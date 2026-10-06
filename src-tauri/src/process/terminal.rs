use crate::{
    error::{codes, AppError, AppResult},
    process::reaper::{self, MAX_SESSION_AGE, OUTPUT_LIMIT_BYTES},
};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{self, SyncSender},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, WebviewWindow};

const MAX_SESSIONS_GLOBAL: usize = 16;
const MAX_SESSIONS_PER_WINDOW: usize = 4;
const MIN_COLS: u16 = 10;
const MAX_COLS: u16 = 1000;
const MAX_WRITE_BYTES: usize = 256 * 1024;
/// Writes waiting behind a stuck writer before `write` fails fast with
/// `pty-write-busy` (backpressure; wps_02 D-6).
const MAX_PENDING_WRITES: usize = 4;
/// Total time a write may take before the caller gets `pty-write-timeout`
/// (wps_02 D-5).
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const REAPER_INTERVAL: Duration = Duration::from_secs(60);
/// Output coalescing window/buffer used on Unix (wps_02 D-6).
#[cfg(unix)]
const COALESCE_WINDOW: Duration = Duration::from_millis(8);
#[cfg(unix)]
const MAX_COALESCE_BYTES: usize = 64 * 1024;

type PtyChild = Box<dyn Child + Send + Sync>;

/// One queued terminal write with a private reply channel.
struct WriteRequest {
    bytes: Vec<u8>,
    reply: mpsc::Sender<std::io::Result<()>>,
}

struct TerminalSession {
    id: String,
    window_label: String,
    cwd: PathBuf,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// Bounded channel into the per-session writer thread; never a lock held
    /// across a blocking PTY write.
    write_requests: SyncSender<WriteRequest>,
    child: Mutex<PtyChild>,
    pid: Option<u32>,
    /// File recording this session's process-group leader, so the group can be
    /// killed at next startup if our process died without reaping it (wps_02 D-3).
    orphan_marker: Option<PathBuf>,
    output_bytes: AtomicUsize,
    stopping: AtomicBool,
    started: Instant,
    events: Channel<TerminalEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    pub started: bool,
    pub cwd: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    #[serde(rename = "type")]
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
    session_id: String,
    window_label: String,
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<TerminalSession>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<TerminalSession>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn key(window_label: &str, session_id: &str) -> String {
    format!("{window_label}\u{1f}{session_id}")
}

// --- Orphan-session markers (Unix; wps_02 D-3) -----------------------------
// portable_pty cannot install PR_SET_PDEATHSIG for us, so a session whose
// parent process crashes would otherwise keep running under init. Each live
// session records its group leader on disk; the file is removed on every
// explicit teardown. Markers left behind are reaped at the next startup.

fn orphan_dir(window: &WebviewWindow) -> Option<PathBuf> {
    use tauri::Manager;
    let dir = window
        .app_handle()
        .path()
        .app_data_dir()
        .ok()?
        .join("terminal-pids");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn orphan_marker_path(window: &WebviewWindow, label: &str, id: &str) -> Option<PathBuf> {
    // label/id are restricted to filename-safe characters at validation time.
    Some(orphan_dir(window)?.join(format!("{label}__{id}.json")))
}

#[cfg(unix)]
fn record_orphan_marker(marker: &PathBuf, group_leader: i32) {
    let payload = serde_json::json!({ "pgid": group_leader }).to_string();
    let _ = std::fs::write(marker, payload);
}

fn clear_orphan_marker(session: &TerminalSession) {
    if let Some(marker) = &session.orphan_marker {
        let _ = std::fs::remove_file(marker);
    }
}

/// Kill process groups left by a crashed previous instance and clear their
/// markers. Called once during startup setup. Best effort only.
pub fn reap_orphan_sessions(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let dir = data_dir.join("terminal-pids");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(content) = std::fs::read_to_string(&path) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(group) = value.get("pgid").and_then(|value| value.as_i64()) {
                    if let Ok(group) = i32::try_from(group) {
                        #[cfg(unix)]
                        unsafe {
                            libc::kill(-group, libc::SIGKILL);
                        }
                        // On Windows the killing is handled through the
                        // kill-on-close job object; the marker is still cleared.
                        #[cfg(not(unix))]
                        let _ = group;
                    }
                }
            }
        }
        let _ = std::fs::remove_file(&path);
    }
}

fn shell_command() -> PathBuf {
    if cfg!(windows) {
        std::env::var_os("COMSPEC")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("cmd.exe"))
    } else {
        std::env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| PathBuf::from("/bin/sh"))
    }
}

pub fn start(
    window: WebviewWindow,
    events: Channel<TerminalEvent>,
    requested_id: String,
    cwd: PathBuf,
    cols: u16,
    rows: u16,
) -> AppResult<TerminalStartResult> {
    let id = normalize_session_id(&requested_id)?;
    let label = window.label().to_owned();
    let session_key = key(&label, &id);

    let metadata = std::fs::metadata(&cwd)?;
    if !metadata.is_dir() {
        return Err(AppError::invalid(
            "Terminal working directory is not a directory",
        ));
    }

    // Open the PTY and spawn the shell before touching the registry. If a
    // concurrent start for the same key wins the race below, the freshly
    // spawned child is rolled back here (review report P8: the previous
    // check-then-act allowed two spawns and an orphaned session).
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.clamp(2, 500),
            cols: cols.clamp(MIN_COLS, MAX_COLS),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::new(codes::PTY_ERROR, error.to_string()))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| AppError::new(codes::PTY_ERROR, error.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| AppError::new(codes::PTY_ERROR, error.to_string()))?;
    // Dedicated writer thread owns the blocking PTY writer. Callers queue
    // bounded requests and time out instead of holding an IPC thread inside a
    // blocking write forever (wps_02 D-5/D-6). Started before the child is
    // spawned so a thread-creation failure needs no child cleanup.
    let (write_sender, write_receiver) =
        mpsc::sync_channel::<WriteRequest>(MAX_PENDING_WRITES);
    let writer_started = std::thread::Builder::new()
        .name("pty-writer".to_owned())
        .spawn(move || {
            let mut writer = writer;
            while let Ok(request) = write_receiver.recv() {
                let outcome = writer.write_all(&request.bytes).and_then(|_| writer.flush());
                let _ = request.reply.send(outcome);
            }
        });
    if let Err(error) = writer_started {
        return Err(AppError::internal(format!(
            "Failed to start terminal writer thread: {error}"
        )));
    }
    let mut command = CommandBuilder::new(shell_command());
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    if cfg!(windows) {
        command.env("PROMPT", "$P$G");
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| AppError::new(codes::PTY_ERROR, error.to_string()))?;
    let pid = child.process_id();
    // portable_pty only exposes the group-leader pid on Unix (the method is
    // absent from the trait on Windows, where job-object binding is used).
    #[cfg(unix)]
    let group_leader = child.process_group_leader();
    drop(pair.slave);

    // Capture the raw master fd for the reader thread's poll() before the
    // master is moved into the session (Unix).
    #[cfg(unix)]
    let reader_fd = pair.master.as_raw_fd().unwrap_or_default();
    let orphan_marker = orphan_marker_path(&window, &label, &id);
    let session = Arc::new(TerminalSession {
        id,
        window_label: label.clone(),
        cwd,
        master: Mutex::new(pair.master),
        write_requests: write_sender,
        child: Mutex::new(child),
        pid,
        orphan_marker,
        output_bytes: AtomicUsize::new(0),
        stopping: AtomicBool::new(false),
        started: Instant::now(),
        events,
    });

    // One critical section: duplicate check, quota check and the insert all
    // happen under the same lock. The loser of a same-key race never reaches
    // the registry, so it cannot occupy the 16-session quota until the 8 h
    // reaper comes along.
    let inserted = {
        let mut active = sessions().lock();
        if active.contains_key(&session_key) {
            Err(AppError::new(
                codes::SESSION_ALREADY_ACTIVE,
                "A terminal session with this id is already active",
            ))
        } else if active.len() >= MAX_SESSIONS_GLOBAL
            || active
                .values()
                .filter(|existing| existing.window_label == label)
                .count()
                >= MAX_SESSIONS_PER_WINDOW
        {
            Err(AppError::new(
                codes::SESSION_LIMIT,
                "Too many terminal sessions are active",
            ))
        } else {
            active.insert(session_key, session.clone());
            Ok(())
        }
    };
    if let Err(error) = inserted {
        // Roll back the spawned child; the reader thread was never started and
        // nothing was registered, so no quota is leaked.
        stop_session(&session);
        return Err(error);
    }
    // Parent-death binding (wps_02 D-3). Windows: assign into the kill-on-close
    // job. Unix: record the group leader so a crashed instance is reaped next startup.
    #[cfg(windows)]
    if let Some(pid) = session.pid {
        reaper::bind_pid(pid);
    }
    #[cfg(unix)]
    if let (Some(marker), Some(group)) = (&session.orphan_marker, group_leader) {
        record_orphan_marker(marker, group);
    }
    #[cfg(unix)]
    let spawn_result = spawn_reader(session.clone(), reader, reader_fd);
    #[cfg(not(unix))]
    let spawn_result = spawn_reader(session.clone(), reader);
    if let Err(error) = spawn_result {
        // Thread creation failed (rlimit/thread exhaustion): roll the registered
        // session back so the quota slot is not held until the 8 h reaper and no
        // output-less zombie session remains (wps_02 D-10).
        sessions()
            .lock()
            .remove(&key(&label, &session.id));
        stop_session(&session);
        log::error!(
            "Failed to start PTY reader thread for session {}: {error}",
            session.id
        );
        return Err(AppError::internal(format!(
            "Failed to start terminal reader: {error}"
        )));
    }
    ensure_reaper();
    Ok(start_result(&session))
}

pub fn write(window: &WebviewWindow, session_id: &str, data: String) -> AppResult<()> {
    if data.contains('\0') || data.len() > MAX_WRITE_BYTES {
        return Err(AppError::invalid("Terminal input is invalid or too large"));
    }
    let session = get(window.label(), session_id)?;
    if session.stopping.load(Ordering::SeqCst) {
        return Err(AppError::new(
            codes::SESSION_ENDED,
            "The terminal session has ended",
        ));
    }
    let (reply, outcome) = mpsc::channel();
    // Bounded enqueue: when a previous write is stuck and the queue is full,
    // fail fast with `pty-write-busy` instead of piling up pending writes.
    session
        .write_requests
        .try_send(WriteRequest {
            bytes: data.into_bytes(),
            reply,
        })
        .map_err(|_| {
            AppError::new(
                codes::PTY_WRITE_BUSY,
                "The terminal is not accepting input right now",
            )
        })?;
    match outcome.recv_timeout(WRITE_TIMEOUT) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(error.into()),
        Err(mpsc::RecvTimeoutError::Timeout) => Err(AppError::new(
            codes::PTY_WRITE_TIMEOUT,
            "The terminal did not accept the input in time",
        )),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(AppError::internal(
            "The terminal writer thread stopped unexpectedly",
        )),
    }
    // The stuck-write window: a timed-out request may still complete when the
    // child resumes; later requests queue behind it until the queue reports
    // busy. Stopping the session kills the child and unblocks the writer.
}

pub fn resize(window: &WebviewWindow, session_id: &str, cols: u16, rows: u16) -> AppResult<()> {
    let session = get(window.label(), session_id)?;
    let result = session
        .master
        .lock()
        .resize(PtySize {
            rows: rows.clamp(2, 500),
            cols: cols.clamp(MIN_COLS, MAX_COLS),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| AppError::new(codes::PTY_ERROR, error.to_string()));
    result
}

pub fn kill(window_label: &str, session_id: &str) -> AppResult<bool> {
    let Some(session) = sessions().lock().remove(&key(window_label, session_id)) else {
        return Ok(false);
    };
    stop_session(&session);
    Ok(true)
}

pub fn kill_window(window_label: &str) -> usize {
    let removed = {
        let mut active = sessions().lock();
        let keys = active
            .iter()
            .filter_map(|(key, session)| {
                (session.window_label == window_label).then_some(key.clone())
            })
            .collect::<Vec<_>>();
        keys.into_iter()
            .filter_map(|key| active.remove(&key))
            .collect::<Vec<_>>()
    };
    for session in &removed {
        stop_session(session);
    }
    removed.len()
}

fn get(window_label: &str, session_id: &str) -> AppResult<Arc<TerminalSession>> {
    sessions()
        .lock()
        .get(&key(window_label, session_id))
        .cloned()
        .ok_or_else(|| AppError::not_found("Terminal session was not found"))
}

fn normalize_session_id(requested: &str) -> AppResult<String> {
    let id = requested.trim();
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_'))
    {
        return Err(AppError::invalid("Invalid terminal session id"));
    }
    Ok(id.to_owned())
}

fn start_result(session: &TerminalSession) -> TerminalStartResult {
    TerminalStartResult {
        started: true,
        cwd: session.cwd.to_string_lossy().into_owned(),
        session_id: session.id.clone(),
    }
}

fn spawn_reader(
    session: Arc<TerminalSession>,
    mut reader: Box<dyn Read + Send>,
    #[cfg(unix)] reader_fd: i32,
) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name(format!("pty-reader-{}", session.id))
        // Mutability of batch/keep/hit_limit/eof is consumed only by the
        // Unix-gated coalescing block.
        .spawn(#[allow(unused_mut)] move || {
            let mut buffer = [0_u8; 8192];
            // The 4 MiB notice fires once; over-limit bytes are drained and
            // discarded while the session itself stays alive (wps_10 B2).
            let mut limit_notice_sent = false;
            'read: loop {
                // Unix: poll with a bounded timeout so an idle, stopping session
                // exits promptly instead of sitting in a blocking read.
                #[cfg(unix)]
                {
                    let mut can_read = false;
                    while !can_read {
                        match wait_readable(reader_fd, 250, &session.stopping) {
                            Ok(true) => can_read = true,
                            Ok(false) => {
                                if session.stopping.load(Ordering::SeqCst) {
                                    break 'read;
                                }
                            }
                            // wps_10 D1: a poll failure kills the reader thread;
                            // previously the session died silently.
                            Err(error) => {
                                log::warn!(
                                    "PTY reader poll failed, ending reader for session {}: {error}",
                                    session.id
                                );
                                break 'read;
                            }
                        }
                    }
                }
                let count = match reader.read(&mut buffer) {
                    // wps_10 D1: reader-thread death must leave a trace. EOF is
                    // the normal child-exit path (debug level); a read error is
                    // unexpected and warned. Both still reap and emit_exit below.
                    Ok(0) => {
                        log::debug!("PTY reader reached EOF for session {}", session.id);
                        break;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(error) => {
                        log::warn!(
                            "PTY reader read failed, ending reader for session {}: {error}",
                            session.id
                        );
                        break;
                    }
                    Ok(count) => count,
                };
                let previous = session.output_bytes.fetch_add(count, Ordering::Relaxed);
                let mut keep = if previous >= OUTPUT_LIMIT_BYTES {
                    0
                } else {
                    count.min(OUTPUT_LIMIT_BYTES - previous)
                };
                let mut batch = String::from_utf8_lossy(&buffer[..keep]).into_owned();
                let mut over_limit = keep < count;
                let mut eof = false;

                // Coalesce further bytes that are already queued, within a short
                // window, so high-throughput output emits one event instead of
                // one per read (Unix only; wps_02 D-6).
                #[cfg(unix)]
                {
                    let deadline = Instant::now() + COALESCE_WINDOW;
                    'coalesce: while !over_limit && batch.len() < MAX_COALESCE_BYTES {
                        let timeout = deadline
                            .saturating_duration_since(Instant::now())
                            .as_millis()
                            .min(i32::MAX as u128) as i32;
                        match wait_readable(reader_fd, timeout + 1, &session.stopping) {
                            Ok(true) => {}
                            _ => break 'coalesce,
                        }
                        match reader.read(&mut buffer) {
                            Ok(0) => {
                                eof = true;
                                break 'coalesce;
                            }
                            Err(error)
                                if error.kind() == std::io::ErrorKind::Interrupted =>
                            {
                                continue 'coalesce
                            }
                            Err(error) => {
                                log::debug!(
                                    "PTY output coalescing ended on read error for session {}: {error}",
                                    session.id
                                );
                                break 'coalesce;
                            }
                            Ok(extra) => {
                                let previous =
                                    session.output_bytes.fetch_add(extra, Ordering::Relaxed);
                                keep = if previous >= OUTPUT_LIMIT_BYTES {
                                    0
                                } else {
                                    extra.min(OUTPUT_LIMIT_BYTES - previous)
                                };
                                batch.push_str(&String::from_utf8_lossy(&buffer[..keep]));
                                if keep < extra {
                                    over_limit = true;
                                }
                            }
                        }
                    }
                }

                if !batch.is_empty() {
                    emit_output(&session, &batch);
                }
                if over_limit && !limit_notice_sent {
                    emit_output(
                        &session,
                        "\r\n[terminal output limit reached; further output is discarded, session stays active]\r\n",
                    );
                    limit_notice_sent = true;
                }
                if eof {
                    break 'read;
                }
            }
            if !session.stopping.swap(true, Ordering::SeqCst) {
                reaper::terminate_process_tree_sync(session.pid);
                let _ = session.child.lock().kill();
            }
            let code = session
                .child
                .lock()
                .try_wait()
                .ok()
                .flatten()
                .map(|status| status.exit_code());
            sessions()
                .lock()
                .remove(&key(&session.window_label, &session.id));
            clear_orphan_marker(&session);
            emit_exit(&session, code);
        })?;
    Ok(())
}

/// Poll `fd` for input. Returns true when readable, false on timeout.
#[cfg(unix)]
fn wait_readable(fd: i32, timeout_ms: i32, stopping: &AtomicBool) -> std::io::Result<bool> {
    if stopping.load(Ordering::SeqCst) {
        return Ok(false);
    }
    let mut pollfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let ready = unsafe { libc::poll(&mut pollfd as *mut _, 1, timeout_ms) };
    if ready < 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EINTR) {
            return Ok(false);
        }
        return Err(error);
    }
    Ok(ready > 0 && pollfd.revents & libc::POLLIN != 0)
}

fn ensure_reaper() {
    static REAPER: OnceLock<()> = OnceLock::new();
    REAPER.get_or_init(|| {
        std::thread::Builder::new()
            .name("pty-session-reaper".into())
            .spawn(|| loop {
                std::thread::sleep(REAPER_INTERVAL);
                let expired = {
                    let mut active = sessions().lock();
                    let keys = active
                        .iter()
                        .filter(|(_, session)| session.started.elapsed() >= MAX_SESSION_AGE)
                        .map(|(key, _)| key.clone())
                        .collect::<Vec<_>>();
                    keys.into_iter()
                        .filter_map(|key| active.remove(&key))
                        .collect::<Vec<_>>()
                };
                for session in expired {
                    emit_output(&session, "\r\n[terminal session expired]\r\n");
                    stop_session(&session);
                }
            })
            .expect("failed to start PTY session reaper");
    });
}

fn stop_session(session: &TerminalSession) {
    if session.stopping.swap(true, Ordering::SeqCst) {
        return;
    }
    reaper::terminate_process_tree_sync(session.pid);
    let _ = session.child.lock().kill();
    clear_orphan_marker(session);
}

fn emit_output(session: &TerminalSession, text: &str) {
    let _ = session.events.send(TerminalEvent {
        kind: "output",
        text: Some(text.to_owned()),
        code: None,
        session_id: session.id.clone(),
        window_label: session.window_label.clone(),
    });
}

fn emit_exit(session: &TerminalSession, code: Option<u32>) {
    let _ = session.events.send(TerminalEvent {
        kind: "exit",
        text: None,
        code: code.and_then(|value| i32::try_from(value).ok()),
        session_id: session.id.clone(),
        window_label: session.window_label.clone(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_session_ids() {
        assert_eq!(normalize_session_id("term_1-a").unwrap(), "term_1-a");
        assert!(normalize_session_id("../bad").is_err());
        assert!(normalize_session_id("").is_err());
    }

    #[test]
    fn registry_key_is_window_scoped() {
        assert_ne!(key("main", "default"), key("second", "default"));
    }

    #[test]
    fn shell_is_platform_appropriate() {
        let shell = shell_command();
        assert!(!shell.as_os_str().is_empty());
        if !cfg!(windows) {
            assert!(shell.is_absolute());
        }
    }
}

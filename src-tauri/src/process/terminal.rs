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
const REAPER_INTERVAL: Duration = Duration::from_secs(60);

type PtyWriter = Box<dyn Write + Send>;
type PtyChild = Box<dyn Child + Send + Sync>;

struct TerminalSession {
    id: String,
    window_label: String,
    cwd: PathBuf,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<PtyWriter>,
    child: Mutex<PtyChild>,
    pid: Option<u32>,
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
    drop(pair.slave);

    let session = Arc::new(TerminalSession {
        id,
        window_label: label.clone(),
        cwd,
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        pid,
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
    spawn_reader(session.clone(), reader);
    ensure_reaper();
    Ok(start_result(&session))
}

pub fn write(window: &WebviewWindow, session_id: &str, data: String) -> AppResult<()> {
    if data.contains('\0') || data.len() > MAX_WRITE_BYTES {
        return Err(AppError::invalid("Terminal input is invalid or too large"));
    }
    let session = get(window.label(), session_id)?;
    let mut writer = session.writer.lock();
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(AppError::from)
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

fn spawn_reader(session: Arc<TerminalSession>, mut reader: Box<dyn Read + Send>) {
    std::thread::Builder::new()
        .name(format!("pty-reader-{}", session.id))
        .spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                let count = match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => count,
                };
                let previous = session.output_bytes.fetch_add(count, Ordering::Relaxed);
                if previous >= OUTPUT_LIMIT_BYTES {
                    break;
                }
                let keep = count.min(OUTPUT_LIMIT_BYTES - previous);
                let text = String::from_utf8_lossy(&buffer[..keep]);
                emit_output(&session, &text);
                if keep < count {
                    emit_output(&session, "\r\n[terminal output limit reached]\r\n");
                    break;
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
            emit_exit(&session, code);
        })
        .ok();
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

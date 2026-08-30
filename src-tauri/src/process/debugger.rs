use crate::{
    error::{AppError, AppResult},
    process::dependencies::resolve_executable,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::{BufRead, BufReader, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, WebviewWindow};
use tempfile::TempDir;
use tungstenite::{client, error::Error as WebSocketError, Message, WebSocket};
use uuid::Uuid;

const MAX_DEBUG_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_DEBUG_SOURCE_BYTES: u64 = 10 * 1024 * 1024;
const INSPECTOR_START_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_DEBUG_SESSION_AGE: Duration = Duration::from_secs(8 * 60 * 60);

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DebugBreakpoint {
    pub file: String,
    pub line: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "kebab-case")]
pub enum DebugCommand {
    Continue,
    StepOver,
    StepInto,
    StepOut,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DebugStartResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub kind: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub error: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub session_id: Option<String>,
}

enum DebugControl {
    Node(Sender<NodeRequest>),
    Python {
        stdin: Arc<Mutex<ChildStdin>>,
        parser: Box<Mutex<PdbParser>>,
    },
}

struct DebugSession {
    id: String,
    window_label: String,
    file_path: PathBuf,
    inspector_path: PathBuf,
    _temp_dir: Option<TempDir>,
    events: Channel<Value>,
    child: Arc<Mutex<Child>>,
    pid: u32,
    control: DebugControl,
    stopping: AtomicBool,
    exit_emitted: AtomicBool,
    output_bytes: std::sync::atomic::AtomicUsize,
    started: Instant,
}

enum NodeRequest {
    Command(DebugCommand),
    Evaluate { expression: String, id: String },
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PdbLastCommand {
    Start,
    SetBreak,
    Continue,
    Step,
    Vars,
    Eval,
    None,
}

#[derive(Debug, Clone)]
struct PausedState {
    reason: &'static str,
    frame: PdbFrame,
}

#[derive(Debug, Clone)]
struct PdbFrame {
    file: String,
    line: u32,
    name: String,
}

struct PdbParser {
    buffer: String,
    pending_lines: Vec<String>,
    last_command: PdbLastCommand,
    break_index: usize,
    breakpoints: Vec<DebugBreakpoint>,
    breakpoint_set: HashSet<String>,
    pending_paused: Option<PausedState>,
    pending_eval: Option<String>,
}

impl PdbParser {
    fn new(breakpoints: Vec<DebugBreakpoint>) -> Self {
        Self {
            buffer: String::new(),
            pending_lines: Vec::new(),
            last_command: PdbLastCommand::Start,
            break_index: 0,
            breakpoint_set: breakpoints
                .iter()
                .map(|breakpoint| breakpoint_key(&breakpoint.file, breakpoint.line))
                .collect(),
            breakpoints,
            pending_paused: None,
            pending_eval: None,
        }
    }
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<DebugSession>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<DebugSession>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn session_key(window_label: &str, session_id: &str) -> String {
    format!("{window_label}\u{1f}{session_id}")
}

pub fn start(
    window: WebviewWindow,
    events: Channel<Value>,
    file_path: PathBuf,
    breakpoints: Vec<DebugBreakpoint>,
) -> AppResult<DebugStartResult> {
    stop(&window, None)?;
    let metadata = std::fs::metadata(&file_path)?;
    if !metadata.is_file() {
        return Err(AppError::invalid("Debugger accepts files only"));
    }
    if metadata.len() > MAX_DEBUG_SOURCE_BYTES {
        return Err(AppError::new(
            "file-too-large",
            "Debugger source files are limited to 10 MiB",
        ));
    }
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let allowed_breakpoints = validate_breakpoints(&file_path, breakpoints)?;
    match extension.as_str() {
        "js" | "jsx" | "mjs" | "cjs" | "ts" | "tsx" => {
            start_node(window, events, file_path, allowed_breakpoints)
        }
        "py" | "pyw" => start_python(window, events, file_path, allowed_breakpoints),
        _ => Ok(start_failure("unsupported")),
    }
}

pub fn stop(window: &WebviewWindow, session_id: Option<&str>) -> AppResult<bool> {
    let session = find_session(window.label(), session_id);
    let Some(session) = session else {
        return Ok(false);
    };
    sessions()
        .lock()
        .remove(&session_key(&session.window_label, &session.id));
    stop_session(&session);
    Ok(true)
}

pub fn stop_window(window_label: &str) -> usize {
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

fn stop_session(session: &DebugSession) {
    if session.stopping.swap(true, Ordering::SeqCst) {
        return;
    }
    match &session.control {
        DebugControl::Node(sender) => {
            let _ = sender.send(NodeRequest::Stop);
        }
        DebugControl::Python { stdin, .. } => {
            let _ = writeln!(stdin.lock(), "quit");
            let _ = stdin.lock().flush();
        }
    }
    terminate_tree(session.pid);
    let _ = session.child.lock().kill();
    emit_exit_once(session, None);
}

pub fn send_command(
    window: &WebviewWindow,
    session_id: Option<&str>,
    command: DebugCommand,
) -> AppResult<()> {
    let session = find_session(window.label(), session_id)
        .ok_or_else(|| AppError::not_found("Debug session was not found"))?;
    match &session.control {
        DebugControl::Node(sender) => sender
            .send(NodeRequest::Command(command))
            .map_err(|_| AppError::new("session-ended", "The Node debugger has stopped"))?,
        DebugControl::Python { stdin, parser } => {
            let value = match command {
                DebugCommand::Continue => "continue",
                DebugCommand::StepOver => "next",
                DebugCommand::StepInto => "step",
                DebugCommand::StepOut => "return",
            };
            parser.lock().last_command = if matches!(command, DebugCommand::Continue) {
                PdbLastCommand::Continue
            } else {
                PdbLastCommand::Step
            };
            write_line(stdin, value)?;
        }
    }
    if matches!(session.control, DebugControl::Python { .. }) {
        emit_event(&session, json!({ "event": "resumed" }));
    }
    Ok(())
}

pub fn evaluate(
    window: &WebviewWindow,
    session_id: Option<&str>,
    expression: String,
    id: String,
) -> AppResult<()> {
    let expression = expression.trim().to_owned();
    if expression.is_empty()
        || expression.len() > 16 * 1024
        || expression.contains(['\r', '\n', '\0'])
    {
        return Err(AppError::invalid(
            "Debug expression is empty, invalid, or too large",
        ));
    }
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::invalid("Invalid evaluation id"));
    }
    let session = find_session(window.label(), session_id)
        .ok_or_else(|| AppError::not_found("Debug session was not found"))?;
    match &session.control {
        DebugControl::Node(sender) => sender
            .send(NodeRequest::Evaluate { expression, id })
            .map_err(|_| AppError::new("session-ended", "The Node debugger has stopped")),
        DebugControl::Python { stdin, parser } => {
            let mut parser = parser.lock();
            if parser.pending_eval.is_some() {
                return Err(AppError::new(
                    "debugger-busy",
                    "A Python evaluation is already pending",
                ));
            }
            parser.last_command = PdbLastCommand::Eval;
            parser.pending_eval = Some(id);
            drop(parser);
            write_line(stdin, &format!("p {expression}"))
        }
    }
}

fn start_node(
    window: WebviewWindow,
    events: Channel<Value>,
    file_path: PathBuf,
    breakpoints: Vec<DebugBreakpoint>,
) -> AppResult<DebugStartResult> {
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let Some(executable) = resolve_executable("node") else {
        return Ok(start_failure("dependency-missing"));
    };

    let needs_transpiler = is_node_transpile_extension(&extension);
    let (inspector_path, temp_dir) = if needs_transpiler {
        let esbuild = super::runner::bundled_esbuild_path();
        if !esbuild.is_file() {
            return Ok(start_failure("dependency-missing"));
        }
        let temp_dir = tempfile::tempdir()?;
        let compiled = temp_dir.path().join("program.cjs");
        let output = Command::new(&esbuild)
            .arg(&file_path)
            .arg("--bundle")
            .arg("--platform=node")
            .arg("--format=cjs")
            .arg("--sourcemap=inline")
            .arg("--log-level=warning")
            .arg(format!("--outfile={}", compiled.to_string_lossy()))
            .current_dir(file_path.parent().unwrap_or_else(|| Path::new(".")))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| AppError::new("debug-transpile-failed", error.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::new(
                "debug-transpile-failed",
                stderr.chars().take(8 * 1024).collect::<String>(),
            ));
        }
        (compiled, Some(temp_dir))
    } else {
        (file_path.clone(), None)
    };

    let mut command = Command::new(executable);
    command
        .arg("--enable-source-maps")
        .arg("--inspect-brk=0")
        .arg(&inspector_path)
        .current_dir(file_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(start_failure("dependency-missing"));
        }
        Err(error) => return Err(AppError::new("debug-start-failed", error.to_string())),
    };
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::internal("Node debugger stdout was not captured"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::internal("Node debugger stderr was not captured"))?;
    let id = Uuid::new_v4().to_string();
    let label = window.label().to_owned();
    let (url_sender, url_receiver) = mpsc::sync_channel(1);
    let url_events = events.clone();
    let url_id = id.clone();
    let url_label = label.clone();
    std::thread::Builder::new()
        .name(format!("node-debug-stderr-{id}"))
        .spawn(move || {
            let mut sent_url = false;
            for line in BufReader::new(stderr)
                .take((MAX_DEBUG_OUTPUT + 1) as u64)
                .lines()
                .map_while(Result::ok)
            {
                if let Some(url) = inspector_url(&line) {
                    if !sent_url {
                        let _ = url_sender.send(url);
                        sent_url = true;
                    }
                    continue;
                }
                if !is_inspector_boilerplate(&line) {
                    emit_raw(
                        &url_events,
                        &url_id,
                        &url_label,
                        json!({ "event": "output", "kind": "stderr", "text": format!("{line}\n") }),
                    );
                }
            }
        })
        .map_err(|error| AppError::internal(error.to_string()))?;
    let ws_url = match url_receiver.recv_timeout(INSPECTOR_START_TIMEOUT) {
        Ok(url) => url,
        Err(_) => {
            terminate_tree(pid);
            let _ = child.kill();
            return Ok(start_failure("failed"));
        }
    };
    let socket = match connect_inspector(&ws_url) {
        Ok(socket) => socket,
        Err(error) => {
            terminate_tree(pid);
            let _ = child.kill();
            return Err(error);
        }
    };

    let child = Arc::new(Mutex::new(child));
    let (sender, receiver) = mpsc::channel();
    let session = Arc::new(DebugSession {
        id: id.clone(),
        window_label: label.clone(),
        file_path: file_path.clone(),
        inspector_path,
        _temp_dir: temp_dir,
        events,
        child,
        pid,
        control: DebugControl::Node(sender),
        stopping: AtomicBool::new(false),
        exit_emitted: AtomicBool::new(false),
        output_bytes: std::sync::atomic::AtomicUsize::new(0),
        started: Instant::now(),
    });
    sessions()
        .lock()
        .insert(session_key(&label, &id), session.clone());
    spawn_output_reader(session.clone(), stdout, "stdout");
    spawn_node_loop(session.clone(), socket, receiver, breakpoints);
    emit_event(&session, json!({ "event": "started", "kind": "node" }));
    Ok(DebugStartResult {
        ok: true,
        kind: Some("node"),
        error: None,
        session_id: Some(id),
    })
}

fn start_python(
    window: WebviewWindow,
    events: Channel<Value>,
    file_path: PathBuf,
    breakpoints: Vec<DebugBreakpoint>,
) -> AppResult<DebugStartResult> {
    let candidates: &[&str] = if cfg!(windows) {
        &["python", "py"]
    } else {
        &["python3", "python"]
    };
    let Some((name, executable)) = candidates
        .iter()
        .find_map(|name| resolve_executable(name).map(|path| (*name, path)))
    else {
        return Ok(start_failure("dependency-missing"));
    };
    let mut command = Command::new(executable);
    if cfg!(windows) && name == "py" {
        command.arg("-3");
    }
    command
        .args(["-u", "-m", "pdb"])
        .arg(&file_path)
        .current_dir(file_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(start_failure("dependency-missing"));
        }
        Err(error) => return Err(AppError::new("debug-start-failed", error.to_string())),
    };
    let pid = child.id();
    let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or_else(|| {
        AppError::internal("Python debugger stdin was not captured")
    })?));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::internal("Python debugger stdout was not captured"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| AppError::internal("Python debugger stderr was not captured"))?;
    let id = Uuid::new_v4().to_string();
    let label = window.label().to_owned();
    let session = Arc::new(DebugSession {
        id: id.clone(),
        window_label: label.clone(),
        inspector_path: file_path.clone(),
        file_path,
        _temp_dir: None,
        events,
        child: Arc::new(Mutex::new(child)),
        pid,
        control: DebugControl::Python {
            stdin,
            parser: Box::new(Mutex::new(PdbParser::new(breakpoints))),
        },
        stopping: AtomicBool::new(false),
        exit_emitted: AtomicBool::new(false),
        output_bytes: std::sync::atomic::AtomicUsize::new(0),
        started: Instant::now(),
    });
    sessions()
        .lock()
        .insert(session_key(&label, &id), session.clone());
    spawn_pdb_reader(session.clone(), stdout);
    spawn_output_reader(session.clone(), stderr, "stderr");
    spawn_child_monitor(session.clone());
    emit_event(&session, json!({ "event": "started", "kind": "python" }));
    Ok(DebugStartResult {
        ok: true,
        kind: Some("python"),
        error: None,
        session_id: Some(id),
    })
}

fn spawn_node_loop(
    session: Arc<DebugSession>,
    mut socket: WebSocket<TcpStream>,
    receiver: Receiver<NodeRequest>,
    breakpoints: Vec<DebugBreakpoint>,
) {
    std::thread::Builder::new()
        .name(format!("node-inspector-{}", session.id))
        .spawn(move || {
            let mut command_id = 0_u64;
            let mut pending_evaluations: HashMap<u64, String> = HashMap::new();
            let mut pending_breakpoints: HashMap<u64, (String, u32)> = HashMap::new();
            let mut top_call_frame: Option<String> = None;
            let mut startup_pause = true;
            if send_cdp(&mut socket, &mut command_id, "Debugger.enable", json!({})).is_err()
                || send_cdp(&mut socket, &mut command_id, "Runtime.enable", json!({})).is_err()
            {
                emit_event(
                    &session,
                    json!({ "event": "error", "message": "Could not initialize Node Inspector" }),
                );
                terminate_tree(session.pid);
                return;
            }
            let file_url = url::Url::from_file_path(&session.inspector_path)
                .ok()
                .map(|url| url.to_string())
                .unwrap_or_else(|| session.file_path.to_string_lossy().into_owned());
            for breakpoint in &breakpoints {
                if let Ok(id) = send_cdp(
                    &mut socket,
                    &mut command_id,
                    "Debugger.setBreakpointByUrl",
                    json!({ "lineNumber": breakpoint.line.saturating_sub(1), "url": file_url }),
                ) {
                    pending_breakpoints.insert(id, (breakpoint.file.clone(), breakpoint.line));
                }
            }
            let _ = send_cdp(
                &mut socket,
                &mut command_id,
                "Runtime.runIfWaitingForDebugger",
                json!({}),
            );

            loop {
                while let Ok(request) = receiver.try_recv() {
                    match request {
                        NodeRequest::Stop => {
                            let _ = socket.close(None);
                            return;
                        }
                        NodeRequest::Command(command) => {
                            let method = match command {
                                DebugCommand::Continue => "Debugger.resume",
                                DebugCommand::StepOver => "Debugger.stepOver",
                                DebugCommand::StepInto => "Debugger.stepInto",
                                DebugCommand::StepOut => "Debugger.stepOut",
                            };
                            let _ = send_cdp(&mut socket, &mut command_id, method, json!({}));
                        }
                        NodeRequest::Evaluate { expression, id } => {
                            let (method, params) = if let Some(frame) = &top_call_frame {
                                (
                                    "Debugger.evaluateOnCallFrame",
                                    json!({ "callFrameId": frame, "expression": expression, "silent": true }),
                                )
                            } else {
                                (
                                    "Runtime.evaluate",
                                    json!({ "expression": expression, "includeCommandLineAPI": true, "silent": true }),
                                )
                            };
                            match send_cdp(&mut socket, &mut command_id, method, params) {
                                Ok(command_id) => {
                                    pending_evaluations.insert(command_id, id);
                                }
                                Err(error) => emit_event(
                                    &session,
                                    json!({ "event": "eval-result", "id": id, "error": error.to_string() }),
                                ),
                            }
                        }
                    }
                }
                if let Ok(Some(status)) = session.child.lock().try_wait() {
                    emit_exit_once(&session, status.code());
                    remove_session(&session);
                    return;
                }
                if session.started.elapsed() >= MAX_DEBUG_SESSION_AGE {
                    emit_event(
                        &session,
                        json!({ "event": "error", "message": "Debug session expired" }),
                    );
                    terminate_tree(session.pid);
                    let _ = session.child.lock().kill();
                    break;
                }
                match socket.read() {
                    Ok(Message::Text(text)) => {
                        let Ok(message) = serde_json::from_str::<Value>(&text) else {
                            continue;
                        };
                        if let Some(id) = message.get("id").and_then(Value::as_u64) {
                            if let Some(eval_id) = pending_evaluations.remove(&id) {
                                emit_node_evaluation(&session, &eval_id, &message);
                            }
                            if let Some((file, requested_line)) = pending_breakpoints.remove(&id) {
                                let line = message
                                    .pointer("/result/locations/0/lineNumber")
                                    .or_else(|| message.pointer("/result/actualLocation/lineNumber"))
                                    .and_then(Value::as_u64)
                                    .map(|line| line + 1)
                                    .unwrap_or(u64::from(requested_line));
                                emit_event(
                                    &session,
                                    json!({ "event": "breakpoint-verified", "file": file, "line": line }),
                                );
                            }
                            continue;
                        }
                        match message.get("method").and_then(Value::as_str) {
                            Some("Debugger.paused") => {
                                let frames = node_frames(
                                    &session.file_path,
                                    &session.inspector_path,
                                    &message,
                                );
                                top_call_frame = message
                                    .pointer("/params/callFrames/0/callFrameId")
                                    .and_then(Value::as_str)
                                    .map(ToOwned::to_owned);
                                if startup_pause {
                                    startup_pause = false;
                                    let _ = send_cdp(
                                        &mut socket,
                                        &mut command_id,
                                        "Debugger.resume",
                                        json!({}),
                                    );
                                } else {
                                    let reason = message
                                        .pointer("/params/reason")
                                        .and_then(Value::as_str)
                                        .unwrap_or("breakpoint");
                                    emit_event(
                                        &session,
                                        json!({ "event": "paused", "reason": reason, "frames": frames, "variables": [] }),
                                    );
                                }
                            }
                            Some("Debugger.resumed") => {
                                top_call_frame = None;
                                emit_event(&session, json!({ "event": "resumed" }));
                            }
                            Some("Runtime.exceptionThrown") => {
                                let text = message
                                    .pointer("/params/exceptionDetails/exception/description")
                                    .or_else(|| message.pointer("/params/exceptionDetails/text"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("Uncaught exception");
                                emit_event(
                                    &session,
                                    json!({ "event": "output", "kind": "stderr", "text": format!("{text}\n") }),
                                );
                            }
                            _ => {}
                        }
                    }
                    Ok(Message::Ping(value)) => {
                        let _ = socket.send(Message::Pong(value));
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(WebSocketError::Io(error))
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) => {}
                    Err(WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed) => break,
                    Err(error) => {
                        if !session.stopping.load(Ordering::SeqCst) {
                            emit_event(
                                &session,
                                json!({ "event": "error", "message": error.to_string() }),
                            );
                        }
                        break;
                    }
                }
            }
            if !session.stopping.load(Ordering::SeqCst) {
                terminate_tree(session.pid);
                let _ = session.child.lock().kill();
            }
            let code = session
                .child
                .lock()
                .try_wait()
                .ok()
                .flatten()
                .and_then(|status| status.code());
            emit_exit_once(&session, code);
            remove_session(&session);
        })
        .ok();
}

fn spawn_pdb_reader(session: Arc<DebugSession>, mut stdout: impl Read + Send + 'static) {
    std::thread::Builder::new()
        .name(format!("pdb-reader-{}", session.id))
        .spawn(move || {
            let mut bytes = [0_u8; 4096];
            loop {
                match stdout.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let previous = session.output_bytes.fetch_add(count, Ordering::Relaxed);
                        if previous >= MAX_DEBUG_OUTPUT {
                            terminate_tree(session.pid);
                            break;
                        }
                        let keep = count.min(MAX_DEBUG_OUTPUT - previous);
                        process_pdb_chunk(&session, &bytes[..keep]);
                        if keep < count {
                            emit_event(
                                &session,
                                json!({ "event": "error", "message": "Debug output limit reached" }),
                            );
                            terminate_tree(session.pid);
                            break;
                        }
                    }
                }
            }
        })
        .ok();
}

fn process_pdb_chunk(session: &Arc<DebugSession>, bytes: &[u8]) {
    let DebugControl::Python { stdin, parser } = &session.control else {
        return;
    };
    let mut commands = Vec::new();
    let mut events = Vec::new();
    {
        let mut parser = parser.lock();
        parser.buffer.push_str(&String::from_utf8_lossy(bytes));
        while let Some(index) = parser.buffer.find("(Pdb) ") {
            let prefix = parser.buffer[..index].to_owned();
            parser.buffer.drain(..index + "(Pdb) ".len());
            parser.pending_lines.extend(
                prefix
                    .lines()
                    .filter(|line| !line.is_empty())
                    .map(ToOwned::to_owned),
            );
            let (next_commands, next_events) = handle_pdb_prompt(&mut parser);
            commands.extend(next_commands);
            events.extend(next_events);
        }
    }
    for command in commands {
        if write_line(stdin, &command).is_err() {
            break;
        }
    }
    for event in events {
        if event.get("event").and_then(Value::as_str) == Some("exit") {
            let code = event
                .get("code")
                .and_then(Value::as_i64)
                .map(|code| code as i32);
            emit_exit_once(session, code);
        } else {
            emit_event(session, event);
        }
    }
}

fn handle_pdb_prompt(parser: &mut PdbParser) -> (Vec<String>, Vec<Value>) {
    let raw = std::mem::take(&mut parser.pending_lines);
    let mut commands = Vec::new();
    let mut events = Vec::new();
    match parser.last_command {
        PdbLastCommand::Start => {
            parser.break_index = 0;
            if let Some(first) = parser.breakpoints.first() {
                parser.last_command = PdbLastCommand::SetBreak;
                commands.push(format!("break {}:{}", first.file, first.line));
            } else {
                parser.last_command = PdbLastCommand::Continue;
                commands.push("continue".into());
            }
        }
        PdbLastCommand::SetBreak => {
            if let Some(current) = parser.breakpoints.get(parser.break_index) {
                if !raw.iter().any(|line| line.contains("Error in argument")) {
                    events.push(json!({
                        "event": "breakpoint-verified",
                        "file": current.file,
                        "line": current.line,
                    }));
                }
            }
            parser.break_index += 1;
            if let Some(next) = parser.breakpoints.get(parser.break_index) {
                commands.push(format!("break {}:{}", next.file, next.line));
            } else {
                parser.last_command = PdbLastCommand::Continue;
                commands.push("continue".into());
            }
        }
        PdbLastCommand::Vars => {
            let paused = parser.pending_paused.take();
            parser.last_command = PdbLastCommand::None;
            if let Some(paused) = paused {
                let body = program_output(&raw)
                    .trim()
                    .chars()
                    .take(8000)
                    .collect::<String>();
                let variables = if body.is_empty() {
                    Vec::new()
                } else {
                    vec![json!({ "name": "locals", "value": body })]
                };
                events.push(json!({
                    "event": "paused",
                    "reason": paused.reason,
                    "frames": [frame_value(&paused.frame)],
                    "variables": variables,
                }));
            }
        }
        PdbLastCommand::Eval => {
            let id = parser.pending_eval.take().unwrap_or_default();
            parser.last_command = PdbLastCommand::None;
            let body = program_output(&raw).trim().to_owned();
            if body.starts_with("***") {
                events.push(json!({ "event": "eval-result", "id": id, "error": body }));
            } else {
                events.push(json!({
                    "event": "eval-result",
                    "id": id,
                    "result": if body.is_empty() { "(no value)" } else { &body },
                }));
            }
        }
        PdbLastCommand::Continue | PdbLastCommand::Step => {
            let output = program_output(&raw);
            if !output.trim().is_empty() {
                events.push(json!({
                    "event": "output",
                    "kind": "stdout",
                    "text": format!("{}\n", output.trim_end()),
                }));
            }
            if raw.iter().any(|line| line.contains("The program finished")) {
                events.push(json!({ "event": "exit", "code": 0 }));
                commands.push("quit".into());
                parser.last_command = PdbLastCommand::None;
            } else if let Some(frame) = pdb_current_frame(&raw) {
                let reason = if parser.last_command == PdbLastCommand::Continue {
                    if parser
                        .breakpoint_set
                        .contains(&breakpoint_key(&frame.file, frame.line))
                    {
                        "breakpoint"
                    } else {
                        "exception"
                    }
                } else {
                    "step"
                };
                parser.pending_paused = Some(PausedState { reason, frame });
                parser.last_command = PdbLastCommand::Vars;
                commands.push(
                    "p {k: repr(v) for k, v in list(locals().items()) if not k.startswith('__')}"
                        .into(),
                );
            }
        }
        PdbLastCommand::None => {}
    }
    (commands, events)
}

fn spawn_output_reader(
    session: Arc<DebugSession>,
    mut reader: impl Read + Send + 'static,
    kind: &'static str,
) {
    std::thread::Builder::new()
        .name(format!("debug-{kind}-{}", session.id))
        .spawn(move || {
            let mut bytes = [0_u8; 8192];
            loop {
                let count = match reader.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => count,
                };
                let previous = session.output_bytes.fetch_add(count, Ordering::Relaxed);
                if previous >= MAX_DEBUG_OUTPUT {
                    break;
                }
                let keep = count.min(MAX_DEBUG_OUTPUT - previous);
                let text = String::from_utf8_lossy(&bytes[..keep]);
                emit_event(
                    &session,
                    json!({ "event": "output", "kind": kind, "text": text }),
                );
                if keep < count {
                    emit_event(
                        &session,
                        json!({ "event": "error", "message": "Debug output limit reached" }),
                    );
                    terminate_tree(session.pid);
                    break;
                }
            }
        })
        .ok();
}

fn spawn_child_monitor(session: Arc<DebugSession>) {
    std::thread::Builder::new()
        .name(format!("debug-monitor-{}", session.id))
        .spawn(move || loop {
            match session.child.lock().try_wait() {
                Ok(Some(status)) => {
                    emit_exit_once(&session, status.code());
                    remove_session(&session);
                    return;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => {
                    emit_event(
                        &session,
                        json!({ "event": "error", "message": error.to_string() }),
                    );
                    remove_session(&session);
                    return;
                }
            }
            if session.started.elapsed() >= MAX_DEBUG_SESSION_AGE {
                emit_event(
                    &session,
                    json!({ "event": "error", "message": "Debug session expired" }),
                );
                terminate_tree(session.pid);
                let _ = session.child.lock().kill();
            }
        })
        .ok();
}

fn connect_inspector(url: &str) -> AppResult<WebSocket<TcpStream>> {
    let parsed = url::Url::parse(url)?;
    if parsed.scheme() != "ws" {
        return Err(AppError::denied("Node Inspector must use a local ws URL"));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::invalid("Inspector URL has no host"))?;
    if !matches!(host, "127.0.0.1" | "localhost" | "::1") {
        return Err(AppError::denied("Node Inspector is not local"));
    }
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| AppError::invalid("Inspector URL has no port"))?;
    let address = (host, port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| AppError::not_found("Cannot resolve Node Inspector address"))?;
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(3))?;
    stream.set_read_timeout(Some(Duration::from_millis(100)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let (socket, _) = client(url, stream)
        .map_err(|error| AppError::new("inspector-connection-failed", error.to_string()))?;
    Ok(socket)
}

fn send_cdp(
    socket: &mut WebSocket<TcpStream>,
    command_id: &mut u64,
    method: &str,
    params: Value,
) -> Result<u64, WebSocketError> {
    *command_id += 1;
    let id = *command_id;
    socket.send(Message::Text(
        json!({ "id": id, "method": method, "params": params })
            .to_string()
            .into(),
    ))?;
    Ok(id)
}

fn emit_node_evaluation(session: &DebugSession, id: &str, message: &Value) {
    if let Some(error) = message
        .pointer("/error/message")
        .or_else(|| message.pointer("/result/exceptionDetails/exception/description"))
        .or_else(|| message.pointer("/result/exceptionDetails/text"))
        .and_then(Value::as_str)
    {
        emit_event(
            session,
            json!({ "event": "eval-result", "id": id, "error": error }),
        );
        return;
    }
    let value = message
        .pointer("/result/result")
        .map(cdp_remote_value)
        .unwrap_or_else(|| "undefined".into());
    emit_event(
        session,
        json!({ "event": "eval-result", "id": id, "result": value }),
    );
}

fn cdp_remote_value(value: &Value) -> String {
    value
        .get("value")
        .map(|value| match value {
            Value::String(value) => value.clone(),
            value => value.to_string(),
        })
        .or_else(|| {
            value
                .get("unserializableValue")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .or_else(|| {
            value
                .get("description")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "undefined".into())
}

fn node_frames(original_file: &Path, inspector_file: &Path, message: &Value) -> Vec<Value> {
    message
        .pointer("/params/callFrames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, frame)| {
            let raw_url = frame.get("url").and_then(Value::as_str).unwrap_or_default();
            let resolved = url::Url::parse(raw_url)
                .ok()
                .and_then(|url| url.to_file_path().ok());
            let file = if raw_url.is_empty()
                || resolved.as_deref().is_some_and(|path| path == inspector_file)
            {
                original_file.to_string_lossy().into_owned()
            } else {
                resolved
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_else(|| raw_url.to_owned())
            };
            json!({
                "index": index,
                "name": frame.get("functionName").and_then(Value::as_str).filter(|name| !name.is_empty()).unwrap_or("(anonymous)"),
                "file": file,
                "line": frame.pointer("/location/lineNumber").and_then(Value::as_u64).unwrap_or(0) + 1,
                "column": frame.pointer("/location/columnNumber").and_then(Value::as_u64).unwrap_or(0) + 1,
            })
        })
        .collect()
}

fn is_node_transpile_extension(extension: &str) -> bool {
    matches!(extension, "ts" | "tsx" | "jsx")
}

fn find_session(window_label: &str, session_id: Option<&str>) -> Option<Arc<DebugSession>> {
    let active = sessions().lock();
    if let Some(id) = session_id {
        return active.get(&session_key(window_label, id)).cloned();
    }
    active
        .values()
        .find(|session| session.window_label == window_label)
        .cloned()
}

fn validate_breakpoints(
    file_path: &Path,
    breakpoints: Vec<DebugBreakpoint>,
) -> AppResult<Vec<DebugBreakpoint>> {
    if breakpoints.len() > 1000 {
        return Err(AppError::invalid("Too many debug breakpoints"));
    }
    let canonical = std::fs::canonicalize(file_path)?;
    let mut normalized = Vec::new();
    for breakpoint in breakpoints {
        if breakpoint.line == 0 || breakpoint.line > 10_000_000 {
            return Err(AppError::invalid("Invalid breakpoint line"));
        }
        let path = std::fs::canonicalize(&breakpoint.file)?;
        if path != canonical {
            return Err(AppError::denied(
                "Breakpoints may only target the granted debug file",
            ));
        }
        normalized.push(DebugBreakpoint {
            file: canonical.to_string_lossy().into_owned(),
            line: breakpoint.line,
        });
    }
    Ok(normalized)
}

fn inspector_url(line: &str) -> Option<String> {
    let start = line.find("ws://")?;
    let value = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches(&['.', ',', ')', ']'][..]);
    url::Url::parse(value).ok()?;
    Some(value.to_owned())
}

fn is_inspector_boilerplate(line: &str) -> bool {
    line.starts_with("Debugger listening on")
        || line.starts_with("For help, see:")
        || line == "Debugger attached."
        || line.starts_with("Waiting for the debugger to disconnect")
}

fn pdb_current_frame(lines: &[String]) -> Option<PdbFrame> {
    lines.iter().find_map(|line| parse_pdb_frame(line))
}

fn parse_pdb_frame(line: &str) -> Option<PdbFrame> {
    let value = line.trim().strip_prefix('>')?.trim();
    let close = value.find(')')?;
    let open = value[..close].rfind('(')?;
    let file = value[..open].trim();
    let line = value[open + 1..close].parse().ok()?;
    let name = value[close + 1..]
        .trim()
        .trim_end_matches("()")
        .trim()
        .to_owned();
    Some(PdbFrame {
        file: file.to_owned(),
        line,
        name: if name.is_empty() {
            "<module>".into()
        } else {
            name
        },
    })
}

fn program_output(lines: &[String]) -> String {
    lines
        .iter()
        .filter(|line| parse_pdb_frame(line).is_none() && !line.trim().starts_with("->"))
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

fn frame_value(frame: &PdbFrame) -> Value {
    json!({
        "index": 0,
        "name": frame.name,
        "file": frame.file,
        "line": frame.line,
        "column": 1,
    })
}

fn breakpoint_key(file: &str, line: u32) -> String {
    let path = if cfg!(windows) {
        file.to_ascii_lowercase()
    } else {
        file.to_owned()
    };
    format!("{path}:{line}")
}

fn write_line(stdin: &Arc<Mutex<ChildStdin>>, line: &str) -> AppResult<()> {
    let mut stdin = stdin.lock();
    writeln!(stdin, "{line}")?;
    stdin.flush()?;
    Ok(())
}

fn emit_event(session: &DebugSession, mut event: Value) {
    if let Some(object) = event.as_object_mut() {
        object.insert("sessionId".into(), Value::String(session.id.clone()));
        object.insert(
            "windowLabel".into(),
            Value::String(session.window_label.clone()),
        );
    }
    let _ = session.events.send(event);
}

fn emit_raw(events: &Channel<Value>, session_id: &str, window_label: &str, mut event: Value) {
    if let Some(object) = event.as_object_mut() {
        object.insert("sessionId".into(), Value::String(session_id.to_owned()));
        object.insert("windowLabel".into(), Value::String(window_label.to_owned()));
    }
    let _ = events.send(event);
}

fn emit_exit_once(session: &DebugSession, code: Option<i32>) {
    if !session.exit_emitted.swap(true, Ordering::SeqCst) {
        emit_event(session, json!({ "event": "exit", "code": code }));
    }
}

fn remove_session(session: &DebugSession) {
    let key = session_key(&session.window_label, &session.id);
    let mut active = sessions().lock();
    if active
        .get(&key)
        .is_some_and(|candidate| candidate.id == session.id)
    {
        active.remove(&key);
    }
}

fn start_failure(error: &'static str) -> DebugStartResult {
    DebugStartResult {
        ok: false,
        kind: None,
        error: Some(error),
        session_id: None,
    }
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
fn terminate_tree(pid: u32) {
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
        libc::kill(pid as i32, libc::SIGKILL);
    }
}

#[cfg(windows)]
fn terminate_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_inspector_url() {
        assert_eq!(
            inspector_url("Debugger listening on ws://127.0.0.1:9229/abc"),
            Some("ws://127.0.0.1:9229/abc".into())
        );
        assert_eq!(inspector_url("ordinary stderr"), None);
    }

    #[test]
    fn parses_posix_and_windows_pdb_frames() {
        let unix = parse_pdb_frame("> /tmp/example.py(12)run()").unwrap();
        assert_eq!(unix.file, "/tmp/example.py");
        assert_eq!(unix.line, 12);
        assert_eq!(unix.name, "run");
        let windows = parse_pdb_frame(r"> C:\work\example.py(7)<module>()").unwrap();
        assert_eq!(windows.file, r"C:\work\example.py");
        assert_eq!(windows.line, 7);
        assert_eq!(windows.name, "<module>");
    }

    #[test]
    fn parser_sets_breakpoints_before_continue() {
        let mut parser = PdbParser::new(vec![DebugBreakpoint {
            file: "/tmp/example.py".into(),
            line: 3,
        }]);
        let (commands, events) = handle_pdb_prompt(&mut parser);
        assert_eq!(commands, vec!["break /tmp/example.py:3"]);
        assert!(events.is_empty());
        parser.pending_lines = vec!["Breakpoint 1 at /tmp/example.py:3".into()];
        let (commands, events) = handle_pdb_prompt(&mut parser);
        assert_eq!(commands, vec!["continue"]);
        assert_eq!(events[0]["event"], "breakpoint-verified");
    }

    #[test]
    fn node_frame_mapping_is_one_based() {
        let frames = node_frames(
            Path::new("/tmp/example.js"),
            Path::new("/tmp/example.js"),
            &json!({
                "params": { "callFrames": [{
                    "functionName": "main",
                    "url": "file:///tmp/example.js",
                    "location": { "lineNumber": 4, "columnNumber": 2 }
                }]}
            }),
        );
        assert_eq!(frames[0]["line"], 5);
        assert_eq!(frames[0]["column"], 3);
    }

    #[test]
    fn typescript_debugging_uses_the_transpile_path() {
        assert!(is_node_transpile_extension("ts"));
        assert!(is_node_transpile_extension("tsx"));
        assert!(is_node_transpile_extension("jsx"));
        assert!(!is_node_transpile_extension("js"));
    }
}

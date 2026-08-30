use crate::{
    error::AppResult,
    process::{
        debugger::{DebugBreakpoint, DebugCommand, DebugStartResult},
        dependencies::DependencyStatus,
        runner::CodeRunResult,
        terminal::{TerminalEvent, TerminalStartResult},
    },
    state::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::Channel, State, WebviewWindow};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStartRequest {
    path: String,
    grant_id: String,
    #[serde(default)]
    breakpoints: Vec<DebugBreakpoint>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugCommandRequest {
    command: DebugCommand,
    session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEvaluateRequest {
    expression: String,
    id: String,
    session_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartRequest {
    session_id: Option<String>,
    cwd: Option<String>,
    grant_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteRequest {
    session_id: Option<String>,
    #[serde(alias = "text", alias = "input")]
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    session_id: Option<String>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
pub struct SuccessResult {
    success: bool,
}

#[tauri::command]
pub async fn process_probe_dependencies() -> AppResult<Vec<DependencyStatus>> {
    let mut dependencies = crate::process::dependencies::probe_all().await;
    for converter in crate::documents::converter::probe_office_converters().await {
        if let Some(existing) = dependencies
            .iter_mut()
            .find(|dependency| dependency.id == converter.id)
        {
            existing.available = converter.available;
            existing.path = converter.path;
            existing.version = converter.version;
            for capability in converter.capabilities {
                if !existing.capabilities.contains(&capability) {
                    existing.capabilities.push(capability);
                }
            }
        } else {
            dependencies.push(DependencyStatus {
                id: converter.id,
                available: converter.available,
                path: converter.path,
                version: converter.version,
                capabilities: converter.capabilities,
            });
        }
    }
    Ok(dependencies)
}

#[tauri::command]
pub async fn process_run_code(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<CodeRunResult> {
    let path = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    crate::process::runner::run_file(&path).await
}

#[tauri::command]
pub async fn process_debug_start(
    request: DebugStartRequest,
    on_event: Channel<Value>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<DebugStartResult> {
    let path = state.files.access.resolve(
        window.label(),
        &request.path,
        &request.grant_id,
        false,
        Some(false),
    )?;
    crate::process::debugger::start(window, on_event, path, request.breakpoints)
}

#[tauri::command]
pub async fn process_debug_stop(
    session_id: Option<String>,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    Ok(SuccessResult {
        success: crate::process::debugger::stop(&window, session_id.as_deref())?,
    })
}

#[tauri::command]
pub async fn process_debug_command(
    request: DebugCommandRequest,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    crate::process::debugger::send_command(
        &window,
        request.session_id.as_deref(),
        request.command,
    )?;
    Ok(SuccessResult { success: true })
}

#[tauri::command]
pub async fn process_debug_evaluate(
    request: DebugEvaluateRequest,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    crate::process::debugger::evaluate(
        &window,
        request.session_id.as_deref(),
        request.expression,
        request.id,
    )?;
    Ok(SuccessResult { success: true })
}

#[tauri::command]
pub async fn process_terminal_start(
    request: Option<TerminalStartRequest>,
    on_event: Channel<TerminalEvent>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<TerminalStartResult> {
    let request = request.unwrap_or_default();
    let cwd = match request.cwd {
        Some(path) => state.files.access.resolve(
            window.label(),
            &path,
            request
                .grant_id
                .as_deref()
                .ok_or_else(|| crate::error::AppError::denied("A directory grant is required"))?,
            false,
            Some(true),
        )?,
        None if request.grant_id.is_some() => state.files.access.resolve_grant(
            window.label(),
            request.grant_id.as_deref().expect("grant id checked"),
            false,
            Some(true),
        )?,
        None => state.files.home_dir().to_path_buf(),
    };
    crate::process::terminal::start(
        window,
        on_event,
        request.session_id,
        cwd,
        request.cols.unwrap_or(120),
        request.rows.unwrap_or(30),
    )
}

#[tauri::command]
pub async fn process_terminal_exec(
    input: String,
    on_event: Channel<TerminalEvent>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<TerminalStartResult> {
    crate::process::terminal::exec(
        window,
        on_event,
        input,
        state.files.home_dir().to_path_buf(),
    )
}

#[tauri::command]
pub async fn process_terminal_write(
    request: TerminalWriteRequest,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    crate::process::terminal::write(&window, request.session_id.as_deref(), request.data)?;
    Ok(SuccessResult { success: true })
}

#[tauri::command]
pub async fn process_terminal_resize(
    request: TerminalResizeRequest,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    crate::process::terminal::resize(
        &window,
        request.session_id.as_deref(),
        request.cols,
        request.rows,
    )?;
    Ok(SuccessResult { success: true })
}

#[tauri::command]
pub async fn process_terminal_kill(
    session_id: Option<String>,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    Ok(SuccessResult {
        success: crate::process::terminal::kill(window.label(), session_id.as_deref())?,
    })
}

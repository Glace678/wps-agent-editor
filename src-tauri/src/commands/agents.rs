use crate::{
    agents::{
        conversations::{
            CodexImportResult, ConversationRecord, ConversationSaveRequest, ConversationSummary,
        },
        models::{
            AgentChatRequest, AgentCollaborationEvent, AgentDocumentEvent, AgentDocumentResult,
            AgentRunTaskRequest, AgentTaskResult, CommandSuccess,
        },
        runtime::{run_agent_chat, run_multi_agent_task, AgentChatInput, AgentExecutionContext},
        store::AgentConfig,
    },
    error::{AppError, AppResult},
    state::AppState,
};
use tauri::{ipc::Channel, State, WebviewWindow};

#[tauri::command]
pub async fn agents_list(state: State<'_, AppState>) -> AppResult<Vec<AgentConfig>> {
    Ok(state.agents.list())
}

#[tauri::command]
pub async fn agents_save(
    config: AgentConfig,
    state: State<'_, AppState>,
) -> AppResult<AgentConfig> {
    state.agents.save(config)
}

#[tauri::command]
pub async fn agents_delete(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state.agents.delete(&id)
}

#[tauri::command]
pub async fn agents_conversations_list(
    state: State<'_, AppState>,
) -> AppResult<Vec<ConversationSummary>> {
    Ok(state.conversations.list())
}

#[tauri::command]
pub async fn agents_conversations_get(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<ConversationRecord> {
    state.conversations.get(id.trim())
}

#[tauri::command]
pub async fn agents_conversations_save(
    request: ConversationSaveRequest,
    state: State<'_, AppState>,
) -> AppResult<ConversationRecord> {
    state.conversations.save(request)
}

#[tauri::command]
pub async fn agents_conversations_delete(
    id: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    state.conversations.delete(id.trim())
}

#[tauri::command]
pub async fn agents_conversations_import_codex(
    state: State<'_, AppState>,
) -> AppResult<CodexImportResult> {
    let store = state.conversations.clone();
    tokio::task::spawn_blocking(move || store.import_codex())
        .await
        .map_err(|error| AppError::internal(format!("Codex import task failed: {error}")))?
}

#[tauri::command]
pub async fn agents_chat(
    request: AgentChatRequest,
    on_event: Channel<AgentCollaborationEvent>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<AgentTaskResult> {
    let agent = state
        .agents
        .list()
        .into_iter()
        .find(|agent| agent.id == request.agent_id && agent.enabled)
        .ok_or_else(|| AppError::new("agent-unavailable", "Agent is missing or disabled"))?;
    let (run_id, cancellation) =
        state
            .agent_runtime
            .begin_run(request.run_id.as_deref(), window.label(), on_event)?;
    let conversation_id = request
        .conversation_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(&agent.id)
        .trim();
    if conversation_id.len() > 256 {
        state.agent_runtime.finish_run(&run_id);
        return Err(AppError::invalid(
            "Agent conversation id cannot exceed 256 bytes",
        ));
    }
    let result = run_agent_chat(
        AgentExecutionContext {
            runtime: &state.agent_runtime,
            provider_store: &state.providers,
            files: &state.files,
            window: &window,
            run_id: &run_id,
            cancellation: &cancellation,
        },
        AgentChatInput {
            agent: &agent,
            messages: request.messages,
            conversation_id: conversation_id.to_owned(),
            allow_document_tools: true,
        },
    )
    .await;
    if let Err(error) = &result {
        if error.code == "cancelled" {
            let _ = state.agent_runtime.emit_cancelled(&window, &run_id);
        } else {
            let _ = state.agent_runtime.emit_error(&window, &run_id, error);
        }
    }
    state.agent_runtime.finish_run(&run_id);
    result
}

#[tauri::command]
pub async fn agents_run_task(
    request: AgentRunTaskRequest,
    on_event: Channel<AgentCollaborationEvent>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<AgentTaskResult>> {
    let (run_id, cancellation) =
        state
            .agent_runtime
            .begin_run(request.run_id.as_deref(), window.label(), on_event)?;
    let result = run_multi_agent_task(
        AgentExecutionContext {
            runtime: &state.agent_runtime,
            provider_store: &state.providers,
            files: &state.files,
            window: &window,
            run_id: &run_id,
            cancellation: &cancellation,
        },
        &state.agents,
        request,
    )
    .await;
    if let Err(error) = &result {
        if error.code == "cancelled" {
            let _ = state.agent_runtime.emit_cancelled(&window, &run_id);
        } else {
            let _ = state.agent_runtime.emit_error(&window, &run_id, error);
        }
    }
    state.agent_runtime.finish_run(&run_id);
    result
}

#[tauri::command]
pub async fn agents_cancel(
    run_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<CommandSuccess> {
    let run_id = run_id.trim();
    if run_id.is_empty() {
        return Err(AppError::invalid("Agent run id is required"));
    }
    let cancelled = state.agent_runtime.cancel_run(run_id, &window)?;
    Ok(CommandSuccess {
        success: cancelled,
        already_finished: (!cancelled).then_some(true),
    })
}

#[tauri::command]
pub async fn agents_document_result(
    result: AgentDocumentResult,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<CommandSuccess> {
    state.agent_runtime.accept_document_result(
        result.request_id.trim(),
        window.label(),
        result.result,
    )?;
    Ok(CommandSuccess {
        success: true,
        already_finished: None,
    })
}

#[tauri::command]
pub async fn agents_document_event(
    event: AgentDocumentEvent,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<CommandSuccess> {
    state.agent_runtime.forward_document_event(event, &window)?;
    Ok(CommandSuccess {
        success: true,
        already_finished: None,
    })
}

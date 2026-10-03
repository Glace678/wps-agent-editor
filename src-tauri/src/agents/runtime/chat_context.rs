use super::*;

pub(super) async fn build_provider_messages(
    runtime: &AgentRuntime,
    files: &FileServices,
    owner: &str,
    agent: &AgentConfig,
    messages: Vec<ChatMessage>,
    conversation_id: &str,
    delegation_protocol: Option<&str>,
) -> AppResult<Vec<ProviderMessage>> {
    let mut provider_messages = vec![ProviderMessage {
        role: "system".to_owned(),
        content: DOCUMENT_PROTOCOL.to_owned(),
    }];
    if let Some(protocol) = delegation_protocol {
        provider_messages.push(ProviderMessage {
            role: "system".to_owned(),
            content: protocol.to_owned(),
        });
    }
    if !agent.system_prompt.trim().is_empty() {
        provider_messages.push(ProviderMessage {
            role: "system".to_owned(),
            content: agent.system_prompt.clone(),
        });
    }
    let mut attachment_budget = MAX_ATTACHMENT_CONTEXT_CHARS;
    for message in messages {
        let context = runtime
            .attachment_context(owner, conversation_id, &message, files, attachment_budget)
            .await?;
        attachment_budget = attachment_budget.saturating_sub(context.chars().count());
        let content = if context.is_empty() {
            message.content
        } else if message.content.trim().is_empty() {
            context
        } else {
            format!("{}\n\n{}", message.content, context)
        };
        provider_messages.push(ProviderMessage {
            role: message.role.as_str().to_owned(),
            content,
        });
    }
    Ok(provider_messages)
}

pub(super) fn validate_agent(agent: &AgentConfig) -> AppResult<()> {
    if agent.id.trim().is_empty() || agent.name.trim().is_empty() {
        return Err(AppError::invalid("Agent id and name are required"));
    }
    if agent.provider_id.trim().is_empty() {
        return Err(AppError::invalid("Agent provider id is required"));
    }
    if agent.model.trim().is_empty() {
        return Err(AppError::new(
            "agent-model-required",
            format!("Agent {} requires an explicit model", agent.id),
        ));
    }
    if agent.system_prompt.chars().count() > MAX_SYSTEM_PROMPT_CHARS {
        return Err(AppError::new(
            "request-too-large",
            "Agent system prompt exceeded the 128 KiB character limit",
        ));
    }
    Ok(())
}

pub(super) fn validate_messages(messages: &[ChatMessage]) -> AppResult<()> {
    if messages.is_empty() || messages.len() > MAX_MESSAGES {
        return Err(AppError::invalid(format!(
            "Agent chat requires between 1 and {MAX_MESSAGES} messages"
        )));
    }
    let mut total = 0usize;
    for message in messages {
        let length = message.content.chars().count();
        if length > MAX_MESSAGE_CHARS {
            return Err(AppError::new(
                "request-too-large",
                "A chat message exceeded the 128 KiB character limit",
            ));
        }
        total = total.saturating_add(length);
        if total > MAX_REQUEST_CHARS {
            return Err(AppError::new(
                "request-too-large",
                "Agent chat history exceeded the 512 KiB character limit",
            ));
        }
    }
    Ok(())
}

pub(super) fn portable_chat_context(messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    let total_chars = messages
        .iter()
        .map(|message| message.content.chars().count())
        .sum::<usize>();
    let oversized_message = messages
        .iter()
        .any(|message| message.content.chars().count() > PORTABLE_MESSAGE_CHARS);
    if messages.len() <= PORTABLE_CONTEXT_MESSAGES
        && total_chars <= PORTABLE_CONTEXT_CHARS
        && !oversized_message
    {
        return messages;
    }

    let original_count = messages.len();
    let first_user = messages
        .iter()
        .find(|message| message.role == ChatRole::User && !message.content.trim().is_empty())
        .cloned()
        .map(|mut message| {
            message.content = portable_message_text(&message.content, 16 * 1024);
            message
        });
    let marker = ChatMessage {
        role: ChatRole::System,
        content: format!(
            "This is a portable continuation of a longer saved conversation. The host retained the original request and the most recent context while omitting older messages to stay compatible with external model limits (original message count: {original_count}). Continue the current task from the retained context. Do not claim to remember omitted details; ask for a specific missing detail only when it is essential."
        ),
        attachments: Vec::new(),
    };
    let first_user_chars = first_user
        .as_ref()
        .map(|message| message.content.chars().count())
        .unwrap_or(0);
    let mut remaining_chars = PORTABLE_CONTEXT_CHARS
        .saturating_sub(marker.content.len())
        .saturating_sub(first_user_chars);
    let mut selected = Vec::new();
    for mut message in messages.into_iter().rev() {
        if selected.len() >= PORTABLE_CONTEXT_MESSAGES.saturating_sub(2) || remaining_chars < 256 {
            break;
        }
        message.content = portable_message_text(&message.content, remaining_chars);
        let length = message.content.chars().count();
        if message.content.trim().is_empty() || length > remaining_chars {
            continue;
        }
        remaining_chars = remaining_chars.saturating_sub(length);
        selected.push(message);
    }
    selected.reverse();

    if let Some(first_user) = first_user {
        let already_retained = selected
            .iter()
            .any(|message| message.role == ChatRole::User && message.content == first_user.content);
        if !already_retained {
            selected.insert(0, first_user);
        }
    }

    let mut portable = Vec::with_capacity(selected.len() + 1);
    portable.push(marker);
    portable.extend(selected);
    portable
}

pub(super) fn portable_message_text(value: &str, available: usize) -> String {
    let maximum = available.min(PORTABLE_MESSAGE_CHARS);
    let length = value.chars().count();
    if length <= maximum {
        return value.to_owned();
    }
    if maximum < 128 {
        return value.chars().take(maximum).collect();
    }
    let marker = "\n\n[… middle of this saved message omitted for model portability …]\n\n";
    let marker_length = marker.chars().count();
    let retained = maximum.saturating_sub(marker_length);
    let head = retained / 2;
    let tail = retained.saturating_sub(head);
    let prefix = value.chars().take(head).collect::<String>();
    let suffix = value
        .chars()
        .rev()
        .take(tail)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("{prefix}{marker}{suffix}")
}

pub(super) fn parse_tool_calls(content: &str) -> AppResult<Vec<ParsedToolCall>> {
    let mut calls = Vec::new();
    let mut remaining = content;
    while let Some(start) = remaining.find("```tool") {
        remaining = &remaining[start + "```tool".len()..];
        let Some(end) = remaining.find("```") else {
            return Err(AppError::new(
                "invalid-tool-block",
                "Agent returned an unterminated tool block",
            ));
        };
        let body = remaining[..end].trim();
        let call: ParsedToolCall = serde_json::from_str(body).map_err(|error| {
            AppError::new(
                "invalid-tool-block",
                format!("Agent returned invalid tool JSON: {error}"),
            )
        })?;
        if call.tool.trim().is_empty() {
            return Err(AppError::new(
                "invalid-tool-block",
                "Agent tool name cannot be empty",
            ));
        }
        calls.push(call);
        remaining = &remaining[end + 3..];
    }
    Ok(calls)
}

pub(super) fn is_document_tool(tool: &str) -> bool {
    matches!(
        tool,
        "read_document" | "insert_text" | "append_paragraph" | "replace_text"
    )
}

pub(super) fn build_document_command(
    call: &ParsedToolCall,
    run_id: &str,
    agent: &AgentConfig,
    operation_id: &str,
) -> AppResult<Value> {
    let mut command = Map::new();
    let action = match call.tool.as_str() {
        "read_document" => "readDocument",
        "insert_text" => {
            let text = required_string(&call.args, "text", false)?;
            command.insert("text".to_owned(), Value::String(text));
            let position = call
                .args
                .get("position")
                .and_then(Value::as_str)
                .unwrap_or("cursor");
            if !matches!(position, "cursor" | "start" | "end") {
                return Err(AppError::invalid(
                    "insert_text position must be cursor, start, or end",
                ));
            }
            command.insert("position".to_owned(), Value::String(position.to_owned()));
            "insertText"
        }
        "append_paragraph" => {
            command.insert(
                "text".to_owned(),
                Value::String(required_string(&call.args, "text", false)?),
            );
            "appendParagraph"
        }
        "replace_text" => {
            command.insert(
                "search".to_owned(),
                Value::String(required_string(&call.args, "search", true)?),
            );
            command.insert(
                "replace".to_owned(),
                Value::String(required_string(&call.args, "replace", false)?),
            );
            command.insert(
                "all".to_owned(),
                Value::Bool(
                    call.args
                        .get("all")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                ),
            );
            "replaceText"
        }
        _ => return Err(AppError::invalid("Unsupported document tool")),
    };
    command.insert("action".to_owned(), Value::String(action.to_owned()));
    command.insert(
        "operationId".to_owned(),
        Value::String(operation_id.to_owned()),
    );
    command.insert("runId".to_owned(), Value::String(run_id.to_owned()));
    command.insert("agentId".to_owned(), Value::String(agent.id.clone()));
    command.insert("agentName".to_owned(), Value::String(agent.name.clone()));
    Ok(Value::Object(command))
}

pub(super) fn required_string(
    args: &Map<String, Value>,
    field: &str,
    non_empty: bool,
) -> AppResult<String> {
    let value = args
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::invalid(format!("Tool argument {field} must be a string")))?;
    if non_empty && value.is_empty() {
        return Err(AppError::invalid(format!(
            "Tool argument {field} cannot be empty"
        )));
    }
    if value.chars().count() > MAX_TOOL_ARGUMENT_CHARS {
        return Err(AppError::new(
            "tool-argument-too-large",
            format!("Tool argument {field} exceeded the 64 KiB character limit"),
        ));
    }
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_strict_tool_blocks() {
        let calls = parse_tool_calls(
            "before\n```tool\n{\"tool\":\"read_document\",\"args\":{}}\n```\nafter",
        )
        .unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].tool, "read_document");
    }

    #[test]
    fn rejects_unterminated_tool_blocks() {
        let error = parse_tool_calls("```tool\n{\"tool\":\"read_document\"}").unwrap_err();
        assert_eq!(error.code, "invalid-tool-block");
    }

    #[test]
    fn terminal_is_never_a_document_tool() {
        assert!(!is_document_tool("terminal"));
        assert!(!is_document_tool("run_code"));
    }

    #[test]
    fn validates_document_tool_arguments() {
        let call = ParsedToolCall {
            tool: "replace_text".to_owned(),
            args: serde_json::from_value(json!({
                "search": "",
                "replace": "x"
            }))
            .unwrap(),
        };
        let agent = AgentConfig {
            id: "a".to_owned(),
            name: "A".to_owned(),
            role: String::new(),
            system_prompt: String::new(),
            provider_id: "openai".to_owned(),
            model: "model".to_owned(),
            reasoning: None,
            color: String::new(),
            enabled: true,
            description: None,
        };
        assert!(build_document_command(&call, "run", &agent, "op").is_err());
    }

    #[test]
    fn portable_context_keeps_original_request_and_latest_work() {
        let mut messages = vec![ChatMessage {
            role: ChatRole::User,
            content: "original task".to_owned(),
            attachments: Vec::new(),
        }];
        for index in 0..100 {
            messages.push(ChatMessage {
                role: if index % 2 == 0 {
                    ChatRole::Assistant
                } else {
                    ChatRole::User
                },
                content: format!("message-{index} {}", "x".repeat(2_000)),
                attachments: Vec::new(),
            });
        }
        let portable = portable_chat_context(messages);
        assert!(portable.len() <= PORTABLE_CONTEXT_MESSAGES);
        assert!(portable.first().is_some_and(|message| {
            message.role == ChatRole::System && message.content.contains("portable continuation")
        }));
        assert!(portable
            .iter()
            .any(|message| message.content == "original task"));
        assert!(portable
            .last()
            .is_some_and(|message| message.content.starts_with("message-99")));
        assert!(
            portable
                .iter()
                .map(|message| message.content.chars().count())
                .sum::<usize>()
                <= PORTABLE_CONTEXT_CHARS
        );
    }
}

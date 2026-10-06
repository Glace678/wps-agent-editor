use crate::{
    error::{AppError, AppResult},
    providers::{
        sse_limits::{bounded_sse_bytes, RESPONSE_HEADERS_TIMEOUT, SSE_IDLE_TIMEOUT},
        store::{ProviderProtocol, ProviderStore},
    },
};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    RequestBuilder, Response,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use super::{models::AgentCacheUsage, store::AgentConfig};

pub(crate) const MAX_PROVIDER_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_TEXT_BYTES: usize = 1024 * 1024;
const MAX_SSE_EVENTS: usize = 16_384;

/// Anthropic rejects a request with more than four explicit `cache_control`
/// breakpoints across `system`, `messages`, and `tools`.
const ANTHROPIC_CACHE_BREAKPOINT_CAP: usize = 4;
/// The stable system prefix is cached on its own breakpoint. Everything the
/// caller still has budget for becomes a rolling window over the conversation
/// tail, so a follow-up turn (or the next tool round) reads the entire history
/// from cache instead of re-billing it as cache misses.
const ANTHROPIC_SYSTEM_BREAKPOINTS: usize = 1;
const ANTHROPIC_CONVERSATION_BREAKPOINTS: usize =
    ANTHROPIC_CACHE_BREAKPOINT_CAP.saturating_sub(ANTHROPIC_SYSTEM_BREAKPOINTS);

fn ephemeral_cache_control() -> Value {
    json!({ "type": "ephemeral" })
}

/// Marks the trailing `count` Anthropic conversation entries with a cache
/// breakpoint. A breakpoint caches the whole request prefix up to and including
/// that block, which is what makes the next request's identical prefix a read.
fn mark_anthropic_conversation_breakpoints(messages: &mut [Value], count: usize) {
    let start = messages.len().saturating_sub(count.min(messages.len()));
    for message in messages.iter_mut().skip(start) {
        let Some(blocks) = message.get_mut("content").and_then(Value::as_array_mut) else {
            continue;
        };
        // A breakpoint is honoured on the block the prefix ends at; marking the
        // last block of the message is enough for the prefix to be cached.
        if let Some(block) = blocks.last_mut().filter(|block| block.is_object()) {
            block["cache_control"] = ephemeral_cache_control();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug)]
pub struct ProviderCompletion {
    pub text: String,
    pub usage: AgentCacheUsage,
}

#[derive(Debug, Clone)]
struct ResolvedProvider {
    id: String,
    api: String,
    protocol: ProviderProtocol,
    is_local: bool,
}

enum ProviderPayload {
    Json(Value),
    Events(Vec<(String, Value)>),
}

type DeltaObserver<'a> = dyn Fn(&str) -> AppResult<()> + Send + Sync + 'a;
type EventObserver<'a> = dyn Fn(&str, &Value) -> AppResult<()> + Send + Sync + 'a;

struct CompletionContext<'a> {
    conversation_id: &'a str,
    cancellation: &'a CancellationToken,
    on_delta: Option<&'a DeltaObserver<'a>>,
}

pub async fn complete(
    store: &ProviderStore,
    agent: &AgentConfig,
    messages: &[ProviderMessage],
    conversation_id: &str,
    cancellation: &CancellationToken,
) -> AppResult<ProviderCompletion> {
    complete_streaming(store, agent, messages, conversation_id, cancellation, None).await
}

/// Completes a provider request while reporting text deltas as each bounded
/// SSE frame arrives. The callback is deliberately synchronous: it only
/// forwards a small frame to Tauri's IPC channel and never blocks the network
/// stream on renderer work.
pub async fn complete_streaming(
    store: &ProviderStore,
    agent: &AgentConfig,
    messages: &[ProviderMessage],
    conversation_id: &str,
    cancellation: &CancellationToken,
    on_delta: Option<&DeltaObserver<'_>>,
) -> AppResult<ProviderCompletion> {
    if cancellation.is_cancelled() {
        return Err(cancelled_error());
    }
    let provider = resolve_provider(store, &agent.provider_id)?;
    let model = agent.model.trim();
    if model.is_empty() {
        return Err(AppError::new(
            "agent-model-required",
            format!("Agent {} does not have an explicit model", agent.id),
        ));
    }
    let context = CompletionContext {
        conversation_id,
        cancellation,
        on_delta,
    };
    match provider.protocol {
        ProviderProtocol::Openai | ProviderProtocol::OpenaiCompatible => {
            complete_openai(
                store,
                &provider,
                model,
                &agent.reasoning,
                messages,
                &context,
            )
            .await
        }
        ProviderProtocol::Anthropic => {
            complete_anthropic(
                store,
                &provider,
                model,
                &agent.reasoning,
                messages,
                &context,
            )
            .await
        }
        ProviderProtocol::Google => {
            complete_google(
                store,
                &provider,
                model,
                &agent.reasoning,
                messages,
                &context,
            )
            .await
        }
        ProviderProtocol::Bedrock | ProviderProtocol::Unknown => Err(AppError::new(
            "provider-protocol-unsupported",
            format!(
                "Provider {} uses an unsupported protocol; no fallback request was sent",
                provider.id
            ),
        )),
    }
}

fn resolve_provider(store: &ProviderStore, provider_id: &str) -> AppResult<ResolvedProvider> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err(AppError::invalid("Agent provider id is required"));
    }
    let mut provider = if let Some(custom) = store.custom_get(provider_id) {
        ResolvedProvider {
            id: custom.id,
            api: custom.base_url,
            protocol: custom.protocol,
            is_local: false,
        }
    } else {
        match provider_id {
            "ollama" => ResolvedProvider {
                id: provider_id.to_owned(),
                api: "http://127.0.0.1:11434/v1".to_owned(),
                protocol: ProviderProtocol::OpenaiCompatible,
                is_local: true,
            },
            "openai" => ResolvedProvider {
                id: provider_id.to_owned(),
                api: "https://api.openai.com/v1".to_owned(),
                protocol: ProviderProtocol::Openai,
                is_local: false,
            },
            "anthropic" => ResolvedProvider {
                id: provider_id.to_owned(),
                api: "https://api.anthropic.com".to_owned(),
                protocol: ProviderProtocol::Anthropic,
                is_local: false,
            },
            "google" => ResolvedProvider {
                id: provider_id.to_owned(),
                api: "https://generativelanguage.googleapis.com".to_owned(),
                protocol: ProviderProtocol::Google,
                is_local: false,
            },
            "deepseek" => ResolvedProvider {
                id: provider_id.to_owned(),
                api: "https://api.deepseek.com".to_owned(),
                protocol: ProviderProtocol::OpenaiCompatible,
                is_local: false,
            },
            _ => {
                return Err(AppError::new(
                    "unknown-provider",
                    format!("Unknown provider: {provider_id}"),
                ))
            }
        }
    };
    if let Some(overridden) = store.base_url(&provider.id) {
        provider.api = overridden;
    }
    Ok(provider)
}

async fn complete_openai(
    store: &ProviderStore,
    provider: &ResolvedProvider,
    model: &str,
    reasoning: &Option<Value>,
    messages: &[ProviderMessage],
    context: &CompletionContext<'_>,
) -> AppResult<ProviderCompletion> {
    let url = append_endpoint(&provider.api, "chat/completions");
    let outbound_messages = openai_messages(provider, messages);
    let mut body = json!({
        "model": model,
        "messages": outbound_messages,
        "stream": true
    });
    if let Some(effort) = openai_reasoning_effort(reasoning) {
        body["reasoning_effort"] = Value::String(effort);
    }
    // A stable key routes OpenAI's automatic prefix cache to the same shard
    // across turns of one conversation, and keeps different providers from
    // evicting each other. Strict OpenAI-compatible deployments 400 on unknown
    // fields, so the hint is only sent where it is documented.
    if provider_supports_prompt_cache_key(provider) {
        body["prompt_cache_key"] =
            Value::String(prompt_cache_key(&provider.id, context.conversation_id));
    }
    let observe = |_: &str, value: &Value| {
        if let Some(observer) = context.on_delta {
            if let Some(delta) = openai_event_delta(value)? {
                observer(&delta)?;
            }
        }
        Ok(())
    };
    // wps_06 A2: some strict OpenAI-compatible gateways reject the
    // `stream_options` argument with HTTP 400. Try with it (needed so a final
    // usage frame is emitted), and on a 400 naming the field, retry the request
    // once without it.
    let mut payload = None;
    for include_stream_options in [true, false] {
        let mut retry_body = body.clone();
        if include_stream_options {
            retry_body["stream_options"] = json!({ "include_usage": true });
        }
        let mut request = store.client.post(url.clone()).json(&retry_body);
        if !provider.is_local {
            request = request.bearer_auth(store.api_key(&provider.id).await?);
        }
        match send_provider_payload(request, context.cancellation, Some(&observe)).await {
            Ok(value) => {
                payload = Some(value);
                break;
            }
            Err(error)
                if include_stream_options && error_rejects_stream_options(&error) =>
            {
                log::warn!(
                    "provider rejected stream_options with HTTP 400; retrying without it: {error}"
                );
            }
            Err(error) => return Err(error),
        }
    }
    let payload = payload
        .expect("the request loop either sets a payload or returns the last error");
    let (text, usage) = match payload {
        ProviderPayload::Json(value) => {
            check_provider_error(&value)?;
            let text = openai_text(&value).ok_or_else(|| {
                AppError::new(
                    "invalid-provider-response",
                    "OpenAI-compatible response did not contain assistant text",
                )
            })?;
            let usage = openai_usage(value.get("usage"));
            (text, usage)
        }
        ProviderPayload::Events(events) => parse_openai_events(events)?,
    };
    validate_response_text(&text)?;
    Ok(ProviderCompletion { text, usage })
}

fn openai_messages(
    provider: &ResolvedProvider,
    messages: &[ProviderMessage],
) -> Vec<ProviderMessage> {
    messages
        .iter()
        .map(|message| ProviderMessage {
            role: if provider.id == "openai" && message.role == "system" {
                "developer".to_owned()
            } else {
                message.role.clone()
            },
            content: message.content.clone(),
        })
        .collect()
}

/// Builds the Anthropic Messages request body.
///
/// Caching policy: one breakpoint anchors the joined system prefix, and a
/// rolling window anchors the conversation tail. Together they mean the next
/// turn of the same conversation (and the next tool round) re-sends a prefix
/// that is already resident, so only the newly appended tokens are billed as
/// cache misses instead of the whole history.
fn anthropic_request_body(
    model: &str,
    reasoning: &Option<Value>,
    messages: &[ProviderMessage],
) -> Value {
    let system = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut conversation = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "assistant" } else { "user" },
                "content": [{ "type": "text", "text": message.content }]
            })
        })
        .collect::<Vec<_>>();
    mark_anthropic_conversation_breakpoints(&mut conversation, ANTHROPIC_CONVERSATION_BREAKPOINTS);
    let mut body = json!({
        "model": model,
        "max_tokens": 8192,
        "messages": conversation,
        "stream": true
    });
    if !system.trim().is_empty() {
        body["system"] = json!([{
            "type": "text",
            "text": system,
            "cache_control": ephemeral_cache_control()
        }]);
    }
    apply_anthropic_reasoning(&mut body, reasoning);
    body
}

async fn complete_anthropic(
    store: &ProviderStore,
    provider: &ResolvedProvider,
    model: &str,
    reasoning: &Option<Value>,
    messages: &[ProviderMessage],
    context: &CompletionContext<'_>,
) -> AppResult<ProviderCompletion> {
    let url = if provider.api.trim_end_matches('/').ends_with("/v1") {
        append_endpoint(&provider.api, "messages")
    } else {
        append_endpoint(&provider.api, "v1/messages")
    };
    let body = anthropic_request_body(model, reasoning, messages);
    let api_key = store.api_key(&provider.id).await?;
    let request = store
        .client
        .post(url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    let observe = |event_name: &str, value: &Value| {
        if let (Some(observer), Some(delta)) =
            (context.on_delta, anthropic_event_delta(event_name, value))
        {
            observer(delta)?;
        }
        Ok(())
    };
    let payload = send_provider_payload(request, context.cancellation, Some(&observe)).await?;
    let (text, usage) = match payload {
        ProviderPayload::Json(value) => {
            check_provider_error(&value)?;
            let text = anthropic_text(&value);
            let usage = anthropic_usage(value.get("usage"));
            (text, usage)
        }
        ProviderPayload::Events(events) => parse_anthropic_events(events)?,
    };
    if text.is_empty() {
        return Err(AppError::new(
            "invalid-provider-response",
            "Anthropic response did not contain assistant text",
        ));
    }
    validate_response_text(&text)?;
    Ok(ProviderCompletion { text, usage })
}

async fn complete_google(
    store: &ProviderStore,
    provider: &ResolvedProvider,
    model: &str,
    reasoning: &Option<Value>,
    messages: &[ProviderMessage],
    context: &CompletionContext<'_>,
) -> AppResult<ProviderCompletion> {
    let root = provider.api.trim_end_matches('/');
    let versioned = root.ends_with("/v1") || root.ends_with("/v1beta");
    let encoded_model =
        percent_encoding::utf8_percent_encode(model, percent_encoding::NON_ALPHANUMERIC);
    let url = if versioned {
        format!("{root}/models/{encoded_model}:streamGenerateContent?alt=sse")
    } else {
        format!("{root}/v1beta/models/{encoded_model}:streamGenerateContent?alt=sse")
    };
    let system = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let contents = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": message.content }]
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": contents
    });
    if let Some(config) = google_thinking_config(reasoning) {
        body["generationConfig"] = json!({ "thinkingConfig": config });
    }
    let api_key = store.api_key(&provider.id).await?;
    let request = store
        .client
        .post(url)
        .header("x-goog-api-key", api_key)
        .json(&body);
    let observe = |_: &str, value: &Value| {
        if let Some(observer) = context.on_delta {
            let delta = google_text(value);
            if !delta.is_empty() {
                observer(&delta)?;
            }
        }
        Ok(())
    };
    let payload = send_provider_payload(request, context.cancellation, Some(&observe)).await?;
    let (text, usage) = match payload {
        ProviderPayload::Json(value) => {
            check_provider_error(&value)?;
            let text = google_text(&value);
            let usage = google_usage(value.get("usageMetadata"));
            (text, usage)
        }
        ProviderPayload::Events(events) => parse_google_events(events)?,
    };
    if text.is_empty() {
        return Err(AppError::new(
            "invalid-provider-response",
            "Google response did not contain assistant text",
        ));
    }
    validate_response_text(&text)?;
    Ok(ProviderCompletion { text, usage })
}

async fn send_provider_payload(
    request: RequestBuilder,
    cancellation: &CancellationToken,
    observer: Option<&EventObserver<'_>>,
) -> AppResult<ProviderPayload> {
    let response = tokio::select! {
        biased;
        _ = cancellation.cancelled() => return Err(cancelled_error()),
        response = request.send() => response?,
        _ = tokio::time::sleep(RESPONSE_HEADERS_TIMEOUT) => {
            return Err(AppError::new(
                "provider-timeout",
                "The provider did not return response headers in time",
            ));
        }
    };
    let status = response.status();
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_PROVIDER_BODY_BYTES)
    {
        return Err(AppError::new(
            "response-too-large",
            "Provider response exceeded the 2 MiB limit",
        ));
    }
    if !status.is_success() {
        let body = read_limited_body(response, cancellation).await?;
        let detail = provider_error_message(&body);
        return Err(AppError::new(
            "provider-http-error",
            format!("Provider returned HTTP {status}: {detail}"),
        ));
    }
    let is_sse = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().starts_with("text/event-stream"));
    if !is_sse {
        let body = read_limited_body(response, cancellation).await?;
        let value = serde_json::from_slice(&body).map_err(|error| {
            AppError::new(
                "invalid-provider-response",
                format!("Provider returned invalid JSON: {error}"),
            )
        })?;
        return Ok(ProviderPayload::Json(value));
    }

    // Byte-level frame cap while the body streams (wps_06 N-5).
    let mut stream = bounded_sse_bytes(response).eventsource();
    let mut events = Vec::new();
    let mut total_bytes = 0usize;
    loop {
        let next = tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Err(cancelled_error()),
            next = stream.next() => next,
            _ = tokio::time::sleep(SSE_IDLE_TIMEOUT) => {
                return Err(AppError::new(
                    "provider-timeout",
                    "The provider connection timed out while waiting for the next SSE event",
                ));
            }
        };
        let Some(event) = next else { break };
        let event = event.map_err(|error| {
            AppError::new(
                "invalid-sse",
                format!("Provider returned an invalid SSE stream: {error}"),
            )
        })?;
        if event.data.trim() == "[DONE]" {
            break;
        }
        total_bytes = total_bytes.saturating_add(event.data.len());
        if total_bytes > MAX_PROVIDER_BODY_BYTES || events.len() >= MAX_SSE_EVENTS {
            return Err(AppError::new(
                "response-too-large",
                "Provider SSE response exceeded its bounded event limit",
            ));
        }
        if event.data.trim().is_empty() {
            continue;
        }
        let value = serde_json::from_str::<Value>(&event.data).map_err(|error| {
            AppError::new(
                "invalid-provider-response",
                format!("Provider returned invalid SSE JSON: {error}"),
            )
        })?;
        if let Some(observer) = observer {
            observer(&event.event, &value)?;
        }
        events.push((event.event, value));
    }
    Ok(ProviderPayload::Events(events))
}

fn openai_event_delta(value: &Value) -> AppResult<Option<String>> {
    let content = value
        .pointer("/choices/0/delta/content")
        .or_else(|| value.pointer("/choices/0/message/content"));
    let Some(content) = content else {
        return Ok(None);
    };
    let mut delta = String::new();
    append_content(&mut delta, content)?;
    Ok((!delta.is_empty()).then_some(delta))
}

fn anthropic_event_delta<'a>(event_name: &str, value: &'a Value) -> Option<&'a str> {
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or(event_name);
    match event_type {
        "content_block_start"
            if value.pointer("/content_block/type").and_then(Value::as_str) == Some("text") =>
        {
            value.pointer("/content_block/text").and_then(Value::as_str)
        }
        "content_block_delta"
            if value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") =>
        {
            value.pointer("/delta/text").and_then(Value::as_str)
        }
        _ => None,
    }
}

async fn read_limited_body(
    response: Response,
    cancellation: &CancellationToken,
) -> AppResult<Vec<u8>> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    loop {
        let next = tokio::select! {
            _ = cancellation.cancelled() => return Err(cancelled_error()),
            next = stream.next() => next,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk?;
        if body.len().saturating_add(chunk.len()) > MAX_PROVIDER_BODY_BYTES {
            return Err(AppError::new(
                "response-too-large",
                "Provider response exceeded the 2 MiB limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Reads a JSON response body with a hard byte cap for the provider
/// discovery / custom-test / catalog paths that have no agent-run cancellation
/// token. It rejects an over-large declared `Content-Length` up front, then
/// accumulates the streamed body chunk by chunk and hard-rejects once the
/// cumulative bytes exceed the cap, before any deserialization happens.
pub(crate) async fn read_bounded_json(response: Response) -> AppResult<Value> {
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|length| length > MAX_PROVIDER_BODY_BYTES)
    {
        return Err(AppError::new(
            "response-too-large",
            "Provider response exceeded the 2 MiB limit",
        ));
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if body.len().saturating_add(chunk.len()) > MAX_PROVIDER_BODY_BYTES {
            return Err(AppError::new(
                "response-too-large",
                "Provider response exceeded the 2 MiB limit",
            ));
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|error| {
        AppError::new(
            "invalid-provider-response",
            format!("Provider returned invalid JSON: {error}"),
        )
    })
}

fn parse_openai_events(events: Vec<(String, Value)>) -> AppResult<(String, AgentCacheUsage)> {
    let mut text = String::new();
    let mut usage = AgentCacheUsage {
        requests: 1,
        ..AgentCacheUsage::default()
    };
    for (_, value) in events {
        check_provider_error(&value)?;
        if let Some(content) = value.pointer("/choices/0/delta/content") {
            append_content(&mut text, content)?;
        } else if let Some(content) = value.pointer("/choices/0/message/content") {
            append_content(&mut text, content)?;
        }
        if let Some(reported) = value.get("usage") {
            // wps_06 F3: merge field-by-field; a later partial usage chunk must
            // not erase cache numbers or the measured flag from an earlier one.
            merge_openai_stream_usage(&mut usage, reported);
        }
        validate_response_text(&text)?;
    }
    if text.is_empty() {
        return Err(AppError::new(
            "invalid-provider-response",
            "OpenAI-compatible SSE response did not contain assistant text",
        ));
    }
    Ok((text, usage))
}

fn parse_anthropic_events(events: Vec<(String, Value)>) -> AppResult<(String, AgentCacheUsage)> {
    let mut text = String::new();
    let mut usage = AgentCacheUsage {
        requests: 1,
        ..AgentCacheUsage::default()
    };
    for (event_name, value) in events {
        check_provider_error(&value)?;
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or(&event_name);
        match event_type {
            "content_block_start" => {
                if value.pointer("/content_block/type").and_then(Value::as_str) == Some("text") {
                    if let Some(delta) =
                        value.pointer("/content_block/text").and_then(Value::as_str)
                    {
                        text.push_str(delta);
                    }
                }
            }
            "content_block_delta" => {
                if value.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    if let Some(delta) = value.pointer("/delta/text").and_then(Value::as_str) {
                        text.push_str(delta);
                    }
                }
            }
            "message_start" => {
                if let Some(reported) = value.pointer("/message/usage") {
                    merge_anthropic_stream_usage(&mut usage, reported);
                }
            }
            "message_delta" => {
                if let Some(reported) = value.get("usage") {
                    merge_anthropic_stream_usage(&mut usage, reported);
                }
            }
            _ => {}
        }
        validate_response_text(&text)?;
    }
    if text.is_empty() {
        return Err(AppError::new(
            "invalid-provider-response",
            "Anthropic SSE response did not contain assistant text",
        ));
    }
    usage.refresh_hit_rate();
    Ok((text, usage))
}

fn parse_google_events(events: Vec<(String, Value)>) -> AppResult<(String, AgentCacheUsage)> {
    let mut text = String::new();
    let mut usage = AgentCacheUsage {
        requests: 1,
        ..AgentCacheUsage::default()
    };
    for (_, value) in events {
        check_provider_error(&value)?;
        text.push_str(&google_text(&value));
        if let Some(reported) = value.get("usageMetadata") {
            usage = google_usage(Some(reported));
        }
        validate_response_text(&text)?;
    }
    if text.is_empty() {
        return Err(AppError::new(
            "invalid-provider-response",
            "Google SSE response did not contain assistant text",
        ));
    }
    Ok((text, usage))
}

fn merge_anthropic_stream_usage(usage: &mut AgentCacheUsage, value: &Value) {
    if let Some(input) = uint(value.get("input_tokens")) {
        usage.cache_miss_tokens = input;
    }
    if let Some(cache_read) = uint(value.get("cache_read_input_tokens")) {
        usage.cache_read_tokens = cache_read;
        usage.measured = true;
    }
    if let Some(cache_write) = uint(value.get("cache_creation_input_tokens")) {
        usage.cache_write_tokens = cache_write;
        usage.measured = true;
    }
    if let Some(output) = uint(value.get("output_tokens")) {
        usage.completion_tokens = output;
    }
    usage.prompt_tokens = usage
        .cache_miss_tokens
        .saturating_add(usage.cache_read_tokens)
        .saturating_add(usage.cache_write_tokens);
    usage.total_tokens = usage.prompt_tokens.saturating_add(usage.completion_tokens);
    usage.requests = 1;
    usage.refresh_hit_rate();
}

fn append_content(output: &mut String, value: &Value) -> AppResult<()> {
    if let Some(text) = value.as_str() {
        output.push_str(text);
        return Ok(());
    }
    if let Some(parts) = value.as_array() {
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                output.push_str(text);
            }
        }
        return Ok(());
    }
    if value.is_null() {
        return Ok(());
    }
    Err(AppError::new(
        "invalid-provider-response",
        "Provider returned an unsupported assistant content shape",
    ))
}

fn anthropic_text(value: &Value) -> String {
    value["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| {
            (block["type"] == "text")
                .then(|| block["text"].as_str())
                .flatten()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn google_text(value: &Value) -> String {
    value["candidates"]
        .as_array()
        .and_then(|candidates| candidates.first())
        .and_then(|candidate| candidate["content"]["parts"].as_array())
        .into_iter()
        .flatten()
        .filter_map(|part| part["text"].as_str())
        .collect::<Vec<_>>()
        .join("")
}

fn check_provider_error(value: &Value) -> AppResult<()> {
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| error.as_str())
            .unwrap_or("Provider reported an unspecified error");
        return Err(AppError::new(
            "provider-error",
            truncate_chars(message, 2048),
        ));
    }
    Ok(())
}

fn provider_error_message(body: &[u8]) -> String {
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        for candidate in [
            value.pointer("/error/message"),
            value.pointer("/error/status"),
            value.get("message"),
        ] {
            if let Some(message) = candidate.and_then(Value::as_str) {
                return truncate_chars(message, 2048);
            }
        }
    }
    truncate_chars(&String::from_utf8_lossy(body), 2048)
}

fn openai_text(value: &Value) -> Option<String> {
    let content = value.pointer("/choices/0/message/content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    content.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn openai_usage(value: Option<&Value>) -> AgentCacheUsage {
    let value = value.unwrap_or(&Value::Null);
    let prompt_tokens = uint(value.get("prompt_tokens")).unwrap_or(0);
    let cache_read_tokens = uint(value.pointer("/prompt_tokens_details/cached_tokens"))
        .or_else(|| uint(value.get("prompt_cache_hit_tokens")))
        .unwrap_or(0);
    let explicit_miss = uint(value.get("prompt_cache_miss_tokens"));
    let measured = value
        .pointer("/prompt_tokens_details/cached_tokens")
        .is_some()
        || value.get("prompt_cache_hit_tokens").is_some()
        || explicit_miss.is_some();
    let mut usage = AgentCacheUsage {
        measured,
        requests: 1,
        prompt_tokens,
        cache_read_tokens,
        cache_miss_tokens: if measured {
            explicit_miss.unwrap_or(prompt_tokens.saturating_sub(cache_read_tokens))
        } else {
            0
        },
        cache_write_tokens: 0,
        completion_tokens: uint(value.get("completion_tokens")).unwrap_or(0),
        // wps_06 F2: o-series reasoning detail (already included in completion).
        reasoning_tokens: value
            .pointer("/completion_tokens_details/reasoning_tokens")
            .and_then(|detail| uint(Some(detail)))
            .unwrap_or(0),
        total_tokens: uint(value.get("total_tokens")).unwrap_or(0),
        hit_rate: 0.0,
    };
    if usage.total_tokens == 0 {
        usage.total_tokens = usage.prompt_tokens.saturating_add(usage.completion_tokens);
    }
    usage.refresh_hit_rate();
    usage
}

/// Merges a usage object carried on an OpenAI streaming chunk into the running
/// totals instead of replacing it (wps_06 F3). Some compatible gateways emit
/// usage on more than one chunk — an earlier chunk carrying cache detail and a
/// later one omitting it — so fields are updated only when the incoming chunk
/// actually reports a (non-zero) value, and `measured` is set-only/never
/// cleared. All chunks of one stream belong to one request, so `requests` is
/// not incremented here.
fn merge_openai_stream_usage(usage: &mut AgentCacheUsage, reported: &Value) {
    let incoming = openai_usage(Some(reported));
    usage.measured |= incoming.measured;
    if incoming.prompt_tokens > 0 {
        usage.prompt_tokens = incoming.prompt_tokens;
    }
    if incoming.cache_read_tokens > 0 {
        usage.cache_read_tokens = incoming.cache_read_tokens;
    }
    if incoming.cache_miss_tokens > 0 {
        usage.cache_miss_tokens = incoming.cache_miss_tokens;
    }
    if incoming.completion_tokens > 0 {
        usage.completion_tokens = incoming.completion_tokens;
    }
    if incoming.reasoning_tokens > 0 {
        usage.reasoning_tokens = incoming.reasoning_tokens;
    }
    if incoming.total_tokens > 0 {
        usage.total_tokens = incoming.total_tokens;
    }
    if usage.measured {
        // Derive the miss side from prompt/read when the chunk did not state it.
        usage.cache_miss_tokens = usage
            .cache_miss_tokens
            .max(usage.prompt_tokens.saturating_sub(usage.cache_read_tokens));
    }
    if usage.total_tokens == 0 {
        usage.total_tokens = usage
            .prompt_tokens
            .saturating_add(usage.completion_tokens);
    }
    usage.refresh_hit_rate();
}

fn anthropic_usage(value: Option<&Value>) -> AgentCacheUsage {
    let value = value.unwrap_or(&Value::Null);
    let input = uint(value.get("input_tokens")).unwrap_or(0);
    let cache_read = uint(value.get("cache_read_input_tokens")).unwrap_or(0);
    let cache_write = uint(value.get("cache_creation_input_tokens")).unwrap_or(0);
    let output = uint(value.get("output_tokens")).unwrap_or(0);
    let measured = value.get("cache_read_input_tokens").is_some()
        || value.get("cache_creation_input_tokens").is_some();
    let prompt = input.saturating_add(cache_read).saturating_add(cache_write);
    let mut usage = AgentCacheUsage {
        measured,
        requests: 1,
        prompt_tokens: prompt,
        cache_read_tokens: cache_read,
        cache_miss_tokens: if measured { input } else { 0 },
        cache_write_tokens: cache_write,
        completion_tokens: output,
        // Anthropic folds thinking tokens into output_tokens with no separate
        // field in this usage shape.
        reasoning_tokens: 0,
        total_tokens: prompt.saturating_add(output),
        hit_rate: 0.0,
    };
    usage.refresh_hit_rate();
    usage
}

fn google_usage(value: Option<&Value>) -> AgentCacheUsage {
    let value = value.unwrap_or(&Value::Null);
    let prompt = uint(value.get("promptTokenCount")).unwrap_or(0);
    let cached = uint(value.get("cachedContentTokenCount")).unwrap_or(0);
    let completion = uint(value.get("candidatesTokenCount")).unwrap_or(0);
    // wps_06 F2: thinking tokens are billed but NOT included in
    // candidatesTokenCount; surface them as the reasoning sub-count.
    let reasoning = uint(value.get("thoughtsTokenCount")).unwrap_or(0);
    let measured = value.get("cachedContentTokenCount").is_some();
    let mut usage = AgentCacheUsage {
        measured,
        requests: 1,
        prompt_tokens: prompt,
        cache_read_tokens: cached,
        cache_miss_tokens: if measured {
            prompt.saturating_sub(cached)
        } else {
            0
        },
        cache_write_tokens: 0,
        completion_tokens: completion,
        reasoning_tokens: reasoning,
        total_tokens: uint(value.get("totalTokenCount")).unwrap_or_else(|| {
            prompt
                .saturating_add(completion)
                .saturating_add(reasoning)
        }),
        hit_rate: 0.0,
    };
    usage.refresh_hit_rate();
    usage
}

fn openai_reasoning_effort(reasoning: &Option<Value>) -> Option<String> {
    let value = reasoning.as_ref()?;
    match value.get("kind").and_then(Value::as_str)? {
        "enabled" => Some("medium".to_owned()),
        "disabled" => Some("none".to_owned()),
        "effort" => value
            .get("value")
            .and_then(Value::as_str)
            .filter(|effort| {
                matches!(
                    *effort,
                    "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
                )
            })
            .map(str::to_owned),
        _ => None,
    }
}

fn apply_anthropic_reasoning(body: &mut Value, reasoning: &Option<Value>) {
    let Some(value) = reasoning.as_ref() else {
        return;
    };
    match value.get("kind").and_then(Value::as_str) {
        Some("enabled") => {
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": 4096 });
            body["max_tokens"] = json!(8192);
        }
        Some("budget") => {
            let budget = uint(value.get("tokens"))
                .unwrap_or(4096)
                .clamp(1024, 16_000);
            body["thinking"] = json!({ "type": "enabled", "budget_tokens": budget });
            body["max_tokens"] = json!(budget.saturating_add(8192));
        }
        Some("effort") => {
            if let Some(effort) = value
                .get("value")
                .and_then(Value::as_str)
                .filter(|effort| matches!(*effort, "low" | "medium" | "high" | "max"))
            {
                body["output_config"] = json!({ "effort": effort });
            }
        }
        _ => {}
    }
}

fn google_thinking_config(reasoning: &Option<Value>) -> Option<Value> {
    let value = reasoning.as_ref()?;
    match value.get("kind").and_then(Value::as_str)? {
        "enabled" => Some(json!({ "thinkingBudget": -1 })),
        "disabled" => Some(json!({ "thinkingBudget": 0 })),
        "budget" => Some(json!({
            "thinkingBudget": uint(value.get("tokens")).unwrap_or(4096).min(32_768)
        })),
        _ => None,
    }
}

fn prompt_cache_key(provider_id: &str, conversation_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"office-agentic-cache-v3\0");
    digest.update(provider_id.as_bytes());
    digest.update(b"\0");
    digest.update(conversation_id.as_bytes());
    hex::encode(digest.finalize())
}

/// True for deployments that document `prompt_cache_key`. An unknown field is a
/// hard 400 on strict OpenAI-compatible servers, so the hint is never sent
/// speculatively.
fn provider_supports_prompt_cache_key(provider: &ResolvedProvider) -> bool {
    matches!(provider.protocol, ProviderProtocol::Openai) || provider.api.contains("opencode.ai")
}

/// Whether a failed provider request was a 400 specifically rejecting the
/// `stream_options` argument, which justifies the fieldless retry (wps_06 A2).
fn error_rejects_stream_options(error: &AppError) -> bool {
    use crate::error::codes;
    if error.code != codes::PROVIDER_HTTP_ERROR || !error.message.contains("400") {
        return false;
    }
    error
        .message
        .to_ascii_lowercase()
        .contains("stream_options")
}

fn append_endpoint(base: &str, endpoint: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    )
}

fn uint(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| {
        value.as_u64().or_else(|| {
            value
                .as_f64()
                .filter(|number| *number >= 0.0)
                .map(|n| n as u64)
        })
    })
}

fn validate_response_text(text: &str) -> AppResult<()> {
    if text.len() > MAX_RESPONSE_TEXT_BYTES {
        return Err(AppError::new(
            "response-too-large",
            "Assistant text exceeded the 1 MiB limit",
        ));
    }
    Ok(())
}

fn truncate_chars(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

pub fn cancelled_error() -> AppError {
    AppError::new("cancelled", "Agent run was cancelled")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn test_agent() -> AgentConfig {
        AgentConfig {
            id: "test".to_owned(),
            name: "Test".to_owned(),
            role: String::new(),
            system_prompt: String::new(),
            provider_id: "ollama".to_owned(),
            model: "test-model".to_owned(),
            reasoning: None,
            color: "#000000".to_owned(),
            enabled: true,
            description: None,
        }
    }

    fn serve_once(
        response: &'static [u8],
        pause_after_headers_ms: Option<u64>,
    ) -> std::net::SocketAddr {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            let mut expected_length = None;
            loop {
                let read = stream.read(&mut buffer).unwrap_or(0);
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if expected_length.is_none() {
                    if let Some(header_end) =
                        request.windows(4).position(|part| part == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_length = headers
                            .lines()
                            .find_map(|line| {
                                line.split_once(':').and_then(|(name, value)| {
                                    name.eq_ignore_ascii_case("content-length")
                                        .then(|| value.trim().parse::<usize>().ok())
                                        .flatten()
                                })
                            })
                            .unwrap_or(0);
                        expected_length = Some(header_end + 4 + content_length);
                    }
                }
                if expected_length.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }
            if let Some(delay) = pause_after_headers_ms {
                let split = response
                    .windows(4)
                    .position(|part| part == b"\r\n\r\n")
                    .map(|index| index + 4)
                    .unwrap_or(response.len());
                stream.write_all(&response[..split]).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(delay));
                let _ = stream.write_all(&response[split..]);
            } else {
                stream.write_all(response).unwrap();
            }
            let _ = stream.flush();
        });
        address
    }

    #[test]
    fn appends_provider_endpoints_without_changing_base() {
        assert_eq!(
            append_endpoint("https://api.example/v1/", "/chat/completions"),
            "https://api.example/v1/chat/completions"
        );
    }

    #[tokio::test]
    async fn consumes_real_openai_compatible_sse_response() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":1,\"total_tokens\":6}}\n\ndata: [DONE]\n\n";
        let address = serve_once(response, None);
        let temp = tempfile::tempdir().unwrap();
        let store = ProviderStore::new(temp.path().to_path_buf()).unwrap();
        store
            .set_base_url("ollama", &format!("http://{address}/v1"))
            .unwrap();
        let result = complete(
            &store,
            &test_agent(),
            &[ProviderMessage {
                role: "user".to_owned(),
                content: "hi".to_owned(),
            }],
            "conversation",
            &CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result.text, "hello");
        assert_eq!(result.usage.total_tokens, 6);
    }

    #[tokio::test]
    async fn reports_openai_deltas_before_returning_the_completion() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n";
        let address = serve_once(response, None);
        let temp = tempfile::tempdir().unwrap();
        let store = ProviderStore::new(temp.path().to_path_buf()).unwrap();
        store
            .set_base_url("ollama", &format!("http://{address}/v1"))
            .unwrap();
        let deltas = std::sync::Mutex::new(Vec::new());
        let observe = |delta: &str| {
            deltas.lock().unwrap().push(delta.to_owned());
            Ok(())
        };
        let result = complete_streaming(
            &store,
            &test_agent(),
            &[ProviderMessage {
                role: "user".to_owned(),
                content: "hi".to_owned(),
            }],
            "conversation",
            &CancellationToken::new(),
            Some(&observe),
        )
        .await
        .unwrap();
        assert_eq!(result.text, "Hello");
        assert_eq!(*deltas.lock().unwrap(), ["Hel", "lo"]);
    }

    #[tokio::test]
    async fn cancellation_interrupts_an_open_sse_response() {
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\ndata: [DONE]\n\n";
        let address = serve_once(response, Some(250));
        let temp = tempfile::tempdir().unwrap();
        let store = ProviderStore::new(temp.path().to_path_buf()).unwrap();
        store
            .set_base_url("ollama", &format!("http://{address}/v1"))
            .unwrap();
        let cancellation = CancellationToken::new();
        let cancel = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            cancel.cancel();
        });
        let error = complete(
            &store,
            &test_agent(),
            &[ProviderMessage {
                role: "user".to_owned(),
                content: "hi".to_owned(),
            }],
            "conversation",
            &cancellation,
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "cancelled");
    }

    #[test]
    fn official_openai_uses_developer_messages_without_changing_compatible_providers() {
        let messages = vec![ProviderMessage {
            role: "system".to_owned(),
            content: "rules".to_owned(),
        }];
        let official = ResolvedProvider {
            id: "openai".to_owned(),
            api: "https://api.openai.com/v1".to_owned(),
            protocol: ProviderProtocol::Openai,
            is_local: false,
        };
        let compatible = ResolvedProvider {
            id: "ollama".to_owned(),
            api: "http://127.0.0.1:11434/v1".to_owned(),
            protocol: ProviderProtocol::OpenaiCompatible,
            is_local: true,
        };
        assert_eq!(openai_messages(&official, &messages)[0].role, "developer");
        assert_eq!(openai_messages(&compatible, &messages)[0].role, "system");
    }

    #[test]
    fn extracts_openai_cache_usage() {
        let usage = openai_usage(Some(&json!({
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "total_tokens": 120,
            "prompt_tokens_details": { "cached_tokens": 80 }
        })));
        assert!(usage.measured);
        assert_eq!(usage.cache_read_tokens, 80);
        assert_eq!(usage.cache_miss_tokens, 20);
        assert!((usage.hit_rate - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn assembles_openai_sse_deltas_and_final_usage() {
        let (text, usage) = parse_openai_events(vec![
            (
                "message".to_owned(),
                json!({ "choices": [{ "delta": { "content": "Hel" } }] }),
            ),
            (
                "message".to_owned(),
                json!({ "choices": [{ "delta": { "content": "lo" } }] }),
            ),
            (
                "message".to_owned(),
                json!({
                    "choices": [],
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 2,
                        "total_tokens": 12,
                        "prompt_tokens_details": { "cached_tokens": 4 }
                    }
                }),
            ),
        ])
        .unwrap();
        assert_eq!(text, "Hello");
        assert_eq!(usage.total_tokens, 12);
        assert_eq!(usage.cache_read_tokens, 4);
    }

    #[test]
    fn assembles_anthropic_sse_and_cache_usage() {
        let (text, usage) = parse_anthropic_events(vec![
            (
                "message_start".to_owned(),
                json!({
                    "type": "message_start",
                    "message": { "usage": {
                        "input_tokens": 3,
                        "cache_read_input_tokens": 7,
                        "cache_creation_input_tokens": 2
                    }}
                }),
            ),
            (
                "content_block_delta".to_owned(),
                json!({
                    "type": "content_block_delta",
                    "delta": { "type": "text_delta", "text": "answer" }
                }),
            ),
            (
                "message_delta".to_owned(),
                json!({
                    "type": "message_delta",
                    "usage": { "output_tokens": 4 }
                }),
            ),
        ])
        .unwrap();
        assert_eq!(text, "answer");
        assert_eq!(usage.prompt_tokens, 12);
        assert_eq!(usage.completion_tokens, 4);
        assert!(usage.measured);
    }

    #[test]
    fn anthropic_body_anchors_the_system_prefix_and_the_conversation_tail() {
        let messages = vec![
            ProviderMessage {
                role: "system".to_owned(),
                content: "rules".to_owned(),
            },
            ProviderMessage {
                role: "user".to_owned(),
                content: "first".to_owned(),
            },
            ProviderMessage {
                role: "assistant".to_owned(),
                content: "second".to_owned(),
            },
            ProviderMessage {
                role: "user".to_owned(),
                content: "third".to_owned(),
            },
            ProviderMessage {
                role: "assistant".to_owned(),
                content: "fourth".to_owned(),
            },
            ProviderMessage {
                role: "user".to_owned(),
                content: "fifth".to_owned(),
            },
        ];
        let body = anthropic_request_body("claude", &None, &messages);

        let system = body["system"].as_array().unwrap();
        assert_eq!(system.len(), 1);
        assert_eq!(system[0]["cache_control"]["type"], "ephemeral");

        let conversation = body["messages"].as_array().unwrap();
        assert_eq!(conversation.len(), 5);
        // Every turn of the history is lowered to a text content block so the
        // trailing blocks can carry a cache breakpoint.
        assert!(conversation
            .iter()
            .all(|message| message["content"][0]["type"] == "text"));
        // The rolling window marks the tail and nothing older, and it never
        // exceeds Anthropic's four-breakpoint request cap once the system
        // prefix is counted.
        let breakpoints = conversation
            .iter()
            .filter(|message| message["content"][0]["cache_control"].is_object())
            .count();
        assert_eq!(breakpoints, ANTHROPIC_CONVERSATION_BREAKPOINTS);
        assert!(breakpoints < ANTHROPIC_CACHE_BREAKPOINT_CAP);
        assert!(conversation[0]["content"][0]["cache_control"].is_null());
        assert!(conversation[1]["content"][0]["cache_control"].is_null());
        assert!(conversation[3]["content"][0]["cache_control"].is_object());
        assert!(conversation[4]["content"][0]["cache_control"].is_object());
    }

    #[test]
    fn anthropic_body_marks_every_conversation_turn_below_the_cap() {
        let messages = vec![ProviderMessage {
            role: "user".to_owned(),
            content: "only".to_owned(),
        }];
        let body = anthropic_request_body("claude", &None, &messages);
        let conversation = body["messages"].as_array().unwrap();
        assert!(conversation
            .iter()
            .all(|message| message["content"][0]["cache_control"].is_object()));
    }

    #[test]
    fn anthropic_body_omits_an_empty_system_block() {
        let messages = vec![ProviderMessage {
            role: "user".to_owned(),
            content: "hi".to_owned(),
        }];
        let body = anthropic_request_body("claude", &None, &messages);
        assert!(body.get("system").is_none());
        assert_eq!(
            body["messages"][0]["content"][0]["cache_control"]["type"],
            "ephemeral"
        );
    }

    #[test]
    fn prompt_cache_keys_are_stable_and_provider_scoped() {
        let openai = ResolvedProvider {
            id: "openai".to_owned(),
            api: "https://api.openai.com/v1".to_owned(),
            protocol: ProviderProtocol::Openai,
            is_local: false,
        };
        let gateway = ResolvedProvider {
            id: "gateway".to_owned(),
            api: "https://gateway.example/v1".to_owned(),
            protocol: ProviderProtocol::OpenaiCompatible,
            is_local: false,
        };
        assert!(provider_supports_prompt_cache_key(&openai));
        // An unknown field is a hard 400 on strict compatible endpoints.
        assert!(!provider_supports_prompt_cache_key(&gateway));

        assert_eq!(
            prompt_cache_key("openai", "conversation"),
            prompt_cache_key("openai", "conversation")
        );
        assert_ne!(
            prompt_cache_key("openai", "conversation"),
            prompt_cache_key("anthropic", "conversation")
        );
        assert_ne!(
            prompt_cache_key("openai", "conversation"),
            prompt_cache_key("openai", "other")
        );
    }

    #[test]
    fn provider_error_event_is_not_treated_as_success() {
        let error = parse_google_events(vec![(
            "error".to_owned(),
            json!({ "error": { "message": "rate limited" } }),
        )])
        .unwrap_err();
        assert_eq!(error.code, "provider-error");
    }

    #[test]
    fn rejects_unsupported_reasoning_shape_without_inventing_values() {
        assert!(openai_reasoning_effort(&Some(json!({ "kind": "auto" }))).is_none());
    }
}

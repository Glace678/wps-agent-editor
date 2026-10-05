use crate::error::{AppError, AppResult};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{header::HeaderMap, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use url::Url;

const MAX_EVENT_BYTES: usize = 2 * 1024 * 1024;
/// Hard cap on how many bytes of a non-2xx provider error body we buffer before
/// surfacing it. Error bodies are expected to be tiny; without this limit a
/// hostile or misbehaving provider could stream an arbitrarily large body straight
/// into memory. (The successful SSE path keeps its own `MAX_EVENT_BYTES` cap.)
const MAX_ERROR_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseRequest {
    pub url: Url,
    #[serde(default)]
    pub body: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum ProviderStreamEvent {
    Open {
        status: u16,
    },
    Message {
        event: String,
        data: String,
        id: String,
    },
    Done,
}

pub async fn stream_json_sse(
    client: &Client,
    request: SseRequest,
    headers: HeaderMap,
    channel: Channel<ProviderStreamEvent>,
) -> AppResult<()> {
    let response = client
        .request(Method::POST, request.url)
        .headers(headers)
        .json(&request.body)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        let (body, truncated) = read_bounded_error_body(response).await;
        let note = if truncated { " (truncated)" } else { "" };
        return Err(AppError::new(
            "provider-http-error",
            format!(
                "Provider returned HTTP {status}: {}{note}",
                truncate(&body, 2048)
            ),
        ));
    }
    channel
        .send(ProviderStreamEvent::Open {
            status: status.as_u16(),
        })
        .map_err(|error| AppError::internal(error.to_string()))?;

    let mut stream = response.bytes_stream().eventsource();
    while let Some(event) = stream.next().await {
        let event = event.map_err(|error| AppError::new("invalid-sse", error.to_string()))?;
        if event.data.len() > MAX_EVENT_BYTES {
            return Err(AppError::new(
                "response-too-large",
                "Provider SSE event exceeded the 2 MiB limit",
            ));
        }
        if event.data == "[DONE]" {
            break;
        }
        channel
            .send(ProviderStreamEvent::Message {
                event: event.event,
                data: event.data,
                id: event.id,
            })
            .map_err(|error| AppError::internal(error.to_string()))?;
    }
    channel
        .send(ProviderStreamEvent::Done)
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

fn truncate(value: &str, max: usize) -> &str {
    value.get(..max).unwrap_or(value)
}

/// Drain a non-2xx response body while capping how much we buffer, returning the
/// lossy-converted text and whether the body exceeded `MAX_ERROR_BODY_BYTES` (in
/// which case the surplus bytes are dropped and the caller annotates the message).
async fn read_bounded_error_body(response: reqwest::Response) -> (String, bool) {
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::with_capacity(MAX_ERROR_BODY_BYTES.min(1024));
    let mut truncated = false;
    while let Some(chunk) = stream.next().await {
        let remaining = MAX_ERROR_BODY_BYTES.saturating_sub(buffer.len());
        if remaining == 0 {
            truncated = true;
            break;
        }
        match chunk {
            Ok(bytes) if bytes.len() <= remaining => buffer.extend_from_slice(&bytes),
            Ok(bytes) => {
                buffer.extend_from_slice(&bytes[..remaining]);
                truncated = true;
                break;
            }
            Err(_) => break,
        }
    }
    (String::from_utf8_lossy(&buffer).into_owned(), truncated)
}

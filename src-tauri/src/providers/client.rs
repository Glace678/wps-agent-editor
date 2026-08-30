use crate::error::{AppError, AppResult};
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use reqwest::{header::HeaderMap, Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::Channel;
use url::Url;

const MAX_EVENT_BYTES: usize = 2 * 1024 * 1024;

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
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(
            "provider-http-error",
            format!("Provider returned HTTP {status}: {}", truncate(&body, 2048)),
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

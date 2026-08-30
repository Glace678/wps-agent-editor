use crate::{
    error::{AppError, AppResult},
    providers::{
        client::{stream_json_sse, ProviderStreamEvent, SseRequest},
        store::{
            validate_base_url, AuthStatus, CustomProviderConfig, ProviderDefinition, ProviderModel,
            ProviderProtocol,
        },
    },
    state::AppState,
};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{ipc::Channel, State};
use url::Url;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBaseUrlInput {
    pub provider_id: String,
    pub base_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderBaseUrlResult {
    pub success: bool,
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthInput {
    pub provider_id: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderTestInput {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderTestResult {
    pub success: bool,
    pub models: Vec<ProviderModel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'static str>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderChatStreamRequest {
    pub provider_id: String,
    pub body: Value,
}

#[tauri::command]
pub async fn providers_list(
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<Vec<ProviderDefinition>> {
    let mut providers = if force_refresh.unwrap_or(false) {
        match fetch_models_dev(&state.providers.client).await {
            Ok(providers) if !providers.is_empty() => merge_with_builtins(providers),
            _ => builtin_providers(),
        }
    } else {
        builtin_providers()
    };
    providers.extend(
        state
            .providers
            .custom_list()
            .into_iter()
            .map(custom_definition),
    );
    for provider in &mut providers {
        apply_base_url_override(provider, state.providers.base_url(&provider.id));
    }
    Ok(providers)
}

#[tauri::command]
pub async fn providers_get(
    provider_id: String,
    state: State<'_, AppState>,
) -> AppResult<Option<ProviderDefinition>> {
    Ok(providers_list(Some(false), state)
        .await?
        .into_iter()
        .find(|provider| provider.id == provider_id))
}

#[tauri::command]
pub async fn providers_detect_ollama(
    base_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<ProviderDefinition> {
    let base_url = validate_base_url(base_url.as_deref().unwrap_or("http://127.0.0.1:11434/v1"))?;
    let root = base_url.strip_suffix("/v1").unwrap_or(&base_url);
    let response = state
        .providers
        .client
        .get(format!("{root}/api/tags"))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "connection-failed",
            format!("Ollama returned HTTP {}", response.status()),
        ));
    }
    let value: Value = response.json().await?;
    let models = value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| model["name"].as_str())
        .map(|id| ProviderModel {
            id: id.to_owned(),
            name: id.to_owned(),
            family: None,
            reasoning: None,
        })
        .collect();
    Ok(ProviderDefinition {
        id: "ollama".into(),
        name: "Ollama".into(),
        api: format!("{root}/v1"),
        npm: String::new(),
        doc: Some("https://docs.ollama.com/api".into()),
        env: vec![],
        protocol: ProviderProtocol::OpenaiCompatible,
        models,
        default_model: None,
        default_api: Some(format!("{root}/v1")),
        is_api_overridden: false,
        is_custom: false,
        is_local: true,
    })
}

#[tauri::command]
pub async fn providers_set_base_url(
    input: ProviderBaseUrlInput,
    state: State<'_, AppState>,
) -> AppResult<ProviderBaseUrlResult> {
    let base_url = state
        .providers
        .set_base_url(&input.provider_id, &input.base_url)?;
    Ok(ProviderBaseUrlResult {
        success: true,
        base_url,
    })
}

#[tauri::command]
pub async fn providers_auth_status(
    state: State<'_, AppState>,
) -> AppResult<HashMap<String, AuthStatus>> {
    state.providers.auth_status()
}

#[tauri::command]
pub async fn providers_auth_set(input: AuthInput, state: State<'_, AppState>) -> AppResult<bool> {
    state
        .providers
        .set_api_key(&input.provider_id, &input.api_key)?;
    Ok(true)
}

#[tauri::command]
pub async fn providers_auth_remove(
    provider_id: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    state.providers.remove_api_key(&provider_id)?;
    Ok(true)
}

#[tauri::command]
pub async fn providers_custom_list(
    state: State<'_, AppState>,
) -> AppResult<Vec<CustomProviderConfig>> {
    Ok(state.providers.custom_list())
}

#[tauri::command]
pub async fn providers_custom_save(
    provider: CustomProviderConfig,
    state: State<'_, AppState>,
) -> AppResult<CustomProviderConfig> {
    state.providers.custom_save(provider)
}

#[tauri::command]
pub async fn providers_custom_delete(id: String, state: State<'_, AppState>) -> AppResult<bool> {
    state.providers.custom_delete(&id)
}

#[tauri::command]
pub async fn providers_custom_test(
    input: CustomProviderTestInput,
    state: State<'_, AppState>,
) -> AppResult<CustomProviderTestResult> {
    let base_url = validate_base_url(&input.base_url)?;
    let response = state
        .providers
        .client
        .get(format!("{base_url}/models"))
        .bearer_auth(input.api_key)
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(_) => {
            return Ok(CustomProviderTestResult {
                success: false,
                models: vec![],
                error: Some("connection-failed"),
            })
        }
    };
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(CustomProviderTestResult {
            success: false,
            models: vec![],
            error: Some("unauthorized"),
        });
    }
    if !response.status().is_success() {
        return Ok(CustomProviderTestResult {
            success: false,
            models: vec![],
            error: Some("connection-failed"),
        });
    }
    let value: Value = response.json().await?;
    let models = value["data"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|model| model["id"].as_str())
        .map(|id| ProviderModel {
            id: id.to_owned(),
            name: id.to_owned(),
            family: None,
            reasoning: None,
        })
        .collect::<Vec<_>>();
    let success = !models.is_empty();
    Ok(CustomProviderTestResult {
        success,
        models,
        error: (!success).then_some("no-models"),
    })
}

#[tauri::command]
pub async fn providers_stream_chat(
    request: ProviderChatStreamRequest,
    on_event: Channel<ProviderStreamEvent>,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let provider = providers_get(request.provider_id.clone(), state.clone())
        .await?
        .ok_or_else(|| AppError::not_found("Unknown provider"))?;
    if !matches!(
        provider.protocol,
        ProviderProtocol::Openai | ProviderProtocol::OpenaiCompatible
    ) {
        return Err(AppError::unsupported(
            "Streaming for non-OpenAI-compatible provider protocols",
        ));
    }
    let mut body = request.body;
    let object = body
        .as_object_mut()
        .ok_or_else(|| AppError::invalid("Provider request body must be a JSON object"))?;
    object.insert("stream".into(), Value::Bool(true));
    let url = Url::parse(&format!(
        "{}/chat/completions",
        provider.api.trim_end_matches('/')
    ))?;
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if !provider.is_local {
        let key = state.providers.api_key(&provider.id)?;
        let value = HeaderValue::from_str(&format!("Bearer {key}"))
            .map_err(|_| AppError::invalid("API key cannot be encoded as an HTTP header"))?;
        headers.insert(AUTHORIZATION, value);
    }
    stream_json_sse(
        &state.providers.client,
        SseRequest { url, body },
        headers,
        on_event,
    )
    .await
}

fn builtin_providers() -> Vec<ProviderDefinition> {
    let snapshot = serde_json::from_str::<Vec<ProviderDefinition>>(include_str!(
        "../../resources/provider-catalog.json"
    ));
    let mut providers: HashMap<String, ProviderDefinition> = snapshot
        .unwrap_or_default()
        .into_iter()
        .map(|provider| (provider.id.clone(), provider))
        .collect();

    for fallback in fallback_providers() {
        providers
            .entry(fallback.id.clone())
            .and_modify(|provider| {
                if provider.api.is_empty() {
                    provider.api.clone_from(&fallback.api);
                }
                if provider.env.is_empty() {
                    provider.env.clone_from(&fallback.env);
                }
                if matches!(provider.protocol, ProviderProtocol::Unknown) {
                    provider.protocol = fallback.protocol.clone();
                }
                provider.is_local |= fallback.is_local;
            })
            .or_insert(fallback);
    }

    let mut providers = providers.into_values().collect::<Vec<_>>();
    providers.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
    providers
}

fn fallback_providers() -> Vec<ProviderDefinition> {
    vec![
        builtin(
            "ollama",
            "Ollama",
            "http://127.0.0.1:11434/v1",
            ProviderProtocol::OpenaiCompatible,
            true,
        ),
        builtin(
            "openai",
            "OpenAI",
            "https://api.openai.com/v1",
            ProviderProtocol::Openai,
            false,
        ),
        builtin(
            "anthropic",
            "Anthropic",
            "https://api.anthropic.com",
            ProviderProtocol::Anthropic,
            false,
        ),
        builtin(
            "google",
            "Google",
            "https://generativelanguage.googleapis.com",
            ProviderProtocol::Google,
            false,
        ),
        builtin(
            "deepseek",
            "DeepSeek",
            "https://api.deepseek.com",
            ProviderProtocol::OpenaiCompatible,
            false,
        ),
    ]
}

fn builtin(
    id: &str,
    name: &str,
    api: &str,
    protocol: ProviderProtocol,
    is_local: bool,
) -> ProviderDefinition {
    ProviderDefinition {
        id: id.into(),
        name: name.into(),
        api: api.into(),
        npm: String::new(),
        doc: None,
        env: vec![],
        protocol,
        models: vec![],
        default_model: None,
        default_api: Some(api.into()),
        is_api_overridden: false,
        is_custom: false,
        is_local,
    }
}

fn custom_definition(provider: CustomProviderConfig) -> ProviderDefinition {
    let api = provider.base_url;
    ProviderDefinition {
        id: provider.id,
        name: provider.name,
        api: api.clone(),
        npm: String::new(),
        doc: None,
        env: vec![],
        protocol: provider.protocol,
        models: provider.models,
        default_model: Some(provider.default_model),
        default_api: Some(api),
        is_api_overridden: false,
        is_custom: true,
        is_local: false,
    }
}

async fn fetch_models_dev(client: &reqwest::Client) -> AppResult<Vec<ProviderDefinition>> {
    let payload: HashMap<String, Value> = client
        .get("https://models.dev/api.json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut providers = Vec::with_capacity(payload.len());
    for (id, provider) in payload {
        let api = provider["api"].as_str().unwrap_or_default();
        if api.is_empty() {
            continue;
        }
        let npm = provider["npm"].as_str().unwrap_or_default();
        let protocol = if npm.contains("openai-compatible") {
            ProviderProtocol::OpenaiCompatible
        } else if npm.contains("openai") {
            ProviderProtocol::Openai
        } else if npm.contains("anthropic") {
            ProviderProtocol::Anthropic
        } else if npm.contains("google") {
            ProviderProtocol::Google
        } else {
            ProviderProtocol::Unknown
        };
        let models = provider["models"]
            .as_object()
            .into_iter()
            .flat_map(|models| models.iter())
            .filter_map(|(model_id, model)| {
                let input = model["modalities"]["input"].as_array()?;
                let output = model["modalities"]["output"].as_array()?;
                let is_text = input.iter().any(|item| item == "text")
                    && output.len() == 1
                    && output[0] == "text";
                is_text.then(|| ProviderModel {
                    id: model_id.clone(),
                    name: model["name"].as_str().unwrap_or(model_id).to_owned(),
                    family: model["family"].as_str().map(str::to_owned),
                    reasoning: model["reasoning"].as_bool(),
                })
            })
            .collect();
        providers.push(ProviderDefinition {
            id: id.clone(),
            name: provider["name"].as_str().unwrap_or(&id).to_owned(),
            api: api.to_owned(),
            npm: npm.to_owned(),
            doc: provider["doc"].as_str().map(str::to_owned),
            env: provider["env"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect(),
            protocol,
            models,
            default_model: None,
            default_api: None,
            is_api_overridden: false,
            is_custom: false,
            is_local: false,
        });
    }
    Ok(providers)
}

fn merge_with_builtins(remote: Vec<ProviderDefinition>) -> Vec<ProviderDefinition> {
    let mut providers: HashMap<String, ProviderDefinition> = builtin_providers()
        .into_iter()
        .map(|provider| (provider.id.clone(), provider))
        .collect();
    for mut provider in remote {
        if let Some(bundled) = providers.get(&provider.id) {
            if provider.api.is_empty() {
                provider.api.clone_from(&bundled.api);
            }
            if provider.npm.is_empty() {
                provider.npm.clone_from(&bundled.npm);
            }
            if provider.doc.is_none() {
                provider.doc.clone_from(&bundled.doc);
            }
            if provider.env.is_empty() {
                provider.env.clone_from(&bundled.env);
            }
            if provider.models.is_empty() {
                provider.models.clone_from(&bundled.models);
            }
        }
        providers.insert(provider.id.clone(), provider);
    }
    let mut providers = providers.into_values().collect::<Vec<_>>();
    providers.sort_by_key(|provider| provider.name.to_lowercase());
    providers
}

fn apply_base_url_override(provider: &mut ProviderDefinition, override_url: Option<String>) {
    let default_api = provider
        .default_api
        .get_or_insert_with(|| provider.api.clone())
        .clone();
    if let Some(override_url) = override_url {
        provider.api = override_url;
        provider.is_api_overridden = true;
    } else {
        provider.api = default_api;
        provider.is_api_overridden = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_response_preserves_default_api_when_overridden() {
        let mut provider = builtin(
            "openai",
            "OpenAI",
            "https://api.openai.com/v1",
            ProviderProtocol::Openai,
            false,
        );

        apply_base_url_override(&mut provider, Some("https://gateway.example.com/v1".into()));

        let response = serde_json::to_value(&provider).unwrap();
        assert_eq!(response["api"], "https://gateway.example.com/v1");
        assert_eq!(response["defaultApi"], "https://api.openai.com/v1");
        assert_eq!(response["isApiOverridden"], true);

        apply_base_url_override(&mut provider, None);
        assert_eq!(provider.api, "https://api.openai.com/v1");
        assert!(!provider.is_api_overridden);
    }
}

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::store::AgentConfig;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentChatRequest {
    pub agent_id: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub conversation_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentRunTaskRequest {
    pub agent_ids: Vec<String>,
    pub task: String,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub run_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub root_agent_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<AgentAttachment>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
    System,
}

impl ChatRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::System => "system",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentAttachment {
    pub path: String,
    pub grant_id: String,
    pub name: String,
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentCacheUsage {
    pub measured: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub requests: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub prompt_tokens: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub cache_read_tokens: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub cache_miss_tokens: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub cache_write_tokens: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub completion_tokens: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub total_tokens: u64,
    pub hit_rate: f64,
}

impl AgentCacheUsage {
    pub fn add_assign(&mut self, other: &Self) {
        self.measured |= other.measured;
        self.requests = self.requests.saturating_add(other.requests);
        self.prompt_tokens = self.prompt_tokens.saturating_add(other.prompt_tokens);
        self.cache_read_tokens = self
            .cache_read_tokens
            .saturating_add(other.cache_read_tokens);
        self.cache_miss_tokens = self
            .cache_miss_tokens
            .saturating_add(other.cache_miss_tokens);
        self.cache_write_tokens = self
            .cache_write_tokens
            .saturating_add(other.cache_write_tokens);
        self.completion_tokens = self
            .completion_tokens
            .saturating_add(other.completion_tokens);
        self.total_tokens = self.total_tokens.saturating_add(other.total_tokens);
        self.refresh_hit_rate();
    }

    pub fn refresh_hit_rate(&mut self) {
        let denominator = self
            .cache_read_tokens
            .saturating_add(self.cache_miss_tokens);
        self.hit_rate = if denominator == 0 {
            0.0
        } else {
            self.cache_read_tokens as f64 / denominator as f64
        };
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskResult {
    pub agent_id: String,
    pub agent_name: String,
    pub provider_id: String,
    pub model: String,
    pub response: String,
    pub tool_calls: Vec<ExecutedToolCall>,
    pub cache_usage: AgentCacheUsage,
}

impl AgentTaskResult {
    pub fn from_agent(
        agent: &AgentConfig,
        response: String,
        tool_calls: Vec<ExecutedToolCall>,
        cache_usage: AgentCacheUsage,
    ) -> Self {
        Self {
            agent_id: agent.id.clone(),
            agent_name: agent.name.clone(),
            provider_id: agent.provider_id.clone(),
            model: agent.model.clone(),
            response,
            tool_calls,
            cache_usage,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ExecutedToolCall {
    pub tool: String,
    pub args: Map<String, Value>,
    pub result: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ParsedToolCall {
    pub tool: String,
    #[serde(default)]
    pub args: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentCollaborationEvent {
    pub run_id: String,
    /// Filled by the runtime immediately before the event is sent through the
    /// window-owned IPC channel. Keeping it on every frame makes accidental
    /// cross-window fan-out detectable in the renderer as well as in Rust.
    pub window_label: String,
    #[serde(rename = "type")]
    pub event_type: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub timestamp: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub from_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub from_agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub to_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub to_agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub args: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub cache_usage: Option<AgentCacheUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub document_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional, type = "number"))]
    pub base_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional, type = "number"))]
    pub revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub position: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub range: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub message: Option<String>,
}

impl AgentCollaborationEvent {
    pub fn new(run_id: impl Into<String>, event_type: impl Into<String>) -> Self {
        Self {
            run_id: run_id.into(),
            window_label: String::new(),
            event_type: event_type.into(),
            timestamp: unix_millis(),
            agent_id: None,
            agent_name: None,
            provider_id: None,
            model: None,
            from_agent_id: None,
            from_agent_name: None,
            to_agent_id: None,
            to_agent_name: None,
            content: None,
            tool: None,
            args: None,
            result: None,
            cache_usage: None,
            error: None,
            operation_id: None,
            document_id: None,
            engine: None,
            base_revision: None,
            revision: None,
            position: None,
            range: None,
            action: None,
            phase: None,
            message: None,
        }
    }

    pub fn for_agent(mut self, agent: &AgentConfig) -> Self {
        self.agent_id = Some(agent.id.clone());
        self.agent_name = Some(agent.name.clone());
        self.provider_id = Some(agent.provider_id.clone());
        self.model = Some(agent.model.clone());
        self
    }
}

#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentDocumentResult {
    pub request_id: String,
    pub result: Value,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AgentDocumentEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub run_id: String,
    #[serde(default)]
    #[cfg_attr(test, ts(optional, type = "number"))]
    pub timestamp: Option<u64>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub operation_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub agent_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub agent_name: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub document_id: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub engine: Option<String>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional, type = "number"))]
    pub revision: Option<u64>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional, type = "number"))]
    pub base_revision: Option<u64>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub position: Option<Value>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub range: Option<Value>,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CommandSuccess {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub already_finished: Option<bool>,
}

pub fn unix_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

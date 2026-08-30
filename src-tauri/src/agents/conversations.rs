use crate::{
    agents::models::ChatRole,
    error::{AppError, AppResult},
    state::{atomic_write_json, ensure_data_version, DATA_SCHEMA_VERSION},
};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const MAX_TITLE_CHARS: usize = 96;
const MAX_IMPORT_FAILURES: usize = 20;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum ConversationSource {
    Native,
    Codex,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub role: ChatRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional, type = "number"))]
    pub timestamp: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub source: ConversationSource,
    #[cfg_attr(test, ts(type = "number"))]
    pub created_at: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub updated_at: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub message_count: usize,
    #[serde(default)]
    #[cfg_attr(test, ts(type = "number"))]
    pub imported_message_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub source_thread_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub project_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub original_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub original_model: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    #[cfg_attr(test, ts(type = "number"))]
    pub source_size: u64,
    #[serde(default)]
    #[cfg_attr(test, ts(type = "number"))]
    pub source_modified_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub summary: ConversationSummary,
    pub messages: Vec<ConversationMessage>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ConversationSaveRequest {
    pub id: String,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub title: Option<String>,
    pub messages: Vec<ConversationMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CodexImportFailure {
    pub file: String,
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CodexImportResult {
    #[cfg_attr(test, ts(type = "number"))]
    pub discovered: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub imported: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub updated: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub skipped: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub failed: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub messages: usize,
    pub failures: Vec<CodexImportFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationIndex {
    version: u32,
    #[serde(default)]
    conversations: Vec<ConversationSummary>,
}

impl Default for ConversationIndex {
    fn default() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            conversations: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationFile {
    version: u32,
    conversation: ConversationRecord,
}

#[derive(Clone)]
pub struct ConversationStore {
    root: Arc<PathBuf>,
    index_path: Arc<PathBuf>,
    codex_home: Arc<PathBuf>,
    summaries: Arc<RwLock<Vec<ConversationSummary>>>,
    import_gate: Arc<Mutex<()>>,
}

impl ConversationStore {
    pub fn new(root: PathBuf, home_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(&root)?;
        let index_path = root.join("index.json");
        let index = match fs::read(&index_path) {
            Ok(data) => serde_json::from_slice::<ConversationIndex>(&data)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ConversationIndex::default()
            }
            Err(error) => return Err(error.into()),
        };
        ensure_data_version("conversation index", index.version)?;
        let codex_home = std::env::var_os("CODEX_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir.join(".codex"));
        Ok(Self {
            root: Arc::new(root),
            index_path: Arc::new(index_path),
            codex_home: Arc::new(codex_home),
            summaries: Arc::new(RwLock::new(index.conversations)),
            import_gate: Arc::new(Mutex::new(())),
        })
    }

    pub fn list(&self) -> Vec<ConversationSummary> {
        let mut summaries = self.summaries.read().clone();
        sort_summaries(&mut summaries);
        summaries
    }

    pub fn get(&self, id: &str) -> AppResult<ConversationRecord> {
        validate_conversation_id(id)?;
        let data = fs::read(self.record_path(id))?;
        let file = serde_json::from_slice::<ConversationFile>(&data)?;
        ensure_data_version("conversation", file.version)?;
        Ok(file.conversation)
    }

    pub fn save(&self, mut request: ConversationSaveRequest) -> AppResult<ConversationRecord> {
        validate_conversation_id(&request.id)?;
        request
            .messages
            .retain(|message| !message.content.trim().is_empty());
        let now = unix_millis();
        let existing = self
            .summaries
            .read()
            .iter()
            .find(|summary| summary.id == request.id)
            .cloned();
        let title = request
            .title
            .as_deref()
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(truncate_title)
            .or_else(|| existing.as_ref().map(|summary| summary.title.clone()))
            .unwrap_or_else(|| derive_title(&request.messages));
        let summary = ConversationSummary {
            id: request.id,
            title,
            source: existing
                .as_ref()
                .map(|summary| summary.source)
                .unwrap_or(ConversationSource::Native),
            created_at: existing
                .as_ref()
                .map(|summary| summary.created_at)
                .unwrap_or(now),
            updated_at: now,
            message_count: request.messages.len(),
            imported_message_count: existing
                .as_ref()
                .map(|summary| summary.imported_message_count)
                .unwrap_or(0),
            source_thread_id: existing
                .as_ref()
                .and_then(|summary| summary.source_thread_id.clone()),
            project_path: existing
                .as_ref()
                .and_then(|summary| summary.project_path.clone()),
            original_provider: existing
                .as_ref()
                .and_then(|summary| summary.original_provider.clone()),
            original_model: existing
                .as_ref()
                .and_then(|summary| summary.original_model.clone()),
            archived: existing.as_ref().is_some_and(|summary| summary.archived),
            source_size: existing
                .as_ref()
                .map(|summary| summary.source_size)
                .unwrap_or(0),
            source_modified_at: existing
                .as_ref()
                .map(|summary| summary.source_modified_at)
                .unwrap_or(0),
        };
        let record = ConversationRecord {
            summary: summary.clone(),
            messages: request.messages,
        };
        self.write_record(&record)?;
        self.upsert_summary(summary);
        self.write_index()?;
        Ok(record)
    }

    pub fn delete(&self, id: &str) -> AppResult<bool> {
        validate_conversation_id(id)?;
        let mut summaries = self.summaries.write();
        let original_len = summaries.len();
        summaries.retain(|summary| summary.id != id);
        let removed = summaries.len() != original_len;
        if !removed {
            return Ok(false);
        }
        let path = self.record_path(id);
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        drop(summaries);
        self.write_index()?;
        Ok(true)
    }

    pub fn import_codex(&self) -> AppResult<CodexImportResult> {
        let _guard = self.import_gate.lock();
        let title_index = read_codex_title_index(&self.codex_home.join("session_index.jsonl"));
        let mut sources = Vec::new();
        collect_jsonl_files(&self.codex_home.join("sessions"), false, &mut sources)?;
        collect_jsonl_files(
            &self.codex_home.join("archived_sessions"),
            true,
            &mut sources,
        )?;
        sources.sort_by(|left, right| left.path.cmp(&right.path));

        let mut result = CodexImportResult {
            discovered: sources.len(),
            ..CodexImportResult::default()
        };
        let known = self
            .summaries
            .read()
            .iter()
            .map(|summary| (summary.id.clone(), summary.clone()))
            .collect::<HashMap<_, _>>();

        for source in sources {
            let metadata = match fs::metadata(&source.path) {
                Ok(metadata) => metadata,
                Err(error) => {
                    record_import_failure(&mut result, &source.path, &error.to_string());
                    continue;
                }
            };
            let size = metadata.len();
            let modified_at = metadata
                .modified()
                .ok()
                .map(system_time_millis)
                .unwrap_or_default();
            let filename_id = codex_thread_id_from_path(&source.path);
            if let Some(existing) = filename_id.as_ref().and_then(|id| known.get(id)) {
                if existing.source == ConversationSource::Codex
                    && existing.source_size == size
                    && existing.source_modified_at == modified_at
                    && self.record_path(&existing.id).is_file()
                {
                    result.skipped += 1;
                    result.messages = result.messages.saturating_add(existing.message_count);
                    continue;
                }
            }

            match parse_codex_rollout(&source.path, source.archived, &title_index) {
                Ok(mut record) => {
                    record.summary.source_size = size;
                    record.summary.source_modified_at = modified_at;
                    record.summary.updated_at = modified_at.max(record.summary.created_at);
                    let existed = known.contains_key(&record.summary.id);
                    let imported_message_count = record.messages.len();
                    if existed {
                        if let Ok(existing_record) = self.get(&record.summary.id) {
                            let continuation = existing_record
                                .messages
                                .into_iter()
                                .skip(existing_record.summary.imported_message_count);
                            for message in continuation {
                                if !record.messages.last().is_some_and(|last| {
                                    last.role == message.role && last.content == message.content
                                }) {
                                    record.messages.push(message);
                                }
                            }
                        }
                    }
                    record.summary.imported_message_count = imported_message_count;
                    record.summary.message_count = record.messages.len();
                    self.write_record(&record)?;
                    result.messages = result.messages.saturating_add(record.messages.len());
                    if existed {
                        result.updated += 1;
                    } else {
                        result.imported += 1;
                    }
                    self.upsert_summary(record.summary);
                }
                Err(error) => {
                    record_import_failure(&mut result, &source.path, &error.to_string());
                }
            }
        }
        self.write_index()?;
        Ok(result)
    }

    fn write_record(&self, record: &ConversationRecord) -> AppResult<()> {
        atomic_write_json(
            &self.record_path(&record.summary.id),
            &ConversationFile {
                version: DATA_SCHEMA_VERSION,
                conversation: record.clone(),
            },
        )
    }

    fn record_path(&self, id: &str) -> PathBuf {
        self.root.join(format!("{id}.json"))
    }

    fn upsert_summary(&self, summary: ConversationSummary) {
        let mut summaries = self.summaries.write();
        if let Some(existing) = summaries.iter_mut().find(|item| item.id == summary.id) {
            *existing = summary;
        } else {
            summaries.push(summary);
        }
        sort_summaries(&mut summaries);
    }

    fn write_index(&self) -> AppResult<()> {
        atomic_write_json(
            &self.index_path,
            &ConversationIndex {
                version: DATA_SCHEMA_VERSION,
                conversations: self.summaries.read().clone(),
            },
        )
    }
}

#[derive(Debug)]
struct CodexSource {
    path: PathBuf,
    archived: bool,
}

#[derive(Debug)]
struct MessageCandidate {
    ordinal: usize,
    priority: u8,
    message: ConversationMessage,
}

fn parse_codex_rollout(
    path: &Path,
    archived: bool,
    title_index: &HashMap<String, String>,
) -> AppResult<ConversationRecord> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    let modified_at = metadata
        .modified()
        .ok()
        .map(system_time_millis)
        .unwrap_or_else(unix_millis);
    let created_at = metadata
        .created()
        .ok()
        .map(system_time_millis)
        .unwrap_or(modified_at);
    let reader = BufReader::new(file);
    let mut thread_id = codex_thread_id_from_path(path);
    let mut project_path = None;
    let mut original_provider = None;
    let mut original_model = None;
    let mut candidates = Vec::new();

    for (ordinal, line) in reader.lines().enumerate() {
        let line = match line {
            Ok(line) => line,
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(error.into()),
        };
        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let record_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = value.get("payload").unwrap_or(&Value::Null);
        match record_type {
            "session_meta" => {
                if thread_id.is_none() {
                    if let Some(id) = payload.get("id").and_then(Value::as_str) {
                        if Uuid::parse_str(id).is_ok() {
                            thread_id = Some(id.to_owned());
                        }
                    }
                }
                project_path = non_empty_string(payload.get("cwd")).or(project_path);
                original_provider =
                    non_empty_string(payload.get("model_provider")).or(original_provider);
            }
            "turn_context" => {
                original_model = non_empty_string(payload.get("model")).or(original_model);
                original_provider =
                    non_empty_string(payload.get("model_provider")).or(original_provider);
            }
            "response_item" => {
                if let Some(message) = response_item_message(payload) {
                    candidates.push(MessageCandidate {
                        ordinal,
                        priority: 0,
                        message,
                    });
                }
            }
            "event_msg" => {
                if let Some(message) = event_message(payload) {
                    candidates.push(MessageCandidate {
                        ordinal,
                        priority: 1,
                        message,
                    });
                }
            }
            _ => {}
        }
    }

    let id = thread_id.ok_or_else(|| {
        AppError::new(
            "invalid-codex-session",
            "Codex session did not contain a valid thread id",
        )
    })?;
    candidates.sort_by_key(|candidate| (candidate.ordinal, candidate.priority));
    let response_candidates = candidates
        .iter()
        .filter(|candidate| candidate.priority == 0)
        .map(|candidate| {
            (
                candidate.ordinal,
                candidate.message.role,
                candidate.message.content.trim().to_owned(),
            )
        })
        .collect::<Vec<_>>();
    let mut messages: Vec<ConversationMessage> = Vec::new();
    for candidate in candidates {
        let content = candidate.message.content.trim().to_owned();
        if content.is_empty()
            || (candidate.message.role == ChatRole::User && is_internal_user_context(&content))
        {
            continue;
        }
        if candidate.priority == 1
            && response_candidates.iter().any(|(ordinal, role, response)| {
                ordinal.abs_diff(candidate.ordinal) <= 4
                    && *role == candidate.message.role
                    && portable_content_matches(response, &content)
            })
        {
            continue;
        }
        if messages.last().is_some_and(|previous| {
            previous.role == candidate.message.role && previous.content.trim() == content
        }) {
            continue;
        }
        let mut message = candidate.message;
        message.content = content;
        messages.push(message);
    }

    let title = title_index
        .get(&id)
        .map(|title| truncate_title(title))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| derive_title(&messages));
    let summary = ConversationSummary {
        id: id.clone(),
        title,
        source: ConversationSource::Codex,
        created_at,
        updated_at: modified_at.max(created_at),
        message_count: messages.len(),
        imported_message_count: messages.len(),
        source_thread_id: Some(id),
        project_path,
        original_provider,
        original_model,
        archived,
        source_size: metadata.len(),
        source_modified_at: modified_at,
    };
    Ok(ConversationRecord { summary, messages })
}

fn portable_content_matches(left: &str, right: &str) -> bool {
    let left = left.trim();
    let right = right.trim();
    left == right
        || left
            .strip_prefix(right)
            .is_some_and(|suffix| suffix.trim_start().starts_with("[1 image attachment"))
        || right
            .strip_prefix(left)
            .is_some_and(|suffix| suffix.trim_start().starts_with("[1 image attachment"))
}

fn response_item_message(payload: &Value) -> Option<ConversationMessage> {
    match payload.get("type").and_then(Value::as_str)? {
        "message" => {
            let role = parse_portable_role(payload.get("role")?.as_str()?)?;
            let content = extract_content(payload.get("content")?);
            (!content.trim().is_empty()).then_some(ConversationMessage {
                role,
                content,
                timestamp: None,
            })
        }
        "agent_message" => {
            let content = extract_content(payload.get("content")?);
            (!content.trim().is_empty()).then_some(ConversationMessage {
                role: ChatRole::Assistant,
                content,
                timestamp: None,
            })
        }
        _ => None,
    }
}

fn event_message(payload: &Value) -> Option<ConversationMessage> {
    let role = match payload.get("type").and_then(Value::as_str)? {
        "user_message" => ChatRole::User,
        "agent_message" => ChatRole::Assistant,
        _ => return None,
    };
    let content = payload.get("message").and_then(Value::as_str)?.to_owned();
    (!content.trim().is_empty()).then_some(ConversationMessage {
        role,
        content,
        timestamp: None,
    })
}

fn extract_content(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_owned();
    }
    let Some(parts) = value.as_array() else {
        return String::new();
    };
    let mut output = Vec::new();
    let mut omitted_images = 0usize;
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            if !text.trim().is_empty() {
                output.push(text.to_owned());
            }
        } else if part.get("type").and_then(Value::as_str) == Some("input_image") {
            omitted_images += 1;
        }
    }
    if omitted_images > 0 {
        output.push(format!(
            "[{} image attachment{} from the original Codex conversation]",
            omitted_images,
            if omitted_images == 1 { "" } else { "s" }
        ));
    }
    output.join("\n\n")
}

fn parse_portable_role(value: &str) -> Option<ChatRole> {
    match value {
        "user" => Some(ChatRole::User),
        "assistant" => Some(ChatRole::Assistant),
        "system" => Some(ChatRole::System),
        _ => None,
    }
}

fn is_internal_user_context(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<permissions instructions>")
        || trimmed.starts_with("<collaboration_mode>")
}

fn read_codex_title_index(path: &Path) -> HashMap<String, String> {
    let Ok(file) = File::open(path) else {
        return HashMap::new();
    };
    let mut titles = HashMap::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(title) = value.get("thread_name").and_then(Value::as_str) else {
            continue;
        };
        if Uuid::parse_str(id).is_ok() && !title.trim().is_empty() {
            titles.insert(id.to_owned(), title.trim().to_owned());
        }
    }
    titles
}

fn collect_jsonl_files(
    path: &Path,
    archived: bool,
    output: &mut Vec<CodexSource>,
) -> AppResult<()> {
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_jsonl_files(&entry.path(), archived, output)?;
        } else if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
        {
            output.push(CodexSource {
                path: entry.path(),
                archived,
            });
        }
    }
    Ok(())
}

fn codex_thread_id_from_path(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    if stem.len() < 36 {
        return None;
    }
    let candidate = &stem[stem.len() - 36..];
    Uuid::parse_str(candidate).ok().map(|id| id.to_string())
}

fn derive_title(messages: &[ConversationMessage]) -> String {
    messages
        .iter()
        .find(|message| message.role == ChatRole::User && !message.content.trim().is_empty())
        .map(|message| truncate_title(&message.content))
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| "Untitled conversation".to_owned())
}

fn truncate_title(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= MAX_TITLE_CHARS {
        compact
    } else {
        format!(
            "{}…",
            compact.chars().take(MAX_TITLE_CHARS).collect::<String>()
        )
    }
}

fn non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn validate_conversation_id(id: &str) -> AppResult<()> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(AppError::invalid("Invalid conversation id"));
    }
    Ok(())
}

fn record_import_failure(result: &mut CodexImportResult, path: &Path, error: &str) {
    result.failed += 1;
    if result.failures.len() < MAX_IMPORT_FAILURES {
        result.failures.push(CodexImportFailure {
            file: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "unknown.jsonl".to_owned()),
            error: error.to_owned(),
        });
    }
}

fn sort_summaries(summaries: &mut [ConversationSummary]) {
    summaries.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.title.cmp(&right.title))
    });
}

fn unix_millis() -> u64 {
    system_time_millis(SystemTime::now())
}

fn system_time_millis(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn imports_portable_codex_messages_without_hidden_or_tool_content() {
        let temp = tempfile::tempdir().unwrap();
        let id = "019dd33c-0a04-7843-9b8e-26a7040aeb63";
        let path = temp
            .path()
            .join(format!("rollout-2026-04-28T16-37-00-{id}.jsonl"));
        let mut file = File::create(&path).unwrap();
        for value in [
            serde_json::json!({"type":"session_meta","payload":{"id":id,"cwd":"C:/work","model_provider":"openai"}}),
            serde_json::json!({"type":"turn_context","payload":{"model":"gpt-5"}}),
            serde_json::json!({"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"hidden"}]}}),
            serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>private</environment_context>"}]}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"Build the feature"}}),
            serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Build the feature"},{"type":"input_image","image_url":"data:image/png;base64,secret"}]}}),
            serde_json::json!({"type":"response_item","payload":{"type":"function_call_output","output":"secret tool output"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"agent_message","message":"Done"}}),
            serde_json::json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Done"}]}}),
        ] {
            writeln!(file, "{}", serde_json::to_string(&value).unwrap()).unwrap();
        }
        drop(file);

        let record = parse_codex_rollout(&path, false, &HashMap::new()).unwrap();
        assert_eq!(record.summary.id, id);
        assert_eq!(record.summary.project_path.as_deref(), Some("C:/work"));
        assert_eq!(record.summary.original_model.as_deref(), Some("gpt-5"));
        assert_eq!(record.messages.len(), 2);
        assert!(record
            .messages
            .iter()
            .all(|message| !message.content.contains("hidden")));
        assert!(record
            .messages
            .iter()
            .all(|message| !message.content.contains("secret")));
        assert!(record.messages[0].content.contains("image attachment"));
    }

    #[test]
    fn conversation_store_round_trips_and_import_is_idempotent() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let sessions = home.join(".codex/sessions/2026/08/30");
        fs::create_dir_all(&sessions).unwrap();
        let id = "01a0508c-c581-73f1-80e2-158bf3a087f4";
        let rollout = sessions.join(format!("rollout-2026-08-30T01-00-00-{id}.jsonl"));
        fs::write(
            &rollout,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"{id}\"}}}}\n{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"user_message\",\"message\":\"Hello\"}}}}\n"
            ),
        )
        .unwrap();
        let store = ConversationStore::new(temp.path().join("data"), &home).unwrap();
        let first = store.import_codex().unwrap();
        assert_eq!(first.imported, 1);
        assert_eq!(store.get(id).unwrap().messages.len(), 1);
        let second = store.import_codex().unwrap();
        assert_eq!(second.skipped, 1);
        assert_eq!(second.imported, 0);
    }
}

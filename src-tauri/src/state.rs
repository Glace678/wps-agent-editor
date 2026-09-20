use crate::{
    agents::{conversations::ConversationStore, runtime::AgentRuntime, store::AgentStore},
    error::{AppError, AppResult},
    files::FileServices,
    providers::store::ProviderStore,
};
use parking_lot::RwLock;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

pub(crate) const DATA_SCHEMA_VERSION: u32 = 1;
pub(crate) type RecoveryNotices = Arc<parking_lot::Mutex<Vec<RecoveryNotice>>>;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct RecoveryNotice {
    pub resource: String,
    pub action: String,
    pub path: String,
    pub message: String,
}

pub struct AppState {
    pub files: FileServices,
    pub agents: AgentStore,
    pub conversations: ConversationStore,
    pub agent_runtime: AgentRuntime,
    pub providers: ProviderStore,
    pub language: RwLock<String>,
    pub theme: RwLock<String>,
    recovery_notices: RecoveryNotices,
    startup_files: parking_lot::Mutex<StartupFileQueue>,
    pub current_files: parking_lot::Mutex<HashMap<String, crate::files::models::GrantedPath>>,
}

impl AppState {
    pub fn initialize(app: &AppHandle) -> AppResult<Self> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| {
                AppError::internal(format!("Cannot resolve app data directory: {error}"))
            })?
            .join("v2");
        std::fs::create_dir_all(&app_data_dir)?;
        let home_dir = dirs::home_dir().ok_or_else(|| {
            AppError::not_found("Cannot resolve the current user's home directory")
        })?;
        let recovery_notices = Arc::new(parking_lot::Mutex::new(Vec::new()));

        Ok(Self {
            files: FileServices::new_with_recovery(
                app_data_dir.clone(),
                home_dir.clone(),
                recovery_notices.clone(),
            )?,
            agents: AgentStore::new_with_recovery(
                app_data_dir.join("agents.json"),
                recovery_notices.clone(),
            )?,
            conversations: ConversationStore::new_with_recovery(
                app_data_dir.join("conversations"),
                &home_dir,
                recovery_notices.clone(),
            )?,
            agent_runtime: AgentRuntime::default(),
            providers: ProviderStore::new_with_recovery(app_data_dir, recovery_notices.clone())?,
            language: RwLock::new("zh-CN".to_owned()),
            theme: RwLock::new("system".to_owned()),
            recovery_notices,
            startup_files: parking_lot::Mutex::new(StartupFileQueue::default()),
            current_files: parking_lot::Mutex::new(HashMap::new()),
        })
    }

    pub fn enqueue_startup_file(
        &self,
        window_label: impl Into<String>,
        grant: crate::files::models::GrantedPath,
    ) {
        self.startup_files.lock().push(window_label.into(), grant);
    }

    pub fn take_startup_files(&self, window_label: &str) -> Vec<crate::files::models::GrantedPath> {
        self.startup_files.lock().take(window_label)
    }

    pub fn take_recovery_notices(&self) -> Vec<RecoveryNotice> {
        std::mem::take(&mut *self.recovery_notices.lock())
    }

    pub fn revoke_window(&self, window_label: &str) {
        crate::process::terminal::kill_window(window_label);
        crate::process::debugger::stop_window(window_label);
        self.agent_runtime.cancel_window(window_label);
        self.files.access.revoke_owner(window_label);
        self.startup_files.lock().discard(window_label);
        self.current_files.lock().remove(window_label);
    }
}

#[derive(Default)]
struct StartupFileQueue {
    by_window: HashMap<String, VecDeque<crate::files::models::GrantedPath>>,
}

impl StartupFileQueue {
    fn push(&mut self, window_label: String, grant: crate::files::models::GrantedPath) {
        self.by_window
            .entry(window_label)
            .or_default()
            .push_back(grant);
    }

    fn take(&mut self, window_label: &str) -> Vec<crate::files::models::GrantedPath> {
        self.by_window
            .remove(window_label)
            .map(|queue| queue.into_iter().collect())
            .unwrap_or_default()
    }

    fn discard(&mut self, window_label: &str) {
        self.by_window.remove(window_label);
    }
}

pub(crate) fn new_recovery_notices() -> RecoveryNotices {
    Arc::new(parking_lot::Mutex::new(Vec::new()))
}

pub(crate) fn read_versioned_json<T>(
    path: &Path,
    resource: &str,
    notices: &RecoveryNotices,
) -> AppResult<T>
where
    T: DeserializeOwned + Default,
{
    match std::fs::read(path) {
        Ok(bytes) => match decode_versioned_json(&bytes, resource) {
            Ok(value) => Ok(value),
            Err(error) if error.code == "unsupported-data-version" => Err(error),
            Err(primary_error) => recover_versioned_json(path, resource, notices, primary_error),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn decode_versioned_json<T: DeserializeOwned>(
    bytes: &[u8],
    resource: &str,
) -> AppResult<T> {
    let value: Value = serde_json::from_slice(bytes)?;
    let version = value
        .get("version")
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .ok_or_else(|| AppError::new("invalid-data", format!("{resource} has no valid version")))?;
    ensure_data_version(resource, version)?;
    serde_json::from_value(value).map_err(Into::into)
}

fn recover_versioned_json<T: DeserializeOwned + Default>(
    path: &Path,
    resource: &str,
    notices: &RecoveryNotices,
    primary_error: AppError,
) -> AppResult<T> {
    let backup = backup_path(path);
    if let Ok(bytes) = std::fs::read(&backup) {
        match decode_versioned_json::<T>(&bytes, resource) {
            Ok(value) => {
                let quarantined = quarantine(path)?;
                crate::files::atomic::write_atomic(path, &bytes)?;
                push_recovery_notice(
                    notices,
                    resource,
                    "restored-backup",
                    &quarantined,
                    format!("Restored {resource} from a validated backup"),
                );
                return Ok(value);
            }
            Err(error) if error.code == "unsupported-data-version" => return Err(error),
            Err(_) => {}
        }
    }

    let quarantined = quarantine(path)?;
    push_recovery_notice(
        notices,
        resource,
        "quarantined",
        &quarantined,
        format!("Isolated damaged {resource}: {primary_error}"),
    );
    Ok(T::default())
}

pub(crate) fn push_recovery_notice(
    notices: &RecoveryNotices,
    resource: &str,
    action: &str,
    path: &Path,
    message: impl Into<String>,
) {
    notices.lock().push(RecoveryNotice {
        resource: resource.to_owned(),
        action: action.to_owned(),
        path: path.to_string_lossy().into_owned(),
        message: message.into(),
    });
}

fn backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "state.json".to_owned());
    path.with_file_name(format!("{name}.bak"))
}

fn quarantine(path: &Path) -> AppResult<PathBuf> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "state.json".to_owned());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut destination = path.with_file_name(format!("{name}.corrupt.{timestamp}"));
    let mut suffix = 0_u32;
    while destination.exists() {
        suffix = suffix.saturating_add(1);
        destination = path.with_file_name(format!("{name}.corrupt.{timestamp}.{suffix}"));
    }
    std::fs::rename(path, &destination)?;
    Ok(destination)
}

pub(crate) fn atomic_write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> AppResult<()> {
    let mut data = serde_json::to_vec_pretty(value)?;
    data.push(b'\n');
    if let Ok(existing) = std::fs::read(path) {
        let current = serde_json::from_slice::<Value>(&existing)
            .ok()
            .and_then(|value| value.get("version").and_then(Value::as_u64))
            == Some(u64::from(DATA_SCHEMA_VERSION));
        if current {
            crate::files::atomic::write_atomic(&backup_path(path), &existing)?;
        }
    }
    crate::files::atomic::write_atomic(path, &data)
}

pub(crate) fn ensure_data_version(resource: &str, actual: u32) -> AppResult<()> {
    if actual == DATA_SCHEMA_VERSION {
        return Ok(());
    }
    Err(AppError::new(
        "unsupported-data-version",
        format!("Unsupported {resource} data version {actual}; expected {DATA_SCHEMA_VERSION}"),
    )
    .with_details(serde_json::json!({
        "resource": resource,
        "actual": actual,
        "expected": DATA_SCHEMA_VERSION,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::models::GrantedPath;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Deserialize, Serialize)]
    struct TestFile {
        #[serde(default = "test_version")]
        version: u32,
        #[serde(default)]
        value: String,
    }

    impl Default for TestFile {
        fn default() -> Self {
            Self {
                version: DATA_SCHEMA_VERSION,
                value: String::new(),
            }
        }
    }

    fn test_version() -> u32 {
        DATA_SCHEMA_VERSION
    }

    #[test]
    fn startup_files_are_window_scoped_and_taken_once() {
        let mut queue = StartupFileQueue::default();
        queue.push(
            "main".to_owned(),
            GrantedPath {
                path: "main.txt".to_owned(),
                grant_id: "main-grant".to_owned(),
            },
        );
        queue.push(
            "other".to_owned(),
            GrantedPath {
                path: "other.txt".to_owned(),
                grant_id: "other-grant".to_owned(),
            },
        );

        let main = queue.take("main");
        assert_eq!(main.len(), 1);
        assert_eq!(main[0].grant_id, "main-grant");
        assert!(queue.take("main").is_empty());
        assert_eq!(queue.take("other")[0].grant_id, "other-grant");
    }

    #[test]
    fn damaged_primary_restores_a_valid_backup() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        std::fs::write(&path, b"broken").unwrap();
        std::fs::write(backup_path(&path), br#"{"version":1,"value":"backup"}"#).unwrap();
        let notices = new_recovery_notices();
        let value: TestFile = read_versioned_json(&path, "test state", &notices).unwrap();
        assert_eq!(value.value, "backup");
        assert_eq!(notices.lock()[0].action, "restored-backup");
        assert!(std::fs::read_dir(temp.path()).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains(".corrupt.")));
    }

    #[test]
    fn damaged_primary_and_backup_are_quarantined_to_defaults() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        std::fs::write(&path, b"broken").unwrap();
        std::fs::write(backup_path(&path), b"also broken").unwrap();
        let notices = new_recovery_notices();
        let value: TestFile = read_versioned_json(&path, "test state", &notices).unwrap();
        assert_eq!(value.version, DATA_SCHEMA_VERSION);
        assert_eq!(notices.lock()[0].action, "quarantined");
        assert!(!path.exists());
    }

    #[test]
    fn future_schema_is_a_hard_failure() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("state.json");
        std::fs::write(&path, br#"{"version":2,"value":"future"}"#).unwrap();
        let notices = new_recovery_notices();
        let error = read_versioned_json::<TestFile>(&path, "test state", &notices).unwrap_err();
        assert_eq!(error.code, "unsupported-data-version");
        assert!(path.exists());
        assert!(notices.lock().is_empty());
    }
}

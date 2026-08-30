use crate::{
    agents::{conversations::ConversationStore, runtime::AgentRuntime, store::AgentStore},
    error::{AppError, AppResult},
    files::FileServices,
    providers::store::ProviderStore,
};
use parking_lot::RwLock;
use serde::Serialize;
use std::{
    collections::{HashMap, VecDeque},
    path::Path,
};
use tauri::{AppHandle, Manager};

pub(crate) const DATA_SCHEMA_VERSION: u32 = 1;

pub struct AppState {
    pub files: FileServices,
    pub agents: AgentStore,
    pub conversations: ConversationStore,
    pub agent_runtime: AgentRuntime,
    pub providers: ProviderStore,
    pub language: RwLock<String>,
    pub theme: RwLock<String>,
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

        Ok(Self {
            files: FileServices::new(app_data_dir.clone(), home_dir.clone())?,
            agents: AgentStore::new(app_data_dir.join("agents.json"))?,
            conversations: ConversationStore::new(app_data_dir.join("conversations"), &home_dir)?,
            agent_runtime: AgentRuntime::default(),
            providers: ProviderStore::new(app_data_dir)?,
            language: RwLock::new("zh-CN".to_owned()),
            theme: RwLock::new("system".to_owned()),
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

pub(crate) fn read_json_or_default<T>(path: &Path) -> AppResult<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    match std::fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.into()),
    }
}

pub(crate) fn atomic_write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> AppResult<()> {
    let mut data = serde_json::to_vec_pretty(value)?;
    data.push(b'\n');
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
    use super::StartupFileQueue;
    use crate::files::models::GrantedPath;

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
}

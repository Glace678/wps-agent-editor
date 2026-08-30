use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    state::{ensure_data_version, DATA_SCHEMA_VERSION},
};

use super::atomic::write_atomic;

pub const MAX_SESSION_DIRECTORIES: usize = 20;
pub const MAX_SESSION_FILES: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSessionPath {
    pub path: String,
    pub writable: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredFileSession {
    pub main_directory: Option<StoredSessionPath>,
    pub current_directory: Option<StoredSessionPath>,
    #[serde(default)]
    pub recent_directories: Vec<StoredSessionPath>,
    #[serde(default)]
    pub open_files: Vec<StoredSessionPath>,
    pub active_file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileSessionStoreFile {
    version: u32,
    session: StoredFileSession,
}

pub struct FileSessionStore {
    store_path: PathBuf,
    lock: Mutex<()>,
}

impl FileSessionStore {
    pub fn new(store_path: PathBuf) -> Self {
        Self {
            store_path,
            lock: Mutex::new(()),
        }
    }

    pub fn load(&self) -> AppResult<StoredFileSession> {
        let _guard = self.lock.lock();
        match std::fs::read(&self.store_path) {
            Ok(data) => {
                let file: FileSessionStoreFile = serde_json::from_slice(&data)?;
                ensure_data_version("file session", file.version)?;
                Ok(sanitize_counts(file.session))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(StoredFileSession::default())
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn save(&self, session: &StoredFileSession) -> AppResult<()> {
        let _guard = self.lock.lock();
        let mut data = serde_json::to_vec_pretty(&FileSessionStoreFile {
            version: DATA_SCHEMA_VERSION,
            session: sanitize_counts(session.clone()),
        })?;
        data.push(b'\n');
        write_atomic(&self.store_path, &data)
    }
}

fn sanitize_counts(mut session: StoredFileSession) -> StoredFileSession {
    session.recent_directories.truncate(MAX_SESSION_DIRECTORIES);
    session.open_files.truncate(MAX_SESSION_FILES);
    session
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_store_round_trips_a_versioned_snapshot() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file-session.json");
        let store = FileSessionStore::new(path.clone());
        let session = StoredFileSession {
            main_directory: Some(StoredSessionPath {
                path: temp.path().to_string_lossy().into_owned(),
                writable: true,
            }),
            open_files: vec![StoredSessionPath {
                path: temp
                    .path()
                    .join("document.txt")
                    .to_string_lossy()
                    .into_owned(),
                writable: false,
            }],
            active_file: Some(
                temp.path()
                    .join("document.txt")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..StoredFileSession::default()
        };

        store.save(&session).unwrap();
        drop(store);
        let reopened_store = FileSessionStore::new(path.clone());
        assert_eq!(reopened_store.load().unwrap(), session);

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["version"], DATA_SCHEMA_VERSION);
        assert_eq!(value["session"]["openFiles"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn session_store_rejects_unversioned_and_future_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("file-session.json");
        let store = FileSessionStore::new(path.clone());

        std::fs::write(&path, b"{}").unwrap();
        assert_eq!(store.load().unwrap_err().code, "invalid-data");
        std::fs::write(&path, br#"{"version":2,"session":{}}"#).unwrap();
        assert_eq!(store.load().unwrap_err().code, "unsupported-data-version");
    }
}

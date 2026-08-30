use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use sha1::{Digest, Sha1};
use tokio::sync::Mutex;

use crate::{
    error::AppResult,
    state::{ensure_data_version, DATA_SCHEMA_VERSION},
};

use super::{
    atomic::write_atomic,
    models::{FileVersion, HistoryIndexEntry},
    path_key,
};

const MAX_VERSIONS: usize = 10;
const MAX_SNAPSHOT_SIZE: u64 = 50 * 1024 * 1024;
const MIN_SNAPSHOT_INTERVAL_MS: u64 = 5 * 60 * 1000;

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryIndexFile {
    version: u32,
    #[serde(default)]
    entries: Vec<HistoryIndexEntry>,
}

pub struct HistoryStore {
    root: PathBuf,
    lock: Mutex<()>,
}

impl HistoryStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            lock: Mutex::new(()),
        }
    }

    pub async fn snapshot(&self, path: &Path, force: bool) -> AppResult<bool> {
        let _guard = self.lock.lock().await;
        self.snapshot_unlocked(path, force)
    }

    pub async fn write_with_snapshot(&self, path: &Path, data: &[u8]) -> AppResult<()> {
        let _guard = self.lock.lock().await;
        self.snapshot_unlocked(path, false)?;
        write_atomic(path, data)
    }

    pub async fn list(&self, path: &Path) -> AppResult<Vec<FileVersion>> {
        let _guard = self.lock.lock().await;
        let directory = self.directory_for(path);
        let entries = self.read_index(&directory)?;
        Ok(entries
            .into_iter()
            .filter(|entry| directory.join(&entry.id).is_file())
            .map(|entry| FileVersion {
                id: entry.id,
                saved_at: entry.saved_at,
                size: entry.size,
            })
            .collect())
    }

    pub async fn restore(&self, path: &Path, version_id: &str) -> AppResult<bool> {
        if !valid_version_id(version_id) {
            return Ok(false);
        }
        let _guard = self.lock.lock().await;
        let directory = self.directory_for(path);
        let snapshot = directory.join(version_id);
        if std::fs::metadata(&snapshot)
            .map(|metadata| !metadata.is_file() || metadata.len() > MAX_SNAPSHOT_SIZE)
            .unwrap_or(false)
        {
            return Ok(false);
        }
        let data = match std::fs::read(snapshot) {
            Ok(data) => data,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        self.snapshot_unlocked(path, true)?;
        write_atomic(path, &data)?;
        Ok(true)
    }

    pub async fn move_history(&self, old_path: &Path, new_path: &Path) -> AppResult<()> {
        let _guard = self.lock.lock().await;
        let old_directory = self.directory_for(old_path);
        let new_directory = self.directory_for(new_path);
        if old_directory == new_directory || !old_directory.exists() {
            return Ok(());
        }
        if new_directory.exists() {
            return Ok(());
        }
        if let Some(parent) = new_directory.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(old_directory, new_directory)?;
        Ok(())
    }

    pub async fn delete_history(&self, path: &Path) -> AppResult<()> {
        let _guard = self.lock.lock().await;
        let directory = self.directory_for(path);
        match std::fs::remove_dir_all(directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn snapshot_unlocked(&self, path: &Path, force: bool) -> AppResult<bool> {
        let metadata = match std::fs::metadata(path) {
            Ok(metadata) if metadata.is_file() && metadata.len() <= MAX_SNAPSHOT_SIZE => metadata,
            Ok(_) => return Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        let source_mtime_ms = system_time_ms(metadata.modified().ok());
        let directory = self.directory_for(path);
        let mut index = self.read_index(&directory)?;
        if let Some(latest) = index.first() {
            if latest.source_mtime_ms == source_mtime_ms && latest.size == metadata.len() {
                return Ok(false);
            }
            if !force && now_ms().saturating_sub(latest.saved_at) < MIN_SNAPSHOT_INTERVAL_MS {
                return Ok(false);
            }
        }

        std::fs::create_dir_all(&directory)?;
        let mut saved_at = now_ms();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| {
                value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
            })
            .map(|value| format!(".{}", value.to_lowercase()))
            .unwrap_or_default();
        let mut id = format!("{saved_at}{extension}");
        while directory.join(&id).exists() {
            saved_at = saved_at.saturating_add(1);
            id = format!("{saved_at}{extension}");
        }

        let data = std::fs::read(path)?;
        write_atomic(&directory.join(&id), &data)?;
        index.insert(
            0,
            HistoryIndexEntry {
                id,
                saved_at,
                size: metadata.len(),
                source_mtime_ms,
            },
        );
        let removed = index.split_off(index.len().min(MAX_VERSIONS));
        self.write_index(&directory, &index)?;
        for entry in removed {
            let _ = std::fs::remove_file(directory.join(entry.id));
        }
        Ok(true)
    }

    fn directory_for(&self, path: &Path) -> PathBuf {
        self.root.join(history_hash(&path_key(path)))
    }

    fn read_index(&self, directory: &Path) -> AppResult<Vec<HistoryIndexEntry>> {
        let path = directory.join("index.json");
        match std::fs::read(path) {
            Ok(data) => {
                let file: HistoryIndexFile = serde_json::from_slice(&data)?;
                ensure_data_version("file history index", file.version)?;
                Ok(file
                    .entries
                    .into_iter()
                    .filter(|entry| valid_version_id(&entry.id))
                    .take(MAX_VERSIONS)
                    .collect())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn write_index(&self, directory: &Path, entries: &[HistoryIndexEntry]) -> AppResult<()> {
        let mut data = serde_json::to_vec_pretty(&HistoryIndexFile {
            version: DATA_SCHEMA_VERSION,
            entries: entries.to_vec(),
        })?;
        data.push(b'\n');
        write_atomic(&directory.join("index.json"), &data)
    }
}

fn history_hash(value: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn valid_version_id(value: &str) -> bool {
    let mut parts = value.split('.');
    let timestamp = parts.next().unwrap_or_default();
    let extension = parts.next();
    !timestamp.is_empty()
        && timestamp
            .chars()
            .all(|character| character.is_ascii_digit())
        && parts.next().is_none()
        && extension
            .map(|value| {
                !value.is_empty()
                    && value
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric())
            })
            .unwrap_or(true)
}

fn now_ms() -> u64 {
    system_time_ms(Some(SystemTime::now()))
}

fn system_time_ms(time: Option<SystemTime>) -> u64 {
    time.and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn history_index_writes_and_requires_a_versioned_envelope() {
        let temp = tempfile::tempdir().unwrap();
        let document = temp.path().join("document.txt");
        std::fs::write(&document, b"first version").unwrap();
        let store = HistoryStore::new(temp.path().join("history"));
        assert!(store.snapshot(&document, true).await.unwrap());

        let index_path = store.directory_for(&document).join("index.json");
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&index_path).unwrap()).unwrap();
        assert_eq!(value["version"], DATA_SCHEMA_VERSION);
        assert_eq!(value["entries"].as_array().unwrap().len(), 1);

        std::fs::write(&index_path, br#"{"version":2,"entries":[]}"#).unwrap();
        assert_eq!(
            store.list(&document).await.unwrap_err().code,
            "unsupported-data-version"
        );
    }
}

use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use sha1::{Digest, Sha1};

use crate::{
    error::{AppError, AppResult},
    state::{
        atomic_write_json, new_recovery_notices, read_versioned_json, RecoveryNotices,
        DATA_SCHEMA_VERSION,
    },
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

impl Default for HistoryIndexFile {
    fn default() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            entries: Vec::new(),
        }
    }
}

#[derive(Clone)]
pub struct HistoryStore {
    root: PathBuf,
    // Serializes history mutations. A std mutex is correct here: every lock
    // site is inside `spawn_blocking` (below), never on an async runtime
    // thread, so blocking-IO contention cannot stall async workers
    // (wps_02 D-8).
    lock: Arc<parking_lot::Mutex<()>>,
    notices: RecoveryNotices,
}

impl HistoryStore {
    pub fn new(root: PathBuf) -> Self {
        Self::new_with_recovery(root, new_recovery_notices())
    }

    pub fn new_with_recovery(root: PathBuf, notices: RecoveryNotices) -> Self {
        Self {
            root,
            lock: Arc::new(parking_lot::Mutex::new(())),
            notices,
        }
    }

    pub async fn snapshot(&self, path: &Path, force: bool) -> AppResult<bool> {
        let this = self.clone();
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let _guard = this.lock.lock();
            this.snapshot_unlocked(&path, force)
        })
        .await
        .map_err(|error| AppError::internal(format!("History snapshot task failed: {error}")))?
    }

    pub async fn write_with_snapshot(&self, path: &Path, data: &[u8]) -> AppResult<()> {
        let this = self.clone();
        let path = path.to_owned();
        let data = data.to_vec();
        tokio::task::spawn_blocking(move || {
            let _guard = this.lock.lock();
            this.snapshot_unlocked(&path, false)?;
            write_atomic(&path, &data)
        })
        .await
        .map_err(|error| AppError::internal(format!("History write task failed: {error}")))?
    }

    pub async fn list(&self, path: &Path) -> AppResult<Vec<FileVersion>> {
        let this = self.clone();
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let _guard = this.lock.lock();
            this.list_blocking(&path)
        })
        .await
        .map_err(|error| AppError::internal(format!("History list task failed: {error}")))?
    }

    pub async fn restore(&self, path: &Path, version_id: &str) -> AppResult<bool> {
        let this = self.clone();
        let path = path.to_owned();
        let version_id = version_id.to_owned();
        tokio::task::spawn_blocking(move || {
            let _guard = this.lock.lock();
            this.restore_blocking(&path, &version_id)
        })
        .await
        .map_err(|error| AppError::internal(format!("History restore task failed: {error}")))?
    }

    pub async fn move_history(&self, old_path: &Path, new_path: &Path) -> AppResult<()> {
        let this = self.clone();
        let old_path = old_path.to_owned();
        let new_path = new_path.to_owned();
        tokio::task::spawn_blocking(move || {
            let _guard = this.lock.lock();
            this.move_history_blocking(&old_path, &new_path)
        })
        .await
        .map_err(|error| AppError::internal(format!("History move task failed: {error}")))?
    }

    pub async fn delete_history(&self, path: &Path) -> AppResult<()> {
        let this = self.clone();
        let path = path.to_owned();
        tokio::task::spawn_blocking(move || {
            let _guard = this.lock.lock();
            this.delete_history_blocking(&path)
        })
        .await
        .map_err(|error| AppError::internal(format!("History delete task failed: {error}")))?
    }

    fn list_blocking(&self, path: &Path) -> AppResult<Vec<FileVersion>> {
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

    fn restore_blocking(&self, path: &Path, version_id: &str) -> AppResult<bool> {
        if !valid_version_id(version_id) {
            return Ok(false);
        }
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

    fn move_history_blocking(&self, old_path: &Path, new_path: &Path) -> AppResult<()> {
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

    fn delete_history_blocking(&self, path: &Path) -> AppResult<()> {
        let directory = self.directory_for(path);
        match std::fs::remove_dir_all(directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    fn snapshot_unlocked(&self, path: &Path, force: bool) -> AppResult<bool> {
        let mut file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            return Ok(false);
        }
        // Read from the already-open handle with a hard bound of at most
        // MAX_SNAPSHOT_SIZE + 1 bytes. If the file grew past the limit between
        // the metadata check and the read, the actual byte count reflects it and
        // we refuse instead of copying an over-large snapshot.
        let mut reader = (&mut file).take(MAX_SNAPSHOT_SIZE.saturating_add(1));
        let mut data = Vec::new();
        reader.read_to_end(&mut data)?;
        let actual_len = data.len() as u64;
        if actual_len > MAX_SNAPSHOT_SIZE {
            return Ok(false);
        }
        let source_mtime_ms = system_time_ms(metadata.modified().ok());
        let directory = self.directory_for(path);
        let mut index = self.read_index(&directory)?;
        if let Some(latest) = index.first() {
            if latest.source_mtime_ms == source_mtime_ms && latest.size == actual_len {
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

        write_atomic(&directory.join(&id), &data)?;
        index.insert(
            0,
            HistoryIndexEntry {
                id: id.clone(),
                saved_at,
                size: actual_len,
                source_mtime_ms,
            },
        );
        let removed = index.split_off(index.len().min(MAX_VERSIONS));
        if let Err(error) = self.write_index(&directory, &index) {
            // wps_10 B4: the index on disk still describes the old version set,
            // so the snapshot written above is referenced nowhere and would be
            // an uncollectable orphan. Remove it before propagating.
            if let Err(remove_error) = std::fs::remove_file(directory.join(&id)) {
                log::warn!(
                    "failed to remove orphaned snapshot {} in {} after index write failure: {remove_error}",
                    id,
                    directory.display()
                );
            }
            return Err(error);
        }
        for entry in removed {
            // wps_10 D1: the index no longer references this snapshot; a delete
            // failure leaves an orphaned version file, so record it.
            if let Err(error) = std::fs::remove_file(directory.join(&entry.id)) {
                log::warn!(
                    "failed to delete pruned history snapshot {} in {}: {error}",
                    entry.id,
                    directory.display()
                );
            }
        }
        Ok(true)
    }

    fn directory_for(&self, path: &Path) -> PathBuf {
        self.root.join(history_hash(&path_key(path)))
    }

    fn read_index(&self, directory: &Path) -> AppResult<Vec<HistoryIndexEntry>> {
        let path = directory.join("index.json");
        let file: HistoryIndexFile =
            read_versioned_json(&path, "file history index", &self.notices)?;
        Ok(file
            .entries
            .into_iter()
            .filter(|entry| valid_version_id(&entry.id))
            .take(MAX_VERSIONS)
            .collect())
    }

    fn write_index(&self, directory: &Path, entries: &[HistoryIndexEntry]) -> AppResult<()> {
        atomic_write_json(
            &directory.join("index.json"),
            &HistoryIndexFile {
                version: DATA_SCHEMA_VERSION,
                entries: entries.to_vec(),
            },
        )
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

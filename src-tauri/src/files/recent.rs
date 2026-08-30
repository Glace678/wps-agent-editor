use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use crate::{
    error::AppResult,
    state::{ensure_data_version, DATA_SCHEMA_VERSION},
};

use super::{atomic::write_atomic, models::StoredRecentFile, path_key};

const MAX_RECENT: usize = 20;

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentFileStore {
    version: u32,
    #[serde(default)]
    entries: Vec<StoredRecentFile>,
}

pub struct RecentStore {
    store_path: PathBuf,
    lock: Mutex<()>,
}

impl RecentStore {
    pub fn new(store_path: PathBuf) -> Self {
        Self {
            store_path,
            lock: Mutex::new(()),
        }
    }

    pub async fn list(&self) -> AppResult<Vec<StoredRecentFile>> {
        let _guard = self.lock.lock().await;
        self.read_unlocked()
    }

    pub async fn add(&self, path: &Path, writable: bool) -> AppResult<Vec<StoredRecentFile>> {
        let _guard = self.lock.lock().await;
        let mut entries = self.read_unlocked()?;
        let key = path_key(path);
        entries.retain(|entry| path_key(Path::new(&entry.path)) != key);
        entries.insert(
            0,
            StoredRecentFile {
                path: path.to_string_lossy().into_owned(),
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                opened_at: now_ms(),
                writable,
            },
        );
        entries.truncate(MAX_RECENT);
        self.write_unlocked(&entries)?;
        Ok(entries)
    }

    pub async fn remove(&self, path: &Path) -> AppResult<Vec<StoredRecentFile>> {
        let _guard = self.lock.lock().await;
        let key = path_key(path);
        let mut entries = self.read_unlocked()?;
        entries.retain(|entry| path_key(Path::new(&entry.path)) != key);
        self.write_unlocked(&entries)?;
        Ok(entries)
    }

    pub async fn rename(
        &self,
        old_path: &Path,
        new_path: &Path,
    ) -> AppResult<Vec<StoredRecentFile>> {
        let _guard = self.lock.lock().await;
        let old_key = path_key(old_path);
        let mut entries = self.read_unlocked()?;
        for entry in &mut entries {
            if path_key(Path::new(&entry.path)) == old_key {
                entry.path = new_path.to_string_lossy().into_owned();
                entry.name = new_path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
            }
        }
        self.write_unlocked(&entries)?;
        Ok(entries)
    }

    fn read_unlocked(&self) -> AppResult<Vec<StoredRecentFile>> {
        match std::fs::read(&self.store_path) {
            Ok(data) => {
                let file: RecentFileStore = serde_json::from_slice(&data)?;
                ensure_data_version("recent files", file.version)?;
                Ok(file.entries.into_iter().take(MAX_RECENT).collect())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.into()),
        }
    }

    fn write_unlocked(&self, entries: &[StoredRecentFile]) -> AppResult<()> {
        let mut data = serde_json::to_vec_pretty(&RecentFileStore {
            version: DATA_SCHEMA_VERSION,
            entries: entries.to_vec(),
        })?;
        data.push(b'\n');
        write_atomic(&self.store_path, &data)
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recent_store_writes_and_requires_a_versioned_envelope() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("recent-files.json");
        let store = RecentStore::new(path.clone());
        store
            .add(&temp.path().join("document.txt"), true)
            .await
            .unwrap();

        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["version"], DATA_SCHEMA_VERSION);
        assert_eq!(value["entries"].as_array().unwrap().len(), 1);
        assert_eq!(value["entries"][0]["writable"], true);

        std::fs::write(&path, b"[]").unwrap();
        assert_eq!(store.list().await.unwrap_err().code, "invalid-data");
        std::fs::write(&path, br#"{"version":2,"entries":[]}"#).unwrap();
        assert_eq!(
            store.list().await.unwrap_err().code,
            "unsupported-data-version"
        );
    }
}

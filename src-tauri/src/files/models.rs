use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct GrantedPath {
    pub path: String,
    pub grant_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub grant_id: String,
    pub is_directory: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub size: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub modified_at: u64,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecentFile {
    pub path: String,
    pub name: String,
    pub opened_at: u64,
    /// The capability that was available when the file was opened.
    /// Missing values from older v2 records are deliberately read-only.
    #[serde(default)]
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub grant_id: String,
    pub name: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub opened_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub path: String,
    pub grant_id: String,
    pub recent: Vec<RecentFile>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileStatInfo {
    pub exists: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub size: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub modified_at: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub created_at: u64,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub id: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub saved_at: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryIndexEntry {
    pub id: String,
    pub saved_at: u64,
    pub size: u64,
    pub source_mtime_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileOperationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub error_code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub grant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub recent: Option<Vec<RecentFile>>,
}

impl FileOperationResult {
    pub fn failure(error_code: &'static str) -> Self {
        Self {
            success: false,
            error_code: Some(error_code),
            path: None,
            grant_id: None,
            recent: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum FileDialogKind {
    All,
    Text,
    Presentation,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PathAccessRequest {
    pub path: String,
    pub grant_id: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileSessionSaveRequest {
    pub main_directory: Option<PathAccessRequest>,
    pub current_directory: Option<PathAccessRequest>,
    #[serde(default)]
    pub recent_directories: Vec<PathAccessRequest>,
    #[serde(default)]
    pub open_files: Vec<PathAccessRequest>,
    pub active_file: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct FileSessionSnapshot {
    pub main_directory: Option<GrantedPath>,
    pub current_directory: Option<GrantedPath>,
    pub recent_directories: Vec<GrantedPath>,
    pub open_files: Vec<GrantedPath>,
    pub active_file: Option<String>,
}

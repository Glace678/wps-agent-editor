use std::{collections::HashSet, fs::File, io::Read, path::Path, process::Stdio};

use serde::Serialize;
use tauri::{ipc::Response, Manager, State, WebviewWindow};
use tokio::process::Command;

use crate::{
    error::{AppError, AppResult},
    files::{
        access::GrantSource,
        dialogs, ensure_file_can_be_opened,
        models::{
            FileDialogKind, FileEntry, FileOperationResult, FileSessionSaveRequest,
            FileSessionSnapshot, FileStatInfo, FileVersion, GrantedPath, OpenedFile,
            PathAccessRequest, RecentFile,
        },
        operations, path_key, path_string,
        session::{
            StoredFileSession, StoredSessionPath, MAX_SESSION_DIRECTORIES, MAX_SESSION_FILES,
        },
        FileServices,
    },
    state::AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardResult {
    pub success: bool,
    pub method: &'static str,
}

pub(super) const MAX_BINARY_IPC_BYTES: u64 = 100 * 1024 * 1024;

#[tauri::command]
pub fn files_list(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileEntry>> {
    let directory =
        state
            .files
            .access
            .resolve(window.label(), &path, &grant_id, false, Some(true))?;
    operations::list_directory(window.label(), &grant_id, &directory, &state.files.access)
}

#[tauri::command]
pub async fn files_open(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<OpenedFile> {
    let (file, writable) = state.files.access.resolve_with_permissions(
        window.label(),
        &path,
        &grant_id,
        false,
        Some(false),
    )?;
    ensure_file_can_be_opened(&file)?;
    let recent = if writable {
        state.files.recent.add(&file, writable).await?
    } else {
        state.files.recent.list().await?
    };
    let _ = state.files.history.snapshot(&file, false).await;
    Ok(OpenedFile {
        path: path_string(&file)?,
        grant_id,
        recent: grant_recent(window.label(), &state.files, recent),
    })
}

#[tauri::command]
pub async fn files_open_external(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<OpenedFile> {
    let (file, writable) = state.files.access.resolve_with_permissions(
        window.label(),
        &path,
        &grant_id,
        false,
        Some(false),
    )?;
    ensure_file_can_be_opened(&file)?;
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        command.arg(&file);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&file);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&file);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            AppError::new(
                "open-failed",
                format!("Failed to open the file with its system application: {error}"),
            )
        })?;
    let recent = if writable {
        state.files.recent.add(&file, writable).await?
    } else {
        state.files.recent.list().await?
    };
    let _ = state.files.history.snapshot(&file, false).await;
    Ok(OpenedFile {
        path: path_string(&file)?,
        grant_id,
        recent: grant_recent(window.label(), &state.files, recent),
    })
}

#[tauri::command]
pub fn files_read_binary(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    Ok(Response::new(read_binary_limited(&file)?))
}

fn read_binary_limited(path: &Path) -> AppResult<Vec<u8>> {
    ensure_file_can_be_opened(path)?;
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    validate_binary_ipc_size(metadata.len())?;

    let mut data = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_BINARY_IPC_BYTES + 1).read_to_end(&mut data)?;
    validate_binary_ipc_size(data.len() as u64)?;
    Ok(data)
}

pub(super) fn validate_binary_ipc_size(size: u64) -> AppResult<()> {
    if size > MAX_BINARY_IPC_BYTES {
        return Err(AppError::new(
            "file-too-large",
            "Binary IPC payload exceeds the 100 MiB limit",
        )
        .with_details(serde_json::json!({
            "actualBytes": size,
            "limitBytes": MAX_BINARY_IPC_BYTES,
        })));
    }
    Ok(())
}

#[tauri::command]
pub async fn files_save_text(
    path: String,
    grant_id: String,
    text: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, true, Some(false))?;
    state
        .files
        .history
        .write_with_snapshot(&file, text.as_bytes())
        .await
}

#[tauri::command]
pub fn files_search(
    path: String,
    grant_id: String,
    query: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileEntry>> {
    let root = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(true))?;
    operations::search_files(
        window.label(),
        &grant_id,
        &root,
        &query,
        &state.files.access,
    )
}

#[tauri::command]
pub async fn files_get_recent(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<RecentFile>> {
    Ok(grant_recent(
        window.label(),
        &state.files,
        state.files.recent.list().await?,
    ))
}

#[tauri::command]
pub fn files_get_home(window: WebviewWindow, state: State<'_, AppState>) -> AppResult<GrantedPath> {
    state.files.access.grant_existing(
        window.label(),
        state.files.home_dir(),
        true,
        GrantSource::Home,
    )
}

#[tauri::command]
pub fn files_session_load(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<FileSessionSnapshot> {
    // Auxiliary document windows are intentionally ephemeral. Only the stable
    // main window owns the workspace session restored on the next app launch.
    if window.label() != "main" {
        return Ok(FileSessionSnapshot::default());
    }

    let owner = window.label();
    let stored = state.files.session.load()?;
    let (main_directory, stored_main_directory) =
        restore_session_path(owner, &state.files, stored.main_directory.as_ref(), true);
    let (current_directory, stored_current_directory) =
        restore_session_path(owner, &state.files, stored.current_directory.as_ref(), true);

    let mut recent_directories = Vec::new();
    let mut stored_recent_directories = Vec::new();
    let mut seen_directories = HashSet::new();
    for entry in stored
        .recent_directories
        .iter()
        .take(MAX_SESSION_DIRECTORIES)
    {
        let (Some(grant), Some(restored)) =
            restore_session_path(owner, &state.files, Some(entry), true)
        else {
            continue;
        };
        if seen_directories.insert(path_key(Path::new(&restored.path))) {
            recent_directories.push(grant);
            stored_recent_directories.push(restored);
        }
    }

    let active_key = stored
        .active_file
        .as_ref()
        .map(|path| path_key(Path::new(path)));
    let mut active_file = None;
    let mut open_files = Vec::new();
    let mut stored_open_files = Vec::new();
    let mut seen_files = HashSet::new();
    for entry in stored.open_files.iter().take(MAX_SESSION_FILES) {
        let original_key = path_key(Path::new(&entry.path));
        let (Some(grant), Some(restored)) =
            restore_session_path(owner, &state.files, Some(entry), false)
        else {
            continue;
        };
        if !seen_files.insert(path_key(Path::new(&restored.path))) {
            continue;
        }
        if active_key.as_ref().is_some_and(|key| key == &original_key) {
            active_file = Some(grant.path.clone());
        }
        open_files.push(grant);
        stored_open_files.push(restored);
    }
    if active_file.is_none() {
        active_file = open_files.last().map(|entry| entry.path.clone());
    }

    let sanitized = StoredFileSession {
        main_directory: stored_main_directory,
        current_directory: stored_current_directory,
        recent_directories: stored_recent_directories,
        open_files: stored_open_files,
        active_file: active_file.clone(),
    };
    if sanitized != stored {
        state.files.session.save(&sanitized)?;
    }

    Ok(FileSessionSnapshot {
        main_directory,
        current_directory,
        recent_directories,
        open_files,
        active_file,
    })
}

#[tauri::command]
pub fn files_session_save(
    session: FileSessionSaveRequest,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if window.label() != "main" {
        return Ok(());
    }
    if session.recent_directories.len() > MAX_SESSION_DIRECTORIES {
        return Err(AppError::invalid("Too many session directories"));
    }
    if session.open_files.len() > MAX_SESSION_FILES {
        return Err(AppError::invalid("Too many open session files"));
    }

    let owner = window.label();
    let main_directory = session
        .main_directory
        .map(|request| resolve_session_path(owner, &state.files, request, true))
        .transpose()?;
    let current_directory = session
        .current_directory
        .map(|request| resolve_session_path(owner, &state.files, request, true))
        .transpose()?;
    let recent_directories =
        resolve_session_paths(owner, &state.files, session.recent_directories, true)?;
    let open_files = resolve_session_paths(owner, &state.files, session.open_files, false)?;

    let active_file = match session.active_file {
        Some(active) => {
            let key = path_key(Path::new(&active));
            Some(
                open_files
                    .iter()
                    .find(|entry| path_key(Path::new(&entry.path)) == key)
                    .ok_or_else(|| AppError::invalid("The active file must be an open file"))?
                    .path
                    .clone(),
            )
        }
        None => None,
    };

    state.files.session.save(&StoredFileSession {
        main_directory,
        current_directory,
        recent_directories,
        open_files,
        active_file,
    })
}

fn restore_session_path(
    owner: &str,
    files: &FileServices,
    stored: Option<&StoredSessionPath>,
    expect_directory: bool,
) -> (Option<GrantedPath>, Option<StoredSessionPath>) {
    let Some(stored) = stored else {
        return (None, None);
    };
    let source = Path::new(&stored.path);
    let Ok(metadata) = std::fs::metadata(source) else {
        return (None, None);
    };
    if metadata.is_dir() != expect_directory {
        return (None, None);
    }
    if !expect_directory && ensure_file_can_be_opened(source).is_err() {
        return (None, None);
    }
    let Ok(grant) =
        files
            .access
            .grant_existing(owner, source, stored.writable, GrantSource::Session)
    else {
        return (None, None);
    };
    if !expect_directory && ensure_file_can_be_opened(Path::new(&grant.path)).is_err() {
        files.access.revoke(owner, &grant.grant_id);
        return (None, None);
    }
    let restored = StoredSessionPath {
        path: grant.path.clone(),
        writable: stored.writable,
    };
    (Some(grant), Some(restored))
}

fn resolve_session_path(
    owner: &str,
    files: &FileServices,
    request: PathAccessRequest,
    expect_directory: bool,
) -> AppResult<StoredSessionPath> {
    let (path, writable) = files.access.resolve_with_permissions(
        owner,
        &request.path,
        &request.grant_id,
        false,
        Some(expect_directory),
    )?;
    if !expect_directory {
        ensure_file_can_be_opened(&path)?;
    }
    Ok(StoredSessionPath {
        path: path_string(&path)?,
        writable,
    })
}

fn resolve_session_paths(
    owner: &str,
    files: &FileServices,
    requests: Vec<PathAccessRequest>,
    expect_directory: bool,
) -> AppResult<Vec<StoredSessionPath>> {
    let mut seen = HashSet::new();
    let mut resolved = Vec::with_capacity(requests.len());
    for request in requests {
        let entry = resolve_session_path(owner, files, request, expect_directory)?;
        if seen.insert(path_key(Path::new(&entry.path))) {
            resolved.push(entry);
        }
    }
    Ok(resolved)
}

#[tauri::command]
pub fn files_stat(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<FileStatInfo> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    operations::stat_file(&file)
}

#[tauri::command]
pub async fn files_rename(
    path: String,
    grant_id: String,
    new_name: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<FileOperationResult> {
    let old_path =
        state
            .files
            .access
            .resolve(window.label(), &path, &grant_id, true, Some(false))?;
    let (mut result, new_path) = operations::rename_file(&old_path, &new_name)?;
    let Some(new_path) = new_path else {
        return Ok(result);
    };

    let granted = state.files.access.grant_existing(
        window.label(),
        &new_path,
        true,
        GrantSource::CurrentDocument,
    )?;
    if path_key(&old_path) != path_key(&new_path) {
        state
            .files
            .access
            .revoke_owner_path(window.label(), &old_path);
    }
    let recent = state.files.recent.rename(&old_path, &new_path).await?;
    state
        .files
        .history
        .move_history(&old_path, &new_path)
        .await?;
    result.path = Some(granted.path);
    result.grant_id = Some(granted.grant_id);
    result.recent = Some(grant_recent(window.label(), &state.files, recent));
    Ok(result)
}

#[tauri::command]
pub async fn files_delete(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<FileOperationResult> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, true, Some(false))?;
    let mut result = operations::trash_file(&file)?;
    if result.success {
        let recent = state.files.recent.remove(&file).await?;
        state.files.history.delete_history(&file).await?;
        state.files.access.revoke_owner_path(window.label(), &file);
        result.recent = Some(grant_recent(window.label(), &state.files, recent));
    }
    Ok(result)
}

#[tauri::command]
pub fn files_show_in_folder(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<FileOperationResult> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    operations::show_in_folder(&file)?;
    Ok(FileOperationResult {
        success: true,
        error_code: None,
        path: None,
        grant_id: None,
        recent: None,
    })
}

#[tauri::command]
pub async fn files_remove_recent(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<RecentFile>> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    let recent = state.files.recent.remove(&file).await?;
    Ok(grant_recent(window.label(), &state.files, recent))
}

#[tauri::command]
pub async fn files_copy_to_clipboard(
    files: Vec<PathAccessRequest>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<ClipboardResult> {
    if files.is_empty() {
        return Err(AppError::invalid("At least one file is required"));
    }
    let mut paths = Vec::with_capacity(files.len());
    for request in files {
        paths.push(state.files.access.resolve(
            window.label(),
            &request.path,
            &request.grant_id,
            false,
            Some(false),
        )?);
    }
    let display = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

    if cfg!(target_os = "windows") {
        let json = serde_json::to_string(&display)?;
        let status = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$paths=@(ConvertFrom-Json -InputObject $env:WAE_FILES_JSON); Set-Clipboard -LiteralPath $paths",
            ])
            .env("WAE_FILES_JSON", json)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
        if status.is_ok_and(|status| status.success()) {
            return Ok(ClipboardResult {
                success: true,
                method: "file",
            });
        }
    } else if cfg!(target_os = "macos") {
        let status = Command::new("osascript")
            .args([
                "-e",
                "set rawPaths to paragraphs of (system attribute \"WAE_FILES\")",
                "-e",
                "set fileList to {}",
                "-e",
                "repeat with rawPath in rawPaths",
                "-e",
                "if (contents of rawPath) is not \"\" then set end of fileList to POSIX file (contents of rawPath)",
                "-e",
                "end repeat",
                "-e",
                "set the clipboard to fileList",
            ])
            .env("WAE_FILES", display.join("\n"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
        if status.is_ok_and(|status| status.success()) {
            return Ok(ClipboardResult {
                success: true,
                method: "file",
            });
        }
    }

    let text = display.join("\n");
    tokio::task::spawn_blocking(move || {
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|error| AppError::new("clipboard-failed", error.to_string()))?;
        clipboard
            .set_text(text)
            .map_err(|error| AppError::new("clipboard-failed", error.to_string()))
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))??;
    Ok(ClipboardResult {
        success: true,
        method: "path",
    })
}

#[tauri::command]
pub async fn files_history_list(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<FileVersion>> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    state.files.history.list(&file).await
}

#[tauri::command]
pub async fn files_history_restore(
    path: String,
    grant_id: String,
    version_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<FileOperationResult> {
    let file = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, true, Some(false))?;
    let restored = state.files.history.restore(&file, &version_id).await?;
    Ok(if restored {
        FileOperationResult {
            success: true,
            error_code: None,
            path: None,
            grant_id: None,
            recent: None,
        }
    } else {
        FileOperationResult::failure("not-found")
    })
}

#[tauri::command]
pub async fn files_select_folder(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Option<GrantedPath>> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    let selected = tauri::async_runtime::spawn_blocking(move || dialogs::select_folder(&app))
        .await
        .map_err(|error| AppError::internal(format!("Folder dialog failed: {error}")))??;
    selected
        .map(|path| {
            state
                .files
                .access
                .grant_existing(&owner, &path, true, GrantSource::Dialog)
        })
        .transpose()
}

#[tauri::command]
pub async fn files_select_file(
    window: WebviewWindow,
    kind: Option<FileDialogKind>,
    state: State<'_, AppState>,
) -> AppResult<Option<GrantedPath>> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialogs::select_file(&app, kind.unwrap_or(FileDialogKind::All))
    })
    .await
    .map_err(|error| AppError::internal(format!("File dialog failed: {error}")))??;
    selected
        .map(|path| {
            ensure_file_can_be_opened(&path)?;
            state
                .files
                .access
                .grant_existing(&owner, &path, true, GrantSource::Dialog)
        })
        .transpose()
}

#[tauri::command]
pub async fn files_select_attachments(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<GrantedPath>> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    let mut seen = HashSet::new();
    let selected = tauri::async_runtime::spawn_blocking(move || dialogs::select_attachments(&app))
        .await
        .map_err(|error| AppError::internal(format!("Attachment dialog failed: {error}")))??
        .into_iter()
        .filter(|path| seen.insert(path_key(path)))
        .collect::<Vec<_>>();
    for path in &selected {
        ensure_file_can_be_opened(path)?;
    }
    selected
        .into_iter()
        .map(|path| {
            state
                .files
                .access
                .grant_existing(&owner, &path, false, GrantSource::Dialog)
        })
        .collect()
}

#[tauri::command]
pub async fn files_select_save_file(
    window: WebviewWindow,
    default_name: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Option<GrantedPath>> {
    let owner = window.label().to_owned();
    let app = window.app_handle().clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialogs::select_save_file(&app, default_name.as_deref())
    })
    .await
    .map_err(|error| AppError::internal(format!("Save dialog failed: {error}")))??;
    selected
        .map(|path| state.files.access.grant_save_target(&owner, &path))
        .transpose()
}

fn grant_recent(
    owner: &str,
    files: &FileServices,
    entries: Vec<crate::files::models::StoredRecentFile>,
) -> Vec<RecentFile> {
    entries
        .into_iter()
        .filter_map(|entry| {
            ensure_file_can_be_opened(Path::new(&entry.path)).ok()?;
            let grant = files
                .access
                .grant_existing(
                    owner,
                    Path::new(&entry.path),
                    entry.writable,
                    GrantSource::Recent,
                )
                .ok()?;
            Some(RecentFile {
                path: grant.path,
                grant_id: grant.grant_id,
                name: entry.name,
                opened_at: entry.opened_at,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_paths_require_a_live_grant_with_the_expected_kind() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data");
        let directory = temp.path().join("workspace");
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("document.txt");
        std::fs::write(&file, "content").unwrap();
        let services = FileServices::new(data, temp.path().to_path_buf()).unwrap();

        let directory_grant = services
            .access
            .grant_existing("main", &directory, true, GrantSource::Dialog)
            .unwrap();
        let stored = resolve_session_path(
            "main",
            &services,
            PathAccessRequest {
                path: directory_grant.path,
                grant_id: directory_grant.grant_id,
            },
            true,
        )
        .unwrap();
        assert!(stored.writable);

        let file_grant = services
            .access
            .grant_existing("main", &file, true, GrantSource::Dialog)
            .unwrap();
        let wrong_kind = resolve_session_path(
            "main",
            &services,
            PathAccessRequest {
                path: file_grant.path.clone(),
                grant_id: file_grant.grant_id.clone(),
            },
            true,
        )
        .unwrap_err();
        assert_eq!(wrong_kind.code, "invalid-path");

        services.access.revoke("main", &file_grant.grant_id);
        let revoked = resolve_session_path(
            "main",
            &services,
            PathAccessRequest {
                path: file_grant.path,
                grant_id: file_grant.grant_id,
            },
            false,
        )
        .unwrap_err();
        assert_eq!(revoked.code, "access-denied");
    }

    #[test]
    fn session_restore_skips_paths_that_no_longer_exist() {
        let temp = tempfile::tempdir().unwrap();
        let services =
            FileServices::new(temp.path().join("data"), temp.path().to_path_buf()).unwrap();
        let missing = StoredSessionPath {
            path: temp
                .path()
                .join("missing.txt")
                .to_string_lossy()
                .into_owned(),
            writable: true,
        };

        let restored = restore_session_path("main", &services, Some(&missing), false);
        assert!(restored.0.is_none());
        assert!(restored.1.is_none());
    }

    #[test]
    fn session_restore_skips_executable_files() {
        let temp = tempfile::tempdir().unwrap();
        let services =
            FileServices::new(temp.path().join("data"), temp.path().to_path_buf()).unwrap();
        let executable = temp.path().join("payload.EXE");
        std::fs::write(&executable, b"payload").unwrap();
        let stored = StoredSessionPath {
            path: executable.to_string_lossy().into_owned(),
            writable: true,
        };

        let restored = restore_session_path("main", &services, Some(&stored), false);
        assert!(restored.0.is_none());
        assert!(restored.1.is_none());
    }

    #[test]
    fn binary_ipc_limit_accepts_exact_size_and_rejects_larger_payloads() {
        assert!(validate_binary_ipc_size(MAX_BINARY_IPC_BYTES).is_ok());
        let error = validate_binary_ipc_size(MAX_BINARY_IPC_BYTES + 1).unwrap_err();
        assert_eq!(error.code, "file-too-large");
        assert_eq!(
            error.details.as_ref().unwrap()["limitBytes"],
            MAX_BINARY_IPC_BYTES
        );
    }

    #[test]
    fn binary_reader_rejects_oversized_sparse_file_before_allocating_it() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("oversized.bin");
        File::create(&path)
            .unwrap()
            .set_len(MAX_BINARY_IPC_BYTES + 1)
            .unwrap();

        let error = read_binary_limited(&path).unwrap_err();
        assert_eq!(error.code, "file-too-large");
    }

    #[test]
    fn binary_reader_returns_small_files_without_transforming_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("document.bin");
        let expected = b"\0WAE binary\xff";
        std::fs::write(&path, expected).unwrap();

        assert_eq!(read_binary_limited(&path).unwrap(), expected);
    }

    #[test]
    fn binary_reader_rejects_executable_files() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("tool.exe");
        std::fs::write(&path, b"MZ").unwrap();

        let error = read_binary_limited(&path).unwrap_err();
        assert_eq!(error.code, "executable-file-blocked");
    }
}

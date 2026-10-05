pub mod access;
pub(crate) mod atomic;
pub mod dialogs;
pub mod history;
pub mod models;
pub mod operations;
pub mod recent;
pub mod session;

use crate::{
    error::AppResult,
    state::{new_recovery_notices, RecoveryNotices},
};
use std::{ffi::OsStr, path::PathBuf};

pub struct FileServices {
    pub access: access::AccessRegistry,
    pub history: history::HistoryStore,
    pub recent: recent::RecentStore,
    pub session: session::FileSessionStore,
    home_dir: PathBuf,
}

impl FileServices {
    pub fn new(app_data_dir: PathBuf, home_dir: PathBuf) -> AppResult<Self> {
        Self::new_with_recovery(app_data_dir, home_dir, new_recovery_notices())
    }

    pub fn new_with_recovery(
        app_data_dir: PathBuf,
        home_dir: PathBuf,
        notices: RecoveryNotices,
    ) -> AppResult<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        Ok(Self {
            access: access::AccessRegistry::default(),
            history: history::HistoryStore::new_with_recovery(
                app_data_dir.join("file-history"),
                notices.clone(),
            ),
            recent: recent::RecentStore::new_with_recovery(
                app_data_dir.join("recent-files.json"),
                notices.clone(),
            ),
            session: session::FileSessionStore::new_with_recovery(
                app_data_dir.join("file-session.json"),
                notices,
            ),
            home_dir,
        })
    }

    pub fn home_dir(&self) -> &std::path::Path {
        &self.home_dir
    }
}

pub(crate) fn app_error(code: &'static str, message: impl Into<String>) -> crate::error::AppError {
    crate::error::AppError::new(code, message.into())
}

/// Windows executable-like extensions we refuse to open directly. This deliberately
/// excludes `.bat`/`.cmd`/`.ps1`/`.vbs`: those are script types the code runner product
/// intentionally executes, not "application binaries" this guard is meant to block.
#[cfg(windows)]
const BLOCKED_WINDOWS_EXTENSIONS: &[&str] = &["exe", "msi", "scr", "com", "pif", "cpl"];

#[cfg(windows)]
pub(crate) fn is_executable_file(path: &std::path::Path) -> bool {
    let extension = match path.extension().and_then(OsStr::to_str) {
        Some(extension) => extension,
        None => return false,
    };
    BLOCKED_WINDOWS_EXTENSIONS
        .iter()
        .any(|blocked| extension.eq_ignore_ascii_case(blocked))
}

#[cfg(unix)]
pub(crate) fn is_executable_file(path: &std::path::Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    // On Unix-like systems extension is not a reliable signal; reject any file that
    // actually carries an executable bit. Reading here stays read-only, but blocking
    // obvious binaries avoids the OS launching an app when a path is misused. A
    // missing/unchangeable path is left to the caller's normal error handling.
    std::fs::metadata(path)
        .map(|metadata| metadata.mode() & 0o111 != 0)
        .unwrap_or(false)
}

pub(crate) fn ensure_file_can_be_opened(path: &std::path::Path) -> AppResult<()> {
    if is_executable_file(path) {
        return Err(app_error(
            "executable-file-blocked",
            "Executable files cannot be opened",
        ));
    }
    Ok(())
}

pub(crate) fn path_string(path: &std::path::Path) -> AppResult<String> {
    dunce::simplified(path)
        .to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| app_error("invalid-path", "The path is not valid UTF-8"))
}

pub(crate) fn path_key(path: &std::path::Path) -> String {
    let key = path.to_string_lossy().into_owned();
    // Windows and the default macOS APFS volume are case-insensitive; fold case so that
    // equivalent paths that differ only in casing resolve to the same grant key.
    if cfg!(windows) || cfg!(target_os = "macos") {
        key.to_lowercase()
    } else {
        key
    }
}

#[cfg(test)]
mod executable_policy_tests {
    use super::*;
    use std::path::Path;

    #[cfg(windows)]
    #[test]
    fn executable_policy_is_case_insensitive_and_extension_specific() {
        assert!(is_executable_file(Path::new("installer.exe")));
        assert!(is_executable_file(Path::new("INSTALLER.EXE")));
        assert!(is_executable_file(Path::new("setup.msi")));
        assert!(is_executable_file(Path::new("setup.MSI")));
        assert!(is_executable_file(Path::new("tool.scr")));
        assert!(is_executable_file(Path::new("run.com")));
        assert!(is_executable_file(Path::new("patch.pif")));
        assert!(is_executable_file(Path::new("applet.cpl")));
        // Decoy / double-extension names are allowed.
        assert!(!is_executable_file(Path::new("installer.exe.txt")));
        assert!(!is_executable_file(Path::new("installer.msi.txt")));
        assert!(!is_executable_file(Path::new("notes.txt")));
        // Runner script types are intentionally NOT blocked here.
        assert!(!is_executable_file(Path::new("build.bat")));
        assert!(!is_executable_file(Path::new("deploy.cmd")));
        assert!(!is_executable_file(Path::new("run.ps1")));
        assert!(!is_executable_file(Path::new("open.vbs")));
    }

    #[cfg(windows)]
    #[test]
    fn executable_policy_returns_a_stable_error() {
        let error = ensure_file_can_be_opened(Path::new("tool.ExE")).unwrap_err();
        assert_eq!(error.code, "executable-file-blocked");
        assert_eq!(error.message_key, "errors.executable-file-blocked");
    }

    #[cfg(unix)]
    #[test]
    fn unix_executable_bit_blocks_file_but_plain_file_is_allowed() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let executable = temp.path().join("run-me");
        std::fs::write(&executable, b"#!/bin/sh\necho hi\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(is_executable_file(&executable));

        let plain = temp.path().join("notes.txt");
        std::fs::write(&plain, b"hello").unwrap();
        std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!is_executable_file(&plain));

        // A nonexistent path is not blocked here; the caller handles missing-file errors.
        assert!(!is_executable_file(temp.path().join("missing")));
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn path_string_hides_safe_windows_verbatim_prefix() {
        assert_eq!(
            path_string(Path::new(r"\\?\C:\workspace\project")).unwrap(),
            r"C:\workspace\project"
        );
    }

    #[test]
    fn path_string_preserves_verbatim_prefix_when_required() {
        assert_eq!(
            path_string(Path::new(r"\\?\C:\workspace\CON")).unwrap(),
            r"\\?\C:\workspace\CON"
        );
    }
}

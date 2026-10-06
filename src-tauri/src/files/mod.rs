pub mod access;
pub(crate) mod atomic;
pub mod dialogs;
pub mod history;
pub mod models;
pub mod operations;
pub mod recent;
pub mod session;

use crate::{
    error::{codes, AppResult},
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
        // wps_10 B4: a previous instance killed by crash/power loss can leave
        // atomic-write `.{name}.{uuid}.tmp` files behind; sweep before startup.
        sweep_stale_temp_files(&app_data_dir);
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
    use crate::process::runner;
    use std::os::unix::fs::MetadataExt;
    // On Unix-like systems extension is not a reliable signal; a file that
    // actually carries an executable bit is normally a binary and is refused.
    // Exception: script types the code runner product intentionally executes
    // (.sh/.py/.pl/…) are chmod +x in normal use — blocking them would break
    // run/debug and stop the agent from reading them, so they are treated as
    // openable text files (wps_09 A-1).
    let runner_script = path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| runner::is_runner_supported_extension(&extension.to_ascii_lowercase()));
    if runner_script {
        return false;
    }
    std::fs::metadata(path)
        .map(|metadata| metadata.mode() & 0o111 != 0)
        .unwrap_or(false)
}

pub(crate) fn ensure_file_can_be_opened(path: &std::path::Path) -> AppResult<()> {
    if is_executable_file(path) {
        return Err(app_error(
            codes::EXECUTABLE_FILE_BLOCKED,
            "Executable files cannot be opened",
        ));
    }
    Ok(())
}

pub(crate) fn path_string(path: &std::path::Path) -> AppResult<String> {
    dunce::simplified(path)
        .to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| app_error(codes::INVALID_PATH, "The path is not valid UTF-8"))
}

/// Identity key used for grant comparison and for hashing indexes/dedup.
///
/// The input MUST already be in canonical form (`std::fs::canonicalize`):
/// grant paths and resolved paths always are, and stored recent/session paths
/// are the string form of canonical grants. No case folding is performed.
/// Folding correctness depends on the semantics of the underlying volume,
/// which cannot be determined from a path: APFS volumes and Windows
/// directories (since the per-directory case-sensitivity flag) may be
/// case-sensitive even on platforms whose default volume is not. Folding on
/// such a volume would make two different files share one key (wps_01 N-2);
/// two paths that name the same file canonicalize to identical bytes on every
/// platform, so the canonical form alone is sufficient.
pub(crate) fn path_key(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
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

    #[cfg(unix)]
    #[test]
    fn unix_executable_runner_scripts_are_not_blocked() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        for name in ["run.sh", "script.py", "build.zsh"] {
            let path = temp.path().join(name);
            std::fs::write(&path, b"echo hi\n").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(!is_executable_file(&path), "{name} must stay openable");
            assert!(ensure_file_can_be_opened(&path).is_ok());
        }
        // A chmod +x extensionless binary is still refused.
        let binary = temp.path().join("program");
        std::fs::write(&binary, b"\x7fELF").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(is_executable_file(&binary));
    }
}

/// Recursively remove atomic-write temporary files (`{name}.{uuid}.tmp`,
/// written dotfile-style by [`crate::files::atomic::write_atomic`]) left over
/// when a previous instance crashed or lost power. Bounded in depth and file
/// count so an unexpectedly huge data tree cannot stall startup (wps_10 B4).
fn sweep_stale_temp_files(root: &std::path::Path) {
    const MAX_DEPTH: u8 = 6;
    const MAX_ENTRIES: usize = 10_000;

    fn is_ours(name: &str) -> bool {
        // .<file-name>.<hyphenated-uuid>.tmp
        let Some(rest) = name.strip_prefix('.') else { return false };
        let Some(rest) = rest.strip_suffix(".tmp") else { return false };
        let Some(uuid) = rest.rsplit_once('.').map(|(_, uuid)| uuid) else { return false };
        let bytes = uuid.as_bytes();
        bytes.len() == 36
            && bytes[8] == b'-'
            && bytes[13] == b'-'
            && bytes[18] == b'-'
            && bytes[23] == b'-'
            && uuid.bytes().all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    }

    let mut visited = 0usize;
    let mut queue = std::collections::VecDeque::from([(root.to_path_buf(), 0_u8)]);
    while let Some((directory, depth)) = queue.pop_front() {
        if visited >= MAX_ENTRIES {
            log::warn!("stale temp sweep hit entry cap at {}, stopping early", directory.display());
            return;
        }
        let Ok(entries) = std::fs::read_dir(&directory) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() {
                if depth < MAX_DEPTH {
                    queue.push_back((path, depth + 1));
                }
            } else if kind.is_file() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if is_ours(&name) {
                    match std::fs::remove_file(&path) {
                        Ok(()) => log::info!("removed stale temporary file {}", path.display()),
                        Err(error) => log::warn!(
                            "failed to remove stale temporary file {}: {error}",
                            path.display()
                        ),
                    }
                }
            }
        }
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

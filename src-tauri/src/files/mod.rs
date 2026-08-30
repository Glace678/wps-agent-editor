pub mod access;
pub(crate) mod atomic;
pub mod dialogs;
pub mod history;
pub mod models;
pub mod operations;
pub mod recent;
pub mod session;

use crate::error::AppResult;
use std::path::PathBuf;

pub struct FileServices {
    pub access: access::AccessRegistry,
    pub history: history::HistoryStore,
    pub recent: recent::RecentStore,
    pub session: session::FileSessionStore,
    home_dir: PathBuf,
}

impl FileServices {
    pub fn new(app_data_dir: PathBuf, home_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&app_data_dir)?;
        Ok(Self {
            access: access::AccessRegistry::default(),
            history: history::HistoryStore::new(app_data_dir.join("file-history")),
            recent: recent::RecentStore::new(app_data_dir.join("recent-files.json")),
            session: session::FileSessionStore::new(app_data_dir.join("file-session.json")),
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

pub(crate) fn path_string(path: &std::path::Path) -> AppResult<String> {
    dunce::simplified(path)
        .to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| app_error("invalid-path", "The path is not valid UTF-8"))
}

pub(crate) fn path_key(path: &std::path::Path) -> String {
    let key = path.to_string_lossy().into_owned();
    if cfg!(windows) {
        key.to_lowercase()
    } else {
        key
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

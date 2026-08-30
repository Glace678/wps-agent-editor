use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::RwLock,
    time::{Duration, Instant},
};

use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{app_error, models::GrantedPath, path_key, path_string};

/// The trusted action which caused the native side to mint an opaque path grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrantSource {
    Dialog,
    Recent,
    Startup,
    Child,
    Home,
    SaveDialog,
    CurrentDocument,
}

#[derive(Debug, Clone)]
struct Grant {
    owner: String,
    path: PathBuf,
    writable: bool,
    is_directory: bool,
    source: GrantSource,
    expires_at: Option<Instant>,
}

#[derive(Default)]
pub struct AccessRegistry {
    grants: RwLock<HashMap<String, Grant>>,
}

impl AccessRegistry {
    pub fn grant_existing(
        &self,
        owner: &str,
        path: &Path,
        writable: bool,
        source: GrantSource,
    ) -> AppResult<GrantedPath> {
        self.grant_existing_with_expiry(owner, path, writable, source, source_expiry(source))
    }

    fn grant_existing_with_expiry(
        &self,
        owner: &str,
        path: &Path,
        writable: bool,
        source: GrantSource,
        expires_after: Option<Duration>,
    ) -> AppResult<GrantedPath> {
        validate_owner(owner)?;
        let canonical =
            std::fs::canonicalize(path).map_err(|error| io_error("grant-existing", path, error))?;
        let metadata = std::fs::metadata(&canonical)
            .map_err(|error| io_error("grant-existing", &canonical, error))?;
        self.insert(
            owner,
            canonical,
            writable,
            metadata.is_dir(),
            source,
            expires_after,
        )
    }

    /// Mint a grant for an entry discovered below an already resolved directory.
    /// The child can never be more permissive than its parent grant.
    pub fn grant_child(
        &self,
        owner: &str,
        parent_grant_id: &str,
        granted_directory: &Path,
        child: &Path,
    ) -> AppResult<GrantedPath> {
        let parent = self.checked_grant(owner, parent_grant_id, false, Some(true))?;
        let root = std::fs::canonicalize(granted_directory)
            .map_err(|error| io_error("grant-child-root", granted_directory, error))?;
        if path_key(&parent.path) != path_key(&root) {
            return Err(app_error(
                "access-denied",
                "The parent grant does not match the requested directory",
            ));
        }
        let canonical =
            std::fs::canonicalize(child).map_err(|error| io_error("grant-child", child, error))?;
        if canonical == root || !is_within(&canonical, &root) {
            return Err(app_error(
                "access-denied",
                "The requested child escapes the granted directory",
            ));
        }
        let metadata = std::fs::metadata(&canonical)
            .map_err(|error| io_error("grant-child", &canonical, error))?;
        self.insert(
            owner,
            canonical,
            parent.writable,
            metadata.is_dir(),
            GrantSource::Child,
            None,
        )
    }

    /// Transfer a path capability to another window without increasing its access.
    pub fn derive_for_owner(
        &self,
        source_owner: &str,
        target_owner: &str,
        path: &str,
        grant_id: &str,
        source: GrantSource,
    ) -> AppResult<GrantedPath> {
        let requested = normalize_requested(Path::new(path))?;
        let grant = self.checked_grant(source_owner, grant_id, false, None)?;
        if path_key(&grant.path) != path_key(&requested) {
            return Err(app_error(
                "access-denied",
                "The grant does not match the requested path",
            ));
        }
        self.insert(
            target_owner,
            grant.path,
            grant.writable,
            grant.is_directory,
            source,
            source_expiry(source),
        )
    }

    pub fn grant_save_target(&self, owner: &str, path: &Path) -> AppResult<GrantedPath> {
        validate_owner(owner)?;
        let file_name = path
            .file_name()
            .filter(|name| !name.is_empty())
            .ok_or_else(|| app_error("invalid-path", "A save target must include a file name"))?;
        if file_name == "." || file_name == ".." {
            return Err(app_error("invalid-path", "Invalid save target"));
        }

        let target = if path.exists() {
            let canonical =
                std::fs::canonicalize(path).map_err(|error| io_error("grant-save", path, error))?;
            if !std::fs::metadata(&canonical)
                .map_err(|error| io_error("grant-save", &canonical, error))?
                .is_file()
            {
                return Err(app_error("invalid-path", "The save target is not a file"));
            }
            canonical
        } else {
            let parent = path
                .parent()
                .ok_or_else(|| app_error("invalid-path", "The save target has no parent"))?;
            std::fs::canonicalize(parent)
                .map_err(|error| io_error("grant-save", parent, error))?
                .join(file_name)
        };
        self.insert(
            owner,
            target,
            true,
            false,
            GrantSource::SaveDialog,
            source_expiry(GrantSource::SaveDialog),
        )
    }

    /// Resolve only when the renderer supplies an opaque grant owned by the
    /// invoking window. There is deliberately no path-to-grant lookup fallback.
    pub fn resolve(
        &self,
        owner: &str,
        path: &str,
        grant_id: &str,
        write: bool,
        expect_directory: Option<bool>,
    ) -> AppResult<PathBuf> {
        self.resolve_with_permissions(owner, path, grant_id, write, expect_directory)
            .map(|(path, _)| path)
    }

    pub fn resolve_with_permissions(
        &self,
        owner: &str,
        path: &str,
        grant_id: &str,
        write: bool,
        expect_directory: Option<bool>,
    ) -> AppResult<(PathBuf, bool)> {
        let requested = normalize_requested(Path::new(path))?;
        let grant = self.checked_grant(owner, grant_id, write, expect_directory)?;
        if path_key(&grant.path) != path_key(&requested) {
            return Err(app_error(
                "access-denied",
                "The grant does not match the requested path",
            ));
        }
        validate_current_grant_path(&grant, &requested, write, expect_directory)?;
        Ok((requested, grant.writable))
    }

    pub fn resolve_grant(
        &self,
        owner: &str,
        grant_id: &str,
        write: bool,
        expect_directory: Option<bool>,
    ) -> AppResult<PathBuf> {
        let grant = self.checked_grant(owner, grant_id, write, expect_directory)?;
        let current = normalize_requested(&grant.path)?;
        validate_current_grant_path(&grant, &current, write, expect_directory)?;
        Ok(current)
    }

    pub fn revoke(&self, owner: &str, grant_id: &str) {
        if let Ok(mut grants) = self.grants.write() {
            if grants
                .get(grant_id)
                .is_some_and(|grant| grant.owner == owner)
            {
                grants.remove(grant_id);
            }
        }
    }

    pub fn revoke_owner(&self, owner: &str) {
        if let Ok(mut grants) = self.grants.write() {
            grants.retain(|_, grant| grant.owner != owner);
        }
    }

    pub fn revoke_owner_path(&self, owner: &str, path: &Path) {
        let key = path_key(path);
        if let Ok(mut grants) = self.grants.write() {
            grants.retain(|_, grant| grant.owner != owner || path_key(&grant.path) != key);
        }
    }

    fn checked_grant(
        &self,
        owner: &str,
        grant_id: &str,
        write: bool,
        expect_directory: Option<bool>,
    ) -> AppResult<Grant> {
        validate_owner(owner)?;
        if grant_id.trim().is_empty() {
            return Err(app_error(
                "access-denied",
                "An opaque path grant is required",
            ));
        }
        let grant = self
            .grants
            .read()
            .map_err(lock_error)?
            .get(grant_id)
            .cloned()
            .ok_or_else(|| app_error("access-denied", "The path grant is invalid or expired"))?;
        if grant.owner != owner {
            return Err(app_error(
                "access-denied",
                "The path grant belongs to another window",
            ));
        }
        if grant
            .expires_at
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            drop(grant);
            self.revoke(owner, grant_id);
            return Err(app_error("access-denied", "The path grant has expired"));
        }
        if write && !grant.writable {
            return Err(app_error("access-denied", "The grant is read-only"));
        }
        if expect_directory.is_some_and(|expected| grant.is_directory != expected) {
            return Err(app_error(
                "invalid-path",
                "The grant has the wrong path type",
            ));
        }
        log::trace!("resolved {:?} path grant for window {owner}", grant.source);
        Ok(grant)
    }

    fn insert(
        &self,
        owner: &str,
        path: PathBuf,
        writable: bool,
        is_directory: bool,
        source: GrantSource,
        expires_after: Option<Duration>,
    ) -> AppResult<GrantedPath> {
        validate_owner(owner)?;
        let id = Uuid::new_v4().to_string();
        let expires_at = expires_after.and_then(|duration| Instant::now().checked_add(duration));
        self.grants.write().map_err(lock_error)?.insert(
            id.clone(),
            Grant {
                owner: owner.to_owned(),
                path: path.clone(),
                writable,
                is_directory,
                source,
                expires_at,
            },
        );
        Ok(GrantedPath {
            path: path_string(&path)?,
            grant_id: id,
        })
    }
}

fn source_expiry(source: GrantSource) -> Option<Duration> {
    match source {
        GrantSource::Startup => Some(Duration::from_secs(10 * 60)),
        GrantSource::SaveDialog => Some(Duration::from_secs(2 * 60 * 60)),
        GrantSource::Dialog
        | GrantSource::Recent
        | GrantSource::Child
        | GrantSource::Home
        | GrantSource::CurrentDocument => None,
    }
}

fn validate_owner(owner: &str) -> AppResult<()> {
    if owner.is_empty() || owner.len() > 128 {
        return Err(app_error("access-denied", "Invalid grant owner"));
    }
    Ok(())
}

fn is_within(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok()
}

fn normalize_requested(path: &Path) -> AppResult<PathBuf> {
    if path.exists() {
        return std::fs::canonicalize(path).map_err(|error| io_error("resolve", path, error));
    }
    let name = path
        .file_name()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| app_error("invalid-path", "Invalid path"))?;
    if name == "." || name == ".." {
        return Err(app_error("invalid-path", "Invalid path"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| app_error("invalid-path", "The path has no parent"))?;
    Ok(std::fs::canonicalize(parent)
        .map_err(|error| io_error("resolve", parent, error))?
        .join(name))
}

fn validate_current_grant_path(
    grant: &Grant,
    current: &Path,
    write: bool,
    expect_directory: Option<bool>,
) -> AppResult<()> {
    if path_key(&grant.path) != path_key(current) {
        return Err(app_error(
            "access-denied",
            "The granted path changed after access was authorized",
        ));
    }

    match std::fs::metadata(current) {
        Ok(metadata) => {
            let is_directory = metadata.is_dir();
            if is_directory != grant.is_directory
                || expect_directory.is_some_and(|expected| expected != is_directory)
            {
                return Err(app_error(
                    "invalid-path",
                    "The granted path type changed after access was authorized",
                ));
            }
        }
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound
                && write
                && !grant.is_directory
                && expect_directory != Some(true) => {}
        Err(error) => return Err(io_error("revalidate grant", current, error)),
    }
    Ok(())
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    app_error("internal", "The path grant registry is unavailable")
}

fn io_error(operation: &str, path: &Path, error: std::io::Error) -> AppError {
    app_error(
        "io-error",
        format!("Failed to {operation} {}: {error}", path.display()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().expect("temp directory")
    }

    #[test]
    fn grant_must_match_path_and_owner() {
        let temp = temp_dir();
        let file = temp.path().join("document.txt");
        std::fs::write(&file, b"hello").unwrap();
        let other = temp.path().join("other.txt");
        std::fs::write(&other, b"other").unwrap();
        let access = AccessRegistry::default();
        let grant = access
            .grant_existing("main", &file, true, GrantSource::Dialog)
            .unwrap();

        assert_eq!(
            access
                .resolve("main", &grant.path, &grant.grant_id, false, Some(false))
                .unwrap(),
            std::fs::canonicalize(&file).unwrap()
        );
        assert_eq!(
            access
                .resolve("other-window", &grant.path, &grant.grant_id, false, None)
                .unwrap_err()
                .code,
            "access-denied"
        );
        assert_eq!(
            access
                .resolve(
                    "main",
                    other.to_str().unwrap(),
                    &grant.grant_id,
                    false,
                    None
                )
                .unwrap_err()
                .code,
            "access-denied"
        );
    }

    #[test]
    fn read_only_expired_and_revoked_grants_are_rejected() {
        let temp = temp_dir();
        let file = temp.path().join("attachment.txt");
        std::fs::write(&file, b"hello").unwrap();
        let access = AccessRegistry::default();
        let read_only = access
            .grant_existing("main", &file, false, GrantSource::Dialog)
            .unwrap();
        assert_eq!(
            access
                .resolve("main", &read_only.path, &read_only.grant_id, true, None)
                .unwrap_err()
                .code,
            "access-denied"
        );

        let expired = access
            .grant_existing_with_expiry(
                "main",
                &file,
                false,
                GrantSource::Startup,
                Some(Duration::ZERO),
            )
            .unwrap();
        assert_eq!(
            access
                .resolve("main", &expired.path, &expired.grant_id, false, None)
                .unwrap_err()
                .code,
            "access-denied"
        );

        access.revoke("main", &read_only.grant_id);
        assert_eq!(
            access
                .resolve("main", &read_only.path, &read_only.grant_id, false, None)
                .unwrap_err()
                .code,
            "access-denied"
        );
    }

    #[test]
    fn child_grants_reject_traversal() {
        let root = temp_dir();
        let outside = temp_dir();
        let inside_file = root.path().join("inside.txt");
        let outside_file = outside.path().join("outside.txt");
        std::fs::write(&inside_file, b"inside").unwrap();
        std::fs::write(&outside_file, b"outside").unwrap();
        let access = AccessRegistry::default();
        let root_grant = access
            .grant_existing("main", root.path(), true, GrantSource::Dialog)
            .unwrap();
        assert!(access
            .grant_child("main", &root_grant.grant_id, root.path(), &inside_file)
            .is_ok());
        assert_eq!(
            access
                .grant_child("main", &root_grant.grant_id, root.path(), &outside_file)
                .unwrap_err()
                .code,
            "access-denied"
        );
    }

    #[cfg(unix)]
    #[test]
    fn child_grants_reject_symlinks_escaping_root() {
        use std::os::unix::fs::symlink;
        let root = temp_dir();
        let outside = temp_dir();
        let outside_file = outside.path().join("outside.txt");
        std::fs::write(&outside_file, b"outside").unwrap();
        let link = root.path().join("link.txt");
        symlink(&outside_file, &link).unwrap();
        let access = AccessRegistry::default();
        let root_grant = access
            .grant_existing("main", root.path(), false, GrantSource::Dialog)
            .unwrap();
        assert_eq!(
            access
                .grant_child("main", &root_grant.grant_id, root.path(), &link)
                .unwrap_err()
                .code,
            "access-denied"
        );
    }

    #[test]
    fn derived_grants_cannot_escalate_write_access() {
        let temp = temp_dir();
        let file = temp.path().join("attachment.txt");
        std::fs::write(&file, b"hello").unwrap();
        let child = temp.path().join("child.txt");
        std::fs::write(&child, b"child").unwrap();
        let access = AccessRegistry::default();
        let file_grant = access
            .grant_existing("main", &file, false, GrantSource::Dialog)
            .unwrap();
        let derived = access
            .derive_for_owner(
                "main",
                "document",
                &file_grant.path,
                &file_grant.grant_id,
                GrantSource::Startup,
            )
            .unwrap();
        assert_eq!(
            access
                .resolve(
                    "document",
                    &derived.path,
                    &derived.grant_id,
                    true,
                    Some(false)
                )
                .unwrap_err()
                .code,
            "access-denied"
        );

        let directory_grant = access
            .grant_existing("main", temp.path(), false, GrantSource::Dialog)
            .unwrap();
        let child_grant = access
            .grant_child("main", &directory_grant.grant_id, temp.path(), &child)
            .unwrap();
        assert_eq!(
            access
                .resolve(
                    "main",
                    &child_grant.path,
                    &child_grant.grant_id,
                    true,
                    Some(false)
                )
                .unwrap_err()
                .code,
            "access-denied"
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn grant_resolvers_reject_parent_directory_link_swap() {
        let temp = temp_dir();
        let selected = temp.path().join("selected");
        let original = temp.path().join("selected-original");
        let outside = temp.path().join("outside");
        std::fs::create_dir(&selected).unwrap();
        std::fs::create_dir(&outside).unwrap();

        let access = AccessRegistry::default();
        let target = selected.join("document.bin");
        let grant = access.grant_save_target("main", &target).unwrap();
        std::fs::rename(&selected, &original).unwrap();
        create_directory_link(&selected, &outside);

        let error = access
            .resolve_grant("main", &grant.grant_id, true, Some(false))
            .unwrap_err();
        assert_eq!(error.code, "access-denied");
        let error = access
            .resolve("main", &grant.path, &grant.grant_id, true, Some(false))
            .unwrap_err();
        assert_eq!(error.code, "access-denied");

        remove_directory_link(&selected);
    }

    #[cfg(unix)]
    fn create_directory_link(link: &Path, target: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(unix)]
    fn remove_directory_link(link: &Path) {
        std::fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn create_directory_link(link: &Path, target: &Path) {
        let status = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "failed to create test directory junction");
    }

    #[cfg(windows)]
    fn remove_directory_link(link: &Path) {
        std::fs::remove_dir(link).unwrap();
    }
}

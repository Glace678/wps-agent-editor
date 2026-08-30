use crate::{
    error::{AppError, AppResult},
    state::atomic_write_json,
};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    ffi::{OsStr, OsString},
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use uuid::Uuid;

const GUARDIAN_FLAG: &str = "--wae-update-health-guardian";
const GUARDIAN_STATE_FLAG: &str = "--wae-update-health-state";
const GUARDIAN_TOKEN_FLAG: &str = "--wae-update-health-token";
const GUARDIAN_SEAL_FLAG: &str = "--wae-update-health-seal";
const GUARDIAN_PAYLOAD_ENV: &str = "WAE_UPDATE_GUARDIAN_PAYLOAD";
pub(crate) const ROLLBACK_PREFIX: &str = "--wae-update-rollback=";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BACKUP_ENTRIES: u64 = 20_000;
const HEALTH_SCHEMA_VERSION: u32 = 1;
const WINDOWS_UNINSTALL_KEY: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WPS Agent Editor";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum HealthStage {
    AwaitingHealth,
    Started,
    Healthy,
    Finalized,
    Aborted,
    RollingBack,
    RolledBack,
    RollbackFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum PayloadKind {
    File,
    Directory,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum GuardianKind {
    StandaloneExecutable,
    AppImage,
    MacAppBundle,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GuardianPlatform {
    Windows,
    Linux,
    Macos,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct GuardianPlan {
    kind: GuardianKind,
    source_path: PathBuf,
    payload_path: PathBuf,
    launch_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProcessIdentity {
    pid: u32,
    executable_path: PathBuf,
    started_marker: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RegistryHive {
    CurrentUser,
    LocalMachine,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum PlatformRollbackMetadata {
    WindowsRegistry {
        hive: RegistryHive,
        key: String,
        display_version: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HealthState {
    schema_version: u32,
    revision: u64,
    authentication_tag: String,
    transaction_id: String,
    from_version: String,
    to_version: String,
    stage: HealthStage,
    payload_kind: PayloadKind,
    target_path: PathBuf,
    backup_path: PathBuf,
    backup_digest_sha256: String,
    launch_path: PathBuf,
    guardian_kind: GuardianKind,
    guardian_path: PathBuf,
    guardian_launch_path: PathBuf,
    guardian_digest_sha256: String,
    platform_metadata: Option<PlatformRollbackMetadata>,
    relaunch_args: Vec<OsString>,
    created_at_unix_ms: u64,
    deadline_unix_ms: Option<u64>,
    owner_process_identity: ProcessIdentity,
    guardian_pid: Option<u32>,
    guardian_process_identity: Option<ProcessIdentity>,
    startup_pid: Option<u32>,
    startup_process_identity: Option<ProcessIdentity>,
    startup_at_unix_ms: Option<u64>,
    healthy_at_unix_ms: Option<u64>,
    rolled_back_at_unix_ms: Option<u64>,
    rollback_reason: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct UpdateHealthTransaction {
    state_path: PathBuf,
    transaction_id: String,
}

#[derive(Clone, Debug)]
struct Payload {
    kind: PayloadKind,
    target: PathBuf,
    launch: PathBuf,
}

#[derive(Clone, Debug)]
struct HealthPaths {
    root: PathBuf,
    state: PathBuf,
    lock: PathBuf,
    secret: PathBuf,
    backups: PathBuf,
    guardians: PathBuf,
}

impl HealthPaths {
    fn from_app(app: &tauri::AppHandle) -> AppResult<Self> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| {
                AppError::internal(format!("Cannot resolve updater health directory: {error}"))
            })?
            .join("v2")
            .join("updater-health");
        Ok(Self::new(root))
    }

    fn new(root: PathBuf) -> Self {
        Self {
            state: root.join("transaction.json"),
            lock: root.join("transaction.lock"),
            secret: root.join("transaction.key"),
            backups: root.join("backups"),
            guardians: root.join("guardians"),
            root,
        }
    }

    fn create(&self) -> AppResult<()> {
        reject_platform_parent_reparse_points(&self.root)?;
        reject_symlink_or_reparse(&self.root)?;
        fs::create_dir_all(&self.backups)?;
        fs::create_dir_all(&self.guardians)?;
        reject_platform_parent_reparse_points(&self.root)?;
        for path in [
            &self.root,
            &self.backups,
            &self.guardians,
            &self.state,
            &self.lock,
            &self.secret,
        ] {
            reject_symlink_or_reparse(path)?;
        }
        restrict_health_directory(&self.root)?;
        restrict_health_directory(&self.backups)?;
        restrict_health_directory(&self.guardians)?;
        Ok(())
    }
}

#[cfg(windows)]
fn reject_platform_parent_reparse_points(path: &Path) -> AppResult<()> {
    let mut ancestors = path.ancestors().collect::<Vec<_>>();
    ancestors.reverse();
    for ancestor in ancestors {
        reject_symlink_or_reparse(ancestor)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn reject_platform_parent_reparse_points(_path: &Path) -> AppResult<()> {
    Ok(())
}

struct TransactionLock(fs::File);

impl Drop for TransactionLock {
    fn drop(&mut self) {
        unlock_transaction_file(&self.0);
    }
}

fn lock_transaction(paths: &HealthPaths) -> AppResult<TransactionLock> {
    reject_platform_parent_reparse_points(&paths.root)?;
    reject_symlink_or_reparse(&paths.lock)?;
    let file = open_lock_file_no_follow(&paths.lock)?;
    if metadata_is_symlink_or_reparse(&fs::symlink_metadata(&paths.lock)?) {
        return Err(AppError::denied(
            "Updater health transaction lock cannot be a symbolic link or reparse point",
        ));
    }
    reject_platform_parent_reparse_points(&paths.root)?;
    lock_transaction_file(&file)?;
    ensure_lock_handle_is_regular(&file)?;
    Ok(TransactionLock(file))
}

#[cfg(unix)]
fn open_lock_file_no_follow(path: &Path) -> AppResult<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(Into::into)
}

#[cfg(windows)]
fn open_lock_file_no_follow(path: &Path) -> AppResult<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(Into::into)
}

#[cfg(not(any(unix, windows)))]
fn open_lock_file_no_follow(path: &Path) -> AppResult<fs::File> {
    fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(path)
        .map_err(Into::into)
}

fn ensure_lock_handle_is_regular(file: &fs::File) -> AppResult<()> {
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata_is_symlink_or_reparse(&metadata) {
        return Err(AppError::denied(
            "Updater health transaction lock must be a regular file",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn lock_transaction_file(file: &fs::File) -> AppResult<()> {
    use std::os::fd::AsRawFd;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().into())
    }
}

#[cfg(unix)]
fn unlock_transaction_file(file: &fs::File) {
    use std::os::fd::AsRawFd;
    unsafe {
        libc::flock(file.as_raw_fd(), libc::LOCK_UN);
    }
}

#[cfg(windows)]
fn lock_transaction_file(file: &fs::File) -> AppResult<()> {
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: *mut std::ffi::c_void,
    }
    #[link(name = "Kernel32")]
    extern "system" {
        fn LockFileEx(
            file: *mut std::ffi::c_void,
            flags: u32,
            reserved: u32,
            bytes_low: u32,
            bytes_high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }
    const LOCKFILE_EXCLUSIVE_LOCK: u32 = 0x0000_0002;
    let mut overlapped: Overlapped = unsafe { std::mem::zeroed() };
    let locked = unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK,
            0,
            u32::MAX,
            u32::MAX,
            &mut overlapped,
        )
    };
    if locked != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().into())
    }
}

#[cfg(windows)]
fn unlock_transaction_file(file: &fs::File) {
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    struct Overlapped {
        internal: usize,
        internal_high: usize,
        offset: u32,
        offset_high: u32,
        event: *mut std::ffi::c_void,
    }
    #[link(name = "Kernel32")]
    extern "system" {
        fn UnlockFileEx(
            file: *mut std::ffi::c_void,
            reserved: u32,
            bytes_low: u32,
            bytes_high: u32,
            overlapped: *mut Overlapped,
        ) -> i32;
    }
    let mut overlapped: Overlapped = unsafe { std::mem::zeroed() };
    unsafe {
        UnlockFileEx(file.as_raw_handle(), 0, u32::MAX, u32::MAX, &mut overlapped);
    }
}

#[cfg(not(any(unix, windows)))]
fn lock_transaction_file(_file: &fs::File) -> AppResult<()> {
    Err(AppError::unsupported(
        "cross-process updater transaction locking",
    ))
}

#[cfg(not(any(unix, windows)))]
fn unlock_transaction_file(_file: &fs::File) {}

fn reject_symlink_or_reparse(path: &Path) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_symlink_or_reparse(&metadata) => Err(AppError::denied(
            "Updater health storage cannot contain symbolic links or reparse points",
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn metadata_is_symlink_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn reject_storage_path_components(root: &Path, path: &Path) -> AppResult<()> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::denied("Updater health path leaves its storage root"))?;
    reject_symlink_or_reparse(root)?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        reject_symlink_or_reparse(&current)?;
    }
    Ok(())
}

#[cfg(unix)]
fn restrict_health_directory(path: &Path) -> AppResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn restrict_health_directory(_path: &Path) -> AppResult<()> {
    Ok(())
}

impl UpdateHealthTransaction {
    pub(crate) fn prepare(app: &tauri::AppHandle, to_version: &str) -> AppResult<Self> {
        let to_version_parsed = Version::parse(to_version).map_err(|error| {
            AppError::new(
                "update-version-invalid",
                format!("Updater offered an invalid version: {error}"),
            )
        })?;
        if to_version_parsed <= app.package_info().version.clone() {
            return Err(AppError::new(
                "update-version-invalid",
                "Update health transactions require a newer application version",
            ));
        }
        let paths = HealthPaths::from_app(app)?;
        paths.create()?;
        let paths = HealthPaths::new(fs::canonicalize(&paths.root)?);
        let _transaction_lock = lock_transaction(&paths)?;
        clean_terminal_transaction(&paths)?;

        match read_state(&paths.state) {
            Ok(existing)
                if !matches!(
                    existing.stage,
                    HealthStage::Finalized | HealthStage::Aborted | HealthStage::RolledBack
                ) =>
            {
                return Err(AppError::new(
                    "update-health-pending",
                    "Another update health transaction is still active",
                ));
            }
            Ok(_) => {}
            Err(error) if error.code == "not-found" => {}
            Err(error) => return Err(error),
        }

        let payload = installation_payload()?;
        let canonical_root = fs::canonicalize(&paths.root)?;
        let canonical_target = fs::canonicalize(&payload.target)?;
        let canonical_launch = if payload.kind == PayloadKind::File {
            canonical_target.clone()
        } else {
            fs::canonicalize(&payload.launch)?
        };
        if canonical_root.starts_with(&canonical_target)
            || canonical_target.starts_with(&canonical_root)
        {
            return Err(AppError::denied(
                "The updater backup directory must be outside the installed payload",
            ));
        }
        verify_restore_permissions(&canonical_target)?;
        let from_version = app.package_info().version.to_string();
        let platform_metadata = capture_platform_metadata(&from_version)?;

        let transaction_id = Uuid::new_v4().simple().to_string();
        let backup_path = paths.backups.join(&transaction_id).join("payload");
        let current_exe = std::env::current_exe()?;

        let mut budget = CopyBudget::default();
        if let Err(error) = copy_path(&canonical_target, &backup_path, &mut budget) {
            let _ = remove_path(backup_path.parent().unwrap_or(backup_path.as_path()));
            return Err(error);
        }
        let backup_digest_sha256 = payload_digest(&backup_path)?;
        let guardian = guardian_plan(
            current_guardian_platform(),
            &paths.guardians,
            &transaction_id,
            &backup_path,
            &canonical_target,
            &canonical_launch,
            &current_exe,
        )?;
        let mut guardian_budget = CopyBudget::default();
        if let Err(error) = copy_path(
            &guardian.source_path,
            &guardian.payload_path,
            &mut guardian_budget,
        ) {
            let _ = remove_path(backup_path.parent().unwrap_or(backup_path.as_path()));
            let _ = remove_path(&guardian.payload_path);
            return Err(error);
        }
        let guardian_digest_sha256 = payload_digest(&guardian.payload_path)?;

        let now = unix_time_ms()?;
        let owner_process_identity = current_process_identity()?;
        let guardian_secret = new_guardian_secret();
        write_guardian_secret(&paths, &guardian_secret)?;
        let mut state = HealthState {
            schema_version: HEALTH_SCHEMA_VERSION,
            revision: 0,
            authentication_tag: String::new(),
            transaction_id: transaction_id.clone(),
            from_version,
            to_version: to_version.to_owned(),
            stage: HealthStage::AwaitingHealth,
            payload_kind: payload.kind,
            target_path: canonical_target,
            backup_path,
            backup_digest_sha256,
            launch_path: canonical_launch,
            guardian_kind: guardian.kind.clone(),
            guardian_path: guardian.payload_path.clone(),
            guardian_launch_path: guardian.launch_path.clone(),
            guardian_digest_sha256,
            platform_metadata,
            relaunch_args: filtered_relaunch_args(),
            created_at_unix_ms: now,
            deadline_unix_ms: None,
            owner_process_identity,
            guardian_pid: None,
            guardian_process_identity: None,
            startup_pid: None,
            startup_process_identity: None,
            startup_at_unix_ms: None,
            healthy_at_unix_ms: None,
            rolled_back_at_unix_ms: None,
            rollback_reason: None,
            error: None,
        };
        state.authentication_tag = state_authentication_tag(&state, &guardian_secret)?;
        write_initial_state(&paths.state, &state, &guardian_secret)?;
        validate_storage_scope(&paths.state, &state)?;
        verify_guardian_payload(&state)?;

        let mut child = spawn_guardian(
            &guardian.launch_path,
            &guardian.payload_path,
            &guardian.kind,
            &paths.state,
            &transaction_id,
            &guardian_secret,
        )
        .map_err(|error| {
            state.stage = HealthStage::Aborted;
            state.error = Some(format!("Cannot start update health guardian: {error}"));
            let _ = commit_state(&paths.state, &mut state, &guardian_secret);
            let _ = remove_path(&state.backup_path);
            let _ = remove_path(&guardian.payload_path);
            AppError::new(
                "update-health-guardian-failed",
                format!("Cannot start update health guardian: {error}"),
            )
        })?;
        let guardian_identity = match wait_for_process_identity(child.id()) {
            Ok(identity) => identity,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                state.stage = HealthStage::Aborted;
                state.error = Some(format!("Cannot identify update health guardian: {error}"));
                let _ = commit_state(&paths.state, &mut state, &guardian_secret);
                let _ = remove_path(&state.backup_path);
                let _ = remove_path(&guardian.payload_path);
                return Err(AppError::new(
                    "update-health-guardian-failed",
                    format!("Cannot identify update health guardian: {error}"),
                ));
            }
        };
        state.guardian_pid = Some(guardian_identity.pid);
        state.guardian_process_identity = Some(guardian_identity);
        commit_state(&paths.state, &mut state, &guardian_secret)?;

        Ok(Self {
            state_path: paths.state,
            transaction_id,
        })
    }

    pub(crate) fn abort(&self, message: impl Into<String>) -> AppResult<()> {
        let root = self
            .state_path
            .parent()
            .ok_or_else(|| AppError::invalid("Update health state has no parent directory"))?;
        let paths = HealthPaths::new(fs::canonicalize(root)?);
        let _transaction_lock = lock_transaction(&paths)?;
        let mut state = self.read_owned()?;
        let guardian_secret = read_guardian_secret(&paths)?;
        verify_state_auth(&state, &guardian_secret)?;
        state.stage = HealthStage::Aborted;
        state.error = Some(message.into());
        commit_state(&self.state_path, &mut state, &guardian_secret)
    }

    pub(crate) fn id(&self) -> &str {
        &self.transaction_id
    }

    fn read_owned(&self) -> AppResult<HealthState> {
        let state = read_state(&self.state_path)?;
        if state.transaction_id != self.transaction_id {
            return Err(AppError::denied(
                "The update health transaction token no longer matches",
            ));
        }
        Ok(state)
    }
}

pub(crate) fn record_startup(app: &tauri::AppHandle) -> AppResult<()> {
    let paths = HealthPaths::from_app(app)?;
    paths.create()?;
    let paths = HealthPaths::new(fs::canonicalize(&paths.root)?);
    let _transaction_lock = lock_transaction(&paths)?;
    let mut state = match read_state(&paths.state) {
        Ok(state) => state,
        Err(error) if error.code == "not-found" => {
            clean_orphan_storage(&paths)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let guardian_secret = read_guardian_secret(&paths)?;
    verify_state_auth(&state, &guardian_secret)?;
    validate_storage_scope(&paths.state, &state)?;
    let running_version = app.package_info().version.to_string();
    match state.stage {
        HealthStage::Finalized | HealthStage::Aborted => {
            clean_terminal_transaction(&paths)?;
            return Ok(());
        }
        HealthStage::RolledBack | HealthStage::RollbackFailed
            if running_version == state.from_version =>
        {
            ensure_running_payload_matches(&state)?;
            return Ok(());
        }
        HealthStage::RolledBack => {
            return Err(AppError::new(
                "update-rollback-verification-failed",
                "Rollback state does not match the running application version",
            ));
        }
        HealthStage::RollbackFailed => {
            return Err(AppError::new(
                "update-rollback-failed",
                state
                    .error
                    .clone()
                    .unwrap_or_else(|| "The previous update rollback failed".to_owned()),
            ));
        }
        HealthStage::RollingBack => {
            ensure_running_payload_matches(&state)?;
            if ensure_guardian_running(&paths.state, &mut state, &guardian_secret)? {
                commit_state(&paths.state, &mut state, &guardian_secret)?;
            }
            return Err(AppError::new(
                "update-rollback-in-progress",
                "The previous update is still being rolled back",
            ));
        }
        HealthStage::AwaitingHealth | HealthStage::Started | HealthStage::Healthy => {}
    }
    ensure_running_payload_matches(&state)?;
    let process_identity = current_process_identity()?;
    let guardian_restarted = ensure_guardian_running(&paths.state, &mut state, &guardian_secret)?;
    if state.stage == HealthStage::Healthy {
        if guardian_restarted {
            commit_state(&paths.state, &mut state, &guardian_secret)?;
        }
        return Ok(());
    }
    let allow_rebind = state
        .startup_process_identity
        .as_ref()
        .is_some_and(|identity| !is_same_process(identity));
    if state.stage == HealthStage::Started
        && state.startup_process_identity.as_ref() != Some(&process_identity)
        && !allow_rebind
    {
        return Err(AppError::new(
            "update-health-startup-already-running",
            "Another updated application process owns startup health confirmation",
        ));
    }
    let transitioned = transition_to_started(
        &mut state,
        &running_version,
        process_identity,
        unix_time_ms()?,
        allow_rebind,
    );
    if !transitioned && !guardian_restarted {
        return Ok(());
    }
    commit_state(&paths.state, &mut state, &guardian_secret)
}

pub(crate) fn mark_startup_healthy(app: &tauri::AppHandle) -> AppResult<bool> {
    if crate::updater_smoke::health_failure_injection_active() {
        return Ok(false);
    }
    let paths = HealthPaths::from_app(app)?;
    paths.create()?;
    let paths = HealthPaths::new(fs::canonicalize(&paths.root)?);
    let _transaction_lock = lock_transaction(&paths)?;
    let mut state = match read_state(&paths.state) {
        Ok(state) => state,
        Err(error) if error.code == "not-found" => return Ok(false),
        Err(error) => return Err(error),
    };
    let guardian_secret = read_guardian_secret(&paths)?;
    verify_state_auth(&state, &guardian_secret)?;
    validate_storage_scope(&paths.state, &state)?;
    ensure_running_payload_matches(&state)?;
    let process_identity = current_process_identity()?;
    let guardian_restarted = ensure_guardian_running(&paths.state, &mut state, &guardian_secret)?;
    if state.stage == HealthStage::Healthy {
        if guardian_restarted {
            commit_state(&paths.state, &mut state, &guardian_secret)?;
        }
        return Ok(true);
    }
    if !transition_to_healthy(
        &mut state,
        &app.package_info().version.to_string(),
        &process_identity,
        unix_time_ms()?,
    ) {
        return Ok(false);
    }
    commit_state(&paths.state, &mut state, &guardian_secret)?;
    schedule_guardian_cleanup(paths.state, state);
    Ok(true)
}

fn transition_to_started(
    state: &mut HealthState,
    running_version: &str,
    process_identity: ProcessIdentity,
    now: u64,
    allow_rebind: bool,
) -> bool {
    if state.to_version != running_version
        || !(state.stage == HealthStage::AwaitingHealth
            || (state.stage == HealthStage::Started && allow_rebind))
    {
        return false;
    }
    state.stage = HealthStage::Started;
    state.startup_pid = Some(process_identity.pid);
    state.startup_process_identity = Some(process_identity);
    state.startup_at_unix_ms = Some(now);
    state.deadline_unix_ms = Some(now.saturating_add(HEALTH_TIMEOUT.as_millis() as u64));
    true
}

fn transition_to_healthy(
    state: &mut HealthState,
    running_version: &str,
    process_identity: &ProcessIdentity,
    now: u64,
) -> bool {
    if state.stage != HealthStage::Started
        || state.startup_pid != Some(process_identity.pid)
        || state.startup_process_identity.as_ref() != Some(process_identity)
        || state.to_version != running_version
    {
        return false;
    }
    state.stage = HealthStage::Healthy;
    state.healthy_at_unix_ms = Some(now);
    true
}

pub(crate) fn verify_rollback(
    app: &tauri::AppHandle,
    transaction_id: &str,
    expected_from: &Version,
    expected_to: &Version,
) -> AppResult<()> {
    validate_token(transaction_id)?;
    let paths = HealthPaths::from_app(app)?;
    paths.create()?;
    let paths = HealthPaths::new(fs::canonicalize(&paths.root)?);
    let _transaction_lock = lock_transaction(&paths)?;
    let state = read_state(&paths.state)?;
    let guardian_secret = read_guardian_secret(&paths)?;
    verify_state_auth(&state, &guardian_secret)?;
    validate_storage_scope(&paths.state, &state)?;
    if state.transaction_id != transaction_id
        || state.stage != HealthStage::RolledBack
        || state.from_version != expected_from.to_string()
        || state.to_version != expected_to.to_string()
        || state.rollback_reason.as_deref() != Some("startup-health-failed")
        || app.package_info().version.to_string() != expected_from.to_string()
    {
        return Err(AppError::new(
            "update-rollback-verification-failed",
            "The updater rollback record does not match the restored application",
        ));
    }
    ensure_running_payload_matches(&state).map_err(|_| {
        AppError::new(
            "update-rollback-verification-failed",
            "The restored payload does not match the rollback record",
        )
    })?;
    schedule_guardian_cleanup(paths.state, state);
    Ok(())
}

pub(crate) fn run_guardian_from_process() -> AppResult<bool> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if !args.iter().any(|argument| argument == GUARDIAN_FLAG) {
        return Ok(false);
    }
    let state_path = required_guardian_value(&args, GUARDIAN_STATE_FLAG)?;
    let token = required_guardian_value(&args, GUARDIAN_TOKEN_FLAG)?;
    let token = token
        .to_str()
        .ok_or_else(|| AppError::invalid("Guardian token must be valid UTF-8"))?;
    validate_token(token)?;
    let seal = required_guardian_value(&args, GUARDIAN_SEAL_FLAG)?;
    let seal = seal
        .to_str()
        .ok_or_else(|| AppError::invalid("Guardian seal must be valid UTF-8"))?;
    validate_seal(seal)?;
    run_guardian(Path::new(&state_path), token, seal)?;
    Ok(true)
}

fn required_guardian_value(arguments: &[OsString], flag: &str) -> AppResult<OsString> {
    let positions = arguments
        .iter()
        .enumerate()
        .filter_map(|(index, argument)| (argument == flag).then_some(index))
        .collect::<Vec<_>>();
    if positions.len() != 1 {
        return Err(AppError::invalid(format!(
            "Guardian argument {flag} must occur exactly once"
        )));
    }
    arguments
        .get(positions[0] + 1)
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| AppError::invalid(format!("Guardian argument {flag} has no value")))
}

fn run_guardian(state_path: &Path, transaction_id: &str, guardian_secret: &str) -> AppResult<()> {
    let root = state_path
        .parent()
        .ok_or_else(|| AppError::invalid("Guardian state has no parent directory"))?;
    let paths = HealthPaths::new(fs::canonicalize(root)?);
    let mut owner_exit_observed = None;
    loop {
        let transaction_lock = lock_transaction(&paths)?;
        let state = read_state(state_path)?;
        verify_state_auth(&state, guardian_secret)?;
        validate_guardian_execution(state_path, &state)?;
        if state.transaction_id != transaction_id {
            return Err(AppError::denied("Guardian transaction token mismatch"));
        }
        match state.stage {
            HealthStage::Healthy => {
                finalize_healthy(state_path, state, guardian_secret)?;
                return Ok(());
            }
            HealthStage::Finalized | HealthStage::RolledBack | HealthStage::RollbackFailed => {
                return Ok(())
            }
            HealthStage::Aborted => {
                validate_storage_scope(state_path, &state)?;
                let _ = remove_path(&state.backup_path);
                return Ok(());
            }
            HealthStage::AwaitingHealth => {
                if is_same_process(&state.owner_process_identity) {
                    owner_exit_observed = None;
                } else if owner_exit_observed
                    .get_or_insert_with(Instant::now)
                    .elapsed()
                    >= HEALTH_TIMEOUT
                {
                    rollback(state_path, state, guardian_secret)?;
                    return Ok(());
                }
            }
            HealthStage::Started => {
                let startup_exited = state
                    .startup_process_identity
                    .as_ref()
                    .is_some_and(|identity| !is_same_process(identity));
                if startup_exited
                    || state
                        .deadline_unix_ms
                        .is_some_and(|deadline| unix_time_ms().is_ok_and(|now| now >= deadline))
                {
                    rollback(state_path, state, guardian_secret)?;
                    return Ok(());
                }
            }
            HealthStage::RollingBack => {
                rollback(state_path, state, guardian_secret)?;
                return Ok(());
            }
        }
        drop(transaction_lock);
        thread::sleep(POLL_INTERVAL);
    }
}

fn validate_guardian_execution(state_path: &Path, state: &HealthState) -> AppResult<()> {
    validate_storage_scope(state_path, state)?;
    if state.guardian_kind != current_guardian_kind() {
        return Err(AppError::denied(
            "Guardian payload kind does not match the current platform",
        ));
    }
    let current_identity = current_process_identity()?;
    if state.guardian_process_identity.as_ref() != Some(&current_identity) {
        return Err(AppError::denied(
            "Guardian process identity does not match the active transaction",
        ));
    }
    match state.guardian_kind {
        GuardianKind::StandaloneExecutable | GuardianKind::MacAppBundle => {
            if fs::canonicalize(&state.guardian_launch_path)?
                != fs::canonicalize(std::env::current_exe()?)?
            {
                return Err(AppError::denied(
                    "Only the transaction's copied guardian may perform rollback",
                ));
            }
        }
        GuardianKind::AppImage => {
            let payload = std::env::var_os(GUARDIAN_PAYLOAD_ENV)
                .map(PathBuf::from)
                .ok_or_else(|| AppError::denied("AppImage guardian payload is not bound"))?;
            let appimage = std::env::var_os("APPIMAGE")
                .map(PathBuf::from)
                .ok_or_else(|| AppError::denied("AppImage guardian identity is unavailable"))?;
            if fs::canonicalize(payload)? != fs::canonicalize(&state.guardian_path)?
                || fs::canonicalize(appimage)? != fs::canonicalize(&state.guardian_path)?
            {
                return Err(AppError::denied(
                    "Only the transaction's copied AppImage may perform rollback",
                ));
            }
        }
    }
    Ok(())
}

fn validate_storage_scope(state_path: &Path, state: &HealthState) -> AppResult<()> {
    if fs::symlink_metadata(state_path)?.file_type().is_symlink()
        || state_path.file_name() != Some(OsStr::new("transaction.json"))
    {
        return Err(AppError::denied(
            "Guardian state must be the updater's regular transaction file",
        ));
    }
    let root = fs::canonicalize(
        state_path
            .parent()
            .ok_or_else(|| AppError::invalid("Guardian state has no parent directory"))?,
    )?;
    let backup_directory = root.join("backups");
    let guardian_directory = root.join("guardians");
    let secret_path = root.join("transaction.key");
    let expected_guardian = expected_guardian_path(
        &guardian_directory,
        &state.transaction_id,
        &state.guardian_kind,
    );
    if root.file_name() != Some(OsStr::new("updater-health"))
        || state.backup_path != backup_directory.join(&state.transaction_id).join("payload")
        || state.guardian_path != expected_guardian
        || root.starts_with(&state.target_path)
        || state.target_path.starts_with(&root)
    {
        return Err(AppError::denied(
            "Guardian state contains paths outside its update transaction",
        ));
    }
    for storage_path in [
        state_path,
        backup_directory.as_path(),
        guardian_directory.as_path(),
        secret_path.as_path(),
        state.backup_path.as_path(),
        state.guardian_path.as_path(),
        state.guardian_launch_path.as_path(),
    ] {
        reject_storage_path_components(&root, storage_path)?;
    }
    match (&state.payload_kind, &state.guardian_kind) {
        (PayloadKind::File, GuardianKind::AppImage)
            if state.launch_path == state.target_path
                && state.guardian_launch_path == state.guardian_path =>
        {
            validate_platform_metadata(state.platform_metadata.as_ref())
        }
        (PayloadKind::Directory, GuardianKind::MacAppBundle)
            if state.launch_path.starts_with(&state.target_path)
                && state
                    .launch_path
                    .strip_prefix(&state.target_path)
                    .is_ok_and(|relative| {
                        state.guardian_launch_path == state.guardian_path.join(relative)
                    }) =>
        {
            validate_platform_metadata(state.platform_metadata.as_ref())
        }
        (PayloadKind::Directory, GuardianKind::StandaloneExecutable)
            if state.launch_path.starts_with(&state.target_path)
                && state.guardian_launch_path == state.guardian_path =>
        {
            validate_platform_metadata(state.platform_metadata.as_ref())
        }
        (PayloadKind::File, _) if state.launch_path != state.target_path => Err(AppError::denied(
            "File payload launch path must match its rollback target",
        )),
        _ => Err(AppError::denied(
            "Guardian payload and launch paths do not match the installation payload",
        )),
    }
}

fn finalize_healthy(
    state_path: &Path,
    mut state: HealthState,
    guardian_secret: &str,
) -> AppResult<()> {
    validate_storage_scope(state_path, &state)?;
    state.stage = HealthStage::Finalized;
    state.error = None;
    commit_state(state_path, &mut state, guardian_secret)?;
    let _ = remove_path(&state.backup_path);
    Ok(())
}

fn rollback(state_path: &Path, mut state: HealthState, guardian_secret: &str) -> AppResult<()> {
    validate_storage_scope(state_path, &state)?;
    state.stage = HealthStage::RollingBack;
    state.rollback_reason = Some("startup-health-failed".to_owned());
    state.error = None;
    commit_state(state_path, &mut state, guardian_secret)?;

    if let Some(identity) = state.startup_process_identity.as_ref() {
        terminate_process_tree_if_same(identity)?;
    }

    let restore_result = restore_payload(&state);
    if let Err(error) = restore_result {
        state.stage = HealthStage::RollbackFailed;
        state.error = Some(error.to_string());
        commit_state(state_path, &mut state, guardian_secret)?;
        return Err(error);
    }

    if let Err(error) = restore_platform_metadata(state.platform_metadata.as_ref()) {
        state.stage = HealthStage::RollbackFailed;
        state.error = Some(error.to_string());
        commit_state(state_path, &mut state, guardian_secret)?;
        return Err(error);
    }

    state.stage = HealthStage::RolledBack;
    state.rolled_back_at_unix_ms = Some(unix_time_ms()?);
    commit_state(state_path, &mut state, guardian_secret)?;
    if let Err(error) = launch_restored(&state) {
        record_relaunch_failure(state_path, &mut state, guardian_secret, &error)?;
        return Err(error);
    }
    Ok(())
}

fn record_relaunch_failure(
    state_path: &Path,
    state: &mut HealthState,
    guardian_secret: &str,
    error: &AppError,
) -> AppResult<()> {
    // Restoration is complete. Preserve RolledBack so a manual launch of the
    // old version remains possible, and retain the backup until verification.
    state.error = Some(format!("Automatic relaunch failed: {error}"));
    commit_state(state_path, state, guardian_secret)
}

fn restore_payload(state: &HealthState) -> AppResult<()> {
    if !state.backup_path.exists() {
        return Err(AppError::new(
            "update-rollback-backup-missing",
            "The updater rollback backup is missing",
        ));
    }
    verify_payload_digest(&state.backup_path, &state.backup_digest_sha256)?;
    let parent = state
        .target_path
        .parent()
        .ok_or_else(|| AppError::invalid("Installed payload has no parent directory"))?;
    let stem = format!(".wae-rollback-{}", state.transaction_id);
    let staging = parent.join(format!("{stem}.new"));
    let failed = parent.join(format!("{stem}.failed"));
    remove_path(&staging)?;
    remove_path(&failed)?;
    let mut budget = CopyBudget::default();
    copy_path(&state.backup_path, &staging, &mut budget)?;
    if let Err(error) = verify_payload_digest(&staging, &state.backup_digest_sha256) {
        let _ = remove_path(&staging);
        return Err(error);
    }

    if state.target_path.exists() {
        rename_with_retry(&state.target_path, &failed)?;
    }
    if let Err(error) = rename_with_retry(&staging, &state.target_path) {
        if failed.exists() {
            let _ = rename_with_retry(&failed, &state.target_path);
        }
        let _ = remove_path(&staging);
        return Err(error);
    }
    let _ = remove_path(&failed);
    Ok(())
}

fn rename_with_retry(source: &Path, destination: &Path) -> AppResult<()> {
    let started = Instant::now();
    loop {
        match fs::rename(source, destination) {
            Ok(()) => return Ok(()),
            Err(error)
                if started.elapsed() < Duration::from_secs(10)
                    && matches!(
                        error.kind(),
                        std::io::ErrorKind::PermissionDenied
                            | std::io::ErrorKind::WouldBlock
                            | std::io::ErrorKind::Interrupted
                    ) =>
            {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.into()),
        }
    }
}

fn verify_payload_digest(path: &Path, expected: &str) -> AppResult<()> {
    let actual = payload_digest(path)?;
    if constant_time_equal(actual.as_bytes(), expected.as_bytes()) {
        Ok(())
    } else {
        Err(AppError::denied("Rollback payload authentication failed"))
    }
}

fn launch_restored(state: &HealthState) -> AppResult<()> {
    let mut command = Command::new(&state.launch_path);
    command
        .args(&state.relaunch_args)
        .arg(format!("{ROLLBACK_PREFIX}{}", state.transaction_id));
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach_command(&mut command);
    command.spawn().map(|_| ()).map_err(|error| {
        AppError::new(
            "update-rollback-relaunch-failed",
            format!("The previous version was restored but could not be relaunched: {error}"),
        )
    })
}

fn spawn_guardian(
    guardian_launch_path: &Path,
    guardian_payload_path: &Path,
    guardian_kind: &GuardianKind,
    state_path: &Path,
    transaction_id: &str,
    seal: &str,
) -> std::io::Result<std::process::Child> {
    let mut command = Command::new(guardian_launch_path);
    command
        .arg(GUARDIAN_FLAG)
        .arg(GUARDIAN_STATE_FLAG)
        .arg(state_path)
        .arg(GUARDIAN_TOKEN_FLAG)
        .arg(transaction_id)
        .arg(GUARDIAN_SEAL_FLAG)
        .arg(seal)
        .env(GUARDIAN_PAYLOAD_ENV, guardian_payload_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if guardian_kind == &GuardianKind::AppImage {
        command.env("APPIMAGE_EXTRACT_AND_RUN", "1");
    }
    detach_command(&mut command);
    command.spawn()
}

fn ensure_guardian_running(
    state_path: &Path,
    state: &mut HealthState,
    guardian_secret: &str,
) -> AppResult<bool> {
    if !stage_needs_guardian(&state.stage) {
        return Ok(false);
    }
    if state
        .guardian_process_identity
        .as_ref()
        .is_some_and(is_same_process)
    {
        return Ok(false);
    }
    validate_storage_scope(state_path, state)?;
    verify_state_auth(state, guardian_secret)?;
    verify_guardian_payload(state)?;
    let mut child = spawn_guardian(
        &state.guardian_launch_path,
        &state.guardian_path,
        &state.guardian_kind,
        state_path,
        &state.transaction_id,
        guardian_secret,
    )
    .map_err(|error| {
        AppError::new(
            "update-health-guardian-failed",
            format!("Cannot restart update health guardian: {error}"),
        )
    })?;
    let identity = match wait_for_process_identity(child.id()) {
        Ok(identity) => identity,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::new(
                "update-health-guardian-failed",
                format!("Cannot identify restarted update health guardian: {error}"),
            ));
        }
    };
    state.guardian_pid = Some(identity.pid);
    state.guardian_process_identity = Some(identity);
    Ok(true)
}

fn stage_needs_guardian(stage: &HealthStage) -> bool {
    matches!(
        stage,
        HealthStage::AwaitingHealth
            | HealthStage::Started
            | HealthStage::Healthy
            | HealthStage::RollingBack
    )
}

#[cfg(windows)]
fn detach_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
}

#[cfg(unix)]
fn detach_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(any(unix, windows)))]
fn detach_command(_command: &mut Command) {}

fn filtered_relaunch_args() -> Vec<OsString> {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    let mut filtered = Vec::with_capacity(arguments.len());
    let mut index = 0;
    while index < arguments.len() {
        if arguments[index] == GUARDIAN_FLAG {
            index += 1;
            continue;
        }
        if arguments[index] == GUARDIAN_STATE_FLAG
            || arguments[index] == GUARDIAN_TOKEN_FLAG
            || arguments[index] == GUARDIAN_SEAL_FLAG
        {
            index += 2;
            continue;
        }
        if arguments[index]
            .to_str()
            .is_some_and(|argument| argument.starts_with(ROLLBACK_PREFIX))
        {
            index += 1;
            continue;
        }
        filtered.push(arguments[index].clone());
        index += 1;
    }
    filtered
}

fn guardian_plan(
    platform: GuardianPlatform,
    guardian_directory: &Path,
    transaction_id: &str,
    backup_path: &Path,
    installed_target: &Path,
    installed_launch: &Path,
    current_exe: &Path,
) -> AppResult<GuardianPlan> {
    validate_token(transaction_id)?;
    match platform {
        GuardianPlatform::Windows => {
            let payload_path = expected_guardian_path(
                guardian_directory,
                transaction_id,
                &GuardianKind::StandaloneExecutable,
            );
            Ok(GuardianPlan {
                kind: GuardianKind::StandaloneExecutable,
                source_path: current_exe.to_path_buf(),
                launch_path: payload_path.clone(),
                payload_path,
            })
        }
        GuardianPlatform::Linux => {
            let payload_path =
                expected_guardian_path(guardian_directory, transaction_id, &GuardianKind::AppImage);
            Ok(GuardianPlan {
                kind: GuardianKind::AppImage,
                source_path: backup_path.to_path_buf(),
                launch_path: payload_path.clone(),
                payload_path,
            })
        }
        GuardianPlatform::Macos => {
            let relative_launch =
                installed_launch
                    .strip_prefix(installed_target)
                    .map_err(|_| {
                        AppError::denied(
                            "macOS guardian executable must stay inside the installed app bundle",
                        )
                    })?;
            let payload_path = expected_guardian_path(
                guardian_directory,
                transaction_id,
                &GuardianKind::MacAppBundle,
            );
            Ok(GuardianPlan {
                kind: GuardianKind::MacAppBundle,
                source_path: backup_path.to_path_buf(),
                launch_path: payload_path.join(relative_launch),
                payload_path,
            })
        }
        GuardianPlatform::Other => Err(AppError::unsupported(
            "update health guardian on this platform",
        )),
    }
}

fn expected_guardian_path(
    guardian_directory: &Path,
    transaction_id: &str,
    kind: &GuardianKind,
) -> PathBuf {
    let suffix = match kind {
        GuardianKind::StandaloneExecutable => ".exe",
        GuardianKind::AppImage => ".AppImage",
        GuardianKind::MacAppBundle => ".app",
    };
    guardian_directory.join(format!("guardian-{transaction_id}{suffix}"))
}

#[cfg(target_os = "windows")]
fn current_guardian_platform() -> GuardianPlatform {
    GuardianPlatform::Windows
}

#[cfg(target_os = "linux")]
fn current_guardian_platform() -> GuardianPlatform {
    GuardianPlatform::Linux
}

#[cfg(target_os = "macos")]
fn current_guardian_platform() -> GuardianPlatform {
    GuardianPlatform::Macos
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn current_guardian_platform() -> GuardianPlatform {
    GuardianPlatform::Other
}

fn current_guardian_kind() -> GuardianKind {
    match current_guardian_platform() {
        GuardianPlatform::Windows => GuardianKind::StandaloneExecutable,
        GuardianPlatform::Linux => GuardianKind::AppImage,
        GuardianPlatform::Macos => GuardianKind::MacAppBundle,
        GuardianPlatform::Other => GuardianKind::StandaloneExecutable,
    }
}

fn installation_payload() -> AppResult<Payload> {
    let current_exe = fs::canonicalize(std::env::current_exe()?)?;
    #[cfg(target_os = "linux")]
    if let Some(appimage) = std::env::var_os("APPIMAGE").map(PathBuf::from) {
        if appimage.is_file() {
            if fs::symlink_metadata(&appimage)?.file_type().is_symlink() {
                return Err(AppError::denied(
                    "Updater rollback does not accept a symbolic-link AppImage path",
                ));
            }
            return Ok(Payload {
                kind: PayloadKind::File,
                target: appimage.clone(),
                launch: appimage,
            });
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(bundle) = current_exe
        .ancestors()
        .find(|path| path.extension() == Some(OsStr::new("app")))
    {
        return Ok(Payload {
            kind: PayloadKind::Directory,
            target: bundle.to_path_buf(),
            launch: current_exe,
        });
    }

    #[cfg(target_os = "windows")]
    {
        let target = current_exe
            .parent()
            .ok_or_else(|| AppError::invalid("Installed executable has no parent directory"))?
            .to_path_buf();
        return Ok(Payload {
            kind: PayloadKind::Directory,
            target,
            launch: current_exe,
        });
    }

    #[allow(unreachable_code)]
    Ok(Payload {
        kind: PayloadKind::File,
        target: current_exe.clone(),
        launch: current_exe,
    })
}

#[derive(Default)]
struct CopyBudget {
    bytes: u64,
    entries: u64,
}

impl CopyBudget {
    fn add(&mut self, bytes: u64) -> AppResult<()> {
        self.bytes = self.bytes.saturating_add(bytes);
        self.entries = self.entries.saturating_add(1);
        if self.bytes > MAX_BACKUP_BYTES || self.entries > MAX_BACKUP_ENTRIES {
            return Err(AppError::new(
                "update-backup-too-large",
                "The installed payload exceeds the rollback backup limits",
            ));
        }
        Ok(())
    }
}

fn payload_digest(path: &Path) -> AppResult<String> {
    let mut digest = Sha256::new();
    digest.update(b"WAE-PAYLOAD-DIGEST-V1\0");
    let mut budget = CopyBudget::default();
    digest_payload_entry(path, path, &mut digest, &mut budget)?;
    Ok(hex::encode(digest.finalize()))
}

fn verify_guardian_payload(state: &HealthState) -> AppResult<()> {
    verify_payload_digest(&state.guardian_path, &state.guardian_digest_sha256).map_err(|error| {
        AppError::denied(format!("Update guardian authentication failed: {error}"))
    })
}

fn digest_payload_entry(
    root: &Path,
    path: &Path,
    digest: &mut Sha256,
    budget: &mut CopyBudget,
) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    if metadata_is_symlink_or_reparse(&metadata) {
        return Err(AppError::new(
            "update-backup-unsupported-entry",
            format!(
                "Rollback digest refuses a reparse point: {}",
                path.display()
            ),
        ));
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| AppError::denied("Rollback digest path escaped its payload root"))?;
    let relative_bytes = os_str_bytes(relative.as_os_str());
    if metadata.file_type().is_symlink() {
        budget.add(0)?;
        digest_record(digest, b'L', &relative_bytes);
        let target = fs::read_link(path)?;
        let target_bytes = os_str_bytes(target.as_os_str());
        digest.update((target_bytes.len() as u64).to_le_bytes());
        digest.update(target_bytes);
        return Ok(());
    }
    if metadata.is_dir() {
        budget.add(0)?;
        digest_record(digest, b'D', &relative_bytes);
        digest_metadata_mode(digest, &metadata);
        let mut entries = fs::read_dir(path)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by(|left, right| {
            os_str_bytes(&left.file_name()).cmp(&os_str_bytes(&right.file_name()))
        });
        for entry in entries {
            digest_payload_entry(root, &entry.path(), digest, budget)?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(AppError::new(
            "update-backup-unsupported-entry",
            format!("Unsupported rollback digest entry: {}", path.display()),
        ));
    }
    budget.add(metadata.len())?;
    digest_record(digest, b'F', &relative_bytes);
    digest_metadata_mode(digest, &metadata);
    digest.update(metadata.len().to_le_bytes());
    let mut file = fs::File::open(path)?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut read_total = 0_u64;
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        read_total = read_total.saturating_add(read as u64);
        if read_total > metadata.len() || read_total > MAX_BACKUP_BYTES {
            return Err(AppError::new(
                "update-backup-changed",
                "Rollback payload changed while it was being authenticated",
            ));
        }
        digest.update(&buffer[..read]);
    }
    if read_total != metadata.len() {
        return Err(AppError::new(
            "update-backup-changed",
            "Rollback payload changed while it was being authenticated",
        ));
    }
    Ok(())
}

fn digest_record(digest: &mut Sha256, kind: u8, path: &[u8]) {
    digest.update([kind]);
    digest.update((path.len() as u64).to_le_bytes());
    digest.update(path);
}

#[cfg(unix)]
fn digest_metadata_mode(digest: &mut Sha256, metadata: &fs::Metadata) {
    use std::os::unix::fs::PermissionsExt;
    digest.update((metadata.permissions().mode() & 0o7777).to_le_bytes());
}

#[cfg(not(unix))]
fn digest_metadata_mode(digest: &mut Sha256, metadata: &fs::Metadata) {
    digest.update([u8::from(metadata.permissions().readonly())]);
}

#[cfg(unix)]
fn os_str_bytes(value: &OsStr) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    value.as_bytes().to_vec()
}

#[cfg(windows)]
fn os_str_bytes(value: &OsStr) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    value
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>()
}

#[cfg(not(any(unix, windows)))]
fn os_str_bytes(value: &OsStr) -> Vec<u8> {
    value.to_string_lossy().as_bytes().to_vec()
}

fn copy_path(source: &Path, destination: &Path, budget: &mut CopyBudget) -> AppResult<()> {
    let metadata = fs::symlink_metadata(source)?;
    #[cfg(windows)]
    if metadata_is_symlink_or_reparse(&metadata) {
        return Err(AppError::new(
            "update-backup-unsupported-entry",
            format!(
                "Windows rollback backup refuses a reparse point: {}",
                source.display()
            ),
        ));
    }
    if metadata.file_type().is_symlink() {
        budget.add(0)?;
        let target = fs::read_link(source)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        create_symlink(&target, destination, source.is_dir())?;
        return Ok(());
    }
    if metadata.is_dir() {
        budget.add(0)?;
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_path(&entry.path(), &destination.join(entry.file_name()), budget)?;
        }
        fs::set_permissions(destination, metadata.permissions())?;
        return Ok(());
    }
    if !metadata.is_file() {
        return Err(AppError::new(
            "update-backup-unsupported-entry",
            format!("Unsupported installed payload entry: {}", source.display()),
        ));
    }
    budget.add(metadata.len())?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    fs::set_permissions(destination, metadata.permissions())?;
    Ok(())
}

#[cfg(unix)]
fn create_symlink(target: &Path, destination: &Path, _directory: bool) -> AppResult<()> {
    std::os::unix::fs::symlink(target, destination).map_err(Into::into)
}

#[cfg(windows)]
fn create_symlink(target: &Path, destination: &Path, directory: bool) -> AppResult<()> {
    if directory {
        std::os::windows::fs::symlink_dir(target, destination).map_err(Into::into)
    } else {
        std::os::windows::fs::symlink_file(target, destination).map_err(Into::into)
    }
}

#[cfg(not(any(unix, windows)))]
fn create_symlink(_target: &Path, _destination: &Path, _directory: bool) -> AppResult<()> {
    Err(AppError::unsupported("symbolic-link rollback backup"))
}

fn remove_path(path: &Path) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata_is_symlink_or_reparse(&metadata) && metadata.is_dir() => {
            fs::remove_dir(path)?
        }
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path)?,
        Ok(_) => fs::remove_file(path)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

fn verify_restore_permissions(target: &Path) -> AppResult<()> {
    use std::io::Write;

    let parent = target
        .parent()
        .ok_or_else(|| AppError::invalid("Installed payload has no parent directory"))?;
    let probe = parent.join(format!(
        ".wae-update-write-probe-{}",
        Uuid::new_v4().simple()
    ));
    let result = (|| -> AppResult<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&probe)
            .map_err(|error| {
                AppError::new(
                    "update-rollback-permission-denied",
                    format!(
                        "Cannot prepare rollback beside {}: {error}",
                        target.display()
                    ),
                )
            })?;
        file.write_all(b"WAE2")?;
        file.sync_all()?;
        Ok(())
    })();
    let _ = fs::remove_file(&probe);
    result
}

fn write_initial_state(path: &Path, state: &HealthState, guardian_secret: &str) -> AppResult<()> {
    validate_state(state)?;
    verify_state_auth(state, guardian_secret)?;
    if path.exists() {
        return Err(AppError::new(
            "update-health-pending",
            "Updater health state already exists",
        ));
    }
    atomic_write_json(path, state)
}

fn read_state(path: &Path) -> AppResult<HealthState> {
    let state: HealthState = serde_json::from_slice(&fs::read(path)?)?;
    validate_state(&state)?;
    Ok(state)
}

fn commit_state(path: &Path, state: &mut HealthState, guardian_secret: &str) -> AppResult<()> {
    let current = read_state(path)?;
    verify_state_auth(&current, guardian_secret)?;
    if current.transaction_id != state.transaction_id
        || current.revision != state.revision
        || current.authentication_tag != state.authentication_tag
    {
        return Err(AppError::new(
            "update-health-state-conflict",
            "Updater health state changed concurrently",
        ));
    }
    state.revision = state.revision.checked_add(1).ok_or_else(|| {
        AppError::new(
            "update-health-state-conflict",
            "Updater health state revision overflowed",
        )
    })?;
    state.authentication_tag = state_authentication_tag(state, guardian_secret)?;
    validate_state(state)?;
    atomic_write_json(path, state)
}

fn state_authentication_tag(state: &HealthState, guardian_secret: &str) -> AppResult<String> {
    validate_seal(guardian_secret)?;
    let mut authenticated = serde_json::to_value(state)?;
    let object = authenticated
        .as_object_mut()
        .ok_or_else(|| AppError::internal("Updater health state is not a JSON object"))?;
    object
        .remove("authenticationTag")
        .ok_or_else(|| AppError::internal("Updater health authentication field is unavailable"))?;
    hmac_sha256_hex(guardian_secret, &serde_json::to_vec(&authenticated)?)
}

fn hmac_sha256_hex(secret: &str, message: &[u8]) -> AppResult<String> {
    let key =
        hex::decode(secret).map_err(|error| AppError::new("invalid-data", error.to_string()))?;
    let mut inner_key = [0x36_u8; 64];
    let mut outer_key = [0x5c_u8; 64];
    for (index, byte) in key.iter().enumerate() {
        inner_key[index] ^= byte;
        outer_key[index] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(inner_key);
    inner.update(message);
    let inner_digest = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_key);
    outer.update(inner_digest);
    Ok(hex::encode(outer.finalize()))
}

fn verify_state_auth(state: &HealthState, guardian_secret: &str) -> AppResult<()> {
    let expected = state_authentication_tag(state, guardian_secret)?;
    if constant_time_equal(state.authentication_tag.as_bytes(), expected.as_bytes()) {
        Ok(())
    } else {
        Err(AppError::denied(
            "Updater health state authentication failed",
        ))
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn new_guardian_secret() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn write_guardian_secret(paths: &HealthPaths, secret: &str) -> AppResult<()> {
    use std::io::Write;

    validate_seal(secret)?;
    reject_storage_path_components(&paths.root, &paths.secret)?;
    let mut options = fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options.open(&paths.secret)?;
    ensure_lock_handle_is_regular(&file)?;
    file.write_all(secret.as_bytes())?;
    file.sync_all()?;
    reject_storage_path_components(&paths.root, &paths.secret)
}

fn read_guardian_secret(paths: &HealthPaths) -> AppResult<String> {
    reject_storage_path_components(&paths.root, &paths.secret)?;
    let bytes = fs::read(&paths.secret)?;
    let secret = std::str::from_utf8(&bytes)
        .map_err(|_| AppError::new("invalid-data", "Guardian key is not valid UTF-8"))?;
    validate_seal(secret)?;
    Ok(secret.to_owned())
}

fn validate_seal(seal: &str) -> AppResult<()> {
    if seal.len() == 64
        && seal
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(AppError::invalid(
            "Guardian seal must be 64 lowercase hexadecimal characters",
        ))
    }
}

fn validate_state(state: &HealthState) -> AppResult<()> {
    if state.schema_version != HEALTH_SCHEMA_VERSION {
        return Err(AppError::new(
            "unsupported-data-version",
            format!(
                "Unsupported updater health data version {}; expected {}",
                state.schema_version, HEALTH_SCHEMA_VERSION
            ),
        ));
    }
    validate_seal(&state.authentication_tag)?;
    validate_token(&state.transaction_id)?;
    let from_version = Version::parse(&state.from_version)
        .map_err(|error| AppError::new("invalid-data", error.to_string()))?;
    let to_version = Version::parse(&state.to_version)
        .map_err(|error| AppError::new("invalid-data", error.to_string()))?;
    if to_version <= from_version {
        return Err(AppError::new(
            "invalid-data",
            "Updater health target version must be newer than its source version",
        ));
    }
    if state.target_path.as_os_str().is_empty()
        || state.backup_path.as_os_str().is_empty()
        || state.launch_path.as_os_str().is_empty()
        || state.guardian_path.as_os_str().is_empty()
        || state.guardian_launch_path.as_os_str().is_empty()
        || !state.target_path.is_absolute()
        || !state.backup_path.is_absolute()
        || !state.launch_path.is_absolute()
        || !state.guardian_path.is_absolute()
        || !state.guardian_launch_path.is_absolute()
    {
        return Err(AppError::new(
            "invalid-data",
            "Updater health state contains invalid paths or timestamps",
        ));
    }
    validate_seal(&state.backup_digest_sha256).map_err(|_| {
        AppError::new(
            "invalid-data",
            "Updater rollback payload digest must be lowercase SHA-256",
        )
    })?;
    validate_seal(&state.guardian_digest_sha256).map_err(|_| {
        AppError::new(
            "invalid-data",
            "Updater guardian digest must be lowercase SHA-256",
        )
    })?;
    validate_process_identity(&state.owner_process_identity)?;
    match (state.guardian_pid, state.guardian_process_identity.as_ref()) {
        (Some(pid), Some(identity)) if pid == identity.pid => {
            validate_process_identity(identity)?;
        }
        (None, None) => {}
        _ => {
            return Err(AppError::new(
                "invalid-data",
                "Updater guardian process state is incomplete",
            ))
        }
    }
    let has_complete_startup = match (
        state.startup_pid,
        state.startup_process_identity.as_ref(),
        state.startup_at_unix_ms,
        state.deadline_unix_ms,
    ) {
        (Some(pid), Some(identity), Some(started), Some(deadline)) => {
            validate_process_identity(identity)?;
            pid == identity.pid
                && started >= state.created_at_unix_ms
                && deadline == started.saturating_add(HEALTH_TIMEOUT.as_millis() as u64)
        }
        (None, None, None, None) => false,
        _ => {
            return Err(AppError::new(
                "invalid-data",
                "Updater startup process state is incomplete",
            ))
        }
    };
    let has_no_startup = state.startup_pid.is_none()
        && state.startup_process_identity.is_none()
        && state.startup_at_unix_ms.is_none()
        && state.deadline_unix_ms.is_none();
    let no_healthy_or_rollback = state.healthy_at_unix_ms.is_none()
        && state.rolled_back_at_unix_ms.is_none()
        && state.rollback_reason.is_none();
    let valid_stage = match state.stage {
        HealthStage::AwaitingHealth => has_no_startup && no_healthy_or_rollback,
        HealthStage::Started => has_complete_startup && no_healthy_or_rollback,
        HealthStage::Healthy | HealthStage::Finalized => {
            has_complete_startup
                && state.rollback_reason.is_none()
                && state.rolled_back_at_unix_ms.is_none()
                && state.healthy_at_unix_ms.is_some_and(|healthy| {
                    state
                        .startup_at_unix_ms
                        .is_some_and(|started| healthy >= started)
                })
        }
        HealthStage::Aborted => has_no_startup && no_healthy_or_rollback,
        HealthStage::RollingBack => {
            (has_no_startup || has_complete_startup)
                && state.rollback_reason.as_deref() == Some("startup-health-failed")
                && state.healthy_at_unix_ms.is_none()
                && state.rolled_back_at_unix_ms.is_none()
        }
        HealthStage::RolledBack => {
            (has_no_startup || has_complete_startup)
                && state.rollback_reason.as_deref() == Some("startup-health-failed")
                && state.healthy_at_unix_ms.is_none()
                && state
                    .rolled_back_at_unix_ms
                    .is_some_and(|rolled| rolled >= state.created_at_unix_ms)
        }
        HealthStage::RollbackFailed => {
            (has_no_startup || has_complete_startup)
                && state.rollback_reason.as_deref() == Some("startup-health-failed")
                && state.healthy_at_unix_ms.is_none()
                && state.error.as_ref().is_some_and(|error| !error.is_empty())
        }
    };
    if !valid_stage {
        return Err(AppError::new(
            "invalid-data",
            "Updater health stage has inconsistent process or timestamp fields",
        ));
    }
    validate_platform_metadata(state.platform_metadata.as_ref())
}

fn validate_process_identity(identity: &ProcessIdentity) -> AppResult<()> {
    if !valid_process_id(identity.pid)
        || !identity.executable_path.is_absolute()
        || identity.started_marker.is_empty()
        || identity.started_marker.len() > 256
    {
        return Err(AppError::new(
            "invalid-data",
            "Updater process identity is invalid",
        ));
    }
    Ok(())
}

fn valid_process_id(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        i32::try_from(pid).is_ok()
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn current_process_identity() -> AppResult<ProcessIdentity> {
    query_process_identity(std::process::id())
}

fn wait_for_process_identity(pid: u32) -> AppResult<ProcessIdentity> {
    if !valid_process_id(pid) {
        return Err(AppError::new(
            "invalid-data",
            "Guardian returned an invalid process identifier",
        ));
    }
    let mut last_error = None;
    let mut previous = None;
    for _ in 0..80 {
        match query_process_identity(pid) {
            Ok(identity) if previous.as_ref() == Some(&identity) => return Ok(identity),
            Ok(identity) => previous = Some(identity),
            Err(error) => last_error = Some(error),
        }
        thread::sleep(Duration::from_millis(25));
    }
    Err(last_error.unwrap_or_else(|| {
        AppError::new(
            "update-health-guardian-failed",
            "Cannot identify the update health guardian process",
        )
    }))
}

fn is_same_process(expected: &ProcessIdentity) -> bool {
    valid_process_id(expected.pid)
        && query_process_identity(expected.pid).is_ok_and(|actual| actual == *expected)
}

const MAX_PROCESS_TREE_PROCESSES: usize = 4_096;
const MAX_PROCESS_TREE_PASSES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessLink {
    pid: u32,
    parent_pid: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ProcessDescendant {
    pid: u32,
    parent_pid: u32,
    depth: usize,
}

fn recursive_process_descendants(root_pid: u32, links: &[ProcessLink]) -> Vec<ProcessDescendant> {
    let mut children = BTreeMap::<u32, BTreeSet<u32>>::new();
    for link in links {
        if valid_process_id(link.pid)
            && valid_process_id(link.parent_pid)
            && link.pid != link.parent_pid
        {
            children
                .entry(link.parent_pid)
                .or_default()
                .insert(link.pid);
        }
    }
    let mut visited = BTreeSet::from([root_pid]);
    let mut queue = VecDeque::from([(root_pid, 0_usize)]);
    let mut descendants = Vec::new();
    while let Some((parent_pid, parent_depth)) = queue.pop_front() {
        let Some(direct_children) = children.get(&parent_pid) else {
            continue;
        };
        for &pid in direct_children {
            if !visited.insert(pid) || descendants.len() >= MAX_PROCESS_TREE_PROCESSES {
                continue;
            }
            let depth = parent_depth.saturating_add(1);
            descendants.push(ProcessDescendant {
                pid,
                parent_pid,
                depth,
            });
            queue.push_back((pid, depth));
        }
    }
    descendants
}

#[cfg(any(test, windows))]
fn process_tree_edge_is_possible(
    parent_pid: u32,
    parent_started: u64,
    child_parent_pid: u32,
    child_started: u64,
) -> bool {
    valid_process_id(parent_pid) && parent_pid == child_parent_pid && child_started > parent_started
}

#[cfg(target_os = "linux")]
struct LinuxTreeProcess {
    identity: ProcessIdentity,
    pidfd: std::os::fd::OwnedFd,
    depth: usize,
    suspended: bool,
    terminated: bool,
}

#[cfg(target_os = "linux")]
impl Drop for LinuxTreeProcess {
    fn drop(&mut self) {
        use std::os::fd::AsRawFd;
        if self.suspended && !self.terminated {
            let _ = pidfd_send_signal(self.pidfd.as_raw_fd(), libc::SIGCONT);
        }
    }
}

#[cfg(target_os = "linux")]
fn terminate_process_tree_if_same(expected: &ProcessIdentity) -> AppResult<()> {
    if !valid_process_id(expected.pid) {
        return Err(AppError::new(
            "invalid-data",
            "Refusing to terminate an invalid process identifier",
        ));
    }
    let Some(mut root) = open_linux_tree_process(expected.pid, 0)? else {
        return Ok(());
    };
    if root.identity != *expected {
        return Ok(());
    }
    suspend_linux_tree_process(&mut root)?;
    let mut processes = vec![root];
    let mut quiet_passes = 0_usize;
    for _ in 0..MAX_PROCESS_TREE_PASSES {
        let links = snapshot_linux_process_links()?;
        let descendants = recursive_process_descendants(expected.pid, &links);
        if descendants.len() >= MAX_PROCESS_TREE_PROCESSES {
            return Err(AppError::new(
                "update-rollback-process-tree-limit",
                "The unhealthy application process tree exceeds the rollback safety limit",
            ));
        }
        let mut added = false;
        for descendant in descendants {
            if processes
                .iter()
                .any(|process| process.identity.pid == descendant.pid)
            {
                continue;
            }
            if !processes
                .iter()
                .any(|process| process.identity.pid == descendant.parent_pid && process.suspended)
            {
                continue;
            }
            let Some(mut process) = open_linux_tree_process(descendant.pid, descendant.depth)?
            else {
                continue;
            };
            if linux_process_parent_pid(descendant.pid)? != descendant.parent_pid {
                continue;
            }
            suspend_linux_tree_process(&mut process)?;
            processes.push(process);
            added = true;
        }
        if added {
            quiet_passes = 0;
        } else {
            quiet_passes += 1;
            if quiet_passes >= 2 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    if quiet_passes < 2 {
        return Err(AppError::new(
            "update-rollback-process-tree-unstable",
            "The unhealthy application process tree did not stabilize before rollback",
        ));
    }
    processes.sort_by_key(|process| std::cmp::Reverse(process.depth));
    for process in &mut processes {
        use std::os::fd::AsRawFd;
        pidfd_send_signal(process.pidfd.as_raw_fd(), libc::SIGKILL)?;
        process.terminated = true;
        process.suspended = false;
    }
    for process in &processes {
        wait_for_linux_pidfd(&process.pidfd, Duration::from_secs(10))?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn open_linux_tree_process(pid: u32, depth: usize) -> AppResult<Option<LinuxTreeProcess>> {
    use std::os::fd::{FromRawFd, OwnedFd};
    let pid = libc::pid_t::try_from(pid)
        .map_err(|_| AppError::new("invalid-data", "Invalid Linux process identifier"))?;
    let raw_fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid, 0_u32) as i32 };
    if raw_fd < 0 {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(None)
        } else {
            Err(error.into())
        };
    }
    let pidfd = unsafe { OwnedFd::from_raw_fd(raw_fd) };
    if linux_pidfd_exited(&pidfd)? {
        return Ok(None);
    }
    let identity = match query_process_identity(pid as u32) {
        Ok(identity) => identity,
        Err(_) if linux_pidfd_exited(&pidfd)? => return Ok(None),
        Err(error) => return Err(error),
    };
    Ok(Some(LinuxTreeProcess {
        identity,
        pidfd,
        depth,
        suspended: false,
        terminated: false,
    }))
}

#[cfg(target_os = "linux")]
fn suspend_linux_tree_process(process: &mut LinuxTreeProcess) -> AppResult<()> {
    use std::os::fd::AsRawFd;
    pidfd_send_signal(process.pidfd.as_raw_fd(), libc::SIGSTOP)?;
    if linux_pidfd_exited(&process.pidfd)? {
        return Ok(());
    }
    if query_process_identity(process.identity.pid).as_ref().ok() != Some(&process.identity) {
        return Err(AppError::denied(
            "Linux process identity changed while freezing the rollback process tree",
        ));
    }
    process.suspended = true;
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_pidfd_exited(pidfd: &std::os::fd::OwnedFd) -> AppResult<bool> {
    use std::os::fd::AsRawFd;
    let mut descriptor = libc::pollfd {
        fd: pidfd.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    loop {
        let result = unsafe { libc::poll(&mut descriptor, 1, 0) };
        if result >= 0 {
            return Ok(result > 0);
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error.into());
        }
    }
}

#[cfg(target_os = "linux")]
fn wait_for_linux_pidfd(pidfd: &std::os::fd::OwnedFd, timeout: Duration) -> AppResult<()> {
    use std::os::fd::AsRawFd;
    let milliseconds = i32::try_from(timeout.as_millis()).unwrap_or(i32::MAX);
    let mut descriptor = libc::pollfd {
        fd: pidfd.as_raw_fd(),
        events: libc::POLLIN,
        revents: 0,
    };
    loop {
        let result = unsafe { libc::poll(&mut descriptor, 1, milliseconds) };
        if result > 0 {
            return Ok(());
        }
        if result == 0 {
            return Err(AppError::new(
                "update-rollback-process-timeout",
                "Timed out stopping the unhealthy updated application process tree",
            ));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::Interrupted {
            return Err(error.into());
        }
    }
}

#[cfg(target_os = "linux")]
fn snapshot_linux_process_links() -> AppResult<Vec<ProcessLink>> {
    let mut links = Vec::new();
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        match linux_process_parent_pid(pid) {
            Ok(parent_pid) => links.push(ProcessLink { pid, parent_pid }),
            Err(error) if matches!(error.code.as_str(), "not-found" | "io-error") => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(links)
}

#[cfg(target_os = "linux")]
fn linux_process_parent_pid(pid: u32) -> AppResult<u32> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let fields = stat
        .rsplit_once(')')
        .ok_or_else(|| AppError::new("invalid-data", "Malformed Linux process metadata"))?
        .1
        .split_whitespace()
        .collect::<Vec<_>>();
    fields
        .get(1)
        .ok_or_else(|| AppError::new("invalid-data", "Linux parent process is unavailable"))?
        .parse::<u32>()
        .map_err(|_| AppError::new("invalid-data", "Linux parent process is malformed"))
}

#[cfg(target_os = "linux")]
fn pidfd_send_signal(pidfd: i32, signal: i32) -> AppResult<()> {
    let result = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            pidfd,
            signal,
            std::ptr::null::<libc::siginfo_t>(),
            0_u32,
        )
    };
    if result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error().into())
    }
}

#[cfg(target_os = "macos")]
fn terminate_process_tree_if_same(expected: &ProcessIdentity) -> AppResult<()> {
    terminate_macos_process_tree(expected)
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn terminate_process_tree_if_same(_expected: &ProcessIdentity) -> AppResult<()> {
    Err(AppError::unsupported("stable process-tree termination"))
}

#[cfg(target_os = "linux")]
fn query_process_identity(pid: u32) -> AppResult<ProcessIdentity> {
    if !valid_process_id(pid) {
        return Err(AppError::new("invalid-data", "Invalid Linux process ID"));
    }
    let process_root = PathBuf::from(format!("/proc/{pid}"));
    let executable_path = fs::canonicalize(process_root.join("exe"))?;
    let stat = fs::read_to_string(process_root.join("stat"))?;
    let fields = stat
        .rsplit_once(')')
        .ok_or_else(|| AppError::new("invalid-data", "Malformed Linux process metadata"))?
        .1
        .split_whitespace()
        .collect::<Vec<_>>();
    let started = fields
        .get(19)
        .ok_or_else(|| AppError::new("invalid-data", "Linux process start time is unavailable"))?;
    if !started.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AppError::new(
            "invalid-data",
            "Linux process start time is malformed",
        ));
    }
    let boot_id = fs::read_to_string("/proc/sys/kernel/random/boot_id")?;
    let boot_id = validate_linux_boot_id(boot_id.trim())?;
    Ok(ProcessIdentity {
        pid,
        executable_path,
        started_marker: format!("linux-boot:{boot_id}:ticks:{started}"),
    })
}

#[cfg(any(target_os = "linux", test))]
fn validate_linux_boot_id(value: &str) -> AppResult<&str> {
    let valid = value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        });
    if valid {
        Ok(value)
    } else {
        Err(AppError::new(
            "invalid-data",
            "Linux boot identity is malformed",
        ))
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct MacosProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    command: [u8; 16],
    name: [u8; 32],
    files: u32,
    process_group: u32,
    job_control: u32,
    controlling_device: u32,
    terminal_process_group: u32,
    nice: i32,
    start_seconds: u64,
    start_microseconds: u64,
}

#[cfg(target_os = "macos")]
#[link(name = "proc")]
extern "C" {
    fn proc_pidpath(pid: i32, buffer: *mut std::ffi::c_void, size: u32) -> i32;
    fn proc_pidinfo(
        pid: i32,
        flavor: i32,
        argument: u64,
        buffer: *mut std::ffi::c_void,
        size: i32,
    ) -> i32;
    fn proc_listchildpids(pid: i32, buffer: *mut std::ffi::c_void, size: i32) -> i32;
}

#[cfg(target_os = "macos")]
fn query_process_identity(pid: u32) -> AppResult<ProcessIdentity> {
    macos_process_record(pid).map(|(identity, _)| identity)
}

#[cfg(target_os = "macos")]
fn macos_process_record(pid: u32) -> AppResult<(ProcessIdentity, u32)> {
    use std::os::unix::ffi::OsStringExt;
    const PROC_PIDTBSDINFO: i32 = 3;
    let pid_i32 = i32::try_from(pid)
        .map_err(|_| AppError::new("invalid-data", "Invalid macOS process ID"))?;
    if pid_i32 <= 0 {
        return Err(AppError::new("invalid-data", "Invalid macOS process ID"));
    }
    let mut path = vec![0_u8; 4096];
    let path_length = unsafe {
        proc_pidpath(
            pid_i32,
            path.as_mut_ptr().cast(),
            u32::try_from(path.len()).unwrap_or(u32::MAX),
        )
    };
    if path_length <= 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    path.truncate(path_length as usize);
    let executable_path = fs::canonicalize(PathBuf::from(OsString::from_vec(path)))?;
    let mut info: MacosProcBsdInfo = unsafe { std::mem::zeroed() };
    let info_size = i32::try_from(std::mem::size_of::<MacosProcBsdInfo>())
        .map_err(|_| AppError::internal("macOS process metadata size overflow"))?;
    let read = unsafe {
        proc_pidinfo(
            pid_i32,
            PROC_PIDTBSDINFO,
            0,
            (&mut info as *mut MacosProcBsdInfo).cast(),
            info_size,
        )
    };
    if read < info_size || info.pid != pid {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok((
        ProcessIdentity {
            pid,
            executable_path,
            started_marker: format!(
                "macos-timeval:{}:{}",
                info.start_seconds, info.start_microseconds
            ),
        },
        info.ppid,
    ))
}

#[cfg(target_os = "macos")]
struct MacosTreeProcess {
    identity: ProcessIdentity,
    depth: usize,
    suspended: bool,
    terminated: bool,
}

#[cfg(target_os = "macos")]
impl Drop for MacosTreeProcess {
    fn drop(&mut self) {
        if self.suspended && !self.terminated && is_same_process(&self.identity) {
            if let Ok(pid) = libc::pid_t::try_from(self.identity.pid) {
                unsafe {
                    libc::kill(pid, libc::SIGCONT);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn terminate_macos_process_tree(expected: &ProcessIdentity) -> AppResult<()> {
    if !valid_process_id(expected.pid) || !is_same_process(expected) {
        return Ok(());
    }
    let mut root = MacosTreeProcess {
        identity: expected.clone(),
        depth: 0,
        suspended: false,
        terminated: false,
    };
    if !signal_macos_process_if_same(&root.identity, libc::SIGSTOP)? {
        return Ok(());
    }
    root.suspended = true;
    let mut processes = vec![root];
    let mut quiet_passes = 0_usize;
    for _ in 0..MAX_PROCESS_TREE_PASSES {
        let mut candidates = BTreeMap::<u32, (u32, usize)>::new();
        for process in &processes {
            if !process.suspended {
                continue;
            }
            for pid in macos_child_pids(process.identity.pid)? {
                candidates
                    .entry(pid)
                    .or_insert((process.identity.pid, process.depth.saturating_add(1)));
            }
        }
        let mut added = false;
        for (pid, (parent_pid, depth)) in candidates {
            if processes.iter().any(|process| process.identity.pid == pid) {
                continue;
            }
            let (identity, actual_parent_pid) = match macos_process_record(pid) {
                Ok(record) => record,
                Err(_) => continue,
            };
            if actual_parent_pid != parent_pid {
                continue;
            }
            let mut process = MacosTreeProcess {
                identity,
                depth,
                suspended: false,
                terminated: false,
            };
            if !signal_macos_process_if_same(&process.identity, libc::SIGSTOP)? {
                continue;
            }
            process.suspended = true;
            processes.push(process);
            added = true;
            if processes.len() >= MAX_PROCESS_TREE_PROCESSES {
                return Err(AppError::new(
                    "update-rollback-process-tree-limit",
                    "The unhealthy application process tree exceeds the rollback safety limit",
                ));
            }
        }
        if added {
            quiet_passes = 0;
        } else {
            quiet_passes += 1;
            if quiet_passes >= 2 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    if quiet_passes < 2 {
        return Err(AppError::new(
            "update-rollback-process-tree-unstable",
            "The unhealthy application process tree did not stabilize before rollback",
        ));
    }
    processes.sort_by_key(|process| std::cmp::Reverse(process.depth));
    for process in &mut processes {
        let _ = signal_macos_process_if_same(&process.identity, libc::SIGKILL)?;
        process.terminated = true;
        process.suspended = false;
    }
    for process in &processes {
        let started = Instant::now();
        while is_same_process(&process.identity) {
            if started.elapsed() >= Duration::from_secs(10) {
                return Err(AppError::new(
                    "update-rollback-process-timeout",
                    "Timed out stopping the unhealthy updated application process tree",
                ));
            }
            thread::sleep(Duration::from_millis(50));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_child_pids(parent_pid: u32) -> AppResult<Vec<u32>> {
    let parent_pid = i32::try_from(parent_pid)
        .map_err(|_| AppError::new("invalid-data", "Invalid macOS parent process ID"))?;
    let mut pids = vec![0_i32; MAX_PROCESS_TREE_PROCESSES];
    let buffer_size = i32::try_from(pids.len() * std::mem::size_of::<i32>())
        .map_err(|_| AppError::internal("macOS child process buffer size overflow"))?;
    let count = unsafe { proc_listchildpids(parent_pid, pids.as_mut_ptr().cast(), buffer_size) };
    if count < 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let count = usize::try_from(count)
        .map_err(|_| AppError::new("invalid-data", "macOS child process count overflow"))?;
    if count >= pids.len() {
        return Err(AppError::new(
            "update-rollback-process-tree-limit",
            "The unhealthy application has too many direct child processes",
        ));
    }
    pids.truncate(count);
    Ok(pids
        .into_iter()
        .filter_map(|pid| u32::try_from(pid).ok())
        .filter(|pid| valid_process_id(*pid))
        .collect())
}

#[cfg(target_os = "macos")]
fn signal_macos_process_if_same(expected: &ProcessIdentity, signal: i32) -> AppResult<bool> {
    if query_process_identity(expected.pid).as_ref().ok() != Some(expected)
        || query_process_identity(expected.pid).as_ref().ok() != Some(expected)
    {
        return Ok(false);
    }
    let pid = libc::pid_t::try_from(expected.pid)
        .map_err(|_| AppError::new("invalid-data", "Invalid macOS process identifier"))?;
    if unsafe { libc::kill(pid, signal) } != 0 {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(false)
        } else {
            Err(error.into())
        };
    }
    if signal != libc::SIGKILL
        && query_process_identity(expected.pid).as_ref().ok() != Some(expected)
    {
        return Ok(false);
    }
    Ok(true)
}

#[cfg(windows)]
type WindowsProcessHandle = *mut std::ffi::c_void;

#[cfg(windows)]
const WINDOWS_PROCESS_TERMINATE: u32 = 0x0001;
#[cfg(windows)]
const WINDOWS_PROCESS_SUSPEND_RESUME: u32 = 0x0800;
#[cfg(windows)]
const WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
#[cfg(windows)]
const WINDOWS_SYNCHRONIZE: u32 = 0x0010_0000;
#[cfg(windows)]
const WINDOWS_WAIT_OBJECT_0: u32 = 0;
#[cfg(windows)]
const WINDOWS_WAIT_TIMEOUT: u32 = 258;
#[cfg(windows)]
const WINDOWS_WAIT_FAILED: u32 = u32::MAX;

#[cfg(windows)]
#[repr(C)]
struct WindowsFileTime {
    low: u32,
    high: u32,
}

#[cfg(windows)]
#[repr(C)]
struct WindowsProcessBasicInformation {
    exit_status: i32,
    peb_base_address: *mut std::ffi::c_void,
    affinity_mask: usize,
    base_priority: i32,
    unique_process_id: usize,
    inherited_from_unique_process_id: usize,
}

#[cfg(windows)]
#[repr(C)]
struct WindowsProcessEntry32 {
    size: u32,
    usage: u32,
    process_id: u32,
    default_heap_id: usize,
    module_id: u32,
    thread_count: u32,
    parent_process_id: u32,
    base_priority: i32,
    flags: u32,
    executable_name: [u16; 260],
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn OpenProcess(access: u32, inherit: i32, process_id: u32) -> WindowsProcessHandle;
    fn QueryFullProcessImageNameW(
        process: WindowsProcessHandle,
        flags: u32,
        path: *mut u16,
        size: *mut u32,
    ) -> i32;
    fn GetProcessTimes(
        process: WindowsProcessHandle,
        creation: *mut WindowsFileTime,
        exit: *mut WindowsFileTime,
        kernel: *mut WindowsFileTime,
        user: *mut WindowsFileTime,
    ) -> i32;
    fn TerminateProcess(process: WindowsProcessHandle, exit_code: u32) -> i32;
    fn WaitForSingleObject(handle: WindowsProcessHandle, milliseconds: u32) -> u32;
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> WindowsProcessHandle;
    fn Process32FirstW(snapshot: WindowsProcessHandle, entry: *mut WindowsProcessEntry32) -> i32;
    fn Process32NextW(snapshot: WindowsProcessHandle, entry: *mut WindowsProcessEntry32) -> i32;
    fn CloseHandle(handle: WindowsProcessHandle) -> i32;
}

#[cfg(windows)]
#[link(name = "ntdll")]
extern "system" {
    fn NtQueryInformationProcess(
        process: WindowsProcessHandle,
        information_class: u32,
        information: *mut std::ffi::c_void,
        information_length: u32,
        return_length: *mut u32,
    ) -> i32;
    fn NtSuspendProcess(process: WindowsProcessHandle) -> i32;
    fn NtResumeProcess(process: WindowsProcessHandle) -> i32;
}

#[cfg(windows)]
fn windows_process_identity_from_handle(
    pid: u32,
    process: WindowsProcessHandle,
) -> AppResult<ProcessIdentity> {
    use std::os::windows::ffi::OsStringExt;
    let mut path = vec![0_u16; 32_768];
    let mut path_length = u32::try_from(path.len()).unwrap_or(u32::MAX);
    if unsafe { QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut path_length) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    path.truncate(path_length as usize);
    let executable_path = fs::canonicalize(PathBuf::from(OsString::from_wide(path.as_slice())))?;
    let creation_ticks = windows_process_creation_ticks(process)?;
    Ok(ProcessIdentity {
        pid,
        executable_path,
        started_marker: format!("windows-filetime:{creation_ticks:016x}"),
    })
}

#[cfg(windows)]
fn windows_process_creation_ticks(process: WindowsProcessHandle) -> AppResult<u64> {
    let mut creation: WindowsFileTime = unsafe { std::mem::zeroed() };
    let mut exit: WindowsFileTime = unsafe { std::mem::zeroed() };
    let mut kernel: WindowsFileTime = unsafe { std::mem::zeroed() };
    let mut user: WindowsFileTime = unsafe { std::mem::zeroed() };
    if unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok((u64::from(creation.high) << 32) | u64::from(creation.low))
}

#[cfg(windows)]
fn query_process_identity(pid: u32) -> AppResult<ProcessIdentity> {
    if !valid_process_id(pid) {
        return Err(AppError::new("invalid-data", "Invalid Windows process ID"));
    }
    let process = unsafe { OpenProcess(WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    let result = windows_process_identity_from_handle(pid, process);
    unsafe {
        CloseHandle(process);
    }
    result
}

#[cfg(windows)]
struct WindowsTreeProcess {
    identity: ProcessIdentity,
    handle: WindowsProcessHandle,
    parent_pid: u32,
    creation_ticks: u64,
    depth: usize,
    suspended: bool,
    terminated: bool,
}

#[cfg(windows)]
impl Drop for WindowsTreeProcess {
    fn drop(&mut self) {
        if self.suspended && !self.terminated {
            unsafe {
                NtResumeProcess(self.handle);
            }
        }
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(windows)]
fn terminate_process_tree_if_same(expected: &ProcessIdentity) -> AppResult<()> {
    if !valid_process_id(expected.pid) {
        return Err(AppError::new(
            "invalid-data",
            "Refusing to terminate an invalid Windows process identifier",
        ));
    }
    let Some(mut root) = open_windows_tree_process(expected.pid, 0)? else {
        return Ok(());
    };
    if root.identity != *expected {
        return Ok(());
    }
    if !suspend_windows_tree_process(&mut root)? {
        return Ok(());
    }
    let mut processes = vec![root];
    let mut quiet_passes = 0_usize;
    for _ in 0..MAX_PROCESS_TREE_PASSES {
        let links = snapshot_windows_process_links()?;
        let descendants = recursive_process_descendants(expected.pid, &links);
        if descendants.len() >= MAX_PROCESS_TREE_PROCESSES {
            return Err(AppError::new(
                "update-rollback-process-tree-limit",
                "The unhealthy application process tree exceeds the rollback safety limit",
            ));
        }
        let mut added = false;
        for descendant in descendants {
            if processes
                .iter()
                .any(|process| process.identity.pid == descendant.pid)
            {
                continue;
            }
            let Some(parent_started) = processes
                .iter()
                .find(|process| process.identity.pid == descendant.parent_pid && process.suspended)
                .map(|process| process.creation_ticks)
            else {
                continue;
            };
            let Some(mut process) = open_windows_tree_process(descendant.pid, descendant.depth)?
            else {
                continue;
            };
            if !process_tree_edge_is_possible(
                descendant.parent_pid,
                parent_started,
                process.parent_pid,
                process.creation_ticks,
            ) {
                continue;
            }
            if !suspend_windows_tree_process(&mut process)? {
                continue;
            }
            processes.push(process);
            added = true;
        }
        if added {
            quiet_passes = 0;
        } else {
            quiet_passes += 1;
            if quiet_passes >= 2 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
    if quiet_passes < 2 {
        return Err(AppError::new(
            "update-rollback-process-tree-unstable",
            "The unhealthy application process tree did not stabilize before rollback",
        ));
    }
    processes.sort_by_key(|process| std::cmp::Reverse(process.depth));
    for process in &mut processes {
        if windows_process_has_exited(process.handle)? {
            process.terminated = true;
            process.suspended = false;
            continue;
        }
        if windows_process_identity_from_handle(process.identity.pid, process.handle)?
            != process.identity
        {
            return Err(AppError::denied(
                "Windows process identity changed before rollback termination",
            ));
        }
        if unsafe { TerminateProcess(process.handle, 70) } == 0 {
            let terminate_error = std::io::Error::last_os_error();
            if !windows_process_has_exited(process.handle)? {
                return Err(terminate_error.into());
            }
        }
        process.terminated = true;
        process.suspended = false;
    }
    for process in &processes {
        wait_for_windows_process(process.handle, 10_000)?;
    }
    Ok(())
}

#[cfg(windows)]
fn open_windows_tree_process(pid: u32, depth: usize) -> AppResult<Option<WindowsTreeProcess>> {
    const ERROR_INVALID_PARAMETER: i32 = 87;
    let process = unsafe {
        OpenProcess(
            WINDOWS_PROCESS_TERMINATE
                | WINDOWS_PROCESS_SUSPEND_RESUME
                | WINDOWS_PROCESS_QUERY_LIMITED_INFORMATION
                | WINDOWS_SYNCHRONIZE,
            0,
            pid,
        )
    };
    if process.is_null() {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER) {
            Ok(None)
        } else {
            Err(error.into())
        };
    }
    let result = (|| -> AppResult<Option<WindowsTreeProcess>> {
        if windows_process_has_exited(process)? {
            return Ok(None);
        }
        let identity = match windows_process_identity_from_handle(pid, process) {
            Ok(identity) => identity,
            Err(_) if windows_process_has_exited(process)? => return Ok(None),
            Err(error) => return Err(error),
        };
        let parent_pid = windows_process_parent_pid(process)?;
        let creation_ticks = windows_process_creation_ticks(process)?;
        Ok(Some(WindowsTreeProcess {
            identity,
            handle: process,
            parent_pid,
            creation_ticks,
            depth,
            suspended: false,
            terminated: false,
        }))
    })();
    if !matches!(&result, Ok(Some(_))) {
        unsafe {
            CloseHandle(process);
        }
    }
    result
}

#[cfg(windows)]
fn suspend_windows_tree_process(process: &mut WindowsTreeProcess) -> AppResult<bool> {
    if windows_process_has_exited(process.handle)? {
        return Ok(false);
    }
    let status = unsafe { NtSuspendProcess(process.handle) };
    if status < 0 {
        if windows_process_has_exited(process.handle)? {
            return Ok(false);
        }
        return Err(AppError::new(
            "update-rollback-process-suspend-failed",
            format!("Cannot suspend rollback process (NTSTATUS 0x{status:08x})"),
        ));
    }
    process.suspended = true;
    if windows_process_has_exited(process.handle)? {
        process.suspended = false;
        return Ok(false);
    }
    if windows_process_identity_from_handle(process.identity.pid, process.handle)?
        != process.identity
    {
        return Err(AppError::denied(
            "Windows process identity changed while freezing the rollback process tree",
        ));
    }
    Ok(true)
}

#[cfg(windows)]
fn windows_process_parent_pid(process: WindowsProcessHandle) -> AppResult<u32> {
    let mut information: WindowsProcessBasicInformation = unsafe { std::mem::zeroed() };
    let information_length =
        u32::try_from(std::mem::size_of::<WindowsProcessBasicInformation>())
            .map_err(|_| AppError::internal("Windows process metadata size overflow"))?;
    let mut returned = 0_u32;
    let status = unsafe {
        NtQueryInformationProcess(
            process,
            0,
            (&mut information as *mut WindowsProcessBasicInformation).cast(),
            information_length,
            &mut returned,
        )
    };
    if status < 0 || returned < information_length {
        return Err(AppError::new(
            "update-rollback-process-query-failed",
            format!("Cannot query rollback process parent (NTSTATUS 0x{status:08x})"),
        ));
    }
    u32::try_from(information.inherited_from_unique_process_id)
        .map_err(|_| AppError::new("invalid-data", "Windows parent process ID overflow"))
}

#[cfg(windows)]
fn snapshot_windows_process_links() -> AppResult<Vec<ProcessLink>> {
    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const ERROR_NO_MORE_FILES: i32 = 18;
    let invalid_handle = -1_isize as WindowsProcessHandle;
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == invalid_handle {
        return Err(std::io::Error::last_os_error().into());
    }
    let result = (|| -> AppResult<Vec<ProcessLink>> {
        let mut entry: WindowsProcessEntry32 = unsafe { std::mem::zeroed() };
        entry.size = u32::try_from(std::mem::size_of::<WindowsProcessEntry32>())
            .map_err(|_| AppError::internal("Windows process snapshot entry size overflow"))?;
        if unsafe { Process32FirstW(snapshot, &mut entry) } == 0 {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_NO_MORE_FILES) {
                Ok(Vec::new())
            } else {
                Err(error.into())
            };
        }
        let mut links = Vec::new();
        loop {
            links.push(ProcessLink {
                pid: entry.process_id,
                parent_pid: entry.parent_process_id,
            });
            entry.size = u32::try_from(std::mem::size_of::<WindowsProcessEntry32>())
                .map_err(|_| AppError::internal("Windows process snapshot entry size overflow"))?;
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                let error = std::io::Error::last_os_error();
                if error.raw_os_error() == Some(ERROR_NO_MORE_FILES) {
                    break;
                }
                return Err(error.into());
            }
        }
        Ok(links)
    })();
    unsafe {
        CloseHandle(snapshot);
    }
    result
}

#[cfg(windows)]
fn windows_process_has_exited(process: WindowsProcessHandle) -> AppResult<bool> {
    match unsafe { WaitForSingleObject(process, 0) } {
        WINDOWS_WAIT_OBJECT_0 => Ok(true),
        WINDOWS_WAIT_TIMEOUT => Ok(false),
        WINDOWS_WAIT_FAILED => Err(std::io::Error::last_os_error().into()),
        status => Err(AppError::new(
            "update-rollback-process-wait-failed",
            format!("Unexpected Windows process wait status {status}"),
        )),
    }
}

#[cfg(windows)]
fn wait_for_windows_process(process: WindowsProcessHandle, timeout_ms: u32) -> AppResult<()> {
    match unsafe { WaitForSingleObject(process, timeout_ms) } {
        WINDOWS_WAIT_OBJECT_0 => Ok(()),
        WINDOWS_WAIT_TIMEOUT => Err(AppError::new(
            "update-rollback-process-timeout",
            "Timed out stopping the unhealthy updated application process tree",
        )),
        WINDOWS_WAIT_FAILED => Err(std::io::Error::last_os_error().into()),
        status => Err(AppError::new(
            "update-rollback-process-wait-failed",
            format!("Unexpected Windows process wait status {status}"),
        )),
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn query_process_identity(_pid: u32) -> AppResult<ProcessIdentity> {
    Err(AppError::unsupported("process identity verification"))
}

fn ensure_running_payload_matches(state: &HealthState) -> AppResult<()> {
    let current_exe = fs::canonicalize(std::env::current_exe()?)?;
    if state.guardian_kind == GuardianKind::AppImage {
        let expected_target = fs::canonicalize(&state.target_path)?;
        #[cfg(target_os = "linux")]
        {
            let appimage = std::env::var_os("APPIMAGE")
                .map(PathBuf::from)
                .ok_or_else(|| AppError::denied("Updated AppImage identity is unavailable"))?;
            if fs::canonicalize(appimage)? != expected_target {
                return Err(AppError::denied(
                    "The running AppImage does not match the update transaction",
                ));
            }
            let _ = current_exe;
            return Ok(());
        }
        #[cfg(not(target_os = "linux"))]
        {
            let _ = (current_exe, expected_target);
            return Err(AppError::denied(
                "AppImage update health state cannot run on this platform",
            ));
        }
    }
    let expected_launch = fs::canonicalize(&state.launch_path)?;
    if current_exe != expected_launch {
        return Err(AppError::denied(
            "The running executable does not match the update transaction payload",
        ));
    }
    if state.payload_kind == PayloadKind::File {
        if fs::canonicalize(&state.target_path)? != expected_launch {
            return Err(AppError::denied(
                "The running file payload does not match the rollback target",
            ));
        }
    } else if !expected_launch.starts_with(fs::canonicalize(&state.target_path)?) {
        return Err(AppError::denied(
            "The running application leaves the update transaction payload",
        ));
    }
    Ok(())
}

fn validate_token(token: &str) -> AppResult<()> {
    if token.len() == 32
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(AppError::invalid(
            "Update health token must be 32 lowercase hexadecimal characters",
        ))
    }
}

fn clean_terminal_transaction(paths: &HealthPaths) -> AppResult<()> {
    let state = match read_state(&paths.state) {
        Ok(state) => state,
        Err(error) if error.code == "not-found" => {
            clean_orphan_storage(paths)?;
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    if matches!(
        state.stage,
        HealthStage::Finalized | HealthStage::Aborted | HealthStage::RolledBack
    ) {
        let guardian_secret = read_guardian_secret(paths)?;
        verify_state_auth(&state, &guardian_secret)?;
        validate_storage_scope(&paths.state, &state)?;
        remove_path(&state.backup_path)?;
        remove_path(&state.guardian_path)?;
        remove_path(&paths.state)?;
        remove_path(&paths.secret)?;
    }
    Ok(())
}

fn clean_orphan_storage(paths: &HealthPaths) -> AppResult<()> {
    reject_platform_parent_reparse_points(&paths.root)?;
    for directory in [&paths.backups, &paths.guardians] {
        reject_storage_path_components(&paths.root, directory)?;
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.parent() != Some(directory.as_path()) {
                return Err(AppError::denied(
                    "Updater orphan cleanup escaped its storage directory",
                ));
            }
            remove_path(&path)?;
        }
    }
    reject_storage_path_components(&paths.root, &paths.secret)?;
    remove_path(&paths.secret)
}

fn schedule_guardian_cleanup(state_path: PathBuf, state: HealthState) {
    let transaction_id = state.transaction_id;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(2));
        let _ = cleanup_terminal_payloads(&state_path, &transaction_id);
    });
}

fn cleanup_terminal_payloads(state_path: &Path, transaction_id: &str) -> AppResult<bool> {
    let root = state_path
        .parent()
        .ok_or_else(|| AppError::invalid("Updater health state has no parent directory"))?;
    let paths = HealthPaths::new(fs::canonicalize(root)?);
    let _transaction_lock = lock_transaction(&paths)?;
    let state = read_state(state_path)?;
    let guardian_secret = read_guardian_secret(&paths)?;
    verify_state_auth(&state, &guardian_secret)?;
    validate_storage_scope(state_path, &state)?;
    if state.transaction_id != transaction_id
        || !matches!(
            state.stage,
            HealthStage::Finalized | HealthStage::RolledBack
        )
    {
        return Ok(false);
    }
    remove_path(&state.backup_path)?;
    remove_path(&state.guardian_path)?;
    Ok(true)
}

fn unix_time_ms() -> AppResult<u64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| AppError::internal(format!("System clock is before Unix epoch: {error}")))
}

fn validate_platform_metadata(metadata: Option<&PlatformRollbackMetadata>) -> AppResult<()> {
    match metadata {
        Some(PlatformRollbackMetadata::WindowsRegistry {
            key,
            display_version,
            ..
        }) if key == WINDOWS_UNINSTALL_KEY
            && !display_version.is_empty()
            && !display_version.contains('\0') =>
        {
            Ok(())
        }
        Some(_) => Err(AppError::denied(
            "Updater rollback metadata is outside the application registry scope",
        )),
        None => Ok(()),
    }
}

#[cfg(windows)]
fn capture_platform_metadata(
    expected_version: &str,
) -> AppResult<Option<PlatformRollbackMetadata>> {
    for hive in [RegistryHive::CurrentUser, RegistryHive::LocalMachine] {
        if let Some(display_version) = registry_read_display_version(&hive)? {
            if display_version != expected_version {
                return Err(AppError::new(
                    "update-rollback-metadata-mismatch",
                    format!(
                        "Installed registry version {display_version} does not match application version {expected_version}"
                    ),
                ));
            }
            // Writing the same value is a permission preflight. A guardian
            // cannot promise rollback for an elevated system-wide install.
            registry_write_display_version(&hive, &display_version)?;
            return Ok(Some(PlatformRollbackMetadata::WindowsRegistry {
                hive,
                key: WINDOWS_UNINSTALL_KEY.to_owned(),
                display_version,
            }));
        }
    }
    Err(AppError::new(
        "update-rollback-metadata-missing",
        "Cannot capture the Windows uninstall metadata required for rollback",
    ))
}

#[cfg(not(windows))]
fn capture_platform_metadata(
    _expected_version: &str,
) -> AppResult<Option<PlatformRollbackMetadata>> {
    Ok(None)
}

#[cfg(windows)]
fn restore_platform_metadata(metadata: Option<&PlatformRollbackMetadata>) -> AppResult<()> {
    let Some(PlatformRollbackMetadata::WindowsRegistry {
        hive,
        key,
        display_version,
    }) = metadata
    else {
        return Err(AppError::new(
            "update-rollback-metadata-missing",
            "Windows rollback state has no uninstall metadata",
        ));
    };
    if key != WINDOWS_UNINSTALL_KEY {
        return Err(AppError::denied(
            "Rollback refused an unexpected Windows uninstall key",
        ));
    }
    registry_write_display_version(hive, display_version)
}

#[cfg(not(windows))]
fn restore_platform_metadata(metadata: Option<&PlatformRollbackMetadata>) -> AppResult<()> {
    if metadata.is_some() {
        return Err(AppError::denied(
            "Rollback state contains metadata for another operating system",
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn registry_read_display_version(hive: &RegistryHive) -> AppResult<Option<String>> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    type Hkey = *mut std::ffi::c_void;
    const ERROR_SUCCESS: i32 = 0;
    const KEY_QUERY_VALUE: u32 = 0x0001;
    const REG_SZ: u32 = 1;
    #[link(name = "Advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            key: Hkey,
            sub_key: *const u16,
            options: u32,
            desired: u32,
            result: *mut Hkey,
        ) -> i32;
        fn RegQueryValueExW(
            key: Hkey,
            value_name: *const u16,
            reserved: *mut u32,
            value_type: *mut u32,
            data: *mut u8,
            data_size: *mut u32,
        ) -> i32;
        fn RegCloseKey(key: Hkey) -> i32;
    }

    let sub_key = OsStr::new(WINDOWS_UNINSTALL_KEY)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let value_name = OsStr::new("DisplayVersion")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut key = ptr::null_mut();
    let opened = unsafe {
        RegOpenKeyExW(
            registry_hive_handle(hive),
            sub_key.as_ptr(),
            0,
            KEY_QUERY_VALUE,
            &mut key,
        )
    };
    if opened != ERROR_SUCCESS {
        return Ok(None);
    }
    let result = (|| {
        let mut value_type = 0_u32;
        let mut byte_count = 0_u32;
        let queried = unsafe {
            RegQueryValueExW(
                key,
                value_name.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                ptr::null_mut(),
                &mut byte_count,
            )
        };
        if queried != ERROR_SUCCESS || value_type != REG_SZ || byte_count < 2 {
            return Ok(None);
        }
        let mut value = vec![0_u16; (byte_count as usize).div_ceil(2)];
        let queried = unsafe {
            RegQueryValueExW(
                key,
                value_name.as_ptr(),
                ptr::null_mut(),
                &mut value_type,
                value.as_mut_ptr().cast(),
                &mut byte_count,
            )
        };
        if queried != ERROR_SUCCESS || value_type != REG_SZ {
            return Err(AppError::new(
                "update-rollback-metadata-read-failed",
                format!("Cannot read Windows uninstall metadata (error {queried})"),
            ));
        }
        let length = value
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(value.len());
        String::from_utf16(&value[..length])
            .map(Some)
            .map_err(|error| AppError::new("invalid-data", error.to_string()))
    })();
    unsafe {
        RegCloseKey(key);
    }
    result
}

#[cfg(windows)]
fn registry_write_display_version(hive: &RegistryHive, display_version: &str) -> AppResult<()> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    type Hkey = *mut std::ffi::c_void;
    const ERROR_SUCCESS: i32 = 0;
    const KEY_SET_VALUE: u32 = 0x0002;
    const REG_SZ: u32 = 1;
    #[link(name = "Advapi32")]
    extern "system" {
        fn RegOpenKeyExW(
            key: Hkey,
            sub_key: *const u16,
            options: u32,
            desired: u32,
            result: *mut Hkey,
        ) -> i32;
        fn RegSetValueExW(
            key: Hkey,
            value_name: *const u16,
            reserved: u32,
            value_type: u32,
            data: *const u8,
            data_size: u32,
        ) -> i32;
        fn RegCloseKey(key: Hkey) -> i32;
    }

    let sub_key = OsStr::new(WINDOWS_UNINSTALL_KEY)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let value_name = OsStr::new("DisplayVersion")
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let value = OsStr::new(display_version)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut key = ptr::null_mut();
    let opened = unsafe {
        RegOpenKeyExW(
            registry_hive_handle(hive),
            sub_key.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if opened != ERROR_SUCCESS {
        return Err(AppError::new(
            "update-rollback-metadata-write-failed",
            format!("Cannot open Windows uninstall metadata (error {opened})"),
        ));
    }
    let written = unsafe {
        RegSetValueExW(
            key,
            value_name.as_ptr(),
            0,
            REG_SZ,
            value.as_ptr().cast(),
            (value.len() * std::mem::size_of::<u16>()) as u32,
        )
    };
    unsafe {
        RegCloseKey(key);
    }
    if written != ERROR_SUCCESS {
        return Err(AppError::new(
            "update-rollback-metadata-write-failed",
            format!("Cannot restore Windows uninstall metadata (error {written})"),
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn registry_hive_handle(hive: &RegistryHive) -> *mut std::ffi::c_void {
    let value = match hive {
        RegistryHive::CurrentUser => 0x8000_0001_usize,
        RegistryHive::LocalMachine => 0x8000_0002_usize,
    };
    value as *mut std::ffi::c_void
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET: &str = "1111111111111111111111111111111111111111111111111111111111111111";

    fn identity(root: &Path, pid: u32, marker: &str) -> ProcessIdentity {
        ProcessIdentity {
            pid,
            executable_path: root.join(format!("process-{pid}")),
            started_marker: marker.to_owned(),
        }
    }

    fn test_state(root: &Path, kind: PayloadKind) -> (HealthPaths, HealthState) {
        let initial_paths = HealthPaths::new(root.join("data/updater-health"));
        initial_paths.create().unwrap();
        let paths = HealthPaths::new(fs::canonicalize(&initial_paths.root).unwrap());
        let transaction_id = "0123456789abcdef0123456789abcdef".to_owned();
        let target = root.join("installed");
        let backup_path = paths.backups.join(&transaction_id).join("payload");
        let (launch_path, guardian_kind) = match kind {
            PayloadKind::File => (target.clone(), GuardianKind::AppImage),
            PayloadKind::Directory => (target.join("app.exe"), GuardianKind::StandaloneExecutable),
        };
        let guardian_path =
            expected_guardian_path(&paths.guardians, &transaction_id, &guardian_kind);
        let mut state = HealthState {
            schema_version: HEALTH_SCHEMA_VERSION,
            revision: 0,
            authentication_tag: String::new(),
            transaction_id,
            from_version: "2.0.0".to_owned(),
            to_version: "2.0.1".to_owned(),
            stage: HealthStage::AwaitingHealth,
            payload_kind: kind,
            target_path: target,
            backup_path,
            backup_digest_sha256:
                "2222222222222222222222222222222222222222222222222222222222222222".to_owned(),
            launch_path,
            guardian_kind,
            guardian_path: guardian_path.clone(),
            guardian_launch_path: guardian_path,
            guardian_digest_sha256:
                "3333333333333333333333333333333333333333333333333333333333333333".to_owned(),
            platform_metadata: None,
            relaunch_args: Vec::new(),
            created_at_unix_ms: 1,
            deadline_unix_ms: None,
            owner_process_identity: identity(root, 31, "owner-start"),
            guardian_pid: None,
            guardian_process_identity: None,
            startup_pid: None,
            startup_process_identity: None,
            startup_at_unix_ms: None,
            healthy_at_unix_ms: None,
            rolled_back_at_unix_ms: None,
            rollback_reason: None,
            error: None,
        };
        state.authentication_tag = state_authentication_tag(&state, TEST_SECRET).unwrap();
        (paths, state)
    }

    fn persist(paths: &HealthPaths, state: &HealthState) {
        write_guardian_secret(paths, TEST_SECRET).unwrap();
        write_initial_state(&paths.state, state, TEST_SECRET).unwrap();
    }

    fn make_started(state: &mut HealthState, process: ProcessIdentity, at: u64) {
        state.stage = HealthStage::Started;
        state.startup_pid = Some(process.pid);
        state.startup_process_identity = Some(process);
        state.startup_at_unix_ms = Some(at);
        state.deadline_unix_ms = Some(at + HEALTH_TIMEOUT.as_millis() as u64);
    }

    #[test]
    fn recursive_process_tree_rejects_cycles_duplicates_and_impossible_time_edges() {
        let descendants = recursive_process_descendants(
            10,
            &[
                ProcessLink {
                    pid: 20,
                    parent_pid: 10,
                },
                ProcessLink {
                    pid: 20,
                    parent_pid: 10,
                },
                ProcessLink {
                    pid: 30,
                    parent_pid: 20,
                },
                ProcessLink {
                    pid: 40,
                    parent_pid: 20,
                },
                ProcessLink {
                    pid: 10,
                    parent_pid: 30,
                },
                ProcessLink {
                    pid: 50,
                    parent_pid: 50,
                },
            ],
        );
        assert_eq!(
            descendants,
            vec![
                ProcessDescendant {
                    pid: 20,
                    parent_pid: 10,
                    depth: 1,
                },
                ProcessDescendant {
                    pid: 30,
                    parent_pid: 20,
                    depth: 2,
                },
                ProcessDescendant {
                    pid: 40,
                    parent_pid: 20,
                    depth: 2,
                },
            ]
        );
        assert!(process_tree_edge_is_possible(10, 100, 10, 101));
        assert!(!process_tree_edge_is_possible(10, 100, 99, 101));
        assert!(!process_tree_edge_is_possible(10, 100, 10, 100));
        assert!(!process_tree_edge_is_possible(10, 100, 10, 99));
    }

    #[cfg(windows)]
    const WINDOWS_TREE_FIXTURE_FILTER: &str = "wae_update_tree_fixture_entrypoint";
    #[cfg(windows)]
    const WINDOWS_TREE_ROLE_ENV: &str = "WAE_UPDATE_TREE_TEST_ROLE";
    #[cfg(windows)]
    const WINDOWS_TREE_CHILD_PID_ENV: &str = "WAE_UPDATE_TREE_CHILD_PID_FILE";
    #[cfg(windows)]
    const WINDOWS_TREE_GRANDCHILD_PID_ENV: &str = "WAE_UPDATE_TREE_GRANDCHILD_PID_FILE";

    #[cfg(windows)]
    fn spawn_windows_tree_fixture(role: &str) -> std::process::Child {
        let executable = std::env::current_exe().unwrap();
        let mut command = Command::new(executable);
        command
            .arg(WINDOWS_TREE_FIXTURE_FILTER)
            .arg("--nocapture")
            .env(WINDOWS_TREE_ROLE_ENV, role)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for variable in [WINDOWS_TREE_CHILD_PID_ENV, WINDOWS_TREE_GRANDCHILD_PID_ENV] {
            if let Some(value) = std::env::var_os(variable) {
                command.env(variable, value);
            }
        }
        command.spawn().unwrap()
    }

    #[cfg(windows)]
    fn wait_for_fixture_pid(path: &Path) -> u32 {
        let started = Instant::now();
        loop {
            if let Ok(value) = fs::read_to_string(path) {
                if let Ok(pid) = value.trim().parse::<u32>() {
                    if valid_process_id(pid) {
                        return pid;
                    }
                }
            }
            assert!(
                started.elapsed() < Duration::from_secs(15),
                "timed out waiting for fixture PID at {}",
                path.display()
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(windows)]
    fn wait_until_process_identity_exits(identity: &ProcessIdentity) {
        let started = Instant::now();
        while is_same_process(identity) {
            assert!(
                started.elapsed() < Duration::from_secs(15),
                "fixture process {} did not exit",
                identity.pid
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(windows)]
    #[test]
    fn wae_update_tree_fixture_entrypoint() {
        let Some(role) = std::env::var_os(WINDOWS_TREE_ROLE_ENV) else {
            return;
        };
        match role.to_string_lossy().as_ref() {
            "root" => {
                let mut child = spawn_windows_tree_fixture("child");
                let pid_file = PathBuf::from(
                    std::env::var_os(WINDOWS_TREE_CHILD_PID_ENV).expect("child PID file"),
                );
                fs::write(pid_file, child.id().to_string()).unwrap();
                loop {
                    if child.try_wait().unwrap().is_some() {
                        return;
                    }
                    thread::sleep(Duration::from_secs(1));
                }
            }
            "child" => {
                let mut child = spawn_windows_tree_fixture("grandchild");
                let pid_file = PathBuf::from(
                    std::env::var_os(WINDOWS_TREE_GRANDCHILD_PID_ENV).expect("grandchild PID file"),
                );
                fs::write(pid_file, child.id().to_string()).unwrap();
                loop {
                    if child.try_wait().unwrap().is_some() {
                        return;
                    }
                    thread::sleep(Duration::from_secs(1));
                }
            }
            "grandchild" => loop {
                thread::sleep(Duration::from_secs(1));
            },
            _ => panic!("unknown process tree fixture role"),
        }
    }

    #[cfg(windows)]
    #[test]
    fn windows_process_tree_termination_stops_real_descendants() {
        let root = tempfile::tempdir().unwrap();
        let child_pid_file = root.path().join("child.pid");
        let grandchild_pid_file = root.path().join("grandchild.pid");
        let mut process = Command::new(std::env::current_exe().unwrap())
            .arg(WINDOWS_TREE_FIXTURE_FILTER)
            .arg("--nocapture")
            .env(WINDOWS_TREE_ROLE_ENV, "root")
            .env(WINDOWS_TREE_CHILD_PID_ENV, &child_pid_file)
            .env(WINDOWS_TREE_GRANDCHILD_PID_ENV, &grandchild_pid_file)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let root_identity = wait_for_process_identity(process.id()).unwrap();
        let child_identity =
            wait_for_process_identity(wait_for_fixture_pid(&child_pid_file)).unwrap();
        let grandchild_identity =
            wait_for_process_identity(wait_for_fixture_pid(&grandchild_pid_file)).unwrap();

        let result = terminate_process_tree_if_same(&root_identity);
        if result.is_err() {
            let _ = terminate_process_tree_if_same(&child_identity);
            let _ = terminate_process_tree_if_same(&grandchild_identity);
            let _ = process.kill();
        }
        result.unwrap();
        wait_until_process_identity_exits(&root_identity);
        wait_until_process_identity_exits(&child_identity);
        wait_until_process_identity_exits(&grandchild_identity);
        assert!(process.try_wait().unwrap().is_some());
    }

    #[test]
    fn file_restore_preserves_backup_until_verification() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::File);
        fs::create_dir_all(state.backup_path.parent().unwrap()).unwrap();
        fs::write(&state.target_path, b"new-version").unwrap();
        fs::write(&state.backup_path, b"old-version").unwrap();
        state.backup_digest_sha256 = payload_digest(&state.backup_path).unwrap();

        restore_payload(&state).unwrap();

        assert_eq!(fs::read(&state.target_path).unwrap(), b"old-version");
        assert_eq!(fs::read(&state.backup_path).unwrap(), b"old-version");
    }

    #[test]
    fn directory_restore_replaces_all_files() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::Directory);
        fs::create_dir_all(state.target_path.join("resources")).unwrap();
        fs::write(&state.launch_path, b"new").unwrap();
        fs::write(state.target_path.join("resources/current"), b"new").unwrap();
        fs::create_dir_all(state.backup_path.join("resources")).unwrap();
        fs::write(state.backup_path.join("app.exe"), b"old").unwrap();
        fs::write(state.backup_path.join("resources/current"), b"old").unwrap();
        state.backup_digest_sha256 = payload_digest(&state.backup_path).unwrap();

        restore_payload(&state).unwrap();

        assert_eq!(fs::read(&state.launch_path).unwrap(), b"old");
        assert_eq!(
            fs::read(state.target_path.join("resources/current")).unwrap(),
            b"old"
        );
    }

    #[test]
    fn tampered_file_backup_is_rejected_before_target_changes() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::File);
        fs::create_dir_all(state.backup_path.parent().unwrap()).unwrap();
        fs::write(&state.target_path, b"new-version").unwrap();
        fs::write(&state.backup_path, b"old-version").unwrap();
        state.backup_digest_sha256 = payload_digest(&state.backup_path).unwrap();
        fs::write(&state.backup_path, b"forged-old").unwrap();

        assert_eq!(
            restore_payload(&state).unwrap_err().code,
            "permission-denied"
        );
        assert_eq!(fs::read(&state.target_path).unwrap(), b"new-version");
    }

    #[test]
    fn added_directory_entry_is_rejected_before_target_changes() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::Directory);
        fs::create_dir_all(&state.target_path).unwrap();
        fs::write(&state.launch_path, b"new-version").unwrap();
        fs::create_dir_all(&state.backup_path).unwrap();
        fs::write(state.backup_path.join("app.exe"), b"old-version").unwrap();
        state.backup_digest_sha256 = payload_digest(&state.backup_path).unwrap();
        fs::write(state.backup_path.join("injected.dll"), b"forged").unwrap();

        assert_eq!(
            restore_payload(&state).unwrap_err().code,
            "permission-denied"
        );
        assert_eq!(fs::read(&state.launch_path).unwrap(), b"new-version");
    }

    #[test]
    fn tampered_guardian_is_rejected_before_rearm() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::Directory);
        fs::write(&state.guardian_path, b"guardian-original").unwrap();
        state.guardian_digest_sha256 = payload_digest(&state.guardian_path).unwrap();
        fs::write(&state.guardian_path, b"guardian-tampered").unwrap();

        assert_eq!(
            verify_guardian_payload(&state).unwrap_err().code,
            "permission-denied"
        );
    }

    #[test]
    fn healthy_transaction_finalizes_without_touching_new_payload() {
        let root = tempfile::tempdir().unwrap();
        let (paths, mut state) = test_state(root.path(), PayloadKind::File);
        let startup = identity(root.path(), 41, "startup");
        make_started(&mut state, startup, 2);
        state.stage = HealthStage::Healthy;
        state.healthy_at_unix_ms = Some(3);
        state.authentication_tag = state_authentication_tag(&state, TEST_SECRET).unwrap();
        fs::create_dir_all(state.backup_path.parent().unwrap()).unwrap();
        fs::write(&state.target_path, b"new-version").unwrap();
        fs::write(&state.backup_path, b"old-version").unwrap();
        persist(&paths, &state);

        finalize_healthy(&paths.state, state, TEST_SECRET).unwrap();

        assert_eq!(
            fs::read(root.path().join("installed")).unwrap(),
            b"new-version"
        );
        assert_eq!(
            read_state(&paths.state).unwrap().stage,
            HealthStage::Finalized
        );
        assert!(!paths
            .backups
            .join("0123456789abcdef0123456789abcdef/payload")
            .exists());
    }

    #[test]
    fn health_confirmation_is_version_process_and_start_time_bound() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::File);
        let first = identity(root.path(), 41, "first-start");
        let reused_pid = identity(root.path(), 41, "reused-start");

        assert!(!transition_to_started(
            &mut state,
            "2.0.2",
            first.clone(),
            10,
            false
        ));
        assert!(transition_to_started(
            &mut state,
            "2.0.1",
            first.clone(),
            11,
            false
        ));
        assert!(!transition_to_healthy(&mut state, "2.0.1", &reused_pid, 12));
        assert!(transition_to_healthy(&mut state, "2.0.1", &first, 13));
    }

    #[test]
    fn reboot_rebind_resets_startup_identity_and_deadline() {
        let root = tempfile::tempdir().unwrap();
        let (_, mut state) = test_state(root.path(), PayloadKind::File);
        let before_reboot = identity(root.path(), 41, "old-boot");
        let after_reboot = identity(root.path(), 42, "new-boot");
        assert!(transition_to_started(
            &mut state,
            "2.0.1",
            before_reboot,
            10,
            false
        ));
        assert!(transition_to_started(
            &mut state,
            "2.0.1",
            after_reboot.clone(),
            30,
            true
        ));
        assert_eq!(state.startup_process_identity, Some(after_reboot));
        assert_eq!(state.startup_at_unix_ms, Some(30));
        assert_eq!(
            state.deadline_unix_ms,
            Some(30 + HEALTH_TIMEOUT.as_millis() as u64)
        );
    }

    #[test]
    fn state_mac_rejects_stage_revision_and_identity_tampering() {
        let root = tempfile::tempdir().unwrap();
        let (_, state) = test_state(root.path(), PayloadKind::File);

        let mut revision = state.clone();
        revision.revision += 1;
        assert_eq!(
            verify_state_auth(&revision, TEST_SECRET).unwrap_err().code,
            "permission-denied"
        );

        let mut stage = state.clone();
        make_started(&mut stage, identity(root.path(), 43, "startup"), 2);
        assert_eq!(
            verify_state_auth(&stage, TEST_SECRET).unwrap_err().code,
            "permission-denied"
        );

        let mut guardian = state.clone();
        guardian.guardian_pid = Some(44);
        guardian.guardian_process_identity = Some(identity(root.path(), 44, "guardian"));
        assert_eq!(
            verify_state_auth(&guardian, TEST_SECRET).unwrap_err().code,
            "permission-denied"
        );

        let mut owner = state;
        owner.owner_process_identity.started_marker = "forged".to_owned();
        assert_eq!(
            verify_state_auth(&owner, TEST_SECRET).unwrap_err().code,
            "permission-denied"
        );
    }

    #[test]
    fn stale_revision_cannot_overwrite_a_newer_transition() {
        let root = tempfile::tempdir().unwrap();
        let (paths, state) = test_state(root.path(), PayloadKind::File);
        persist(&paths, &state);
        let mut first = state.clone();
        let mut stale = state;
        first.error = Some("first writer".to_owned());
        commit_state(&paths.state, &mut first, TEST_SECRET).unwrap();
        stale.error = Some("stale writer".to_owned());

        assert_eq!(
            commit_state(&paths.state, &mut stale, TEST_SECRET)
                .unwrap_err()
                .code,
            "update-health-state-conflict"
        );
    }

    #[test]
    fn cleanup_never_deletes_a_healthy_but_unfinalized_guardian() {
        let root = tempfile::tempdir().unwrap();
        let (paths, mut state) = test_state(root.path(), PayloadKind::File);
        make_started(&mut state, identity(root.path(), 61, "startup"), 2);
        state.stage = HealthStage::Healthy;
        state.healthy_at_unix_ms = Some(3);
        fs::create_dir_all(state.backup_path.parent().unwrap()).unwrap();
        fs::write(&state.backup_path, b"backup").unwrap();
        fs::write(&state.guardian_path, b"guardian").unwrap();
        state.authentication_tag = state_authentication_tag(&state, TEST_SECRET).unwrap();
        persist(&paths, &state);

        assert!(!cleanup_terminal_payloads(&paths.state, &state.transaction_id).unwrap());
        assert!(state.backup_path.exists());
        assert!(state.guardian_path.exists());
    }

    #[test]
    fn rolling_back_stage_is_eligible_for_dead_guardian_rearm() {
        assert!(stage_needs_guardian(&HealthStage::RollingBack));
        assert!(!stage_needs_guardian(&HealthStage::RolledBack));
        assert!(!stage_needs_guardian(&HealthStage::RollbackFailed));
    }

    #[test]
    fn orphan_secret_and_payloads_are_recovered_without_state() {
        let root = tempfile::tempdir().unwrap();
        let paths = HealthPaths::new(root.path().to_path_buf());
        paths.create().unwrap();
        write_guardian_secret(&paths, TEST_SECRET).unwrap();
        let backup = paths.backups.join("orphan");
        let guardian = paths.guardians.join("orphan.exe");
        fs::create_dir(&backup).unwrap();
        fs::write(backup.join("payload"), b"old").unwrap();
        fs::write(&guardian, b"guardian").unwrap();

        clean_terminal_transaction(&paths).unwrap();

        assert!(!paths.secret.exists());
        assert_eq!(fs::read_dir(&paths.backups).unwrap().count(), 0);
        assert_eq!(fs::read_dir(&paths.guardians).unwrap().count(), 0);
    }

    #[test]
    fn relaunch_failure_remains_rolled_back_and_retains_backup() {
        let root = tempfile::tempdir().unwrap();
        let (paths, mut state) = test_state(root.path(), PayloadKind::File);
        state.stage = HealthStage::RolledBack;
        state.rollback_reason = Some("startup-health-failed".to_owned());
        state.rolled_back_at_unix_ms = Some(2);
        state.authentication_tag = state_authentication_tag(&state, TEST_SECRET).unwrap();
        fs::create_dir_all(state.backup_path.parent().unwrap()).unwrap();
        fs::write(&state.backup_path, b"old").unwrap();
        persist(&paths, &state);
        let error = AppError::new("update-rollback-relaunch-failed", "fixture");

        record_relaunch_failure(&paths.state, &mut state, TEST_SECRET, &error).unwrap();

        let stored = read_state(&paths.state).unwrap();
        assert_eq!(stored.stage, HealthStage::RolledBack);
        assert!(stored
            .error
            .as_deref()
            .is_some_and(|value| value.contains("fixture")));
        assert!(state.backup_path.exists());
    }

    #[test]
    fn platform_guardians_copy_complete_linux_and_macos_payloads() {
        let root = tempfile::tempdir().unwrap();
        let backup = root.path().join("backup-payload");
        let target = root.path().join("WPS Agent Editor.app");
        let launch = target.join("Contents/MacOS/wps-agent-editor");
        let linux = guardian_plan(
            GuardianPlatform::Linux,
            root.path(),
            "0123456789abcdef0123456789abcdef",
            &backup,
            &target,
            &launch,
            &launch,
        )
        .unwrap();
        assert_eq!(linux.source_path, backup);
        assert_eq!(linux.kind, GuardianKind::AppImage);

        let macos = guardian_plan(
            GuardianPlatform::Macos,
            root.path(),
            "0123456789abcdef0123456789abcdef",
            &backup,
            &target,
            &launch,
            &launch,
        )
        .unwrap();
        assert_eq!(macos.source_path, backup);
        assert_eq!(macos.kind, GuardianKind::MacAppBundle);
        assert!(macos
            .launch_path
            .ends_with("Contents/MacOS/wps-agent-editor"));
    }

    #[test]
    fn current_process_identity_rejects_pid_reuse_marker() {
        let current = current_process_identity().unwrap();
        assert!(is_same_process(&current));
        let mut reused = current;
        reused.started_marker.push_str("-different");
        assert!(!is_same_process(&reused));
    }

    #[test]
    fn linux_boot_identity_is_strict_and_part_of_process_identity() {
        let first_boot = validate_linux_boot_id("11111111-1111-1111-1111-111111111111").unwrap();
        let second_boot = validate_linux_boot_id("22222222-2222-2222-2222-222222222222").unwrap();
        assert!(validate_linux_boot_id("../not-a-boot-id").is_err());
        let root = tempfile::tempdir().unwrap();
        let first = identity(root.path(), 51, &format!("linux-boot:{first_boot}:ticks:7"));
        let second = identity(
            root.path(),
            51,
            &format!("linux-boot:{second_boot}:ticks:7"),
        );
        assert_ne!(first, second);
    }
}

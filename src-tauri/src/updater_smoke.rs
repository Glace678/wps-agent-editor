use crate::{
    error::AppError,
    files::atomic::write_atomic,
    update_health::{self, UpdateHealthTransaction, ROLLBACK_PREFIX},
};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ffi::OsString,
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};
use url::Url;

const SMOKE_FLAG: &str = "--wae-updater-smoke";
const REPORT_PREFIX: &str = "--wae-updater-report=";
const REPOSITORY_PREFIX: &str = "--wae-updater-repository=";
const TAG_PREFIX: &str = "--wae-updater-tag=";
const EXPECTED_PREFIX: &str = "--wae-updater-version=";
const HEALTH_FAILURE_FLAG: &str = "--wae-updater-health-failure";
const REPORT_DIRECTORY: &str = "wae-updater-smoke";

pub(crate) fn health_failure_injection_active() -> bool {
    std::env::args_os().any(|argument| argument == HEALTH_FAILURE_FLAG)
}

#[derive(Clone, Debug)]
pub(crate) struct SmokeSpec {
    report_path: PathBuf,
    expected_version: Version,
    current_version: Version,
    valid_endpoint: Url,
    tampered_endpoint: Url,
    invalid_install_endpoint: Url,
    inject_health_failure: bool,
    rollback_transaction_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeReport {
    schema_version: u32,
    from_version: String,
    to_version: String,
    platform_key: String,
    update_available: bool,
    signature_verified: bool,
    installed: bool,
    restarted: bool,
    tamper_rejected: bool,
    invalid_install_preserved: bool,
    startup_health_verified: bool,
    health_failure_injected: bool,
    rollback_verified: bool,
    previous_executable_sha256: Option<String>,
    invalid_install_executable_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rolled_back_executable_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unhealthy_executable_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    update_transaction_id: Option<String>,
    events: Vec<String>,
    tamper_error_code: Option<String>,
    stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

impl SmokeReport {
    fn new(spec: &SmokeSpec) -> Self {
        Self {
            schema_version: 2,
            from_version: spec.current_version.to_string(),
            to_version: spec.expected_version.to_string(),
            platform_key: platform_key().to_owned(),
            update_available: false,
            signature_verified: false,
            installed: false,
            restarted: false,
            tamper_rejected: false,
            invalid_install_preserved: false,
            startup_health_verified: false,
            health_failure_injected: spec.inject_health_failure,
            rollback_verified: false,
            previous_executable_sha256: None,
            invalid_install_executable_sha256: None,
            rolled_back_executable_sha256: None,
            unhealthy_executable_sha256: None,
            update_transaction_id: spec.rollback_transaction_id.clone(),
            events: Vec::new(),
            tamper_error_code: None,
            stage: "started".to_owned(),
            error_code: None,
            error_message: None,
        }
    }

    fn event(&mut self, event: &str) {
        if !self.events.iter().any(|candidate| candidate == event) {
            self.events.push(event.to_owned());
        }
    }
}

impl SmokeSpec {
    pub(crate) fn from_process() -> Result<Option<Self>, AppError> {
        let args = std::env::args_os().skip(1).collect::<Vec<_>>();
        if !args.iter().any(|argument| argument == SMOKE_FLAG) {
            return Ok(None);
        }

        let current_version = Version::parse(env!("CARGO_PKG_VERSION"))
            .map_err(|error| AppError::invalid(format!("Invalid package version: {error}")))?;
        let values = parse_values(&args)?;
        let health_failure_count = args
            .iter()
            .filter(|argument| *argument == HEALTH_FAILURE_FLAG)
            .count();
        if health_failure_count > 1 {
            return Err(AppError::invalid(
                "Updater health failure flag may occur at most once",
            ));
        }
        let expected_version = Version::parse(required_value(&values, EXPECTED_PREFIX)?)
            .map_err(|error| AppError::invalid(format!("Invalid expected version: {error}")))?;
        let tag = required_value(&values, TAG_PREFIX)?.to_owned();
        if tag != format!("v{expected_version}") {
            return Err(AppError::invalid(
                "Updater smoke tag must exactly match the expected version",
            ));
        }
        if current_version > expected_version {
            return Err(AppError::invalid(
                "Updater smoke cannot downgrade a newer installed version",
            ));
        }

        let repository = required_value(&values, REPOSITORY_PREFIX)?.to_owned();
        validate_repository(&repository)?;
        let report_path = validate_report_path(
            Path::new(required_value(&values, REPORT_PREFIX)?),
            &std::env::temp_dir().join(REPORT_DIRECTORY),
        )?;
        let base = format!("https://github.com/{repository}/releases/download/{tag}");
        let spec = Self {
            report_path,
            expected_version,
            current_version,
            valid_endpoint: Url::parse(&format!("{base}/latest.json"))?,
            tampered_endpoint: Url::parse(&format!("{base}/latest-tampered.json"))?,
            invalid_install_endpoint: Url::parse(&format!("{base}/latest-invalid-install.json"))?,
            inject_health_failure: health_failure_count == 1,
            rollback_transaction_id: values.get(ROLLBACK_PREFIX).cloned(),
        };

        let environment_armed = std::env::var("WAE_UPDATER_SMOKE").as_deref() == Ok("1");
        if !environment_armed {
            let report = read_report(&spec.report_path)?;
            let restart_is_armed = spec.current_version == spec.expected_version
                && report.to_version == spec.expected_version.to_string()
                && matches!(
                    report.stage.as_str(),
                    "installing" | "installed" | "awaiting-health"
                );
            let rollback_is_armed =
                spec.rollback_transaction_id
                    .as_deref()
                    .is_some_and(|transaction_id| {
                        spec.current_version < spec.expected_version
                            && report.stage == "awaiting-rollback"
                            && report.health_failure_injected
                            && report.update_transaction_id.as_deref() == Some(transaction_id)
                    });
            if !restart_is_armed && !rollback_is_armed {
                return Err(AppError::denied(
                    "Updater smoke mode requires the test environment gate",
                ));
            }
        }
        Ok(Some(spec))
    }
}

fn parse_values(arguments: &[OsString]) -> Result<HashMap<&'static str, String>, AppError> {
    let prefixes = [
        REPORT_PREFIX,
        REPOSITORY_PREFIX,
        TAG_PREFIX,
        EXPECTED_PREFIX,
        ROLLBACK_PREFIX,
    ];
    let mut values = HashMap::new();
    for argument in arguments {
        let Some(argument) = argument.to_str() else {
            return Err(AppError::invalid(
                "Updater smoke arguments must be valid UTF-8",
            ));
        };
        for prefix in prefixes {
            if let Some(value) = argument.strip_prefix(prefix) {
                if value.is_empty() || values.insert(prefix, value.to_owned()).is_some() {
                    return Err(AppError::invalid(format!(
                        "Updater smoke argument {prefix} must occur exactly once"
                    )));
                }
            }
        }
    }
    Ok(values)
}

fn required_value<'a>(
    values: &'a HashMap<&'static str, String>,
    prefix: &'static str,
) -> Result<&'a str, AppError> {
    values
        .get(prefix)
        .map(String::as_str)
        .ok_or_else(|| AppError::invalid(format!("Missing updater smoke argument {prefix}")))
}

fn validate_repository(repository: &str) -> Result<(), AppError> {
    let parts = repository.split('/').collect::<Vec<_>>();
    let valid_part = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    };
    if parts.len() != 2 || !parts.iter().copied().all(valid_part) {
        return Err(AppError::invalid(
            "Updater smoke repository must be a GitHub owner/name pair",
        ));
    }
    Ok(())
}

fn validate_report_path(path: &Path, root: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(root)?;
    let canonical_root = fs::canonicalize(root)?;
    if !path.is_absolute() {
        return Err(AppError::invalid(
            "Updater smoke report path must be absolute",
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::invalid("Updater smoke report name is invalid"))?;
    let token = file_name.strip_suffix(".json").unwrap_or("");
    if token.len() != 32
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::invalid(
            "Updater smoke report must use a 32-character lowercase hex token",
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("Updater smoke report path has no parent"))?;
    if fs::canonicalize(parent)? != canonical_root {
        return Err(AppError::denied(
            "Updater smoke report must stay inside the dedicated temporary directory",
        ));
    }
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(AppError::denied(
            "Updater smoke report cannot replace a symbolic link",
        ));
    }
    Ok(path.to_path_buf())
}

pub(crate) fn start(app: AppHandle, spec: SmokeSpec) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run(&app, &spec).await {
            let _ = write_failure(&spec, &error);
            app.exit(1);
        }
    });
}

async fn run(app: &AppHandle, spec: &SmokeSpec) -> Result<(), AppError> {
    if let Some(transaction_id) = spec.rollback_transaction_id.as_deref() {
        let mut report = read_report(&spec.report_path)?;
        let from_version = Version::parse(&report.from_version).map_err(|error| {
            AppError::new(
                "update-rollback-verification-failed",
                format!("Rollback report has an invalid source version: {error}"),
            )
        })?;
        update_health::verify_rollback(app, transaction_id, &from_version, &spec.expected_version)?;
        report.rollback_verified = true;
        report.rolled_back_executable_sha256 =
            Some(hex::encode(sha256_file(&executable_payload_path()?)?));
        report.stage = "complete".to_owned();
        report.event("startup-health-failed");
        report.event("rolled-back");
        report.event("rollback-restarted");
        write_report(&spec.report_path, &report)?;
        app.exit(0);
        return Ok(());
    }

    if spec.current_version == spec.expected_version {
        let mut report = read_report(&spec.report_path)?;
        if report.to_version != spec.expected_version.to_string()
            || !matches!(report.stage.as_str(), "installing" | "installed")
        {
            return Err(AppError::denied(
                "Updater restart report does not match the installed version",
            ));
        }
        report.installed = true;
        report.restarted = true;
        report.event("installed");
        report.event("restarted");
        if spec.inject_health_failure {
            report.health_failure_injected = true;
            report.unhealthy_executable_sha256 =
                Some(hex::encode(sha256_file(&executable_payload_path()?)?));
            report.stage = "awaiting-rollback".to_owned();
            report.event("startup-health-failed");
            write_report(&spec.report_path, &report)?;
            app.exit(72);
            return Ok(());
        }
        if !update_health::mark_startup_healthy(app)? {
            return Err(AppError::new(
                "update-health-confirmation-failed",
                "The restarted updater smoke could not confirm its health transaction",
            ));
        }
        report.startup_health_verified = true;
        report.stage = "complete".to_owned();
        report.event("startup-health-verified");
        write_report(&spec.report_path, &report)?;
        app.exit(0);
        return Ok(());
    }

    let mut report = SmokeReport::new(spec);
    write_report(&spec.report_path, &report)?;

    let tampered = checked_update(app, &spec.tampered_endpoint, &spec.expected_version).await?;
    match tampered.download(|_, _| {}, || {}).await {
        Err(error) if is_signature_error(&error) => {
            report.tamper_rejected = true;
            report.tamper_error_code = Some("update-signature-invalid".to_owned());
            report.event("tamper-rejected");
            write_report(&spec.report_path, &report)?;
        }
        Err(error) => {
            return Err(AppError::new(
                "update-tamper-test-failed",
                format!("Tampered updater failed for the wrong reason: {error}"),
            ));
        }
        Ok(_) => {
            return Err(AppError::new(
                "update-tamper-test-failed",
                "Tampered updater payload was accepted",
            ));
        }
    }

    let install_target = executable_payload_path()?;
    let before_invalid_install = sha256_file(&install_target)?;
    report.previous_executable_sha256 = Some(hex::encode(&before_invalid_install));
    let invalid_update =
        checked_update(app, &spec.invalid_install_endpoint, &spec.expected_version).await?;
    let invalid_payload = invalid_update.download(|_, _| {}, || {}).await?;
    match invalid_update.install(&invalid_payload) {
        Ok(()) => {
            return Err(AppError::new(
                "update-invalid-install-test-failed",
                "Invalid-install fixture was unexpectedly installed",
            ));
        }
        Err(error) if is_signature_error(&error) => {
            return Err(AppError::new(
                "update-invalid-install-test-failed",
                format!("Invalid-install fixture did not pass signature verification: {error}"),
            ));
        }
        Err(_) => {}
    }
    let after_invalid_install = sha256_file(&install_target)?;
    report.invalid_install_executable_sha256 = Some(hex::encode(&after_invalid_install));
    if before_invalid_install != after_invalid_install {
        return Err(AppError::new(
            "update-invalid-install-test-failed",
            "Rejected updater installation modified the original executable",
        ));
    }
    report.invalid_install_preserved = true;
    report.event("invalid-install-preserved");
    write_report(&spec.report_path, &report)?;

    let valid = checked_update(app, &spec.valid_endpoint, &spec.expected_version).await?;
    report.update_available = true;
    let payload = valid.download(|_, _| {}, || {}).await?;
    report.signature_verified = true;
    report.event("downloaded");
    report.event("signature-verified");
    let health = UpdateHealthTransaction::prepare(app, &spec.expected_version.to_string())?;
    report.update_transaction_id = Some(health.id().to_owned());
    report.stage = "installing".to_owned();
    write_report(&spec.report_path, &report)?;

    if let Err(error) = valid.install(&payload) {
        let error: AppError = error.into();
        let _ = health.abort(error.to_string());
        return Err(error);
    }
    report.installed = true;
    report.stage = "installed".to_owned();
    report.event("installed");
    write_report(&spec.report_path, &report)?;
    app.request_restart();
    Ok(())
}

async fn checked_update(
    app: &AppHandle,
    endpoint: &Url,
    expected_version: &Version,
) -> Result<tauri_plugin_updater::Update, AppError> {
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.clone()])?
        .build()?;
    let update = updater
        .check()
        .await?
        .ok_or_else(|| AppError::new("update-not-available", "No smoke update is available"))?;
    if update.version != expected_version.to_string() {
        return Err(AppError::new(
            "update-version-mismatch",
            format!(
                "Updater offered version {}, expected {expected_version}",
                update.version
            ),
        ));
    }
    Ok(update)
}

fn is_signature_error(error: &UpdaterError) -> bool {
    matches!(
        error,
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_)
    )
}

fn executable_payload_path() -> Result<PathBuf, AppError> {
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("APPIMAGE").map(PathBuf::from) {
        if path.is_file() {
            return Ok(path);
        }
    }
    std::env::current_exe().map_err(Into::into)
}

fn sha256_file(path: &Path) -> Result<Vec<u8>, AppError> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest.finalize().to_vec())
}

fn write_report(path: &Path, report: &SmokeReport) -> Result<(), AppError> {
    let mut data = serde_json::to_vec_pretty(report)?;
    data.push(b'\n');
    write_atomic(path, &data)
}

fn read_report(path: &Path) -> Result<SmokeReport, AppError> {
    serde_json::from_slice(&fs::read(path)?).map_err(Into::into)
}

fn write_failure(spec: &SmokeSpec, error: &AppError) -> Result<(), AppError> {
    let mut report = read_report(&spec.report_path).unwrap_or_else(|_| SmokeReport::new(spec));
    report.stage = "failed".to_owned();
    report.error_code = Some(error.code.clone());
    report.error_message = Some(error.message.clone());
    report.event("failed");
    write_report(&spec.report_path, &report)
}

#[cfg(all(target_os = "windows", target_arch = "x86"))]
fn platform_key() -> &'static str {
    "windows-i686"
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn platform_key() -> &'static str {
    "windows-x86_64"
}

#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
fn platform_key() -> &'static str {
    "windows-aarch64"
}

#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn platform_key() -> &'static str {
    "darwin-x86_64"
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn platform_key() -> &'static str {
    "darwin-aarch64"
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn platform_key() -> &'static str {
    "linux-x86_64"
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn platform_key() -> &'static str {
    "linux-aarch64"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_is_restricted_to_owner_and_name() {
        assert!(validate_repository("owner/project.name").is_ok());
        assert!(validate_repository("owner/project/extra").is_err());
        assert!(validate_repository("owner/../project").is_err());
        assert!(validate_repository("owner/project?raw=1").is_err());
    }

    #[test]
    fn report_path_must_be_a_hex_file_directly_below_root() {
        let root = tempfile::tempdir().unwrap();
        let valid = root.path().join("0123456789abcdef0123456789abcdef.json");
        assert_eq!(validate_report_path(&valid, root.path()).unwrap(), valid);

        let nested = root.path().join("nested");
        fs::create_dir(&nested).unwrap();
        assert!(validate_report_path(
            &nested.join("0123456789abcdef0123456789abcdef.json"),
            root.path()
        )
        .is_err());
        assert!(validate_report_path(&root.path().join("report.json"), root.path()).is_err());
    }
}

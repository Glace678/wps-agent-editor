#[cfg(windows)]
use crate::documents::presentation::{
    extract_legacy_presentation_metafiles, replace_legacy_presentation_metafiles,
    validate_rasterized_png,
};
use crate::{
    documents::word,
    error::{AppError, AppResult},
    process::dependencies::resolve_executable,
};
use serde::Serialize;
use serde_json::{json, Value};
#[cfg(windows)]
use std::{
    collections::{BTreeMap, VecDeque},
    ffi::OsStr,
};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    task::JoinHandle,
    time::Instant,
};

const MAX_DOCUMENT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES: usize = 64 * 1024;
const CONVERSION_TIMEOUT: Duration = Duration::from_secs(90);
const OUTPUT_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(windows)]
const METAFILE_CONVERSION_TIMEOUT: Duration = Duration::from_secs(90);
#[cfg(windows)]
const MAX_RASTERIZED_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
#[cfg(windows)]
const MAX_RASTERIZED_IMAGE_DIMENSION: u32 = 4_096;
#[cfg(windows)]
const MAX_RASTERIZED_IMAGE_PIXELS: u64 = 16_777_216;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeConverterStatus {
    pub id: &'static str,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub capabilities: Vec<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "lowercase")]
pub enum PreparedOfficeConverter {
    Libreoffice,
    Word,
    Powerpoint,
    Wps,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DocumentKind {
    Word,
    Presentation,
    Spreadsheet,
}

impl DocumentKind {
    #[cfg(windows)]
    fn id(self) -> &'static str {
        match self {
            Self::Word => "word",
            Self::Presentation => "presentation",
            Self::Spreadsheet => "spreadsheet",
        }
    }

    fn capability(self) -> &'static str {
        match self {
            Self::Word => "word-convert",
            Self::Presentation => "presentation-convert",
            Self::Spreadsheet => "spreadsheet-convert",
        }
    }

    #[cfg(windows)]
    fn com_program_id(self, vendor: OfficeVendor) -> &'static str {
        match (vendor, self) {
            (OfficeVendor::Wps, Self::Word) => "KWps.Application",
            (OfficeVendor::Wps, Self::Presentation) => "KWPP.Application",
            (OfficeVendor::Wps, Self::Spreadsheet) => "KET.Application",
            (OfficeVendor::Microsoft, Self::Word) => "Word.Application",
            (OfficeVendor::Microsoft, Self::Presentation) => "PowerPoint.Application",
            (OfficeVendor::Microsoft, Self::Spreadsheet) => "Excel.Application",
        }
    }

    #[cfg(windows)]
    fn com_save_format(self) -> u32 {
        match self {
            Self::Word => 12,
            Self::Presentation => 24,
            Self::Spreadsheet => 51,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ConversionTarget {
    kind: DocumentKind,
    extension: &'static str,
    libreoffice_filter: &'static str,
}

const DOCX_TARGET: ConversionTarget = ConversionTarget {
    kind: DocumentKind::Word,
    extension: "docx",
    libreoffice_filter: "docx:Office Open XML Text",
};
const PPTX_TARGET: ConversionTarget = ConversionTarget {
    kind: DocumentKind::Presentation,
    extension: "pptx",
    libreoffice_filter: "pptx:Impress MS PowerPoint 2007 XML",
};
const XLSX_TARGET: ConversionTarget = ConversionTarget {
    kind: DocumentKind::Spreadsheet,
    extension: "xlsx",
    libreoffice_filter: "xlsx:Calc MS Excel 2007 XML",
};

#[derive(Debug, Clone)]
enum ConverterBackend {
    LibreOffice {
        executable: PathBuf,
    },
    #[cfg(windows)]
    WindowsCom {
        id: &'static str,
        powershell: PathBuf,
        program_id: &'static str,
        save_format: u32,
    },
    #[cfg(target_os = "macos")]
    MacPowerPoint {
        osascript: PathBuf,
    },
}

impl ConverterBackend {
    fn id(&self) -> &'static str {
        match self {
            Self::LibreOffice { .. } => "libreoffice",
            #[cfg(windows)]
            Self::WindowsCom { id, .. } => id,
            #[cfg(target_os = "macos")]
            Self::MacPowerPoint { .. } => "microsoft-powerpoint",
        }
    }

    fn wire_id(&self, kind: DocumentKind) -> Option<PreparedOfficeConverter> {
        wire_converter_id(self.id(), kind)
    }
}

/// Translate dependency/backend identifiers to the stable values exposed by
/// the renderer's `Prepared*Document` contracts. Dependency probe IDs remain
/// unchanged so callers can still distinguish installed Office products.
fn wire_converter_id(backend: &str, kind: DocumentKind) -> Option<PreparedOfficeConverter> {
    match backend {
        "libreoffice" => Some(PreparedOfficeConverter::Libreoffice),
        "wps-office" => Some(PreparedOfficeConverter::Wps),
        "microsoft-office" => match kind {
            DocumentKind::Word => Some(PreparedOfficeConverter::Word),
            DocumentKind::Presentation => Some(PreparedOfficeConverter::Powerpoint),
            // Spreadsheet preparation currently has no converter metadata.
            DocumentKind::Spreadsheet => None,
        },
        "microsoft-powerpoint" => Some(PreparedOfficeConverter::Powerpoint),
        _ => None,
    }
}

#[derive(Debug)]
struct ProcessResult {
    status: Option<ExitStatus>,
    stdout: CapturedOutput,
    stderr: CapturedOutput,
    timed_out: bool,
    output_limit_bytes: Option<u64>,
}

#[derive(Debug, Default)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

impl CapturedOutput {
    fn text(&self) -> String {
        let mut text = String::from_utf8_lossy(&self.bytes).trim().to_owned();
        if self.truncated {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str("[diagnostic output truncated]");
        }
        text
    }
}

/// Prepared Word bytes plus the compatibility metadata consumed by the
/// renderer. The byte-only wrapper below is retained for agent extraction.
#[derive(Debug)]
pub struct PreparedWord {
    pub data: Vec<u8>,
    pub converted_from_legacy: bool,
    pub converter: Option<PreparedOfficeConverter>,
    pub native_conversion_failed: bool,
    pub normalized_legacy_image_count: usize,
    pub normalized_table_count: usize,
    pub removed_underline_run_count: usize,
}

/// Prepared presentation bytes plus converter/normalization metadata.
#[derive(Debug)]
pub struct PreparedPresentation {
    pub data: Vec<u8>,
    pub converted_from_legacy: bool,
    pub converter: Option<PreparedOfficeConverter>,
    /// Historical wire name retained for compatibility; counts both WMF and
    /// EMF parts that were successfully replaced with PNG media.
    pub normalized_wmf_count: usize,
}

#[derive(Debug)]
struct ConvertedDocument {
    data: Vec<u8>,
    /// Stable renderer-facing converter identifier, not an internal
    /// dependency identifier such as `microsoft-office`.
    converter: Option<PreparedOfficeConverter>,
}

#[cfg(windows)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetafileManifestItem {
    package_path: String,
    source: PathBuf,
    target: PathBuf,
}

pub async fn prepare_word(path: &Path) -> AppResult<Vec<u8>> {
    Ok(prepare_word_with_metadata(path).await?.data)
}

pub async fn prepare_word_with_metadata(path: &Path) -> AppResult<PreparedWord> {
    match extension(path).as_str() {
        "docx" => {
            let normalized = normalize_word(read_limited(path, "input").await?).await?;
            Ok(PreparedWord {
                data: normalized.data,
                converted_from_legacy: false,
                converter: None,
                native_conversion_failed: false,
                normalized_legacy_image_count: normalized.normalized_legacy_image_count,
                normalized_table_count: normalized.normalized_table_count,
                removed_underline_run_count: normalized.removed_underline_run_count,
            })
        }
        "doc" | "odt" => {
            let converted = convert(path, DOCX_TARGET).await?;
            let converter = converted.converter.ok_or_else(|| {
                AppError::internal("Word converter backend has no renderer contract mapping")
            })?;
            let normalized = normalize_word(converted.data).await?;
            Ok(PreparedWord {
                data: normalized.data,
                converted_from_legacy: true,
                converter: Some(converter),
                // Conversion failures are surfaced as structured errors; this
                // path never silently hands raw legacy bytes to SuperDoc.
                native_conversion_failed: false,
                normalized_legacy_image_count: normalized.normalized_legacy_image_count,
                normalized_table_count: normalized.normalized_table_count,
                removed_underline_run_count: normalized.removed_underline_run_count,
            })
        }
        _ => Err(AppError::invalid("Expected a DOC, DOCX, or ODT document")),
    }
}

async fn normalize_word(data: Vec<u8>) -> AppResult<word::WordNormalization> {
    tokio::task::spawn_blocking(move || word::normalize_package(data))
        .await
        .map_err(|error| AppError::internal(format!("Word normalizer task failed: {error}")))?
}

pub async fn prepare_presentation(path: &Path) -> AppResult<Vec<u8>> {
    Ok(prepare_presentation_with_metadata(path).await?.data)
}

/// Keeps modern PPTX media untouched until slide dependency copying finishes.
/// The edit command normalizes the resulting package once, so its count covers
/// only media that actually reached the edited presentation.
pub(crate) async fn prepare_presentation_for_reuse(path: &Path) -> AppResult<Vec<u8>> {
    match extension(path).as_str() {
        "pptx" => read_limited(path, "input").await,
        "ppt" | "odp" => Ok(convert(path, PPTX_TARGET).await?.data),
        _ => Err(AppError::invalid(
            "Expected a PPT, PPTX, or ODP presentation",
        )),
    }
}

pub async fn prepare_presentation_with_metadata(path: &Path) -> AppResult<PreparedPresentation> {
    match extension(path).as_str() {
        "pptx" => {
            let (data, normalized_wmf_count) =
                normalize_presentation_media(read_limited(path, "input").await?).await?;
            Ok(PreparedPresentation {
                data,
                converted_from_legacy: false,
                converter: None,
                normalized_wmf_count,
            })
        }
        "ppt" | "odp" => {
            let converted = convert(path, PPTX_TARGET).await?;
            let converter = converted.converter.ok_or_else(|| {
                AppError::internal(
                    "Presentation converter backend has no renderer contract mapping",
                )
            })?;
            let (data, normalized_wmf_count) = normalize_presentation_media(converted.data).await?;
            Ok(PreparedPresentation {
                data,
                converted_from_legacy: true,
                converter: Some(converter),
                normalized_wmf_count,
            })
        }
        _ => Err(AppError::invalid(
            "Expected a PPT, PPTX, or ODP presentation",
        )),
    }
}

#[cfg(not(windows))]
pub(crate) async fn normalize_presentation_media(data: Vec<u8>) -> AppResult<(Vec<u8>, usize)> {
    // Re-saving a PPTX through an Office suite can discard unknown package
    // parts. Platforms without the Windows metafile decoder therefore retain
    // the original media instead of claiming a lossy normalization.
    Ok((data, 0))
}

#[cfg(windows)]
pub(crate) async fn normalize_presentation_media(data: Vec<u8>) -> AppResult<(Vec<u8>, usize)> {
    let (data, metafiles) = tokio::task::spawn_blocking(move || {
        let metafiles = extract_legacy_presentation_metafiles(&data)?;
        Ok::<_, AppError>((data, metafiles))
    })
    .await
    .map_err(|error| AppError::internal(format!("Presentation media scan failed: {error}")))??;
    if metafiles.is_empty() {
        return Ok((data, 0));
    }

    // PowerShell and System.Drawing are Windows components, not bundled
    // runtimes. Missing/disabled components are a safe compatibility fallback:
    // retain the source package and report zero successful conversions.
    let Some(powershell) = find_powershell() else {
        return Ok((data, 0));
    };
    let temp = tempfile::tempdir()?;
    let script_path = temp.path().join("rasterize-metafiles.ps1");
    let manifest_path = temp.path().join("manifest.json");
    let mut manifest = Vec::with_capacity(metafiles.len());
    for (index, metafile) in metafiles.iter().enumerate() {
        let extension = Path::new(&metafile.package_path)
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| value.eq_ignore_ascii_case("wmf") || value.eq_ignore_ascii_case("emf"))
            .unwrap_or("wmf");
        let source = temp.path().join(format!("source-{index}.{extension}"));
        let target = temp.path().join(format!("target-{index}.png"));
        tokio::fs::write(&source, &metafile.data).await?;
        manifest.push(MetafileManifestItem {
            package_path: metafile.package_path.clone(),
            source,
            target,
        });
    }
    tokio::fs::write(&script_path, WINDOWS_METAFILE_SCRIPT).await?;
    tokio::fs::write(&manifest_path, serde_json::to_vec(&manifest)?).await?;
    let args = vec![
        OsString::from("-NoLogo"),
        OsString::from("-NoProfile"),
        OsString::from("-NonInteractive"),
        OsString::from("-ExecutionPolicy"),
        OsString::from("Bypass"),
        OsString::from("-File"),
        script_path.into_os_string(),
        OsString::from("-Manifest"),
        manifest_path.into_os_string(),
        OsString::from("-MaxImageBytes"),
        OsString::from(MAX_RASTERIZED_IMAGE_BYTES.to_string()),
        OsString::from("-MaxTotalBytes"),
        OsString::from(MAX_DOCUMENT_BYTES.to_string()),
        OsString::from("-MaxDimension"),
        OsString::from(MAX_RASTERIZED_IMAGE_DIMENSION.to_string()),
        OsString::from("-MaxPixels"),
        OsString::from(MAX_RASTERIZED_IMAGE_PIXELS.to_string()),
    ];
    let process = match run_process(&powershell, &args, METAFILE_CONVERSION_TIMEOUT, None).await {
        Ok(process) => process,
        Err(_) => return Ok((data, 0)),
    };
    if process.timed_out || !process.status.is_some_and(|status| status.success()) {
        return Ok((data, 0));
    }

    let mut converted = BTreeMap::new();
    let mut total_bytes = 0_u64;
    for item in manifest {
        let Ok(metadata) = tokio::fs::metadata(&item.target).await else {
            continue;
        };
        if !metadata.is_file()
            || metadata.len() > MAX_RASTERIZED_IMAGE_BYTES
            || total_bytes.saturating_add(metadata.len()) > MAX_DOCUMENT_BYTES
        {
            continue;
        }
        let file = tokio::fs::File::open(&item.target).await?;
        let mut png = Vec::with_capacity(metadata.len() as usize);
        file.take(MAX_RASTERIZED_IMAGE_BYTES + 1)
            .read_to_end(&mut png)
            .await?;
        if png.len() as u64 > MAX_RASTERIZED_IMAGE_BYTES
            || validate_rasterized_png(&item.package_path, &png).is_err()
        {
            continue;
        }
        total_bytes = total_bytes.saturating_add(png.len() as u64);
        converted.insert(item.package_path, png);
    }
    if converted.is_empty() {
        return Ok((data, 0));
    }

    tokio::task::spawn_blocking(move || replace_legacy_presentation_metafiles(&data, &converted))
        .await
        .map_err(|error| {
            AppError::internal(format!("Presentation media rewrite failed: {error}"))
        })?
}

/// Converts legacy/ODF workbooks to XLSX while preserving modern XLSX bytes unchanged.
/// CSV stays on the renderer's text path and is intentionally not transcoded here.
pub async fn prepare_spreadsheet(path: &Path) -> AppResult<Vec<u8>> {
    match extension(path).as_str() {
        "xlsx" => read_limited(path, "input").await,
        "xls" | "ods" => Ok(convert(path, XLSX_TARGET).await?.data),
        _ => Err(AppError::invalid("Expected an XLS, XLSX, or ODS workbook")),
    }
}

/// Reports only converters that can be used non-interactively by this module.
pub async fn probe_office_converters() -> Vec<OfficeConverterStatus> {
    let mut statuses = Vec::new();
    let libreoffice = find_libreoffice();
    let libreoffice_version = match libreoffice.as_deref() {
        Some(path) => command_version(path, &[OsString::from("--version")]).await,
        None => None,
    };
    statuses.push(OfficeConverterStatus {
        id: "libreoffice",
        available: libreoffice.is_some(),
        path: libreoffice.as_deref().map(path_string),
        version: libreoffice_version,
        capabilities: vec![
            DocumentKind::Word.capability(),
            DocumentKind::Presentation.capability(),
            DocumentKind::Spreadsheet.capability(),
        ],
    });

    #[cfg(windows)]
    {
        let powershell = find_powershell();
        for vendor in [OfficeVendor::Wps, OfficeVendor::Microsoft] {
            let components = office_component_paths(vendor);
            let primary_path = components.iter().flatten().next().cloned();
            let version = match (&powershell, primary_path.as_deref()) {
                (Some(shell), Some(path)) => file_product_version(shell, path).await,
                _ => None,
            };
            let capabilities = [
                DocumentKind::Word,
                DocumentKind::Presentation,
                DocumentKind::Spreadsheet,
            ]
            .into_iter()
            .zip(components.iter())
            .filter_map(|(kind, path)| path.as_ref().map(|_| kind.capability()))
            .collect::<Vec<_>>();
            statuses.push(OfficeConverterStatus {
                id: vendor.id(),
                available: powershell.is_some() && !capabilities.is_empty(),
                path: primary_path.as_deref().map(path_string),
                version,
                capabilities,
            });
        }

        let system_drawing_version = match powershell.as_deref() {
            Some(shell) => {
                command_version(
                    shell,
                    &[
                        OsString::from("-NoLogo"),
                        OsString::from("-NoProfile"),
                        OsString::from("-NonInteractive"),
                        OsString::from("-Command"),
                        OsString::from(
                            "Add-Type -AssemblyName System.Drawing; [System.Drawing.Image].Assembly.GetName().Version.ToString()",
                        ),
                    ],
                )
                .await
            }
            None => None,
        };
        statuses.push(OfficeConverterStatus {
            id: "windows-system-drawing",
            available: system_drawing_version.is_some(),
            path: powershell.as_deref().map(path_string),
            version: system_drawing_version,
            capabilities: vec!["presentation-metafile-normalize"],
        });
    }

    #[cfg(target_os = "macos")]
    {
        let app = mac_powerpoint_app();
        let version = match app.as_deref() {
            Some(path) => mac_app_version(path).await,
            None => None,
        };
        statuses.push(OfficeConverterStatus {
            id: "microsoft-powerpoint",
            available: app.is_some() && mac_osascript().is_some(),
            path: app.as_deref().map(path_string),
            version,
            capabilities: app
                .is_some()
                .then(|| DocumentKind::Presentation.capability())
                .into_iter()
                .collect(),
        });
    }

    statuses
}

async fn convert(source: &Path, target: ConversionTarget) -> AppResult<ConvertedDocument> {
    validate_source(source).await?;
    let source_extension = extension(source);
    let backends = discover_backends(target.kind);
    if backends.is_empty() {
        return Err(dependency_missing_error(&source_extension, target));
    }

    let deadline = Instant::now() + CONVERSION_TIMEOUT;
    let mut attempts = Vec::new();
    for backend in backends {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            attempts.push(json!({
                "backend": backend.id(),
                "code": "timeout",
                "message": "The total conversion time limit was exhausted",
            }));
            break;
        }
        match convert_with_backend(source, target, &backend, remaining).await {
            Ok(data) => {
                return Ok(ConvertedDocument {
                    data,
                    converter: backend.wire_id(target.kind),
                })
            }
            Err(error) => attempts.push(error),
        }
    }

    let timed_out = attempts.iter().any(|attempt| attempt["code"] == "timeout");
    let output_too_large = attempts
        .iter()
        .any(|attempt| attempt["code"] == "file-too-large");
    let code = if timed_out {
        "timeout"
    } else if output_too_large {
        "file-too-large"
    } else {
        "conversion-failed"
    };
    Err(AppError::new(
        code,
        if timed_out {
            "Document conversion exceeded the 90 second processing limit"
        } else if output_too_large {
            "Converted document exceeds the 100 MiB processing limit"
        } else {
            "Every available Office converter failed"
        },
    )
    .with_details(json!({
        "sourceFormat": source_extension,
        "targetFormat": target.extension,
        "attempts": attempts,
        "timeLimitSeconds": CONVERSION_TIMEOUT.as_secs(),
        "outputLimitBytes": MAX_DOCUMENT_BYTES,
    })))
}

async fn convert_with_backend(
    source: &Path,
    target: ConversionTarget,
    backend: &ConverterBackend,
    timeout: Duration,
) -> Result<Vec<u8>, Value> {
    let temp = tempfile::tempdir()
        .map_err(|error| attempt_error(backend.id(), "io-error", &error.to_string(), None, None))?;
    let file_stem = source
        .file_stem()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            attempt_error(
                backend.id(),
                "invalid-argument",
                "Document path has no file name",
                None,
                None,
            )
        })?;
    let destination = temp.path().join(file_stem).with_extension(target.extension);

    let result = match backend {
        ConverterBackend::LibreOffice { executable } => {
            let profile = temp.path().join("profile");
            std::fs::create_dir_all(&profile).map_err(|error| {
                attempt_error(backend.id(), "io-error", &error.to_string(), None, None)
            })?;
            let profile_url = url::Url::from_directory_path(&profile).map_err(|_| {
                attempt_error(
                    backend.id(),
                    "invalid-path",
                    "Cannot build an isolated LibreOffice profile URL",
                    None,
                    None,
                )
            })?;
            let args = vec![
                OsString::from("--headless"),
                OsString::from("--nologo"),
                OsString::from("--nodefault"),
                OsString::from("--nofirststartwizard"),
                OsString::from(format!("-env:UserInstallation={profile_url}")),
                OsString::from("--convert-to"),
                OsString::from(target.libreoffice_filter),
                OsString::from("--outdir"),
                temp.path().as_os_str().to_owned(),
                source.as_os_str().to_owned(),
            ];
            run_process(executable, &args, timeout, Some(&destination))
                .await
                .map_err(|error| {
                    attempt_error(
                        backend.id(),
                        "conversion-start-failed",
                        &error.to_string(),
                        None,
                        None,
                    )
                })?
        }
        #[cfg(windows)]
        ConverterBackend::WindowsCom {
            powershell,
            program_id,
            save_format,
            ..
        } => {
            let script_path = temp.path().join("convert.ps1");
            tokio::fs::write(&script_path, WINDOWS_COM_SCRIPT)
                .await
                .map_err(|error| {
                    attempt_error(backend.id(), "io-error", &error.to_string(), None, None)
                })?;
            let args = vec![
                OsString::from("-NoLogo"),
                OsString::from("-NoProfile"),
                OsString::from("-NonInteractive"),
                OsString::from("-ExecutionPolicy"),
                OsString::from("Bypass"),
                OsString::from("-File"),
                script_path.into_os_string(),
                OsString::from("-Source"),
                source.as_os_str().to_owned(),
                OsString::from("-Destination"),
                destination.as_os_str().to_owned(),
                OsString::from("-ProgramId"),
                OsString::from(program_id),
                OsString::from("-Kind"),
                OsString::from(target.kind.id()),
                OsString::from("-SaveFormat"),
                OsString::from(save_format.to_string()),
            ];
            run_process(powershell, &args, timeout, Some(&destination))
                .await
                .map_err(|error| {
                    attempt_error(
                        backend.id(),
                        "conversion-start-failed",
                        &error.to_string(),
                        None,
                        None,
                    )
                })?
        }
        #[cfg(target_os = "macos")]
        ConverterBackend::MacPowerPoint { osascript } => {
            let args = vec![
                OsString::from("-e"),
                OsString::from(MAC_POWERPOINT_SCRIPT),
                source.as_os_str().to_owned(),
                destination.as_os_str().to_owned(),
            ];
            run_process(osascript, &args, timeout, Some(&destination))
                .await
                .map_err(|error| {
                    attempt_error(
                        backend.id(),
                        "conversion-start-failed",
                        &error.to_string(),
                        None,
                        None,
                    )
                })?
        }
    };

    if result.timed_out {
        return Err(attempt_error(
            backend.id(),
            "timeout",
            "Converter exceeded the remaining time limit",
            Some(&result),
            None,
        ));
    }
    if let Some(actual_bytes) = result.output_limit_bytes {
        let mut error = attempt_error(
            backend.id(),
            "file-too-large",
            "Converter output exceeded the 100 MiB processing limit",
            Some(&result),
            None,
        );
        error["actualBytes"] = Value::from(actual_bytes);
        error["limitBytes"] = Value::from(MAX_DOCUMENT_BYTES);
        return Err(error);
    }
    if !result.status.is_some_and(|status| status.success()) {
        return Err(attempt_error(
            backend.id(),
            "conversion-failed",
            "Converter exited unsuccessfully",
            Some(&result),
            result.status.and_then(|status| status.code()),
        ));
    }
    if !destination.is_file() {
        return Err(attempt_error(
            backend.id(),
            "conversion-failed",
            "Converter did not produce the expected output file",
            Some(&result),
            result.status.and_then(|status| status.code()),
        ));
    }

    let data = read_limited(&destination, "output")
        .await
        .map_err(|error| {
            attempt_error(
                backend.id(),
                &error.code,
                &error.message,
                Some(&result),
                result.status.and_then(|status| status.code()),
            )
        })?;
    if !looks_like_ooxml(&data) {
        return Err(attempt_error(
            backend.id(),
            "invalid-conversion-output",
            "Converted OOXML output is not a ZIP package",
            Some(&result),
            result.status.and_then(|status| status.code()),
        ));
    }
    Ok(data)
}

fn attempt_error(
    backend: &str,
    code: &str,
    message: &str,
    result: Option<&ProcessResult>,
    exit_code: Option<i32>,
) -> Value {
    let mut detail = json!({
        "backend": backend,
        "code": code,
        "message": message,
    });
    if let Some(result) = result {
        detail["stdout"] = Value::String(result.stdout.text());
        detail["stderr"] = Value::String(result.stderr.text());
    }
    if let Some(exit_code) = exit_code {
        detail["exitCode"] = Value::from(exit_code);
    }
    detail
}

fn dependency_missing_error(source_extension: &str, target: ConversionTarget) -> AppError {
    #[cfg(windows)]
    let platform_dependencies = &["wps-office", "microsoft-office"][..];
    #[cfg(target_os = "macos")]
    let platform_dependencies = if target.kind == DocumentKind::Presentation {
        &["microsoft-powerpoint"][..]
    } else {
        &[]
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    let platform_dependencies = &[][..];
    let dependencies = std::iter::once("libreoffice")
        .chain(platform_dependencies.iter().copied())
        .collect::<Vec<_>>();
    AppError::dependency_missing(
        "A supported Office application is required to convert this document format",
    )
    .with_details(json!({
        "dependency": "office-converter",
        "capability": target.kind.capability(),
        "sourceFormat": source_extension,
        "targetFormat": target.extension,
        "acceptedDependencies": dependencies,
        "timeLimitSeconds": CONVERSION_TIMEOUT.as_secs(),
        "inputLimitBytes": MAX_DOCUMENT_BYTES,
        "outputLimitBytes": MAX_DOCUMENT_BYTES,
    }))
}

fn discover_backends(_kind: DocumentKind) -> Vec<ConverterBackend> {
    let mut backends = Vec::new();
    if let Some(executable) = find_libreoffice() {
        backends.push(ConverterBackend::LibreOffice { executable });
    }

    #[cfg(windows)]
    if let Some(powershell) = find_powershell() {
        for vendor in [OfficeVendor::Wps, OfficeVendor::Microsoft] {
            if office_component_path(vendor, _kind).is_some() {
                backends.push(ConverterBackend::WindowsCom {
                    id: vendor.id(),
                    powershell: powershell.clone(),
                    program_id: _kind.com_program_id(vendor),
                    save_format: _kind.com_save_format(),
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    if _kind == DocumentKind::Presentation {
        if let Some(osascript) = mac_osascript().filter(|_| mac_powerpoint_app().is_some()) {
            backends.push(ConverterBackend::MacPowerPoint { osascript });
        }
    }

    backends
}

fn find_libreoffice() -> Option<PathBuf> {
    resolve_executable("soffice").or_else(|| resolve_executable("libreoffice"))
}

#[cfg(target_os = "macos")]
fn mac_osascript() -> Option<PathBuf> {
    let path = PathBuf::from("/usr/bin/osascript");
    path.is_file().then_some(path)
}

#[cfg(target_os = "macos")]
fn mac_powerpoint_app() -> Option<PathBuf> {
    let path = PathBuf::from("/Applications/Microsoft PowerPoint.app");
    path.is_dir().then_some(path)
}

#[cfg(target_os = "macos")]
async fn mac_app_version(path: &Path) -> Option<String> {
    let mdls = Path::new("/usr/bin/mdls");
    command_version(
        mdls,
        &[
            OsString::from("-name"),
            OsString::from("kMDItemVersion"),
            OsString::from("-raw"),
            path.as_os_str().to_owned(),
        ],
    )
    .await
}

#[cfg(windows)]
fn find_powershell() -> Option<PathBuf> {
    resolve_executable("powershell.exe").or_else(|| resolve_executable("pwsh.exe"))
}

async fn validate_source(path: &Path) -> AppResult<()> {
    let metadata = tokio::fs::metadata(path).await?;
    if !metadata.is_file() {
        return Err(AppError::invalid("Document source must be a regular file"));
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(file_too_large_error("input", metadata.len()));
    }
    Ok(())
}

async fn read_limited(path: &Path, stage: &str) -> AppResult<Vec<u8>> {
    let metadata = tokio::fs::metadata(path).await?;
    if !metadata.is_file() {
        return Err(AppError::invalid(
            "Document path must point to a regular file",
        ));
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(file_too_large_error(stage, metadata.len()));
    }

    let file = tokio::fs::File::open(path).await?;
    let mut data = Vec::with_capacity(metadata.len().min(MAX_DOCUMENT_BYTES) as usize);
    file.take(MAX_DOCUMENT_BYTES + 1)
        .read_to_end(&mut data)
        .await?;
    if data.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(file_too_large_error(stage, data.len() as u64));
    }
    Ok(data)
}

fn file_too_large_error(stage: &str, actual_bytes: u64) -> AppError {
    AppError::new(
        "file-too-large",
        "Document exceeds the 100 MiB processing limit",
    )
    .with_details(json!({
        "stage": stage,
        "actualBytes": actual_bytes,
        "limitBytes": MAX_DOCUMENT_BYTES,
    }))
}

fn looks_like_ooxml(data: &[u8]) -> bool {
    data.starts_with(b"PK\x03\x04") || data.starts_with(b"PK\x05\x06")
}

async fn run_process(
    executable: &Path,
    args: &[OsString],
    timeout: Duration,
    output_path: Option<&Path>,
) -> std::io::Result<ProcessResult> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut command);
    let mut child = command.spawn()?;
    let pid = child.id();
    let stdout_task = child
        .stdout
        .take()
        .map(|stream| tokio::spawn(read_capped(stream)));
    let stderr_task = child
        .stderr
        .take()
        .map(|stream| tokio::spawn(read_capped(stream)));

    let deadline = tokio::time::sleep_until(Instant::now() + timeout);
    tokio::pin!(deadline);
    let mut output_monitor = tokio::time::interval(Duration::from_millis(200));
    output_monitor.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let (status, timed_out, output_limit_bytes) = loop {
        tokio::select! {
            status = child.wait() => break (Some(status?), false, None),
            _ = &mut deadline => break (None, true, None),
            _ = output_monitor.tick(), if output_path.is_some() => {
                if let Some(length) = output_path
                    .and_then(|path| std::fs::metadata(path).ok())
                    .map(|metadata| metadata.len())
                    .filter(|length| *length > MAX_DOCUMENT_BYTES)
                {
                    break (None, false, Some(length));
                }
            }
        }
    };
    if timed_out || output_limit_bytes.is_some() {
        terminate_process_tree(pid).await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    let stdout = join_capture(stdout_task).await;
    let stderr = join_capture(stderr_task).await;
    Ok(ProcessResult {
        status,
        stdout,
        stderr,
        timed_out,
        output_limit_bytes,
    })
}

async fn read_capped<R: AsyncRead + Unpin>(mut reader: R) -> CapturedOutput {
    let mut output = CapturedOutput::default();
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = MAX_DIAGNOSTIC_BYTES.saturating_sub(output.bytes.len());
                output
                    .bytes
                    .extend_from_slice(&buffer[..count.min(remaining)]);
                output.truncated |= count > remaining;
            }
        }
    }
    output
}

async fn join_capture(task: Option<JoinHandle<CapturedOutput>>) -> CapturedOutput {
    let Some(mut task) = task else {
        return CapturedOutput::default();
    };
    match tokio::time::timeout(OUTPUT_DRAIN_TIMEOUT, &mut task).await {
        Ok(Ok(output)) => output,
        Ok(Err(_)) => CapturedOutput::default(),
        Err(_) => {
            task.abort();
            CapturedOutput {
                bytes: Vec::new(),
                truncated: true,
            }
        }
    }
}

async fn command_version(executable: &Path, args: &[OsString]) -> Option<String> {
    let result = run_process(executable, args, Duration::from_secs(3), None)
        .await
        .ok()?;
    if result.timed_out || !result.status.is_some_and(|status| status.success()) {
        return None;
    }
    let text = if result.stdout.bytes.is_empty() {
        result.stderr.text()
    } else {
        result.stdout.text()
    };
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(240).collect())
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.as_std_mut().process_group(0);
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command
        .as_std_mut()
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
async fn terminate_process_tree(pid: Option<u32>) {
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
async fn terminate_process_tree(pid: Option<u32>) {
    if let Some(pid) = pid {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy)]
enum OfficeVendor {
    Wps,
    Microsoft,
}

#[cfg(windows)]
impl OfficeVendor {
    fn id(self) -> &'static str {
        match self {
            Self::Wps => "wps-office",
            Self::Microsoft => "microsoft-office",
        }
    }
}

#[cfg(windows)]
fn office_component_paths(vendor: OfficeVendor) -> [Option<PathBuf>; 3] {
    [
        office_component_path(vendor, DocumentKind::Word),
        office_component_path(vendor, DocumentKind::Presentation),
        office_component_path(vendor, DocumentKind::Spreadsheet),
    ]
}

#[cfg(windows)]
fn office_component_path(vendor: OfficeVendor, kind: DocumentKind) -> Option<PathBuf> {
    let executable = match (vendor, kind) {
        (OfficeVendor::Wps, DocumentKind::Word) => "wps.exe",
        (OfficeVendor::Wps, DocumentKind::Presentation) => "wpp.exe",
        (OfficeVendor::Wps, DocumentKind::Spreadsheet) => "et.exe",
        (OfficeVendor::Microsoft, DocumentKind::Word) => "WINWORD.EXE",
        (OfficeVendor::Microsoft, DocumentKind::Presentation) => "POWERPNT.EXE",
        (OfficeVendor::Microsoft, DocumentKind::Spreadsheet) => "EXCEL.EXE",
    };
    resolve_executable(executable).or_else(|| {
        office_search_roots(vendor)
            .into_iter()
            .find_map(|root| find_descendant(&root, OsStr::new(executable), 4, 512))
    })
}

#[cfg(windows)]
fn office_search_roots(vendor: OfficeVendor) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        let Some(root) = std::env::var_os(variable).map(PathBuf::from) else {
            continue;
        };
        roots.push(match vendor {
            OfficeVendor::Wps => root.join("Kingsoft").join("WPS Office"),
            OfficeVendor::Microsoft => root.join("Microsoft Office"),
        });
    }
    roots
}

#[cfg(windows)]
fn find_descendant(
    root: &Path,
    file_name: &OsStr,
    max_depth: usize,
    max_directories: usize,
) -> Option<PathBuf> {
    if !root.is_dir() {
        return None;
    }
    let mut queue = VecDeque::from([(root.to_path_buf(), 0_usize)]);
    let mut visited = 0_usize;
    while let Some((directory, depth)) = queue.pop_front() {
        if visited >= max_directories {
            break;
        }
        visited += 1;
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(&file_name.to_string_lossy())
                && path.is_file()
            {
                return Some(path);
            }
            if depth < max_depth && path.is_dir() {
                queue.push_back((path, depth + 1));
            }
        }
    }
    None
}

#[cfg(windows)]
async fn file_product_version(powershell: &Path, path: &Path) -> Option<String> {
    let escaped_path = path.to_string_lossy().replace('\'', "''");
    command_version(
        powershell,
        &[
            OsString::from("-NoLogo"),
            OsString::from("-NoProfile"),
            OsString::from("-NonInteractive"),
            OsString::from("-Command"),
            OsString::from(format!(
                "(Get-Item -LiteralPath '{escaped_path}').VersionInfo.ProductVersion"
            )),
        ],
    )
    .await
}

#[cfg(windows)]
const WINDOWS_METAFILE_SCRIPT: &str = r#"param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][long]$MaxImageBytes,
    [Parameter(Mandatory = $true)][long]$MaxTotalBytes,
    [Parameter(Mandatory = $true)][ValidateRange(1, 16384)][int]$MaxDimension,
    [Parameter(Mandatory = $true)][ValidateRange(1, 268435456)][long]$MaxPixels
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$items = @(Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json)
$totalBytes = 0L

foreach ($item in $items) {
    $image = $null
    $bitmap = $null
    $graphics = $null
    try {
        $image = [System.Drawing.Image]::FromFile([string]$item.source, $false)
        $sourceWidth = [double]$image.Width
        $sourceHeight = [double]$image.Height
        if ($sourceWidth -le 0 -or $sourceHeight -le 0) {
            throw 'Metafile has invalid dimensions'
        }
        $scale = [Math]::Min(1.0, [Math]::Min(
            ([double]$MaxDimension / $sourceWidth),
            ([double]$MaxDimension / $sourceHeight)
        ))
        $sourcePixels = $sourceWidth * $sourceHeight
        if ($sourcePixels -gt [double]$MaxPixels) {
            $scale = [Math]::Min($scale, [Math]::Sqrt(([double]$MaxPixels / $sourcePixels)))
        }
        $width = [Math]::Max(1, [int][Math]::Floor($sourceWidth * $scale))
        $height = [Math]::Max(1, [int][Math]::Floor($sourceHeight * $scale))
        $targetPixels = [long]$width * [long]$height
        if ($width -gt $MaxDimension -or $height -gt $MaxDimension -or $targetPixels -gt $MaxPixels) {
            throw 'Rasterized metafile dimensions exceed the configured limit'
        }
        $bitmap = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        if ($image.HorizontalResolution -gt 0 -and $image.VerticalResolution -gt 0) {
            try { $bitmap.SetResolution($image.HorizontalResolution, $image.VerticalResolution) } catch {}
        }
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $width, $height)
        $bitmap.Save([string]$item.target, [System.Drawing.Imaging.ImageFormat]::Png)
        $length = (Get-Item -LiteralPath ([string]$item.target)).Length
        if ($length -gt $MaxImageBytes -or ($totalBytes + $length) -gt $MaxTotalBytes) {
            Remove-Item -LiteralPath ([string]$item.target) -Force -ErrorAction SilentlyContinue
        } else {
            $totalBytes += $length
        }
    }
    catch {
        Remove-Item -LiteralPath ([string]$item.target) -Force -ErrorAction SilentlyContinue
    }
    finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        if ($null -ne $image) { $image.Dispose() }
    }
}
"#;

#[cfg(windows)]
const WINDOWS_COM_SCRIPT: &str = r#"param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$ProgramId,
    [Parameter(Mandatory = $true)][ValidateSet('word', 'presentation', 'spreadsheet')][string]$Kind,
    [Parameter(Mandatory = $true)][int]$SaveFormat
)
$ErrorActionPreference = 'Stop'
$application = $null
$document = $null
try {
    $application = New-Object -ComObject $ProgramId
    try { $application.Visible = $false } catch {}
    try { $application.DisplayAlerts = 0 } catch {}
    try { $application.AutomationSecurity = 3 } catch {}
    switch ($Kind) {
        'word' {
            $document = $application.Documents.Open($Source, $false, $true)
            try { $document.SaveAs($Destination, $SaveFormat) }
            catch { $document.SaveAs([ref]$Destination, [ref]$SaveFormat) }
        }
        'presentation' {
            $document = $application.Presentations.Open($Source, $true, $true, $false)
            $document.SaveAs($Destination, $SaveFormat)
        }
        'spreadsheet' {
            $document = $application.Workbooks.Open($Source, 0, $true)
            $document.SaveAs($Destination, $SaveFormat)
        }
    }
    if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        throw 'Office automation completed without producing an output file'
    }
}
finally {
    if ($null -ne $document) {
        try {
            if ($Kind -eq 'presentation') { $document.Close() }
            else { $document.Close($false) }
        } catch {}
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) } catch {}
    }
    if ($null -ne $application) {
        try { $application.Quit() } catch {}
        try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($application) } catch {}
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
"#;

#[cfg(target_os = "macos")]
const MAC_POWERPOINT_SCRIPT: &str = r#"on run argv
    set sourcePath to item 1 of argv
    set destinationPath to item 2 of argv
    tell application "Microsoft PowerPoint"
        set presentationDocument to open (POSIX file sourcePath)
        try
            save presentationDocument in (POSIX file destinationPath) as save as Open XML presentation
        on error errorMessage number errorNumber
            try
                close presentationDocument saving no
            end try
            error errorMessage number errorNumber
        end try
        close presentationDocument saving no
    end tell
end run"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    use std::io::Read as _;
    use std::io::{Cursor, Write as _};
    #[cfg(windows)]
    use zip::ZipArchive;
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn minimal_pptx_with_metafile(extension: &str, data: &[u8]) -> Vec<u8> {
        let media_path = format!("ppt/media/image1.{extension}");
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in [
            (
                "[Content_Types].xml".to_owned(),
                format!(
                    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"{extension}\" ContentType=\"image/x-{extension}\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/></Types>"
                )
                .into_bytes(),
            ),
            (
                "ppt/presentation.xml".to_owned(),
                b"<p:presentation xmlns:p=\"urn:p\"/>".to_vec(),
            ),
            (
                "ppt/_rels/presentation.xml.rels".to_owned(),
                b"<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"/>".to_vec(),
            ),
            (
                "ppt/slides/_rels/slide1.xml.rels".to_owned(),
                format!(
                    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image1.{extension}\"/></Relationships>"
                )
                .into_bytes(),
            ),
            (media_path, data.to_vec()),
        ] {
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[cfg(windows)]
    fn zip_part(data: &[u8], name: &str) -> Option<Vec<u8>> {
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut file = archive.by_name(name).ok()?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        Some(bytes)
    }

    fn minimal_unchanged_docx() -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in [
            (
                "[Content_Types].xml",
                b"<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>"
                    .as_slice(),
            ),
            (
                "word/document.xml",
                b"<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>"
                    .as_slice(),
            ),
        ] {
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[cfg(windows)]
    fn long_running_command() -> (PathBuf, Vec<OsString>) {
        (
            resolve_executable("cmd.exe").expect("Windows command processor"),
            vec![
                OsString::from("/D"),
                OsString::from("/C"),
                OsString::from("ping -n 6 127.0.0.1 >NUL"),
            ],
        )
    }

    #[cfg(windows)]
    const WINDOWS_TEST_EMF_SCRIPT: &str = r#"param(
        [Parameter(Mandatory = $true)][string]$Destination
    )
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::new(16, 16)
    $reference = [System.Drawing.Graphics]::FromImage($bitmap)
    $hdc = $reference.GetHdc()
    $metafile = $null
    try {
        $frame = [System.Drawing.RectangleF]::new(0, 0, 16, 16)
        $metafile = [System.Drawing.Imaging.Metafile]::new(
            $Destination,
            $hdc,
            $frame,
            [System.Drawing.Imaging.MetafileFrameUnit]::Pixel,
            [System.Drawing.Imaging.EmfType]::EmfPlusDual
        )
    }
    finally {
        $reference.ReleaseHdc($hdc)
        $reference.Dispose()
        $bitmap.Dispose()
    }
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($metafile)
        try {
            $graphics.Clear([System.Drawing.Color]::White)
            $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::Red, 2)
            try { $graphics.DrawLine($pen, 1, 1, 14, 14) } finally { $pen.Dispose() }
        }
        finally { $graphics.Dispose() }
    }
    finally { $metafile.Dispose() }
    "#;

    #[cfg(unix)]
    fn long_running_command() -> (PathBuf, Vec<OsString>) {
        (
            PathBuf::from("/bin/sh"),
            vec![OsString::from("-c"), OsString::from("sleep 5")],
        )
    }

    #[test]
    fn extension_is_case_insensitive() {
        assert_eq!(extension(Path::new("deck.PPT")), "ppt");
        assert_eq!(extension(Path::new("book.ODS")), "ods");
    }

    #[test]
    fn ooxml_magic_accepts_normal_and_empty_zip_packages() {
        assert!(looks_like_ooxml(b"PK\x03\x04payload"));
        assert!(looks_like_ooxml(b"PK\x05\x06empty"));
        assert!(!looks_like_ooxml(b"not a zip"));
    }

    #[test]
    fn converter_backend_ids_match_the_renderer_contract() {
        assert_eq!(
            wire_converter_id("libreoffice", DocumentKind::Word),
            Some(PreparedOfficeConverter::Libreoffice)
        );
        assert_eq!(
            wire_converter_id("wps-office", DocumentKind::Presentation),
            Some(PreparedOfficeConverter::Wps)
        );
        assert_eq!(
            wire_converter_id("microsoft-office", DocumentKind::Word),
            Some(PreparedOfficeConverter::Word)
        );
        assert_eq!(
            wire_converter_id("microsoft-office", DocumentKind::Presentation),
            Some(PreparedOfficeConverter::Powerpoint)
        );
        assert_eq!(
            wire_converter_id("microsoft-powerpoint", DocumentKind::Presentation),
            Some(PreparedOfficeConverter::Powerpoint)
        );
    }

    #[test]
    fn dependency_error_is_structured() {
        let error = dependency_missing_error("ppt", PPTX_TARGET);
        assert_eq!(error.code, "dependency-missing");
        let details = error.details.expect("dependency details");
        assert_eq!(details["dependency"], "office-converter");
        assert_eq!(details["capability"], "presentation-convert");
        assert_eq!(details["sourceFormat"], "ppt");
        assert_eq!(details["targetFormat"], "pptx");
        assert_eq!(details["outputLimitBytes"], MAX_DOCUMENT_BYTES);
    }

    #[tokio::test]
    async fn modern_document_bytes_are_not_rewritten() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("sample.docx");
        let expected = minimal_unchanged_docx();
        tokio::fs::write(&path, &expected).await.unwrap();
        assert_eq!(prepare_word(&path).await.unwrap(), expected);

        let prepared = prepare_word_with_metadata(&path).await.unwrap();
        assert_eq!(prepared.data, expected);
        assert!(!prepared.converted_from_legacy);
        assert_eq!(prepared.converter, None);
        assert!(!prepared.native_conversion_failed);
        assert_eq!(prepared.normalized_legacy_image_count, 0);
        assert_eq!(prepared.normalized_table_count, 0);
        assert_eq!(prepared.removed_underline_run_count, 0);
    }

    #[tokio::test]
    async fn failed_metafile_rasterization_is_a_byte_exact_safe_fallback() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("invalid-media.pptx");
        let expected = minimal_pptx_with_metafile("wmf", b"not-a-real-metafile");
        tokio::fs::write(&path, &expected).await.unwrap();

        let prepared = prepare_presentation_with_metadata(&path).await.unwrap();
        assert_eq!(prepared.data, expected);
        assert_eq!(prepared.normalized_wmf_count, 0);
        assert!(!prepared.converted_from_legacy);
        assert_eq!(prepared.converter, None);
        assert_eq!(
            prepare_presentation_for_reuse(&path).await.unwrap(),
            expected
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn windows_system_drawing_rasterization_reports_a_real_count() {
        let Some(powershell) = find_powershell() else {
            return;
        };
        let temp = tempfile::tempdir().unwrap();
        let emf_path = temp.path().join("source.emf");
        let script_path = temp.path().join("generate-emf.ps1");
        tokio::fs::write(&script_path, WINDOWS_TEST_EMF_SCRIPT)
            .await
            .unwrap();
        let args = vec![
            OsString::from("-NoLogo"),
            OsString::from("-NoProfile"),
            OsString::from("-NonInteractive"),
            OsString::from("-ExecutionPolicy"),
            OsString::from("Bypass"),
            OsString::from("-File"),
            script_path.into_os_string(),
            OsString::from("-Destination"),
            emf_path.as_os_str().to_owned(),
        ];
        let generated = run_process(&powershell, &args, Duration::from_secs(10), Some(&emf_path))
            .await
            .unwrap();
        if !generated
            .status
            .is_some_and(|status| status.success() && emf_path.is_file())
        {
            // Minimal Windows images may disable System.Drawing. Production
            // behavior in that environment is the tested byte-exact fallback.
            return;
        }

        let emf = tokio::fs::read(&emf_path).await.unwrap();
        let source = minimal_pptx_with_metafile("emf", &emf);
        let (normalized, count) = normalize_presentation_media(source).await.unwrap();
        assert_eq!(count, 1);
        assert!(zip_part(&normalized, "ppt/media/image1.emf").is_none());
        assert!(zip_part(&normalized, "ppt/media/image1.png")
            .is_some_and(|png| png.starts_with(b"\x89PNG\r\n\x1a\n")));
        let relationships = zip_part(&normalized, "ppt/slides/_rels/slide1.xml.rels").unwrap();
        assert!(String::from_utf8(relationships)
            .unwrap()
            .contains("../media/image1.png"));
    }

    #[tokio::test]
    async fn oversized_input_is_rejected_before_conversion() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("oversized.doc");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        let error = prepare_word(&path).await.unwrap_err();
        assert_eq!(error.code, "file-too-large");
        assert_eq!(error.details.unwrap()["stage"], "input");
    }

    #[tokio::test]
    async fn invalid_spreadsheet_extension_is_rejected() {
        let error = prepare_spreadsheet(Path::new("book.csv"))
            .await
            .unwrap_err();
        assert_eq!(error.code, "invalid-argument");
    }

    #[tokio::test]
    async fn capped_reader_discards_excess_without_growing_buffer() {
        let bytes = vec![b'x'; MAX_DIAGNOSTIC_BYTES + 8192];
        let output = read_capped(std::io::Cursor::new(bytes)).await;
        assert_eq!(output.bytes.len(), MAX_DIAGNOSTIC_BYTES);
        assert!(output.truncated);
    }

    #[tokio::test]
    async fn converter_process_is_killed_at_timeout() {
        let (executable, args) = long_running_command();
        let result = run_process(&executable, &args, Duration::from_millis(50), None)
            .await
            .unwrap();
        assert!(result.timed_out);
        assert!(result.status.is_none());
    }

    #[tokio::test]
    async fn converter_process_is_killed_when_output_limit_is_observed() {
        let temp = tempfile::tempdir().unwrap();
        let output_path = temp.path().join("oversized-output.bin");
        let file = std::fs::File::create(&output_path).unwrap();
        file.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        let (executable, args) = long_running_command();
        let result = run_process(
            &executable,
            &args,
            Duration::from_secs(5),
            Some(&output_path),
        )
        .await
        .unwrap();
        assert_eq!(result.output_limit_bytes, Some(MAX_DOCUMENT_BYTES + 1));
        assert!(!result.timed_out);
        assert!(result.status.is_none());
    }

    #[tokio::test]
    async fn converter_probe_reports_paths_versions_and_capabilities_shape() {
        let statuses = probe_office_converters().await;
        let libreoffice = statuses
            .iter()
            .find(|status| status.id == "libreoffice")
            .expect("LibreOffice probe entry");
        assert!(libreoffice.capabilities.contains(&"word-convert"));
        assert!(libreoffice.capabilities.contains(&"presentation-convert"));
        assert!(libreoffice.capabilities.contains(&"spreadsheet-convert"));
        for status in &statuses {
            if status.available {
                assert!(status.path.is_some());
                assert!(!status.capabilities.is_empty());
            }
            if let Some(version) = &status.version {
                assert!(status.available);
                assert!(!version.trim().is_empty());
                assert!(version.chars().count() <= 240);
            }
        }
    }
}

use crate::{
    agents::{
        provider::{complete_streaming, ProviderMessage},
        store::AgentConfig,
    },
    documents::{
        converter::{prepare_spreadsheet, prepare_word},
        envelope,
        presentation::{self, PresentationEditOperation, PresentationEditRequest},
    },
    error::{AppError, AppResult},
    files::atomic::write_atomic,
    providers::store::ProviderStore,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read, Write},
    net::{SocketAddr, TcpListener},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const SMOKE_FLAG: &str = "--wae-runtime-smoke";
const REPORT_PREFIX: &str = "--wae-runtime-report=";
const REPORT_DIRECTORY: &str = "wae-runtime-smoke";

#[derive(Clone, Debug)]
pub(crate) struct SmokeSpec {
    report_path: PathBuf,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SmokeReport {
    schema_version: u32,
    package_version: String,
    ok: bool,
    atomic_file_round_trip: bool,
    wae1_binary_round_trip: bool,
    word_raw_round_trip: bool,
    spreadsheet_raw_round_trip: bool,
    presentation_ooxml_edit: bool,
    agent_streaming: bool,
    agent_deltas: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

impl SmokeReport {
    fn new() -> Self {
        Self {
            schema_version: 1,
            package_version: env!("CARGO_PKG_VERSION").to_owned(),
            ..Self::default()
        }
    }
}

impl SmokeSpec {
    pub(crate) fn from_process() -> AppResult<Option<Self>> {
        let args = std::env::args_os().skip(1).collect::<Vec<_>>();
        if !args.iter().any(|argument| argument == SMOKE_FLAG) {
            return Ok(None);
        }
        if std::env::var("WAE_RUNTIME_SMOKE").as_deref() != Ok("1") {
            return Err(AppError::denied(
                "Runtime smoke mode requires the test environment gate",
            ));
        }
        let values = args
            .iter()
            .filter_map(|argument| argument.to_str()?.strip_prefix(REPORT_PREFIX))
            .collect::<Vec<_>>();
        if values.len() != 1 || values[0].is_empty() {
            return Err(AppError::invalid(
                "Runtime smoke mode requires one report path",
            ));
        }
        let root = std::env::temp_dir().join(REPORT_DIRECTORY);
        fs::create_dir_all(&root)?;
        let report_path = validate_report_path(Path::new(values[0]), &root)?;
        Ok(Some(Self { report_path }))
    }
}

fn validate_report_path(path: &Path, root: &Path) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(AppError::invalid(
            "Runtime smoke report path must be absolute",
        ));
    }
    let canonical_root = fs::canonicalize(root)?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::invalid("Runtime smoke report path has no parent"))?;
    if fs::canonicalize(parent)? != canonical_root {
        return Err(AppError::denied(
            "Runtime smoke report must stay inside its temporary directory",
        ));
    }
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::invalid("Runtime smoke report name is invalid"))?;
    let token = file_name.strip_suffix(".json").unwrap_or("");
    if token.len() != 32
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(AppError::invalid(
            "Runtime smoke report must use a 32-character lowercase hex token",
        ));
    }
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(AppError::denied(
            "Runtime smoke report cannot replace a symbolic link",
        ));
    }
    Ok(path.to_path_buf())
}

pub(crate) fn start(app: AppHandle, spec: SmokeSpec) {
    tauri::async_runtime::spawn(async move {
        let mut report = SmokeReport::new();
        let result = run_checks(&mut report).await;
        if let Err(error) = result {
            report.error_code = Some(error.code);
            report.error_message = Some(error.message);
        } else {
            report.ok = true;
        }
        let write_result = write_report(&spec.report_path, &report);
        app.exit(if report.ok && write_result.is_ok() {
            0
        } else {
            1
        });
    });
}

async fn run_checks(report: &mut SmokeReport) -> AppResult<()> {
    let temporary = tempfile::tempdir()?;

    let atomic_path = temporary.path().join("atomic.txt");
    write_atomic(&atomic_path, b"first")?;
    write_atomic(&atomic_path, b"second")?;
    if fs::read(&atomic_path)? != b"second" {
        return Err(AppError::new(
            "runtime-smoke-failed",
            "Atomic file replacement did not preserve the final payload",
        ));
    }
    report.atomic_file_round_trip = true;

    let binary_payload = [0_u8, 1, 2, 127, 128, 255];
    let encoded = envelope::encode(
        &serde_json::json!({ "kind": "runtime-smoke" }),
        &binary_payload,
    )?;
    let (metadata, decoded) = envelope::decode::<serde_json::Value>(&encoded, 1024)?;
    if metadata["kind"] != "runtime-smoke" || decoded != binary_payload {
        return Err(AppError::new(
            "runtime-smoke-failed",
            "WAE1 binary envelope round trip failed",
        ));
    }
    report.wae1_binary_round_trip = true;

    let word_payload = canary_docx()?;
    let office_payload = canary_pptx()?;
    let word_path = temporary.path().join("canary.docx");
    let spreadsheet_path = temporary.path().join("canary.xlsx");
    fs::write(&word_path, &word_payload)?;
    fs::write(&spreadsheet_path, &office_payload)?;
    report.word_raw_round_trip = prepare_word(&word_path).await? == word_payload;
    report.spreadsheet_raw_round_trip =
        prepare_spreadsheet(&spreadsheet_path).await? == office_payload;
    if !report.word_raw_round_trip || !report.spreadsheet_raw_round_trip {
        return Err(AppError::new(
            "runtime-smoke-failed",
            "Modern Office raw document path changed bytes",
        ));
    }

    let updated = presentation::edit(
        PresentationEditRequest {
            data: office_payload,
            operation: PresentationEditOperation::UpdateText {
                slide_index: 0,
                title: "Runtime smoke title".to_owned(),
                body: "Runtime smoke body".to_owned(),
            },
        },
        None,
    )?;
    let updated_data = updated.data.ok_or_else(|| {
        AppError::new(
            "runtime-smoke-failed",
            "PPTX edit returned no document bytes",
        )
    })?;
    let inspected = presentation::edit(
        PresentationEditRequest {
            data: updated_data.clone(),
            operation: PresentationEditOperation::Inspect { slide_index: 0 },
        },
        None,
    )?;
    let slide = inspected.slide.ok_or_else(|| {
        AppError::new("runtime-smoke-failed", "PPTX inspection returned no slide")
    })?;
    let mut archive = ZipArchive::new(Cursor::new(updated_data))
        .map_err(|error| AppError::new("runtime-smoke-failed", error.to_string()))?;
    let mut opaque = Vec::new();
    archive
        .by_name("custom/opaque.bin")
        .map_err(|error| AppError::new("runtime-smoke-failed", error.to_string()))?
        .read_to_end(&mut opaque)?;
    if slide.title != "Runtime smoke title"
        || slide.body != "Runtime smoke body"
        || opaque != b"preserve-me"
    {
        return Err(AppError::new(
            "runtime-smoke-failed",
            "PPTX OOXML edit did not preserve content and unknown parts",
        ));
    }
    report.presentation_ooxml_edit = true;

    let address = serve_sse_once()?;
    let provider_directory = temporary.path().join("provider");
    fs::create_dir_all(&provider_directory)?;
    let provider_store = ProviderStore::new(provider_directory)?;
    provider_store.set_base_url("ollama", &format!("http://{address}/v1"))?;
    let agent = AgentConfig {
        id: "runtime-smoke".to_owned(),
        name: "Runtime smoke".to_owned(),
        role: String::new(),
        system_prompt: String::new(),
        provider_id: "ollama".to_owned(),
        model: "runtime-smoke-model".to_owned(),
        reasoning: None,
        color: "#000000".to_owned(),
        enabled: true,
        description: None,
    };
    let deltas = Mutex::new(Vec::<String>::new());
    let observer = |delta: &str| {
        deltas
            .lock()
            .expect("runtime delta lock")
            .push(delta.to_owned());
        Ok(())
    };
    let completion = complete_streaming(
        &provider_store,
        &agent,
        &[ProviderMessage {
            role: "user".to_owned(),
            content: "stream".to_owned(),
        }],
        "runtime-smoke",
        &CancellationToken::new(),
        Some(&observer),
    )
    .await?;
    report.agent_deltas = deltas.into_inner().expect("runtime delta lock");
    if completion.text != "Hello" || report.agent_deltas != ["Hel", "lo"] {
        return Err(AppError::new(
            "runtime-smoke-failed",
            "Agent provider did not deliver the expected streaming SSE deltas",
        ));
    }
    report.agent_streaming = true;
    Ok(())
}

fn serve_sse_once() -> AppResult<SocketAddr> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let address = listener.local_addr()?;
    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        let mut expected_length = None;
        loop {
            let read = stream.read(&mut buffer).unwrap_or(0);
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
            if expected_length.is_none() {
                if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.split_once(':').and_then(|(name, value)| {
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())
                                    .flatten()
                            })
                        })
                        .unwrap_or(0);
                    expected_length = Some(header_end + 4 + content_length);
                }
            }
            if expected_length.is_some_and(|length| request.len() >= length) {
                break;
            }
        }
        let response = b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n";
        let _ = stream.write_all(response);
        let _ = stream.flush();
    });
    Ok(address)
}

fn canary_pptx() -> AppResult<Vec<u8>> {
    const RELS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
    const OFFICE_RELS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const PRESENTATION: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const DRAWING: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
    let entries = BTreeMap::from([
        (
            "[Content_Types].xml",
            b"<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/><Override PartName=\"/ppt/slides/slide1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/></Types>".to_vec(),
        ),
        (
            "ppt/presentation.xml",
            format!("<p:presentation xmlns:p=\"{PRESENTATION}\" xmlns:r=\"{OFFICE_RELS}\"><p:sldIdLst><p:sldId id=\"256\" r:id=\"rId1\"/></p:sldIdLst></p:presentation>").into_bytes(),
        ),
        (
            "ppt/_rels/presentation.xml.rels",
            format!("<Relationships xmlns=\"{RELS}\"><Relationship Id=\"rId1\" Type=\"{OFFICE_RELS}/slide\" Target=\"slides/slide1.xml\"/></Relationships>").into_bytes(),
        ),
        (
            "ppt/slides/slide1.xml",
            format!("<p:sld xmlns:p=\"{PRESENTATION}\" xmlns:a=\"{DRAWING}\"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Before</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Body\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"body\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Before body</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>").into_bytes(),
        ),
        ("custom/opaque.bin", b"preserve-me".to_vec()),
    ]);
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .map_err(|error| AppError::new("runtime-smoke-failed", error.to_string()))?;
        writer.write_all(&data)?;
    }
    writer
        .finish()
        .map(Cursor::into_inner)
        .map_err(|error| AppError::new("runtime-smoke-failed", error.to_string()))
}

fn canary_docx() -> AppResult<Vec<u8>> {
    const WORD: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    let document = format!(
        "<w:document xmlns:w=\"{WORD}\"><w:body><w:p><w:r><w:t>Runtime smoke</w:t></w:r></w:p></w:body></w:document>"
    );
    let entries = [
        (
            "[Content_Types].xml",
            b"<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"
                .as_slice(),
        ),
        ("word/document.xml", document.as_bytes()),
    ];
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in entries {
        writer
            .start_file(
                name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .map_err(|error| AppError::new("runtime-smoke-failed", error.to_string()))?;
        writer.write_all(data)?;
    }
    writer
        .finish()
        .map(Cursor::into_inner)
        .map_err(|error| AppError::new("runtime-smoke-failed", error.to_string()))
}

fn write_report(path: &Path, report: &SmokeReport) -> AppResult<()> {
    let mut bytes = serde_json::to_vec_pretty(report)?;
    bytes.push(b'\n');
    write_atomic(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn installed_runtime_canary_exercises_documents_and_streaming() {
        let mut report = SmokeReport::new();
        run_checks(&mut report).await.unwrap();
        assert!(report.atomic_file_round_trip);
        assert!(report.wae1_binary_round_trip);
        assert!(report.word_raw_round_trip);
        assert!(report.spreadsheet_raw_round_trip);
        assert!(report.presentation_ooxml_edit);
        assert!(report.agent_streaming);
        assert_eq!(report.agent_deltas, ["Hel", "lo"]);
    }

    #[test]
    fn runtime_report_path_is_strictly_scoped() {
        let root = tempfile::tempdir().unwrap();
        let valid = root.path().join("0123456789abcdef0123456789abcdef.json");
        assert_eq!(validate_report_path(&valid, root.path()).unwrap(), valid);
        assert!(validate_report_path(&root.path().join("report.json"), root.path()).is_err());
    }
}

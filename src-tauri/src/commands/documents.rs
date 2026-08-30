use crate::{
    documents::{
        converter, envelope,
        fonts::SystemFont,
        presentation::{
            self, PresentationEditOperation, PresentationEditRequest, PresentationEditResult,
        },
    },
    error::{AppError, AppResult},
    files::ensure_file_can_be_opened,
    state::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{borrow::Cow, io::Cursor, path::PathBuf};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    State, WebviewWindow,
};

use super::files::{validate_binary_ipc_size, MAX_BINARY_IPC_BYTES};

const MAX_PRESENTATION_IPC_BYTES: usize = MAX_BINARY_IPC_BYTES as usize;

#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PresentationEditMetadata {
    pub operation: PresentationEditOperation,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    pub reuse_grant_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PresentationEditResponseMetadata {
    pub has_data: bool,
    pub slide_count: usize,
    pub current_slide_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub slide: Option<presentation::PresentationSlideText>,
    pub converter: String,
    pub normalized_wmf_count: usize,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PreparedOfficeMetadata {
    pub converted_from_legacy: bool,
    // Serialize null explicitly so the generated DTO and renderer contract
    // agree that this field is always present but nullable.
    pub converter: Option<converter::PreparedOfficeConverter>,
    pub native_conversion_failed: bool,
    pub normalized_legacy_image_count: usize,
    pub normalized_table_count: usize,
    pub removed_underline_run_count: usize,
    pub normalized_wmf_count: usize,
}

#[tauri::command]
pub async fn documents_prepare_word(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let path = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    ensure_file_can_be_opened(&path)?;
    let prepared = converter::prepare_word_with_metadata(&path).await?;
    let metadata = PreparedOfficeMetadata {
        converted_from_legacy: prepared.converted_from_legacy,
        converter: prepared.converter,
        native_conversion_failed: prepared.native_conversion_failed,
        normalized_legacy_image_count: prepared.normalized_legacy_image_count,
        normalized_table_count: prepared.normalized_table_count,
        removed_underline_run_count: prepared.removed_underline_run_count,
        normalized_wmf_count: 0,
    };
    Ok(Response::new(envelope::encode(&metadata, &prepared.data)?))
}

#[tauri::command]
pub async fn documents_read_file(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let path = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    ensure_file_can_be_opened(&path)?;
    let metadata = tokio::fs::metadata(&path).await?;
    if metadata.len() > 100 * 1024 * 1024 {
        return Err(AppError::new(
            "file-too-large",
            "File exceeds the 100 MiB IPC read limit",
        ));
    }
    Ok(Response::new(tokio::fs::read(path).await?))
}

#[tauri::command]
pub async fn documents_prepare_presentation(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let path = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    ensure_file_can_be_opened(&path)?;
    let prepared = converter::prepare_presentation_with_metadata(&path).await?;
    let metadata = PreparedOfficeMetadata {
        converted_from_legacy: prepared.converted_from_legacy,
        converter: prepared.converter,
        native_conversion_failed: false,
        normalized_legacy_image_count: 0,
        normalized_table_count: 0,
        removed_underline_run_count: 0,
        normalized_wmf_count: prepared.normalized_wmf_count,
    };
    Ok(Response::new(envelope::encode(&metadata, &prepared.data)?))
}

#[tauri::command]
pub async fn documents_prepare_spreadsheet(
    path: String,
    grant_id: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let path = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, false, Some(false))?;
    ensure_file_can_be_opened(&path)?;
    Ok(Response::new(converter::prepare_spreadsheet(&path).await?))
}

#[tauri::command]
pub async fn documents_edit_presentation(
    request: Request<'_>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Response> {
    let raw = match request.body() {
        InvokeBody::Raw(data) => data,
        InvokeBody::Json(_) => {
            return Err(AppError::invalid(
                "documents_edit_presentation requires a raw WAE1 request body",
            ))
        }
    };
    let (metadata, payload) =
        envelope::decode::<PresentationEditMetadata>(raw, MAX_PRESENTATION_IPC_BYTES)?;
    let edit_request = PresentationEditRequest {
        data: payload.to_vec(),
        operation: metadata.operation,
    };
    let reuse_data = if let PresentationEditOperation::ReuseSlides { source_path, .. } =
        &edit_request.operation
    {
        let source = state.files.access.resolve(
            window.label(),
            source_path,
            metadata
                .reuse_grant_id
                .as_deref()
                .ok_or_else(|| AppError::denied("A source file grant is required"))?,
            false,
            Some(false),
        )?;
        ensure_file_can_be_opened(&source)?;
        Some(converter::prepare_presentation_for_reuse(&source).await?)
    } else {
        None
    };

    let mut result: PresentationEditResult = tokio::task::spawn_blocking(move || {
        presentation::edit(edit_request, reuse_data.as_deref())
    })
    .await
    .map_err(|error| AppError::internal(format!("Presentation editor task failed: {error}")))??;
    let has_data = result.data.is_some();
    let payload = if let Some(data) = result.data.take() {
        let (data, normalized_wmf_count) = converter::normalize_presentation_media(data).await?;
        result.normalized_wmf_count = result
            .normalized_wmf_count
            .saturating_add(normalized_wmf_count);
        data
    } else {
        Vec::new()
    };
    let metadata = PresentationEditResponseMetadata {
        has_data,
        slide_count: result.slide_count,
        current_slide_index: result.current_slide_index,
        slide: result.slide,
        converter: result.converter.to_owned(),
        normalized_wmf_count: result.normalized_wmf_count,
    };
    Ok(Response::new(envelope::encode(&metadata, &payload)?))
}

#[tauri::command]
pub async fn documents_list_fonts(language: Option<String>) -> AppResult<Vec<SystemFont>> {
    tokio::task::spawn_blocking(move || crate::documents::fonts::list_system_fonts(language))
        .await
        .map_err(|error| AppError::internal(error.to_string()))
}

#[tauri::command]
pub async fn documents_save_binary(
    request: Request<'_>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let data = raw_binary_body(request.body())?;
    let path = raw_request_path(&request, &state, window.label(), true)?;
    state.files.history.write_with_snapshot(&path, data).await?;
    Ok(serde_json::json!({ "success": true }))
}

fn raw_binary_body(body: &InvokeBody) -> AppResult<&[u8]> {
    match body {
        InvokeBody::Raw(data) => {
            validate_binary_ipc_size(data.len() as u64)?;
            Ok(data.as_slice())
        }
        InvokeBody::Json(_) => Err(AppError::invalid(
            "documents_save_binary requires a raw Uint8Array request body",
        )),
    }
}

#[tauri::command]
pub async fn documents_save_text(
    path: String,
    grant_id: String,
    text: String,
    encoding: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let path = state
        .files
        .access
        .resolve(window.label(), &path, &grant_id, true, Some(false))?;
    let data = encode_text(&text, &encoding)?;
    state
        .files
        .history
        .write_with_snapshot(&path, &data)
        .await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn documents_set_current_file(
    path: Option<String>,
    grant_id: Option<String>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let mut current = state.current_files.lock();
    if let Some(path) = path {
        let grant_id = grant_id.ok_or_else(|| AppError::denied("A file grant is required"))?;
        let resolved =
            state
                .files
                .access
                .resolve(window.label(), &path, &grant_id, false, Some(false))?;
        ensure_file_can_be_opened(&resolved)?;
        current.insert(
            window.label().to_owned(),
            crate::files::models::GrantedPath {
                path: crate::files::path_string(&resolved)?,
                grant_id,
            },
        );
    } else {
        current.remove(window.label());
    }
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn documents_write_png_clipboard(request: Request<'_>) -> AppResult<Value> {
    const MAX_PNG_BYTES: usize = 25 * 1024 * 1024;
    const MAX_PIXELS: u64 = 100_000_000;

    let png = match request.body() {
        InvokeBody::Raw(data) => data.clone(),
        InvokeBody::Json(_) => {
            return Err(AppError::invalid(
                "documents_write_png_clipboard requires a raw Uint8Array request body",
            ))
        }
    };
    if png.is_empty() || png.len() > MAX_PNG_BYTES {
        return Err(AppError::new(
            "invalid-binary",
            "PNG clipboard payload must be between 1 byte and 25 MiB",
        ));
    }

    tokio::task::spawn_blocking(move || {
        let mut decoder = png::Decoder::new(Cursor::new(png));
        decoder.set_transformations(png::Transformations::normalize_to_color8());
        let mut reader = decoder.read_info().map_err(|error| {
            AppError::new(
                "invalid-binary",
                format!("Cannot decode PNG header: {error}"),
            )
        })?;
        let info = reader.info();
        let pixels = u64::from(info.width) * u64::from(info.height);
        if info.width == 0 || info.height == 0 || pixels > MAX_PIXELS {
            return Err(AppError::new(
                "image-too-large",
                "PNG dimensions exceed the 100 megapixel clipboard limit",
            ));
        }

        let output_size = reader.output_buffer_size().ok_or_else(|| {
            AppError::new("invalid-binary", "PNG decoded size cannot be determined")
        })?;
        let mut decoded = vec![0; output_size];
        let frame = reader.next_frame(&mut decoded).map_err(|error| {
            AppError::new("invalid-binary", format!("Cannot decode PNG: {error}"))
        })?;
        let rgba = png_frame_to_rgba(&decoded[..frame.buffer_size()], frame.color_type)?;

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|error| AppError::new("clipboard-unavailable", error.to_string()))?;
        clipboard
            .set_image(arboard::ImageData {
                width: frame.width as usize,
                height: frame.height as usize,
                bytes: Cow::Owned(rgba),
            })
            .map_err(|error| AppError::new("clipboard-write-failed", error.to_string()))?;

        Ok(serde_json::json!({
            "success": true,
            "width": frame.width,
            "height": frame.height,
        }))
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))?
}

fn png_frame_to_rgba(bytes: &[u8], color_type: png::ColorType) -> AppResult<Vec<u8>> {
    let channels = match color_type {
        png::ColorType::Rgba => return Ok(bytes.to_vec()),
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Grayscale => 1,
        png::ColorType::Indexed => {
            return Err(AppError::new(
                "invalid-binary",
                "Indexed PNG was not expanded by the decoder",
            ))
        }
    };
    if bytes.len() % channels != 0 {
        return Err(AppError::new(
            "invalid-binary",
            "PNG pixel buffer has an invalid length",
        ));
    }
    let mut rgba = Vec::with_capacity(bytes.len() / channels * 4);
    for pixel in bytes.chunks_exact(channels) {
        match color_type {
            png::ColorType::Rgb => rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]),
            png::ColorType::GrayscaleAlpha => {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]])
            }
            png::ColorType::Grayscale => {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], 255])
            }
            _ => unreachable!(),
        }
    }
    Ok(rgba)
}

fn raw_request_path(
    request: &Request<'_>,
    state: &AppState,
    owner: &str,
    write: bool,
) -> AppResult<PathBuf> {
    let grant_id = request
        .headers()
        .get("x-wae-grant-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| AppError::denied("An opaque file grant is required for binary access"))?;
    state
        .files
        .access
        .resolve_grant(owner, grant_id, write, Some(false))
}

fn encode_text(text: &str, encoding: &str) -> AppResult<Vec<u8>> {
    match encoding.to_ascii_lowercase().as_str() {
        "utf-8" | "utf8" => Ok(text.as_bytes().to_vec()),
        "utf-8-bom" => Ok([&[0xef, 0xbb, 0xbf][..], text.as_bytes()].concat()),
        "utf-16le" => Ok([&[0xff, 0xfe][..], &utf16_bytes(text, true)].concat()),
        "utf-16be" => Ok([&[0xfe, 0xff][..], &utf16_bytes(text, false)].concat()),
        "gbk" => {
            let (encoded, _, _) = encoding_rs::GBK.encode(text);
            Ok(encoded.into_owned())
        }
        other => Err(AppError::invalid(format!(
            "Unsupported text encoding: {other}"
        ))),
    }
}

fn utf16_bytes(text: &str, little_endian: bool) -> Vec<u8> {
    text.encode_utf16()
        .flat_map(|unit| {
            if little_endian {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepared_metadata_serializes_converter_as_explicit_null() {
        let metadata = PreparedOfficeMetadata {
            converted_from_legacy: false,
            converter: None,
            native_conversion_failed: false,
            normalized_legacy_image_count: 0,
            normalized_table_count: 0,
            removed_underline_run_count: 0,
            normalized_wmf_count: 0,
        };
        let encoded = serde_json::to_value(metadata).unwrap();
        assert_eq!(encoded["converter"], Value::Null);
        assert_eq!(encoded["convertedFromLegacy"], false);
        assert_eq!(encoded["nativeConversionFailed"], false);
    }

    #[test]
    fn prepared_metadata_serializes_typed_converter_id() {
        let metadata = PreparedOfficeMetadata {
            converted_from_legacy: true,
            converter: Some(converter::PreparedOfficeConverter::Wps),
            native_conversion_failed: false,
            normalized_legacy_image_count: 0,
            normalized_table_count: 0,
            removed_underline_run_count: 0,
            normalized_wmf_count: 0,
        };
        let encoded = serde_json::to_value(metadata).unwrap();
        assert_eq!(encoded["converter"], "wps");
        assert_eq!(encoded["convertedFromLegacy"], true);
    }

    #[test]
    fn prepared_metadata_serializes_real_word_normalization_counts() {
        let metadata = PreparedOfficeMetadata {
            converted_from_legacy: false,
            converter: None,
            native_conversion_failed: false,
            normalized_legacy_image_count: 2,
            normalized_table_count: 3,
            removed_underline_run_count: 4,
            normalized_wmf_count: 0,
        };
        let encoded = serde_json::to_value(metadata).unwrap();
        assert_eq!(encoded["normalizedLegacyImageCount"], 2);
        assert_eq!(encoded["normalizedTableCount"], 3);
        assert_eq!(encoded["removedUnderlineRunCount"], 4);
    }

    #[test]
    fn save_binary_body_is_borrowed_and_json_is_rejected() {
        let body = InvokeBody::Raw(vec![0, 1, 2, 255]);
        let original = match &body {
            InvokeBody::Raw(data) => data.as_ptr(),
            InvokeBody::Json(_) => unreachable!(),
        };
        let borrowed = raw_binary_body(&body).unwrap();
        assert_eq!(borrowed, [0, 1, 2, 255]);
        assert_eq!(borrowed.as_ptr(), original);

        let error = raw_binary_body(&InvokeBody::Json(Value::Null)).unwrap_err();
        assert_eq!(error.code, "invalid-argument");
    }
}

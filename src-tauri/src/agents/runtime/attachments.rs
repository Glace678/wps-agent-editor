use super::*;

pub(super) async fn render_attachment(
    owner: &str,
    attachment: &super::super::models::AgentAttachment,
    files: &FileServices,
    maximum_chars: usize,
) -> AppResult<String> {
    if !matches!(
        attachment.source.as_str(),
        "browse" | "recent" | "tab" | "picker"
    ) {
        return Err(AppError::invalid("Unknown attachment source"));
    }
    let path = files.access.resolve(
        owner,
        &attachment.path,
        &attachment.grant_id,
        false,
        Some(false),
    )?;
    let metadata = tokio::fs::metadata(&path).await?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&attachment.name);
    let escaped_name = escape_xml(name);
    if metadata.len() > MAX_ATTACHMENT_FILE_BYTES {
        return Ok(format!(
            "<attachment name=\"{escaped_name}\" size=\"{}\" status=\"metadata-only\">File exceeds the 32 MiB extraction limit.</attachment>",
            metadata.len()
        ));
    }

    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "docx" | "pptx" | "xlsx" | "ods") {
        let path = path.clone();
        let extension_for_task = extension.clone();
        let task = tokio::task::spawn_blocking(move || {
            extract_zipped_document_text(&path, &extension_for_task, MAX_ATTACHMENT_CHARS_PER_FILE)
        });
        let extracted = await_attachment_extraction(task).await?;
        let content_limit = MAX_ATTACHMENT_CHARS_PER_FILE
            .min(maximum_chars.saturating_sub(160))
            .max(1);
        let truncated = extracted.chars().count() > content_limit;
        let text = truncate_chars(&extracted, content_limit);
        return Ok(format!(
            "<attachment name=\"{escaped_name}\" size=\"{}\"{}>\n{}\n</attachment>",
            metadata.len(),
            if truncated {
                " status=\"truncated\""
            } else {
                ""
            },
            escape_xml(&text)
        ));
    }
    if extension == "pdf" {
        let path = path.clone();
        let task = tokio::task::spawn_blocking(move || {
            pdf_extract::extract_text(path).map_err(|error| {
                AppError::new(
                    "invalid-attachment",
                    format!("Cannot extract PDF attachment text: {error}"),
                )
            })
        });
        let extracted = await_attachment_extraction(task).await?;
        return Ok(format_extracted_attachment(
            &escaped_name,
            metadata.len(),
            &extracted,
            maximum_chars,
        ));
    }
    if matches!(extension.as_str(), "doc" | "odt" | "ppt" | "odp" | "xls") {
        let (converted, target_extension) = match extension.as_str() {
            "doc" | "odt" => (
                crate::documents::converter::prepare_word(&path).await?,
                "docx",
            ),
            "ppt" | "odp" => (
                crate::documents::converter::prepare_presentation(&path).await?,
                "pptx",
            ),
            "xls" => (
                crate::documents::converter::prepare_spreadsheet(&path).await?,
                "xlsx",
            ),
            _ => unreachable!("legacy extension checked"),
        };
        let task = tokio::task::spawn_blocking(move || {
            extract_zipped_document_text_bytes(
                &converted,
                target_extension,
                MAX_ATTACHMENT_CHARS_PER_FILE,
            )
        });
        let extracted = await_attachment_extraction(task).await?;
        return Ok(format_extracted_attachment(
            &escaped_name,
            metadata.len(),
            &extracted,
            maximum_chars,
        ));
    }
    if is_known_binary_extension(&extension) {
        return Ok(format!(
            "<attachment name=\"{escaped_name}\" size=\"{}\" status=\"metadata-only\">Binary extraction is unavailable in the Rust host.</attachment>",
            metadata.len()
        ));
    }

    let limit = MAX_ATTACHMENT_CHARS_PER_FILE
        .min(maximum_chars.saturating_sub(160))
        .max(1);
    let file = tokio::fs::File::open(&path).await?;
    let mut reader = BufReader::new(file).take((limit.saturating_mul(4) + 1) as u64);
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes).await?;
    if !looks_like_text(&bytes) {
        return Ok(format!(
            "<attachment name=\"{escaped_name}\" size=\"{}\" status=\"metadata-only\">The selected file is not recognized as text.</attachment>",
            metadata.len()
        ));
    }
    let decoded = String::from_utf8_lossy(&bytes);
    let text = truncate_chars(&decoded, limit);
    let truncated = metadata.len() > bytes.len() as u64 || decoded.chars().count() > limit;
    Ok(format!(
        "<attachment name=\"{escaped_name}\" size=\"{}\"{}>\n{}\n</attachment>",
        metadata.len(),
        if truncated {
            " status=\"truncated\""
        } else {
            ""
        },
        escape_xml(&text)
    ))
}

pub(super) async fn await_attachment_extraction(
    mut task: tokio::task::JoinHandle<AppResult<String>>,
) -> AppResult<String> {
    match tokio::time::timeout(MAX_ATTACHMENT_EXTRACTION_TIME, &mut task).await {
        Ok(result) => result.map_err(|error| {
            AppError::internal(format!("Attachment extraction task failed: {error}"))
        })?,
        Err(_) => {
            task.abort();
            Err(AppError::new(
                "attachment-timeout",
                "Attachment text extraction exceeded 20 seconds",
            ))
        }
    }
}

pub(super) fn format_extracted_attachment(
    escaped_name: &str,
    size: u64,
    extracted: &str,
    maximum_chars: usize,
) -> String {
    let content_limit = MAX_ATTACHMENT_CHARS_PER_FILE
        .min(maximum_chars.saturating_sub(160))
        .max(1);
    let truncated = extracted.chars().count() > content_limit;
    let text = truncate_chars(extracted, content_limit);
    format!(
        "<attachment name=\"{escaped_name}\" size=\"{size}\"{}>\n{}\n</attachment>",
        if truncated {
            " status=\"truncated\""
        } else {
            ""
        },
        escape_xml(&text)
    )
}

pub(super) fn extract_zipped_document_text(
    path: &PathBuf,
    extension: &str,
    maximum_chars: usize,
) -> AppResult<String> {
    let file = std::fs::File::open(path)?;
    extract_zipped_document_text_reader(file, extension, maximum_chars)
}

pub(super) fn extract_zipped_document_text_bytes(
    bytes: &[u8],
    extension: &str,
    maximum_chars: usize,
) -> AppResult<String> {
    extract_zipped_document_text_reader(Cursor::new(bytes), extension, maximum_chars)
}

pub(super) fn extract_zipped_document_text_reader<R: Read + Seek>(
    reader: R,
    extension: &str,
    maximum_chars: usize,
) -> AppResult<String> {
    let mut archive = zip::ZipArchive::new(reader).map_err(|error| {
        AppError::new(
            "invalid-attachment",
            format!("Cannot open zipped document attachment: {error}"),
        )
    })?;
    if archive.len() > MAX_ATTACHMENT_ARCHIVE_ENTRIES {
        return Err(AppError::new(
            "attachment-archive-limit",
            "Document attachment contains too many archive entries",
        ));
    }
    let mut selected = (0..archive.len())
        .filter_map(|index| {
            let name = archive.by_index(index).ok()?.name().replace('\\', "/");
            selected_attachment_part(extension, &name).then_some((index, name))
        })
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| natural_part_order(&left.1, &right.1));

    let mut text = String::new();
    let mut total_uncompressed = 0u64;
    for (index, name) in selected {
        let mut entry = archive.by_index(index).map_err(|error| {
            AppError::new(
                "invalid-attachment",
                format!("Cannot read document attachment part: {error}"),
            )
        })?;
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ATTACHMENT_XML_BYTES {
            return Err(AppError::new(
                "attachment-decompression-limit",
                "Document attachment exceeded the 16 MiB XML extraction limit",
            ));
        }
        let entry_size = entry.size();
        let mut bytes = Vec::with_capacity(entry_size.min(1024 * 1024) as usize);
        entry
            .by_ref()
            .take(entry_size.saturating_add(1))
            .read_to_end(&mut bytes)?;
        let part_text = extract_xml_text(&bytes)?;
        if !part_text.is_empty() {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            if (extension == "pptx" && name.contains("/slides/slide"))
                || (extension == "xlsx" && name.contains("/worksheets/"))
            {
                text.push_str(&format!("[{}]\n", display_part_name(&name)));
            }
            text.push_str(&part_text);
            if text.chars().count() >= maximum_chars {
                break;
            }
        }
    }
    if text.trim().is_empty() {
        Ok("The document contained no extractable text.".to_owned())
    } else {
        Ok(truncate_chars(&text, maximum_chars.saturating_add(1)))
    }
}

pub(super) fn selected_attachment_part(extension: &str, name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    match extension {
        "docx" => {
            lower == "word/document.xml"
                || lower.starts_with("word/header") && lower.ends_with(".xml")
                || lower.starts_with("word/footer") && lower.ends_with(".xml")
                || matches!(
                    lower.as_str(),
                    "word/footnotes.xml" | "word/endnotes.xml" | "word/comments.xml"
                )
        }
        "pptx" => {
            lower.starts_with("ppt/slides/slide")
                && lower.ends_with(".xml")
                && !lower.contains("/_rels/")
        }
        "xlsx" => {
            lower == "xl/sharedstrings.xml"
                || lower.starts_with("xl/worksheets/sheet") && lower.ends_with(".xml")
        }
        "ods" => lower == "content.xml",
        _ => false,
    }
}

pub(super) fn natural_part_order(left: &str, right: &str) -> std::cmp::Ordering {
    part_number(left)
        .cmp(&part_number(right))
        .then_with(|| left.cmp(right))
}

pub(super) fn part_number(name: &str) -> u64 {
    name.rsplit('/')
        .next()
        .unwrap_or(name)
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

pub(super) fn display_part_name(name: &str) -> String {
    name.rsplit('/')
        .next()
        .unwrap_or(name)
        .trim_end_matches(".xml")
        .to_owned()
}

pub(super) fn extract_xml_text(bytes: &[u8]) -> AppResult<String> {
    use quick_xml::{escape::unescape, events::Event, Reader};

    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(event)) => {
                let decoded = event.decode().map_err(|error| {
                    AppError::new("invalid-attachment", format!("Invalid XML text: {error}"))
                })?;
                let decoded = unescape(&decoded).map_err(|error| {
                    AppError::new("invalid-attachment", format!("Invalid XML escape: {error}"))
                })?;
                let value = decoded.trim();
                if !value.is_empty() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(value);
                }
            }
            Ok(Event::CData(event)) => {
                let decoded = event.decode().map_err(|error| {
                    AppError::new("invalid-attachment", format!("Invalid XML CDATA: {error}"))
                })?;
                let value = decoded.trim();
                if !value.is_empty() {
                    if !output.is_empty() {
                        output.push(' ');
                    }
                    output.push_str(value);
                }
            }
            Ok(Event::GeneralRef(event)) => {
                let reference = event.decode().map_err(|error| {
                    AppError::new(
                        "invalid-attachment",
                        format!("Invalid XML reference: {error}"),
                    )
                })?;
                let value = resolve_xml_reference(&reference)?;
                if !output.is_empty() {
                    output.push(' ');
                }
                output.push(value);
            }
            Ok(Event::DocType(_)) => {
                return Err(AppError::new(
                    "invalid-attachment",
                    "DTD declarations are not allowed in document attachments",
                ));
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(error) => {
                return Err(AppError::new(
                    "invalid-attachment",
                    format!("Cannot parse document attachment XML: {error}"),
                ))
            }
        }
    }
    Ok(output)
}

pub(super) fn resolve_xml_reference(reference: &str) -> AppResult<char> {
    let resolved = match reference {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        value if value.starts_with("#x") => u32::from_str_radix(&value[2..], 16)
            .ok()
            .and_then(char::from_u32),
        value if value.starts_with('#') => value[1..].parse().ok().and_then(char::from_u32),
        _ => None,
    };
    resolved.ok_or_else(|| {
        AppError::new(
            "invalid-attachment",
            "Document attachment contains an unsupported XML entity reference",
        )
    })
}

pub(super) fn is_known_binary_extension(extension: &str) -> bool {
    matches!(
        extension,
        "7z" | "avi"
            | "bmp"
            | "class"
            | "dll"
            | "dmg"
            | "doc"
            | "docx"
            | "exe"
            | "gif"
            | "gz"
            | "heic"
            | "ico"
            | "iso"
            | "jar"
            | "jpeg"
            | "jpg"
            | "mov"
            | "mp3"
            | "mp4"
            | "o"
            | "obj"
            | "ods"
            | "odt"
            | "ogg"
            | "pdf"
            | "png"
            | "ppt"
            | "pptx"
            | "rar"
            | "so"
            | "tar"
            | "tif"
            | "tiff"
            | "wav"
            | "webm"
            | "webp"
            | "xls"
            | "xlsx"
            | "zip"
    )
}

pub(super) fn looks_like_text(bytes: &[u8]) -> bool {
    let sample = &bytes[..bytes.len().min(8192)];
    if sample.is_empty() {
        return true;
    }
    let controls = sample
        .iter()
        .filter(|byte| **byte == 0 || (**byte < 9) || (**byte > 13 && **byte < 32))
        .count();
    !sample.contains(&0) && controls.saturating_mul(100) < sample.len().saturating_mul(3)
}

pub(super) fn attachment_signature(
    owner: &str,
    message: &ChatMessage,
    maximum_chars: usize,
) -> String {
    let mut digest = Sha256::new();
    digest.update(owner.as_bytes());
    digest.update([0]);
    digest.update(message.role.as_str().as_bytes());
    digest.update([0]);
    digest.update(message.content.as_bytes());
    // The render budget affects which attachments are included and how much of
    // each is extracted, so it is part of the cache key: a small-budget render
    // must not be served to a later larger-budget request.
    digest.update([0]);
    digest.update(maximum_chars.to_le_bytes());
    for attachment in message.attachments.as_deref().unwrap_or(&[]) {
        digest.update([0]);
        digest.update(attachment.path.as_bytes());
        digest.update([0]);
        digest.update(attachment.grant_id.as_bytes());
        digest.update([0]);
        digest.update(attachment.name.as_bytes());
        digest.update([0]);
        digest.update(attachment.source.as_str().as_bytes());
    }
    hex::encode(digest.finalize())
}

pub(super) fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_xml_attributes_are_escaped() {
        assert_eq!(escape_xml("a&\"<b>"), "a&amp;&quot;&lt;b&gt;");
    }

    #[test]
    fn extracts_text_from_safe_office_xml() {
        let text = extract_xml_text(br#"<w:document xmlns:w="urn:w"><w:p><w:t>A &amp; B</w:t></w:p><w:p><w:t>C</w:t></w:p></w:document>"#)
            .unwrap();
        assert_eq!(text, "A & B C");
        assert_eq!(
            extract_xml_text(br#"<!DOCTYPE x><x>unsafe</x>"#)
                .unwrap_err()
                .code,
            "invalid-attachment"
        );
    }

    #[test]
    fn only_selects_expected_office_archive_parts() {
        assert!(selected_attachment_part("docx", "word/document.xml"));
        assert!(selected_attachment_part("pptx", "ppt/slides/slide2.xml"));
        assert!(!selected_attachment_part(
            "pptx",
            "ppt/slides/_rels/slide2.xml.rels"
        ));
        assert!(!selected_attachment_part("docx", "../outside.xml"));
    }
}

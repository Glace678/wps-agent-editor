use crate::error::{AppError, AppResult};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use quick_xml::{
    events::{BytesEnd, BytesStart, BytesText, Event},
    name::ResolveResult,
    reader::NsReader,
    Reader, Writer,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{Cursor, Read, Write},
    path::{Component, Path},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const CONTENT_TYPES_PART: &str = "[Content_Types].xml";
const PRESENTATION_PART: &str = "ppt/presentation.xml";
const PRESENTATION_RELS_PART: &str = "ppt/_rels/presentation.xml.rels";
const SLIDE_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const SLIDE_RELATIONSHIP_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const PACKAGE_RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships";
const PACKAGE_CONTENT_TYPES_NS: &str =
    "http://schemas.openxmlformats.org/package/2006/content-types";
const PRESENTATION_NS: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWING_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const OFFICE_RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const MAX_ARCHIVE_BYTES: usize = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;
const MAX_XML_BYTES: usize = 16 * 1024 * 1024;
const MAX_XML_DEPTH: usize = 256;
const MAX_XML_EVENTS: usize = 500_000;
const MAX_PART_NAME_BYTES: usize = 512;
const MAX_ENTRIES: usize = 16_384;
const MAX_SLIDES: usize = 2_000;
const MAX_RELATIONSHIP_DEPTH: usize = 256;
const MAX_EDIT_TEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_OUTLINE_TEXT_BYTES: usize = 16 * 1024 * 1024;
#[cfg(any(test, windows))]
const MAX_LEGACY_METAFILES: usize = 512;
#[cfg(any(test, windows))]
const MAX_RASTERIZED_IMAGE_DIMENSION: u32 = 4_096;
#[cfg(any(test, windows))]
const MAX_RASTERIZED_IMAGE_PIXELS: u64 = 16_777_216;
#[cfg(any(test, windows))]
const MAX_PNG_DECODER_BYTES: usize = 8 * 1024 * 1024;
const URI_PATH_SEGMENT_ENCODE_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationEditRequest {
    pub data: Vec<u8>,
    pub operation: PresentationEditOperation,
}

#[derive(Debug, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PresentationEditOperation {
    Inspect {
        slide_index: isize,
    },
    Add {
        after_slide_index: isize,
    },
    UpdateText {
        slide_index: isize,
        title: String,
        body: String,
    },
    UpdateNodeText {
        slide_index: isize,
        node_id: String,
        text: String,
    },
    Duplicate {
        slide_index: isize,
    },
    Delete {
        slide_index: isize,
    },
    ImportOutline {
        after_slide_index: isize,
        slides: Vec<PresentationSlideText>,
    },
    ReuseSlides {
        after_slide_index: isize,
        source_path: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct PresentationSlideText {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationEditResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<u8>>,
    pub slide_count: usize,
    pub current_slide_index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide: Option<PresentationSlideText>,
    // Kept for wire compatibility with the Electron implementation. No external
    // converter is involved in OOXML edits.
    pub converter: &'static str,
    pub normalized_wmf_count: usize,
}

#[derive(Debug, Clone)]
struct SlideRef {
    id: u32,
    relationship_id: String,
}

#[derive(Debug, Clone)]
struct Relationship {
    id: String,
    relationship_type: String,
    target: String,
    target_mode: Option<String>,
}

#[derive(Debug, Default)]
struct ContentTypes {
    defaults: HashMap<String, String>,
    overrides: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct ShapeInfo {
    id: String,
    placeholder_type: Option<String>,
    text: String,
    has_text_body: bool,
}

struct Package<'a> {
    source: &'a [u8],
    original: BTreeMap<String, Vec<u8>>,
    replacements: BTreeMap<String, Vec<u8>>,
    additions: BTreeMap<String, Vec<u8>>,
    removals: HashSet<String>,
}

#[derive(Debug, Clone)]
#[cfg(any(test, windows))]
pub(crate) struct LegacyPresentationMetafile {
    pub package_path: String,
    pub data: Vec<u8>,
}

pub fn edit(
    request: PresentationEditRequest,
    reuse_data: Option<&[u8]>,
) -> AppResult<PresentationEditResult> {
    if request.data.starts_with(&[0xd0, 0xcf, 0x11, 0xe0]) {
        return Err(AppError::dependency_missing(
            "Legacy .ppt files must be converted with LibreOffice, WPS Presentation, or PowerPoint before editing",
        ));
    }

    validate_operation_limits(&request.operation)?;

    let mut package = Package::open(&request.data)?;
    let initial_order = slide_order(&package)?;
    if initial_order.is_empty() {
        return Err(invalid_presentation("The presentation contains no slides"));
    }

    match request.operation {
        PresentationEditOperation::Inspect { slide_index } => {
            let index = clamp_slide_index(slide_index, initial_order.len());
            let text = inspect_slide(&package, &initial_order[index])?;
            Ok(result(None, initial_order.len(), index, Some(text)))
        }
        PresentationEditOperation::UpdateText {
            slide_index,
            title,
            body,
        } => {
            let index = clamp_slide_index(slide_index, initial_order.len());
            let path = initial_order[index].clone();
            let xml = package.part(&path)?.to_vec();
            package.set_part(path, update_slide_text(&xml, &title, &body)?);
            finish_result(package, initial_order.len(), index)
        }
        PresentationEditOperation::UpdateNodeText {
            slide_index,
            node_id,
            text,
        } => {
            let index = clamp_slide_index(slide_index, initial_order.len());
            let path = initial_order[index].clone();
            let xml = package.part(&path)?.to_vec();
            let shapes = parse_shapes(&xml)?;
            let target = shapes.iter().find(|shape| shape.id == node_id);
            if target.is_none() {
                return Err(AppError::new(
                    "presentation-node-not-found",
                    format!("PRESENTATION_NODE_NOT_FOUND: shape {node_id} does not exist"),
                ));
            }
            if !target.is_some_and(|shape| shape.has_text_body) {
                return Err(AppError::new(
                    "presentation-node-not-text",
                    format!("PRESENTATION_NODE_NOT_TEXT: shape {node_id} has no text body"),
                ));
            }
            package.set_part(path, rewrite_shape_text(&xml, &[(node_id, text)])?);
            finish_result(package, initial_order.len(), index)
        }
        PresentationEditOperation::Add { after_slide_index } => {
            let after = clamp_after_index(after_slide_index, initial_order.len());
            let template_index = after.unwrap_or(0).min(initial_order.len() - 1);
            let template = initial_order[template_index].clone();
            let new_index = insert_cloned_slide(&mut package, after, &template, true, None)?;
            finish_result(package, initial_order.len() + 1, new_index)
        }
        PresentationEditOperation::Duplicate { slide_index } => {
            let index = clamp_slide_index(slide_index, initial_order.len());
            let template = initial_order[index].clone();
            let new_index = insert_cloned_slide(&mut package, Some(index), &template, false, None)?;
            finish_result(package, initial_order.len() + 1, new_index)
        }
        PresentationEditOperation::Delete { slide_index } => {
            if initial_order.len() == 1 {
                return Err(AppError::new(
                    "presentation-cannot-delete-only-slide",
                    "PRESENTATION_CANNOT_DELETE_ONLY_SLIDE",
                ));
            }
            let index = clamp_slide_index(slide_index, initial_order.len());
            delete_slide(&mut package, index)?;
            finish_result(
                package,
                initial_order.len() - 1,
                index.min(initial_order.len() - 2),
            )
        }
        PresentationEditOperation::ImportOutline {
            after_slide_index,
            slides,
        } => {
            if slides.len() > MAX_SLIDES.saturating_sub(initial_order.len()) {
                return Err(AppError::new(
                    "presentation-too-many-slides",
                    format!("A presentation may contain at most {MAX_SLIDES} slides"),
                ));
            }
            let mut after = clamp_after_index(after_slide_index, initial_order.len());
            let template_index = after.unwrap_or(0).min(initial_order.len() - 1);
            let template = initial_order[template_index].clone();
            let mut first_inserted = after.map_or(0, |value| value + 1);
            for (offset, slide) in slides.iter().enumerate() {
                let new_index =
                    insert_cloned_slide(&mut package, after, &template, true, Some(slide))?;
                if offset == 0 {
                    first_inserted = new_index;
                }
                after = Some(new_index);
            }
            if slides.is_empty() {
                return finish_result(
                    package,
                    initial_order.len(),
                    clamp_slide_index(after_slide_index, initial_order.len()),
                );
            }
            finish_result(package, initial_order.len() + slides.len(), first_inserted)
        }
        PresentationEditOperation::ReuseSlides {
            after_slide_index, ..
        } => {
            let source_data = reuse_data.ok_or_else(|| {
                AppError::new(
                    "presentation-reuse-file-not-found",
                    "PRESENTATION_REUSE_FILE_NOT_FOUND",
                )
            })?;
            let source = Package::open(source_data).map_err(|error| {
                AppError::new(
                    "presentation-reuse-invalid",
                    format!("PRESENTATION_REUSE_INSERT_FAILED: {error}"),
                )
            })?;
            let source_order = slide_order(&source)?;
            if source_order.is_empty() {
                return Err(AppError::new(
                    "presentation-reuse-empty",
                    "PRESENTATION_REUSE_INSERT_FAILED: source presentation has no slides",
                ));
            }
            if source_order.len() > MAX_SLIDES.saturating_sub(initial_order.len()) {
                return Err(AppError::new(
                    "presentation-too-many-slides",
                    format!("A presentation may contain at most {MAX_SLIDES} slides"),
                ));
            }
            let inserted_count = source_order.len();
            let mut after = clamp_after_index(after_slide_index, initial_order.len());
            let first_inserted = after.map_or(0, |value| value + 1);

            // Allocate every imported slide path up front. A single mapping for
            // the whole source deck preserves hyperlinks and other cross-slide
            // relationships without recursively creating hidden duplicate slides.
            let mut mapping = HashMap::new();
            let mut reserved = HashSet::new();
            for source_slide in &source_order {
                let destination_slide = next_slide_path_excluding(&package, &reserved)?;
                reserved.insert(destination_slide.clone());
                mapping.insert(source_slide.clone(), destination_slide);
            }
            for source_slide in &source_order {
                let new_index =
                    import_slide(&source, &mut package, source_slide, after, &mut mapping)?;
                after = Some(new_index);
            }
            finish_result(
                package,
                initial_order.len() + inserted_count,
                first_inserted,
            )
        }
    }
}

fn validate_operation_limits(operation: &PresentationEditOperation) -> AppResult<()> {
    let check_text = |value: &str| {
        if value.len() > MAX_EDIT_TEXT_BYTES {
            Err(AppError::new(
                "presentation-text-too-large",
                "A presentation text edit may not exceed 4 MiB",
            ))
        } else {
            Ok(())
        }
    };

    match operation {
        PresentationEditOperation::UpdateText { title, body, .. } => {
            check_text(title)?;
            check_text(body)
        }
        PresentationEditOperation::UpdateNodeText { text, .. } => check_text(text),
        PresentationEditOperation::ImportOutline { slides, .. } => {
            let total = slides.iter().try_fold(0_usize, |total, slide| {
                check_text(&slide.title)?;
                check_text(&slide.body)?;
                total
                    .checked_add(slide.title.len())
                    .and_then(|value| value.checked_add(slide.body.len()))
                    .ok_or_else(|| {
                        AppError::new(
                            "presentation-text-too-large",
                            "The presentation outline text size overflowed",
                        )
                    })
            })?;
            if total > MAX_OUTLINE_TEXT_BYTES {
                return Err(AppError::new(
                    "presentation-text-too-large",
                    "A presentation outline import may not exceed 16 MiB",
                ));
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn result(
    data: Option<Vec<u8>>,
    slide_count: usize,
    current_slide_index: usize,
    slide: Option<PresentationSlideText>,
) -> PresentationEditResult {
    PresentationEditResult {
        data,
        slide_count,
        current_slide_index,
        slide,
        converter: "powerpoint",
        normalized_wmf_count: 0,
    }
}

fn finish_result(
    package: Package<'_>,
    slide_count: usize,
    current_slide_index: usize,
) -> AppResult<PresentationEditResult> {
    Ok(result(
        Some(package.finish()?),
        slide_count,
        current_slide_index,
        None,
    ))
}

impl<'a> Package<'a> {
    fn open(source: &'a [u8]) -> AppResult<Self> {
        if source.len() > MAX_ARCHIVE_BYTES {
            return Err(AppError::new(
                "file-too-large",
                "Presentation exceeds the 100 MiB processing limit",
            ));
        }
        let mut archive = ZipArchive::new(Cursor::new(source)).map_err(zip_error)?;
        if archive.len() > MAX_ENTRIES {
            return Err(invalid_presentation(format!(
                "Presentation contains more than {MAX_ENTRIES} ZIP entries"
            )));
        }
        let mut total = 0_u64;
        let mut original = BTreeMap::new();
        let mut folded_names = HashSet::with_capacity(archive.len());
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(zip_error)?;
            if file.encrypted() {
                return Err(invalid_presentation(
                    "Encrypted PPTX parts are not supported",
                ));
            }
            if file.name_raw().contains(&b'\\') {
                return Err(invalid_presentation(
                    "OOXML ZIP part names must use forward slashes",
                ));
            }
            let name = file.name().to_owned();
            validate_part_name(&name)?;
            if original.contains_key(&name) || !folded_names.insert(name.to_ascii_lowercase()) {
                return Err(invalid_presentation(format!("Duplicate ZIP part: {name}")));
            }
            if file.size() > MAX_PART_BYTES {
                return Err(invalid_presentation(format!(
                    "ZIP part exceeds the 64 MiB limit: {name}"
                )));
            }
            let declared_size = file.size();
            let mut bytes = Vec::with_capacity(declared_size as usize);
            (&mut file)
                .take(MAX_PART_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| {
                    invalid_presentation(format!("Cannot read ZIP part {name}: {error}"))
                })?;
            if bytes.len() as u64 > MAX_PART_BYTES {
                return Err(invalid_presentation(format!(
                    "ZIP part exceeds the 64 MiB limit while expanding: {name}"
                )));
            }
            if bytes.len() as u64 != declared_size {
                return Err(invalid_presentation(format!(
                    "Expanded size does not match ZIP metadata for part: {name}"
                )));
            }
            total = total
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| invalid_presentation("Expanded ZIP size overflow"))?;
            if total > MAX_EXPANDED_BYTES {
                return Err(invalid_presentation(
                    "Expanded presentation exceeds the 256 MiB limit",
                ));
            }
            original.insert(name, bytes);
        }
        for required in [
            CONTENT_TYPES_PART,
            PRESENTATION_PART,
            PRESENTATION_RELS_PART,
        ] {
            if !original.contains_key(required) {
                return Err(invalid_presentation(format!(
                    "Required OOXML part is missing: {required}"
                )));
            }
        }
        Ok(Self {
            source,
            original,
            replacements: BTreeMap::new(),
            additions: BTreeMap::new(),
            removals: HashSet::new(),
        })
    }

    fn part(&self, name: &str) -> AppResult<&[u8]> {
        if self.removals.contains(name) {
            return Err(invalid_presentation(format!(
                "OOXML part was removed: {name}"
            )));
        }
        self.replacements
            .get(name)
            .or_else(|| self.additions.get(name))
            .or_else(|| self.original.get(name))
            .map(Vec::as_slice)
            .ok_or_else(|| invalid_presentation(format!("OOXML part is missing: {name}")))
    }

    fn optional_part(&self, name: &str) -> Option<&[u8]> {
        if self.removals.contains(name) {
            return None;
        }
        self.replacements
            .get(name)
            .or_else(|| self.additions.get(name))
            .or_else(|| self.original.get(name))
            .map(Vec::as_slice)
    }

    fn contains(&self, name: &str) -> bool {
        self.optional_part(name).is_some()
    }

    fn active_names(&self) -> impl Iterator<Item = &str> {
        self.original
            .keys()
            .chain(self.additions.keys())
            .filter(|name| !self.removals.contains(name.as_str()))
            .map(String::as_str)
    }

    fn set_part(&mut self, name: String, data: Vec<u8>) {
        self.removals.remove(&name);
        if self.original.contains_key(&name) {
            self.replacements.insert(name, data);
        } else {
            self.additions.insert(name, data);
        }
    }

    fn remove_part(&mut self, name: &str) {
        self.replacements.remove(name);
        self.additions.remove(name);
        if self.original.contains_key(name) {
            self.removals.insert(name.to_owned());
        }
    }

    fn finish(mut self) -> AppResult<Vec<u8>> {
        self.validate_active_limits(MAX_ENTRIES, MAX_PART_BYTES, MAX_EXPANDED_BYTES)?;

        let mut source = ZipArchive::new(Cursor::new(self.source)).map_err(zip_error)?;
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.set_raw_comment(source.comment().to_vec().into_boxed_slice());
        for index in 0..source.len() {
            let file = source.by_index(index).map_err(zip_error)?;
            let name = file.name().to_owned();
            if self.removals.contains(&name) {
                continue;
            }
            if let Some(data) = self.replacements.remove(&name) {
                let permissions = file.unix_mode().unwrap_or(0o644);
                drop(file);
                writer
                    .start_file(
                        &name,
                        SimpleFileOptions::default()
                            .compression_method(CompressionMethod::Deflated)
                            .unix_permissions(permissions),
                    )
                    .map_err(zip_error)?;
                writer.write_all(&data).map_err(AppError::from)?;
            } else {
                writer.raw_copy_file(file).map_err(zip_error)?;
            }
        }
        if !self.replacements.is_empty() {
            return Err(invalid_presentation(
                "Not every edited OOXML part was written",
            ));
        }
        for (name, data) in self.additions {
            writer
                .start_file(
                    name,
                    SimpleFileOptions::default()
                        .compression_method(CompressionMethod::Deflated)
                        .unix_permissions(0o644),
                )
                .map_err(zip_error)?;
            writer.write_all(&data).map_err(AppError::from)?;
        }
        let output = writer.finish().map_err(zip_error)?.into_inner();
        if output.len() > MAX_ARCHIVE_BYTES {
            return Err(AppError::new(
                "file-too-large",
                "Edited presentation exceeds the 100 MiB processing limit",
            ));
        }
        // A final central-directory parse ensures no partial/corrupt archive can
        // escape the in-memory transaction.
        ZipArchive::new(Cursor::new(&output)).map_err(zip_error)?;
        Ok(output)
    }

    fn validate_active_limits(
        &self,
        max_entries: usize,
        max_part_bytes: u64,
        max_expanded_bytes: u64,
    ) -> AppResult<()> {
        let mut count = 0_usize;
        let mut total = 0_u64;
        let mut folded_names = HashSet::new();
        for name in self.active_names() {
            validate_part_name(name)?;
            if !folded_names.insert(name.to_ascii_lowercase()) {
                return Err(invalid_presentation(format!(
                    "Duplicate edited ZIP part: {name}"
                )));
            }
            count = count
                .checked_add(1)
                .ok_or_else(|| invalid_presentation("ZIP entry count overflow"))?;
            if count > max_entries {
                return Err(invalid_presentation(format!(
                    "Edited presentation contains more than {max_entries} ZIP entries"
                )));
            }
            let size = self.part(name)?.len() as u64;
            if size > max_part_bytes {
                return Err(invalid_presentation(format!(
                    "Edited ZIP part exceeds the {max_part_bytes}-byte limit: {name}"
                )));
            }
            total = total
                .checked_add(size)
                .ok_or_else(|| invalid_presentation("Expanded ZIP size overflow"))?;
            if total > max_expanded_bytes {
                return Err(invalid_presentation(format!(
                    "Edited presentation exceeds the {max_expanded_bytes}-byte expanded limit"
                )));
            }
        }
        Ok(())
    }
}

#[cfg(any(test, windows))]
pub(crate) fn extract_legacy_presentation_metafiles(
    source: &[u8],
) -> AppResult<Vec<LegacyPresentationMetafile>> {
    if !may_contain_legacy_metafile(source) {
        return Ok(Vec::new());
    }

    let package = Package::open(source)?;
    let paths = package
        .active_names()
        .filter(|name| is_legacy_metafile_path(name))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if paths.len() > MAX_LEGACY_METAFILES {
        return Err(AppError::new(
            "presentation-media-limit",
            format!("Presentation contains more than {MAX_LEGACY_METAFILES} WMF/EMF media parts"),
        )
        .with_details(serde_json::json!({
            "actualCount": paths.len(),
            "limitCount": MAX_LEGACY_METAFILES,
        })));
    }

    paths
        .into_iter()
        .map(|package_path| {
            Ok(LegacyPresentationMetafile {
                data: package.part(&package_path)?.to_vec(),
                package_path,
            })
        })
        .collect()
}

/// Replaces only successfully rasterized metafiles. All other ZIP parts are
/// copied verbatim, and relationship XML is rewritten only when it targets a
/// converted part.
#[cfg(any(test, windows))]
pub(crate) fn replace_legacy_presentation_metafiles(
    source: &[u8],
    converted: &BTreeMap<String, Vec<u8>>,
) -> AppResult<(Vec<u8>, usize)> {
    if converted.is_empty() {
        return Ok((source.to_vec(), 0));
    }
    if converted.len() > MAX_LEGACY_METAFILES {
        return Err(AppError::new(
            "presentation-media-limit",
            "Too many converted presentation media parts",
        )
        .with_details(serde_json::json!({
            "actualCount": converted.len(),
            "limitCount": MAX_LEGACY_METAFILES,
        })));
    }

    let mut package = Package::open(source)?;
    let mut path_updates = BTreeMap::<String, String>::new();
    let mut allocated = HashSet::new();
    for (source_path, png) in converted {
        if !is_legacy_metafile_path(source_path) || !package.contains(source_path) {
            continue;
        }
        if png.len() as u64 > MAX_PART_BYTES {
            return Err(AppError::new(
                "file-too-large",
                "Rasterized presentation image exceeds the per-part limit",
            )
            .with_details(serde_json::json!({
                "part": source_path,
                "actualBytes": png.len(),
                "limitBytes": MAX_PART_BYTES,
            })));
        }
        validate_rasterized_png(source_path, png)?;
        let target_path = allocate_normalized_media_path(&package, source_path, &allocated)?;
        allocated.insert(target_path.clone());
        path_updates.insert(source_path.clone(), target_path);
    }
    if path_updates.is_empty() {
        return Ok((source.to_vec(), 0));
    }

    let relationship_parts = package
        .active_names()
        .filter(|name| name.ends_with(".rels"))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    for relationship_part in relationship_parts {
        let Some(owner) = relationship_owner_path(&relationship_part) else {
            continue;
        };
        let xml = package.part(&relationship_part)?.to_vec();
        let relationships = parse_relationships(&xml)?;
        let mut target_updates = HashMap::new();
        for relationship in relationships {
            if relationship
                .target_mode
                .as_deref()
                .is_some_and(|mode| mode.eq_ignore_ascii_case("external"))
                || !target_may_reference_legacy_metafile(&relationship.target)
            {
                continue;
            }
            let resolved = resolve_relationship_target(&owner, &relationship.target)?;
            let Some(target_path) = path_updates.get(&resolved) else {
                continue;
            };
            let target = if relationship.target.starts_with('/') {
                format!("/{}", encode_package_path(target_path))
            } else {
                relative_target(&owner, target_path)?
            };
            target_updates.insert(relationship.id, target);
        }
        if !target_updates.is_empty() {
            package.set_part(
                relationship_part,
                modify_relationships(&xml, &HashSet::new(), &target_updates, &[])?,
            );
        }
    }

    let removed_parts = path_updates.keys().cloned().collect::<Vec<_>>();
    let added_parts = path_updates
        .values()
        .cloned()
        .map(|path| (path, "image/png".to_owned()))
        .collect::<Vec<_>>();
    let content_types = package.part(CONTENT_TYPES_PART)?.to_vec();
    package.set_part(
        CONTENT_TYPES_PART.to_owned(),
        modify_content_types(&content_types, &removed_parts, &added_parts)?,
    );

    for (source_path, target_path) in &path_updates {
        package.set_part(
            target_path.clone(),
            converted
                .get(source_path)
                .expect("validated conversion map entry")
                .clone(),
        );
        package.remove_part(source_path);
    }

    let count = path_updates.len();
    Ok((package.finish()?, count))
}

#[cfg(any(test, windows))]
pub(crate) fn validate_rasterized_png(source_path: &str, data: &[u8]) -> AppResult<()> {
    let mut options = png::DecodeOptions::default();
    options.set_ignore_adler32(false);
    options.set_ignore_crc(false);
    options.set_skip_ancillary_crc_failures(false);
    let mut cursor = Cursor::new(data);
    let mut decoder = png::Decoder::new_with_options(&mut cursor, options);
    decoder.set_limits(png::Limits {
        bytes: MAX_PNG_DECODER_BYTES,
    });
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|error| {
        invalid_presentation(format!(
            "Rasterized media is not a valid PNG image ({source_path}): {error}"
        ))
    })?;
    let info = reader.info();
    let pixels = u64::from(info.width)
        .checked_mul(u64::from(info.height))
        .ok_or_else(|| invalid_presentation("Rasterized PNG pixel count overflow"))?;
    if info.width == 0
        || info.height == 0
        || info.width > MAX_RASTERIZED_IMAGE_DIMENSION
        || info.height > MAX_RASTERIZED_IMAGE_DIMENSION
        || pixels > MAX_RASTERIZED_IMAGE_PIXELS
    {
        return Err(invalid_presentation(format!(
            "Rasterized PNG dimensions exceed the normalization limit: {source_path}"
        )));
    }
    let output_size = reader
        .output_buffer_size()
        .ok_or_else(|| invalid_presentation("Rasterized PNG decoded size overflow"))?;
    let max_output_size = usize::try_from(pixels)
        .ok()
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| invalid_presentation("Rasterized PNG decoded size overflow"))?;
    if output_size > max_output_size {
        return Err(invalid_presentation(format!(
            "Rasterized PNG decoded size exceeds the normalization limit: {source_path}"
        )));
    }
    let mut decoded = vec![0_u8; output_size];
    reader.next_frame(&mut decoded).map_err(|error| {
        invalid_presentation(format!(
            "Rasterized PNG pixels are invalid ({source_path}): {error}"
        ))
    })?;
    reader.finish().map_err(|error| {
        invalid_presentation(format!(
            "Rasterized PNG trailing chunks are invalid ({source_path}): {error}"
        ))
    })?;
    drop(reader);
    if cursor.position() != data.len() as u64 {
        return Err(invalid_presentation(format!(
            "Rasterized PNG contains data after IEND: {source_path}"
        )));
    }
    Ok(())
}

#[cfg(any(test, windows))]
fn may_contain_legacy_metafile(source: &[u8]) -> bool {
    source
        .windows(4)
        .any(|window| window.eq_ignore_ascii_case(b".wmf") || window.eq_ignore_ascii_case(b".emf"))
}

#[cfg(any(test, windows))]
fn is_legacy_metafile_path(name: &str) -> bool {
    let Some(file_name) = name.strip_prefix("ppt/media/") else {
        return false;
    };
    !file_name.is_empty()
        && !file_name.contains('/')
        && Path::new(file_name)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                extension.eq_ignore_ascii_case("wmf") || extension.eq_ignore_ascii_case("emf")
            })
}

#[cfg(any(test, windows))]
fn target_may_reference_legacy_metafile(target: &str) -> bool {
    let path = target.split(['?', '#']).next().unwrap_or(target);
    if validate_percent_encoding(path).is_err() {
        return false;
    }
    let Ok(path) = percent_decode_str(path).decode_utf8() else {
        return false;
    };
    Path::new(path.as_ref())
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("wmf") || extension.eq_ignore_ascii_case("emf")
        })
}

#[cfg(any(test, windows))]
fn allocate_normalized_media_path(
    package: &Package<'_>,
    source_path: &str,
    allocated: &HashSet<String>,
) -> AppResult<String> {
    let path = Path::new(source_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid_presentation("Legacy media part has no file stem"))?;
    for index in 0..=MAX_ENTRIES {
        let name = if index == 0 {
            format!("{stem}.png")
        } else {
            format!("{stem}_wae{index}.png")
        };
        let candidate = parent.join(name).to_string_lossy().replace('\\', "/");
        if !package.contains(&candidate) && !allocated.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(invalid_presentation(
        "Cannot allocate a normalized presentation media part name",
    ))
}

#[cfg(any(test, windows))]
fn relationship_owner_path(relationship_part: &str) -> Option<String> {
    if relationship_part == "_rels/.rels" {
        return Some(String::new());
    }
    let (parent, file_name) = relationship_part.rsplit_once("/_rels/")?;
    let owner_name = file_name.strip_suffix(".rels")?;
    (!owner_name.is_empty()).then(|| format!("{parent}/{owner_name}"))
}

fn validate_part_name(name: &str) -> AppResult<()> {
    if name.is_empty()
        || name.len() > MAX_PART_NAME_BYTES
        || name.starts_with('/')
        || name.contains('\0')
        || name.contains("//")
        || name
            .split('/')
            .any(|segment| segment == "." || segment == "..")
        || name
            .split('/')
            .next()
            .is_some_and(|segment| segment.as_bytes().get(1) == Some(&b':'))
    {
        return Err(invalid_presentation("Invalid ZIP part name"));
    }
    let path = Path::new(name);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(invalid_presentation(format!(
            "Unsafe ZIP part name: {name}"
        )));
    }
    Ok(())
}

fn slide_order(package: &Package<'_>) -> AppResult<Vec<String>> {
    let refs = parse_slide_refs(package.part(PRESENTATION_PART)?)?;
    if refs.len() > MAX_SLIDES {
        return Err(invalid_presentation(format!(
            "Presentation contains more than {MAX_SLIDES} slides"
        )));
    }
    let relationships = parse_relationships(package.part(PRESENTATION_RELS_PART)?)?;
    let by_id = relationships
        .iter()
        .map(|relationship| (relationship.id.as_str(), relationship))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    refs.iter()
        .map(|slide| {
            let relationship = by_id.get(slide.relationship_id.as_str()).ok_or_else(|| {
                invalid_presentation(format!(
                    "Slide relationship is missing: {}",
                    slide.relationship_id
                ))
            })?;
            if !is_slide_relationship(&relationship.relationship_type)
                || relationship.target_mode.is_some()
            {
                return Err(invalid_presentation(format!(
                    "Invalid slide relationship: {}",
                    relationship.id
                )));
            }
            let target = resolve_relationship_target(PRESENTATION_PART, &relationship.target)?;
            if !seen.insert(target.clone()) {
                return Err(invalid_presentation(format!(
                    "Multiple slide IDs reference the same part: {target}"
                )));
            }
            package.part(&target)?;
            Ok(target)
        })
        .collect()
}

fn parse_slide_refs(xml: &[u8]) -> AppResult<Vec<SlideRef>> {
    ensure_xml_limit(xml)?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut refs = Vec::new();
    let mut slide_ids = HashSet::new();
    let mut relationship_ids = HashSet::new();
    let mut saw_list = false;
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Start(event) if local_name(event.name().as_ref()) == b"sldIdLst" => {
                saw_list = true;
            }
            Event::Empty(event) | Event::Start(event)
                if local_name(event.name().as_ref()) == b"sldId" =>
            {
                let id = required_attribute_exact(&event, b"id", reader.decoder())?
                    .parse::<u32>()
                    .map_err(|_| invalid_presentation("Slide ID is not an unsigned integer"))?;
                // The relationship attribute is namespaced. Prefer r:id over the
                // unqualified numeric `id` attribute.
                let relationship_id = event
                    .attributes()
                    .with_checks(false)
                    .filter_map(Result::ok)
                    .find(|attribute| attribute.key.as_ref().ends_with(b":id"))
                    .ok_or_else(|| invalid_presentation("Slide r:id is missing"))?
                    .decoded_and_normalized_value(
                        quick_xml::XmlVersion::default(),
                        reader.decoder(),
                    )
                    .map_err(xml_error)?
                    .into_owned();
                if !slide_ids.insert(id) {
                    return Err(invalid_presentation(format!(
                        "Duplicate presentation slide ID: {id}"
                    )));
                }
                if !relationship_ids.insert(relationship_id.clone()) {
                    return Err(invalid_presentation(format!(
                        "Duplicate presentation slide relationship ID: {relationship_id}"
                    )));
                }
                refs.push(SlideRef {
                    id,
                    relationship_id,
                });
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_list {
        return Err(invalid_presentation("Presentation slide list is missing"));
    }
    Ok(refs)
}

fn parse_relationships(xml: &[u8]) -> AppResult<Vec<Relationship>> {
    ensure_xml_limit(xml)?;
    validate_opc_list_xml(
        xml,
        b"Relationships",
        &[b"Relationship"],
        PACKAGE_RELATIONSHIPS_NS,
    )?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut relationships = Vec::new();
    let mut ids = HashSet::new();
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Empty(event) | Event::Start(event)
                if local_name(event.name().as_ref()) == b"Relationship" =>
            {
                let id = required_attribute_exact(&event, b"Id", reader.decoder())?;
                if !ids.insert(id.clone()) {
                    return Err(invalid_presentation(format!(
                        "Duplicate relationship ID: {id}"
                    )));
                }
                relationships.push(Relationship {
                    id,
                    relationship_type: required_attribute_exact(&event, b"Type", reader.decoder())?,
                    target: required_attribute_exact(&event, b"Target", reader.decoder())?,
                    target_mode: optional_attribute_exact(&event, b"TargetMode", reader.decoder())?,
                });
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(relationships)
}

fn parse_content_types(xml: &[u8]) -> AppResult<ContentTypes> {
    ensure_xml_limit(xml)?;
    validate_opc_list_xml(
        xml,
        b"Types",
        &[b"Default", b"Override"],
        PACKAGE_CONTENT_TYPES_NS,
    )?;
    let mut reader = Reader::from_reader(xml);
    let mut result = ContentTypes::default();
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Empty(event) | Event::Start(event)
                if local_name(event.name().as_ref()) == b"Default" =>
            {
                let extension = required_attribute_exact(&event, b"Extension", reader.decoder())?
                    .to_ascii_lowercase();
                let content_type =
                    required_attribute_exact(&event, b"ContentType", reader.decoder())?;
                if result
                    .defaults
                    .insert(extension.clone(), content_type)
                    .is_some()
                {
                    return Err(invalid_presentation(format!(
                        "Duplicate content type default: {extension}"
                    )));
                }
            }
            Event::Empty(event) | Event::Start(event)
                if local_name(event.name().as_ref()) == b"Override" =>
            {
                let encoded_part = required_attribute_exact(&event, b"PartName", reader.decoder())?;
                let part = decode_content_type_part_name(&encoded_part)?;
                let content_type =
                    required_attribute_exact(&event, b"ContentType", reader.decoder())?;
                if result
                    .overrides
                    .insert(part.clone(), content_type)
                    .is_some()
                {
                    return Err(invalid_presentation(format!(
                        "Duplicate content type override: {part}"
                    )));
                }
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(result)
}

impl ContentTypes {
    fn for_part(&self, part: &str) -> Option<&str> {
        self.overrides.get(part).map(String::as_str).or_else(|| {
            Path::new(part)
                .extension()
                .and_then(|extension| extension.to_str())
                .and_then(|extension| self.defaults.get(&extension.to_ascii_lowercase()))
                .map(String::as_str)
        })
    }
}

fn inspect_slide(package: &Package<'_>, slide_path: &str) -> AppResult<PresentationSlideText> {
    let shapes = parse_shapes(package.part(slide_path)?)?;
    let (title, body) = select_title_and_body(&shapes);
    Ok(PresentationSlideText {
        title: title.map_or_else(String::new, |shape| shape.text.clone()),
        body: body.map_or_else(String::new, |shape| shape.text.clone()),
    })
}

fn parse_shapes(xml: &[u8]) -> AppResult<Vec<ShapeInfo>> {
    ensure_xml_limit(xml)?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut shapes = Vec::new();
    let mut current: Option<ShapeInfo> = None;
    let mut shape_depth = 0_usize;
    let mut in_text_body = false;
    let mut in_text = false;
    let mut paragraph_has_text = false;
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Start(event) => {
                let qualified_name = event.name();
                let name = local_name(qualified_name.as_ref());
                if name == b"sp" && current.is_none() {
                    current = Some(ShapeInfo {
                        id: String::new(),
                        placeholder_type: None,
                        text: String::new(),
                        has_text_body: false,
                    });
                    shape_depth = 1;
                } else if let Some(shape) = current.as_mut() {
                    shape_depth += 1;
                    if name == b"cNvPr" && shape.id.is_empty() {
                        shape.id = required_attribute(&event, b"id", reader.decoder())?;
                    } else if name == b"ph" {
                        shape.placeholder_type =
                            optional_attribute(&event, b"type", reader.decoder())?
                                .or_else(|| Some("body".to_owned()));
                    } else if name == b"txBody" {
                        shape.has_text_body = true;
                        in_text_body = true;
                    } else if name == b"p" && in_text_body {
                        paragraph_has_text = false;
                    } else if name == b"t" && in_text_body {
                        in_text = true;
                    }
                }
            }
            Event::Empty(event) => {
                if let Some(shape) = current.as_mut() {
                    let qualified_name = event.name();
                    let name = local_name(qualified_name.as_ref());
                    if name == b"cNvPr" && shape.id.is_empty() {
                        shape.id = required_attribute(&event, b"id", reader.decoder())?;
                    } else if name == b"ph" {
                        shape.placeholder_type =
                            optional_attribute(&event, b"type", reader.decoder())?
                                .or_else(|| Some("body".to_owned()));
                    } else if name == b"txBody" {
                        shape.has_text_body = true;
                    }
                }
            }
            Event::Text(event) if in_text => {
                if let Some(shape) = current.as_mut() {
                    let decoded = event.decode().map_err(xml_error)?;
                    let text = quick_xml::escape::unescape(&decoded)
                        .map_err(xml_error)?
                        .into_owned();
                    append_shape_text(shape, &text, &mut paragraph_has_text);
                }
            }
            Event::GeneralRef(event) if in_text => {
                if let Some(shape) = current.as_mut() {
                    let text = if let Some(value) = event.resolve_char_ref().map_err(xml_error)? {
                        value.to_string()
                    } else {
                        match event.decode().map_err(xml_error)?.as_ref() {
                            "amp" => "&".to_owned(),
                            "lt" => "<".to_owned(),
                            "gt" => ">".to_owned(),
                            "apos" => "'".to_owned(),
                            "quot" => "\"".to_owned(),
                            entity => {
                                return Err(invalid_presentation(format!(
                                    "Unknown XML entity reference: &{entity};"
                                )))
                            }
                        }
                    };
                    append_shape_text(shape, &text, &mut paragraph_has_text);
                }
            }
            Event::End(event) => {
                let qualified_name = event.name();
                let name = local_name(qualified_name.as_ref());
                if current.is_some() {
                    if name == b"t" {
                        in_text = false;
                    } else if name == b"txBody" {
                        in_text_body = false;
                    }
                    shape_depth = shape_depth.saturating_sub(1);
                    if shape_depth == 0 {
                        let shape = current.take().expect("shape state");
                        if !shape.id.is_empty() {
                            shapes.push(shape);
                        }
                    }
                }
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(shapes)
}

fn append_shape_text(shape: &mut ShapeInfo, text: &str, paragraph_has_text: &mut bool) {
    if text.is_empty() {
        return;
    }
    if !*paragraph_has_text && !shape.text.is_empty() {
        shape.text.push('\n');
    }
    shape.text.push_str(text);
    *paragraph_has_text = true;
}

fn select_title_and_body(shapes: &[ShapeInfo]) -> (Option<&ShapeInfo>, Option<&ShapeInfo>) {
    let title = shapes
        .iter()
        .find(|shape| {
            shape.has_text_body
                && matches!(
                    shape.placeholder_type.as_deref(),
                    Some("title" | "ctrTitle")
                )
        })
        .or_else(|| {
            shapes
                .iter()
                .find(|shape| shape.has_text_body && !shape.text.is_empty())
        });
    let body = shapes
        .iter()
        .find(|shape| {
            shape.has_text_body
                && matches!(
                    shape.placeholder_type.as_deref(),
                    Some("body" | "obj" | "subTitle")
                )
                && title.map_or(true, |title| title.id != shape.id)
        })
        .or_else(|| {
            shapes.iter().find(|shape| {
                shape.has_text_body && title.map_or(true, |title| title.id != shape.id)
            })
        });
    (title, body)
}

fn update_slide_text(xml: &[u8], title: &str, body: &str) -> AppResult<Vec<u8>> {
    let shapes = parse_shapes(xml)?;
    let (title_shape, body_shape) = select_title_and_body(&shapes);
    let mut replacements = Vec::new();
    if let Some(shape) = title_shape {
        replacements.push((shape.id.clone(), title.to_owned()));
    }
    if let Some(shape) = body_shape {
        replacements.push((shape.id.clone(), body.to_owned()));
    }
    let mut output = rewrite_shape_text(xml, &replacements)?;
    let max_id = shapes
        .iter()
        .filter_map(|shape| shape.id.parse::<u32>().ok())
        .max()
        .unwrap_or(1);
    if title_shape.is_none() {
        output = append_text_shape(&output, max_id.saturating_add(1), "title", title, 300_000)?;
    }
    if body_shape.is_none() {
        output = append_text_shape(
            &output,
            max_id.saturating_add(if title_shape.is_none() { 2 } else { 1 }),
            "body",
            body,
            1_300_000,
        )?;
    }
    ensure_xml_limit(&output)?;
    Ok(output)
}

fn rewrite_shape_text(xml: &[u8], replacements: &[(String, String)]) -> AppResult<Vec<u8>> {
    if replacements.is_empty() {
        return Ok(xml.to_vec());
    }
    ensure_xml_limit(xml)?;
    let replacements = replacements.iter().cloned().collect::<HashMap<_, _>>();
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len()));
    let mut shape_id = None::<String>;
    let mut shape_depth = 0_usize;
    let mut first_text_written = false;
    let mut in_text_body = false;
    let mut skip_text_depth = 0_usize;
    loop {
        let event = reader.read_event().map_err(xml_error)?;
        if skip_text_depth > 0 {
            match event {
                Event::Start(_) => skip_text_depth += 1,
                Event::End(_) => skip_text_depth -= 1,
                Event::Eof => return Err(invalid_presentation("Unexpected end of slide XML")),
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(event) => {
                let qualified_name = event.name();
                let name = local_name(qualified_name.as_ref());
                if name == b"sp" && shape_depth == 0 {
                    shape_depth = 1;
                    shape_id = None;
                    first_text_written = false;
                    in_text_body = false;
                    writer.write_event(Event::Start(event)).map_err(xml_error)?;
                } else {
                    if shape_depth > 0 {
                        shape_depth += 1;
                        if name == b"cNvPr" && shape_id.is_none() {
                            shape_id = Some(required_attribute(&event, b"id", reader.decoder())?);
                        }
                    }
                    if name == b"txBody"
                        && shape_id
                            .as_ref()
                            .is_some_and(|id| replacements.contains_key(id))
                    {
                        in_text_body = true;
                    }
                    if name == b"t"
                        && in_text_body
                        && shape_id
                            .as_ref()
                            .is_some_and(|id| replacements.contains_key(id))
                    {
                        let text_element_name =
                            String::from_utf8_lossy(event.name().as_ref()).into_owned();
                        writer
                            .write_event(Event::Start(event.to_owned()))
                            .map_err(xml_error)?;
                        if !first_text_written {
                            let text = &replacements[shape_id.as_ref().expect("shape id")];
                            writer
                                .write_event(Event::Text(BytesText::new(text)))
                                .map_err(xml_error)?;
                            first_text_written = true;
                        }
                        writer
                            .write_event(Event::End(BytesEnd::new(text_element_name)))
                            .map_err(xml_error)?;
                        // The matching closing event is consumed by `skip_text_depth`,
                        // so keep the surrounding shape depth balanced here.
                        shape_depth = shape_depth.saturating_sub(1);
                        skip_text_depth = 1;
                    } else {
                        writer.write_event(Event::Start(event)).map_err(xml_error)?;
                    }
                }
            }
            Event::Empty(event) => {
                let qualified_name = event.name();
                let name = local_name(qualified_name.as_ref());
                if shape_depth > 0 && name == b"cNvPr" && shape_id.is_none() {
                    shape_id = Some(required_attribute(&event, b"id", reader.decoder())?);
                }
                if name == b"txBody"
                    && shape_id
                        .as_ref()
                        .is_some_and(|id| replacements.contains_key(id))
                {
                    let replacement = &replacements[shape_id.as_ref().expect("shape id")];
                    let element_name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                    writer
                        .write_event(Event::Start(event.to_owned()))
                        .map_err(xml_error)?;
                    if !replacement.is_empty() {
                        write_generated_text_body_children(&mut writer, replacement)?;
                    }
                    writer
                        .write_event(Event::End(BytesEnd::new(element_name)))
                        .map_err(xml_error)?;
                    first_text_written = !replacement.is_empty();
                } else if name == b"t"
                    && in_text_body
                    && shape_id
                        .as_ref()
                        .is_some_and(|id| replacements.contains_key(id))
                {
                    if !first_text_written {
                        writer
                            .write_event(Event::Start(BytesStart::new("a:t")))
                            .map_err(xml_error)?;
                        let text = &replacements[shape_id.as_ref().expect("shape id")];
                        writer
                            .write_event(Event::Text(BytesText::new(text)))
                            .map_err(xml_error)?;
                        writer
                            .write_event(Event::End(BytesEnd::new("a:t")))
                            .map_err(xml_error)?;
                        first_text_written = true;
                    }
                } else {
                    writer.write_event(Event::Empty(event)).map_err(xml_error)?;
                }
            }
            Event::End(event) => {
                let qualified_name = event.name();
                let name = local_name(qualified_name.as_ref());
                if name == b"txBody" && in_text_body {
                    if !first_text_written {
                        let replacement = &replacements[shape_id.as_ref().expect("shape id")];
                        if !replacement.is_empty() {
                            write_generated_text_paragraph(&mut writer, replacement)?;
                            first_text_written = true;
                        }
                    }
                    in_text_body = false;
                }
                if shape_depth > 0 {
                    shape_depth -= 1;
                    if shape_depth == 0 {
                        shape_id = None;
                    }
                }
                writer.write_event(Event::End(event)).map_err(xml_error)?;
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            other => writer.write_event(other).map_err(xml_error)?,
        }
    }
    let output = writer.into_inner();
    ensure_xml_limit(&output)?;
    Ok(output)
}

fn write_generated_text_body_children(writer: &mut Writer<Vec<u8>>, text: &str) -> AppResult<()> {
    writer
        .get_mut()
        .write_all(b"<a:bodyPr/><a:lstStyle/>")
        .map_err(AppError::from)?;
    write_generated_text_paragraph(writer, text)
}

fn write_generated_text_paragraph(writer: &mut Writer<Vec<u8>>, text: &str) -> AppResult<()> {
    let escaped = quick_xml::escape::escape(text);
    writer
        .get_mut()
        .write_all(
            format!("<a:p><a:r><a:t xml:space=\"preserve\">{escaped}</a:t></a:r></a:p>").as_bytes(),
        )
        .map_err(AppError::from)
}

fn append_text_shape(
    xml: &[u8],
    id: u32,
    placeholder_type: &str,
    text: &str,
    y: u32,
) -> AppResult<Vec<u8>> {
    ensure_xml_limit(xml)?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len() + text.len() + 512));
    let mut inserted = false;
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::End(event) if local_name(event.name().as_ref()) == b"spTree" => {
                let height = if placeholder_type == "title" {
                    800_000
                } else {
                    4_000_000
                };
                write_generated_text_shape(&mut writer, id, placeholder_type, text, y, height)?;
                writer.write_event(Event::End(event)).map_err(xml_error)?;
                inserted = true;
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            event => writer.write_event(event).map_err(xml_error)?,
        }
    }
    if !inserted {
        return Err(invalid_presentation("Slide shape tree is missing"));
    }
    let output = writer.into_inner();
    ensure_xml_limit(&output)?;
    Ok(output)
}

fn write_generated_text_shape(
    writer: &mut Writer<Vec<u8>>,
    id: u32,
    placeholder_type: &str,
    text: &str,
    y: u32,
    height: u32,
) -> AppResult<()> {
    let escaped = quick_xml::escape::escape(text);
    let xml = format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"WPS Agent Text {id}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr><p:ph type=\"{placeholder_type}\"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x=\"457200\" y=\"{y}\"/><a:ext cx=\"8229600\" cy=\"{height}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang=\"zh-CN\"/><a:t xml:space=\"preserve\">{escaped}</a:t></a:r><a:endParaRPr lang=\"zh-CN\"/></a:p></p:txBody></p:sp>"
    );
    writer
        .get_mut()
        .write_all(xml.as_bytes())
        .map_err(AppError::from)
}

fn insert_cloned_slide(
    package: &mut Package<'_>,
    after: Option<usize>,
    template_path: &str,
    blank: bool,
    text: Option<&PresentationSlideText>,
) -> AppResult<usize> {
    let xml = if blank {
        let title = text.map_or("", |slide| slide.title.as_str());
        let body = text.map_or("", |slide| slide.body.as_str());
        new_text_slide(title, body)?
    } else {
        package.part(template_path)?.to_vec()
    };
    let new_path = next_slide_path(package)?;
    package.set_part(new_path.clone(), xml);
    let template_rels = relationships_part_name(template_path);
    let new_rels = relationships_part_name(&new_path);
    if let Some(rels) = package.optional_part(&template_rels).map(ToOwned::to_owned) {
        let rels = if blank {
            new_slide_relationships(&rels)?
        } else {
            rels
        };
        package.set_part(new_rels, rels);
    }
    register_slide(package, after, &new_path)
}

fn new_text_slide(title: &str, body: &str) -> AppResult<Vec<u8>> {
    let mut writer = Writer::new(Vec::with_capacity(title.len() + body.len() + 1_500));
    writer
        .get_mut()
        .write_all(
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:sld xmlns:a=\"{DRAWING_NS}\" xmlns:r=\"{OFFICE_RELATIONSHIPS_NS}\" xmlns:p=\"{PRESENTATION_NS}\"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>"
            )
            .as_bytes(),
        )
        .map_err(AppError::from)?;
    write_generated_text_shape(&mut writer, 2, "title", title, 300_000, 800_000)?;
    write_generated_text_shape(&mut writer, 3, "body", body, 1_300_000, 4_000_000)?;
    writer
        .get_mut()
        .write_all(b"</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>")
        .map_err(AppError::from)?;
    let output = writer.into_inner();
    ensure_xml_limit(&output)?;
    Ok(output)
}

fn new_slide_relationships(template_rels: &[u8]) -> AppResult<Vec<u8>> {
    let relationships = parse_relationships(template_rels)?;
    let layout = relationships.into_iter().find(|relationship| {
        relationship.relationship_type.ends_with("/slideLayout")
            && relationship.target_mode.is_none()
    });
    let mut writer = Writer::new(Vec::with_capacity(512));
    writer
        .get_mut()
        .write_all(
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"{PACKAGE_RELATIONSHIPS_NS}\">"
            )
            .as_bytes(),
        )
        .map_err(AppError::from)?;
    if let Some(layout) = layout {
        write_relationship(&mut writer, &layout)?;
    }
    writer
        .get_mut()
        .write_all(b"</Relationships>")
        .map_err(AppError::from)?;
    Ok(writer.into_inner())
}

fn register_slide(
    package: &mut Package<'_>,
    after: Option<usize>,
    new_path: &str,
) -> AppResult<usize> {
    let mut refs = parse_slide_refs(package.part(PRESENTATION_PART)?)?;
    let relationships = parse_relationships(package.part(PRESENTATION_RELS_PART)?)?;
    if refs.len() >= MAX_SLIDES {
        return Err(AppError::new(
            "presentation-too-many-slides",
            format!("A presentation may contain at most {MAX_SLIDES} slides"),
        ));
    }
    let relationship_id = next_relationship_id(&relationships);
    let slide_id = refs
        .iter()
        .map(|slide| slide.id)
        .max()
        .unwrap_or(255)
        .checked_add(1)
        .ok_or_else(|| invalid_presentation("Slide ID overflow"))?;
    let insert_at = after
        .map_or(0, |value| value.saturating_add(1))
        .min(refs.len());
    refs.insert(
        insert_at,
        SlideRef {
            id: slide_id,
            relationship_id: relationship_id.clone(),
        },
    );
    let presentation = rewrite_slide_refs(package.part(PRESENTATION_PART)?, &refs)?;
    let target = relative_target(PRESENTATION_PART, new_path)?;
    let rels = modify_relationships(
        package.part(PRESENTATION_RELS_PART)?,
        &HashSet::new(),
        &HashMap::new(),
        &[Relationship {
            id: relationship_id,
            relationship_type: SLIDE_RELATIONSHIP_TYPE.to_owned(),
            target,
            target_mode: None,
        }],
    )?;
    let content_types = modify_content_types(
        package.part(CONTENT_TYPES_PART)?,
        &[],
        &[(new_path.to_owned(), SLIDE_CONTENT_TYPE.to_owned())],
    )?;
    package.set_part(PRESENTATION_PART.to_owned(), presentation);
    package.set_part(PRESENTATION_RELS_PART.to_owned(), rels);
    package.set_part(CONTENT_TYPES_PART.to_owned(), content_types);
    Ok(insert_at)
}

fn delete_slide(package: &mut Package<'_>, index: usize) -> AppResult<()> {
    let mut refs = parse_slide_refs(package.part(PRESENTATION_PART)?)?;
    let relationships = parse_relationships(package.part(PRESENTATION_RELS_PART)?)?;
    let removed_ref = refs.remove(index);
    let relationship = relationships
        .iter()
        .find(|relationship| relationship.id == removed_ref.relationship_id)
        .ok_or_else(|| invalid_presentation("Deleted slide relationship is missing"))?;
    let slide_path = resolve_relationship_target(PRESENTATION_PART, &relationship.target)?;
    let presentation = rewrite_slide_refs(package.part(PRESENTATION_PART)?, &refs)?;
    let rels = modify_relationships(
        package.part(PRESENTATION_RELS_PART)?,
        &HashSet::from([removed_ref.relationship_id]),
        &HashMap::new(),
        &[],
    )?;
    let content_types = modify_content_types(
        package.part(CONTENT_TYPES_PART)?,
        std::slice::from_ref(&slide_path),
        &[],
    )?;
    package.set_part(PRESENTATION_PART.to_owned(), presentation);
    package.set_part(PRESENTATION_RELS_PART.to_owned(), rels);
    package.set_part(CONTENT_TYPES_PART.to_owned(), content_types);
    package.remove_part(&slide_path);
    package.remove_part(&relationships_part_name(&slide_path));
    Ok(())
}

fn import_slide(
    source: &Package<'_>,
    destination: &mut Package<'_>,
    source_slide: &str,
    after: Option<usize>,
    mapping: &mut HashMap<String, String>,
) -> AppResult<usize> {
    let destination_slide = mapping
        .get(source_slide)
        .cloned()
        .ok_or_else(|| invalid_presentation("Imported slide path was not allocated"))?;
    let source_types = parse_content_types(source.part(CONTENT_TYPES_PART)?)?;
    let destination_layout = slide_order(destination)?
        .first()
        .and_then(|slide| find_slide_layout(destination, slide).ok().flatten());
    let mut content_overrides = Vec::new();
    copy_part_graph(
        source,
        destination,
        source_slide,
        &destination_slide,
        destination_layout.as_deref(),
        &source_types,
        mapping,
        &mut content_overrides,
        0,
    )?;
    if !content_overrides.is_empty() {
        let content_types = modify_content_types(
            destination.part(CONTENT_TYPES_PART)?,
            &[],
            &content_overrides,
        )?;
        destination.set_part(CONTENT_TYPES_PART.to_owned(), content_types);
    }
    register_slide(destination, after, &destination_slide)
}

#[allow(clippy::too_many_arguments)]
fn copy_part_graph(
    source: &Package<'_>,
    destination: &mut Package<'_>,
    source_part: &str,
    destination_part: &str,
    destination_layout: Option<&str>,
    source_types: &ContentTypes,
    mapping: &mut HashMap<String, String>,
    content_overrides: &mut Vec<(String, String)>,
    depth: usize,
) -> AppResult<()> {
    if depth > MAX_RELATIONSHIP_DEPTH {
        return Err(invalid_presentation(format!(
            "Imported relationship graph exceeds {MAX_RELATIONSHIP_DEPTH} levels"
        )));
    }
    if destination.contains(destination_part) {
        return Ok(());
    }
    let data = source.part(source_part)?.to_vec();
    destination.set_part(destination_part.to_owned(), data);
    if !destination_part.ends_with(".rels") {
        if let Some(content_type) = source_types.for_part(source_part) {
            content_overrides.push((destination_part.to_owned(), content_type.to_owned()));
        }
    }

    let source_rels_name = relationships_part_name(source_part);
    let Some(source_rels) = source.optional_part(&source_rels_name) else {
        return Ok(());
    };
    let relationships = parse_relationships(source_rels)?;
    let mut target_updates = HashMap::new();
    for relationship in relationships {
        if relationship
            .target_mode
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("external"))
        {
            continue;
        }
        if let Some(mode) = &relationship.target_mode {
            return Err(invalid_presentation(format!(
                "Unsupported relationship TargetMode {mode} in {source_rels_name}"
            )));
        }
        let dependency_source = resolve_relationship_target(source_part, &relationship.target)?;
        if !source.contains(&dependency_source) {
            return Err(invalid_presentation(format!(
                "Imported relationship target is missing: {dependency_source}"
            )));
        }
        let dependency_destination = if relationship.relationship_type.ends_with("/slideLayout") {
            if let Some(layout) = destination_layout {
                layout.to_owned()
            } else {
                mapped_dependency_path(destination, &dependency_source, mapping)?
            }
        } else {
            mapped_dependency_path(destination, &dependency_source, mapping)?
        };
        target_updates.insert(
            relationship.id.clone(),
            relative_target(destination_part, &dependency_destination)?,
        );
        if dependency_destination != destination_layout.unwrap_or_default()
            && !destination.contains(&dependency_destination)
        {
            copy_part_graph(
                source,
                destination,
                &dependency_source,
                &dependency_destination,
                destination_layout,
                source_types,
                mapping,
                content_overrides,
                depth + 1,
            )?;
        }
    }
    let rewritten = modify_relationships(source_rels, &HashSet::new(), &target_updates, &[])?;
    destination.set_part(relationships_part_name(destination_part), rewritten);
    Ok(())
}

fn mapped_dependency_path(
    destination: &Package<'_>,
    source_path: &str,
    mapping: &mut HashMap<String, String>,
) -> AppResult<String> {
    if let Some(path) = mapping.get(source_path) {
        return Ok(path.clone());
    }
    let selected = if !destination.contains(source_path)
        && !mapping.values().any(|path| path == source_path)
    {
        source_path.to_owned()
    } else {
        next_collision_path(destination, source_path, mapping)?
    };
    mapping.insert(source_path.to_owned(), selected.clone());
    Ok(selected)
}

fn find_slide_layout(package: &Package<'_>, slide: &str) -> AppResult<Option<String>> {
    let rels_name = relationships_part_name(slide);
    let Some(rels) = package.optional_part(&rels_name) else {
        return Ok(None);
    };
    parse_relationships(rels)?
        .into_iter()
        .find(|relationship| {
            relationship.relationship_type.ends_with("/slideLayout")
                && relationship.target_mode.is_none()
        })
        .map(|relationship| resolve_relationship_target(slide, &relationship.target))
        .transpose()
}

fn rewrite_slide_refs(xml: &[u8], refs: &[SlideRef]) -> AppResult<Vec<u8>> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len() + 128));
    let mut in_list = false;
    let mut nested_depth = 0_usize;
    let mut skip_depth = 0_usize;
    let mut found = false;
    loop {
        let event = reader.read_event().map_err(xml_error)?;
        if skip_depth > 0 {
            match event {
                Event::Start(_) => skip_depth += 1,
                Event::End(_) => skip_depth -= 1,
                Event::Eof => return Err(invalid_presentation("Unexpected end of slide list")),
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(event) if local_name(event.name().as_ref()) == b"sldIdLst" => {
                writer.write_event(Event::Start(event)).map_err(xml_error)?;
                for slide in refs {
                    let mut item = BytesStart::new("p:sldId");
                    let id = slide.id.to_string();
                    item.push_attribute(("id", id.as_str()));
                    item.push_attribute(("r:id", slide.relationship_id.as_str()));
                    writer.write_event(Event::Empty(item)).map_err(xml_error)?;
                }
                in_list = true;
                found = true;
            }
            Event::Empty(event)
                if in_list
                    && nested_depth == 0
                    && local_name(event.name().as_ref()) == b"sldId" => {}
            Event::Start(event)
                if in_list
                    && nested_depth == 0
                    && local_name(event.name().as_ref()) == b"sldId" =>
            {
                skip_depth = 1;
            }
            Event::Start(event) if in_list => {
                nested_depth += 1;
                writer.write_event(Event::Start(event)).map_err(xml_error)?;
            }
            Event::End(event)
                if in_list
                    && nested_depth == 0
                    && local_name(event.name().as_ref()) == b"sldIdLst" =>
            {
                in_list = false;
                writer.write_event(Event::End(event)).map_err(xml_error)?;
            }
            Event::End(event) if in_list => {
                nested_depth = nested_depth.saturating_sub(1);
                writer.write_event(Event::End(event)).map_err(xml_error)?;
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            event => writer.write_event(event).map_err(xml_error)?,
        }
    }
    if !found {
        return Err(invalid_presentation("Presentation slide list is missing"));
    }
    Ok(writer.into_inner())
}

fn modify_relationships(
    xml: &[u8],
    remove_ids: &HashSet<String>,
    target_updates: &HashMap<String, String>,
    additions: &[Relationship],
) -> AppResult<Vec<u8>> {
    parse_relationships(xml)?;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len() + additions.len() * 160));
    let mut skip_depth = 0_usize;
    let mut found_root = false;
    loop {
        let event = reader.read_event().map_err(xml_error)?;
        if skip_depth > 0 {
            match event {
                Event::Start(_) => skip_depth += 1,
                Event::End(_) => skip_depth -= 1,
                Event::Eof => {
                    return Err(invalid_presentation("Unexpected end of relationships XML"))
                }
                _ => {}
            }
            continue;
        }
        match event {
            Event::Empty(event) if local_name(event.name().as_ref()) == b"Relationships" => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                writer.write_event(Event::Start(event)).map_err(xml_error)?;
                for relationship in additions {
                    write_relationship(&mut writer, relationship)?;
                }
                writer
                    .write_event(Event::End(BytesEnd::new(name)))
                    .map_err(xml_error)?;
                found_root = true;
            }
            Event::Empty(event) if local_name(event.name().as_ref()) == b"Relationship" => {
                let id = required_attribute_exact(&event, b"Id", reader.decoder())?;
                if remove_ids.contains(&id) {
                    continue;
                }
                if let Some(target) = target_updates.get(&id) {
                    writer
                        .write_event(Event::Empty(replace_attribute(
                            &event,
                            b"Target",
                            target,
                            reader.decoder(),
                        )?))
                        .map_err(xml_error)?;
                } else {
                    writer.write_event(Event::Empty(event)).map_err(xml_error)?;
                }
            }
            Event::Start(event) if local_name(event.name().as_ref()) == b"Relationship" => {
                let id = required_attribute_exact(&event, b"Id", reader.decoder())?;
                if remove_ids.contains(&id) {
                    skip_depth = 1;
                    continue;
                }
                if let Some(target) = target_updates.get(&id) {
                    writer
                        .write_event(Event::Start(replace_attribute(
                            &event,
                            b"Target",
                            target,
                            reader.decoder(),
                        )?))
                        .map_err(xml_error)?;
                } else {
                    writer.write_event(Event::Start(event)).map_err(xml_error)?;
                }
            }
            Event::End(event) if local_name(event.name().as_ref()) == b"Relationships" => {
                for relationship in additions {
                    write_relationship(&mut writer, relationship)?;
                }
                writer.write_event(Event::End(event)).map_err(xml_error)?;
                found_root = true;
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            event => writer.write_event(event).map_err(xml_error)?,
        }
    }
    if !found_root {
        return Err(invalid_presentation(
            "Relationships root element is missing",
        ));
    }
    Ok(writer.into_inner())
}

fn write_relationship(writer: &mut Writer<Vec<u8>>, relationship: &Relationship) -> AppResult<()> {
    let mut event = BytesStart::new("Relationship");
    event.push_attribute(("xmlns", PACKAGE_RELATIONSHIPS_NS));
    event.push_attribute(("Id", relationship.id.as_str()));
    event.push_attribute(("Type", relationship.relationship_type.as_str()));
    event.push_attribute(("Target", relationship.target.as_str()));
    if let Some(mode) = &relationship.target_mode {
        event.push_attribute(("TargetMode", mode.as_str()));
    }
    writer.write_event(Event::Empty(event)).map_err(xml_error)
}

fn modify_content_types(
    xml: &[u8],
    remove_parts: &[String],
    additions: &[(String, String)],
) -> AppResult<Vec<u8>> {
    let remove = remove_parts
        .iter()
        .map(|part| part.trim_start_matches('/').to_owned())
        .collect::<HashSet<_>>();
    parse_content_types(xml)?;
    let additions_by_part = additions
        .iter()
        .map(|(part, content_type)| {
            (
                part.trim_start_matches('/').to_owned(),
                content_type.as_str(),
            )
        })
        .collect::<HashMap<_, _>>();
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(xml.len() + additions.len() * 140));
    let mut skip_depth = 0_usize;
    let mut found_root = false;
    let mut emitted = HashSet::new();
    loop {
        let event = reader.read_event().map_err(xml_error)?;
        if skip_depth > 0 {
            match event {
                Event::Start(_) => skip_depth += 1,
                Event::End(_) => skip_depth -= 1,
                Event::Eof => {
                    return Err(invalid_presentation("Unexpected end of content types XML"))
                }
                _ => {}
            }
            continue;
        }
        match event {
            Event::Empty(event) if local_name(event.name().as_ref()) == b"Types" => {
                let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
                writer.write_event(Event::Start(event)).map_err(xml_error)?;
                for (part, content_type) in additions {
                    let normalized = part.trim_start_matches('/');
                    if !emitted.insert(normalized.to_owned()) {
                        continue;
                    }
                    let part_name = encode_content_type_part_name(normalized)?;
                    let mut item = BytesStart::new("Override");
                    item.push_attribute(("xmlns", PACKAGE_CONTENT_TYPES_NS));
                    item.push_attribute(("PartName", part_name.as_str()));
                    item.push_attribute(("ContentType", content_type.as_str()));
                    writer.write_event(Event::Empty(item)).map_err(xml_error)?;
                }
                writer
                    .write_event(Event::End(BytesEnd::new(name)))
                    .map_err(xml_error)?;
                found_root = true;
            }
            Event::Empty(event) if local_name(event.name().as_ref()) == b"Override" => {
                let encoded_part = required_attribute_exact(&event, b"PartName", reader.decoder())?;
                let part = decode_content_type_part_name(&encoded_part)?;
                if let Some(content_type) = additions_by_part.get(&part) {
                    writer
                        .write_event(Event::Empty(replace_attribute(
                            &event,
                            b"ContentType",
                            content_type,
                            reader.decoder(),
                        )?))
                        .map_err(xml_error)?;
                    emitted.insert(part);
                } else if !remove.contains(&part) {
                    writer.write_event(Event::Empty(event)).map_err(xml_error)?;
                }
            }
            Event::Start(event) if local_name(event.name().as_ref()) == b"Override" => {
                let encoded_part = required_attribute_exact(&event, b"PartName", reader.decoder())?;
                let part = decode_content_type_part_name(&encoded_part)?;
                if let Some(content_type) = additions_by_part.get(&part) {
                    writer
                        .write_event(Event::Start(replace_attribute(
                            &event,
                            b"ContentType",
                            content_type,
                            reader.decoder(),
                        )?))
                        .map_err(xml_error)?;
                    emitted.insert(part);
                } else if remove.contains(&part) {
                    skip_depth = 1;
                } else {
                    writer.write_event(Event::Start(event)).map_err(xml_error)?;
                }
            }
            Event::End(event) if local_name(event.name().as_ref()) == b"Types" => {
                for (part, content_type) in additions {
                    let normalized = part.trim_start_matches('/');
                    if !emitted.insert(normalized.to_owned()) {
                        continue;
                    }
                    let part_name = encode_content_type_part_name(normalized)?;
                    let mut item = BytesStart::new("Override");
                    item.push_attribute(("xmlns", PACKAGE_CONTENT_TYPES_NS));
                    item.push_attribute(("PartName", part_name.as_str()));
                    item.push_attribute(("ContentType", content_type.as_str()));
                    writer.write_event(Event::Empty(item)).map_err(xml_error)?;
                }
                writer.write_event(Event::End(event)).map_err(xml_error)?;
                found_root = true;
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            event => writer.write_event(event).map_err(xml_error)?,
        }
    }
    if !found_root {
        return Err(invalid_presentation(
            "Content types root element is missing",
        ));
    }
    Ok(writer.into_inner())
}

fn replace_attribute(
    event: &BytesStart<'_>,
    target_name: &[u8],
    replacement: &str,
    decoder: quick_xml::Decoder,
) -> AppResult<BytesStart<'static>> {
    let name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
    let mut output = BytesStart::new(name);
    let mut replaced = false;
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(xml_error)?;
        let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
        if attribute.key.as_ref() == target_name {
            output.push_attribute((key.as_str(), replacement));
            replaced = true;
        } else {
            let value = attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::default(), decoder)
                .map_err(xml_error)?
                .into_owned();
            output.push_attribute((key.as_str(), value.as_str()));
        }
    }
    if !replaced {
        let key = String::from_utf8_lossy(target_name);
        output.push_attribute((key.as_ref(), replacement));
    }
    Ok(output)
}

fn required_attribute(
    event: &BytesStart<'_>,
    name: &[u8],
    decoder: quick_xml::Decoder,
) -> AppResult<String> {
    optional_attribute(event, name, decoder)?.ok_or_else(|| {
        invalid_presentation(format!(
            "Required XML attribute is missing: {}",
            String::from_utf8_lossy(name)
        ))
    })
}

fn required_attribute_exact(
    event: &BytesStart<'_>,
    name: &[u8],
    decoder: quick_xml::Decoder,
) -> AppResult<String> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(xml_error)?;
        if attribute.key.as_ref() == name {
            return attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::default(), decoder)
                .map(|value| value.into_owned())
                .map_err(xml_error);
        }
    }
    Err(invalid_presentation(format!(
        "Required XML attribute is missing: {}",
        String::from_utf8_lossy(name)
    )))
}

fn optional_attribute_exact(
    event: &BytesStart<'_>,
    name: &[u8],
    decoder: quick_xml::Decoder,
) -> AppResult<Option<String>> {
    for attribute in event.attributes().with_checks(true) {
        let attribute = attribute.map_err(xml_error)?;
        if attribute.key.as_ref() == name {
            return attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::default(), decoder)
                .map(|value| Some(value.into_owned()))
                .map_err(xml_error);
        }
    }
    Ok(None)
}

fn optional_attribute(
    event: &BytesStart<'_>,
    name: &[u8],
    decoder: quick_xml::Decoder,
) -> AppResult<Option<String>> {
    for attribute in event.attributes().with_checks(false) {
        let attribute = attribute.map_err(xml_error)?;
        if local_name(attribute.key.as_ref()) == name {
            return Ok(Some(
                attribute
                    .decoded_and_normalized_value(quick_xml::XmlVersion::default(), decoder)
                    .map_err(xml_error)?
                    .into_owned(),
            ));
        }
    }
    Ok(None)
}

fn next_slide_path(package: &Package<'_>) -> AppResult<String> {
    next_slide_path_excluding(package, &HashSet::new())
}

fn next_slide_path_excluding(
    package: &Package<'_>,
    reserved: &HashSet<String>,
) -> AppResult<String> {
    for index in 1..=MAX_SLIDES.saturating_mul(4) {
        let candidate = format!("ppt/slides/slide{index}.xml");
        if !package.contains(&candidate) && !reserved.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err(invalid_presentation(
        "Cannot allocate a new slide part name",
    ))
}

fn next_collision_path(
    package: &Package<'_>,
    source_path: &str,
    mapping: &HashMap<String, String>,
) -> AppResult<String> {
    let path = Path::new(source_path);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| invalid_presentation("Imported part has an invalid file name"))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 1..=MAX_ENTRIES {
        let candidate = parent
            .join(format!("{stem}_wae{index}{extension}"))
            .to_string_lossy()
            .replace('\\', "/");
        if !package.contains(&candidate) && !mapping.values().any(|path| path == &candidate) {
            return Ok(candidate);
        }
    }
    Err(invalid_presentation(
        "Cannot allocate an imported part name",
    ))
}

fn next_relationship_id(relationships: &[Relationship]) -> String {
    let used = relationships
        .iter()
        .map(|relationship| relationship.id.as_str())
        .collect::<HashSet<_>>();
    (1_usize..)
        .map(|index| format!("rId{index}"))
        .find(|candidate| !used.contains(candidate.as_str()))
        .expect("unbounded relationship id sequence")
}

fn relationships_part_name(part: &str) -> String {
    let path = Path::new(part);
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    parent
        .join("_rels")
        .join(format!("{file_name}.rels"))
        .to_string_lossy()
        .replace('\\', "/")
}

fn resolve_relationship_target(owner: &str, target: &str) -> AppResult<String> {
    if target.contains('\\') || target.contains('?') || target.contains('#') {
        return Err(invalid_presentation(format!(
            "Unsupported internal relationship target: {target}"
        )));
    }
    validate_percent_encoding(target)?;
    let decoded = percent_decode_str(target)
        .decode_utf8()
        .map_err(|_| invalid_presentation("Relationship target is not valid UTF-8"))?;
    if decoded.contains('\\') {
        return Err(invalid_presentation(format!(
            "Unsupported internal relationship target: {target}"
        )));
    }
    let target = decoded.as_ref();
    let first_segment = target
        .trim_start_matches('/')
        .split('/')
        .next()
        .unwrap_or("");
    if first_segment.contains(':') {
        return Err(invalid_presentation(format!(
            "Internal relationship target contains a URI scheme: {target}"
        )));
    }
    let mut components = Vec::<String>::new();
    if !target.starts_with('/') {
        let parent = Path::new(owner).parent().unwrap_or_else(|| Path::new(""));
        for component in parent.components() {
            if let Component::Normal(value) = component {
                components.push(value.to_string_lossy().into_owned());
            }
        }
    }
    for component in target.trim_start_matches('/').split('/') {
        match component {
            "" | "." => {}
            ".." => {
                if components.pop().is_none() {
                    return Err(invalid_presentation(
                        "Relationship target escapes the package root",
                    ));
                }
            }
            value => components.push(value.to_owned()),
        }
    }
    let resolved = components.join("/");
    validate_part_name(&resolved)?;
    Ok(resolved)
}

fn relative_target(owner: &str, target: &str) -> AppResult<String> {
    validate_part_name(target)?;
    let owner_parent = Path::new(owner).parent().unwrap_or_else(|| Path::new(""));
    let owner_parts = owner_parent
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let target_parts = Path::new(target)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    let common = owner_parts
        .iter()
        .zip(&target_parts)
        .take_while(|(left, right)| left == right)
        .count();
    let mut result = vec!["..".to_owned(); owner_parts.len() - common];
    result.extend(
        target_parts
            .into_iter()
            .skip(common)
            .map(|segment| encode_uri_segment(&segment)),
    );
    if result.is_empty() {
        return Err(invalid_presentation(
            "Relationship cannot target its owner part",
        ));
    }
    Ok(result.join("/"))
}

fn validate_percent_encoding(value: &str) -> AppResult<()> {
    let bytes = value.as_bytes();
    let mut index = 0_usize;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err(invalid_presentation(
                    "Invalid percent encoding in OOXML URI",
                ));
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    Ok(())
}

fn encode_uri_segment(segment: &str) -> String {
    utf8_percent_encode(segment, URI_PATH_SEGMENT_ENCODE_SET).to_string()
}

fn encode_package_path(path: &str) -> String {
    path.split('/')
        .map(encode_uri_segment)
        .collect::<Vec<_>>()
        .join("/")
}

fn decode_content_type_part_name(value: &str) -> AppResult<String> {
    if !value.starts_with('/') || value.starts_with("//") {
        return Err(invalid_presentation(
            "Content type PartName must be an absolute package URI",
        ));
    }
    validate_percent_encoding(value)?;
    let decoded = percent_decode_str(value)
        .decode_utf8()
        .map_err(|_| invalid_presentation("Content type PartName is not valid UTF-8"))?;
    let part = decoded.trim_start_matches('/').to_owned();
    validate_part_name(&part)?;
    Ok(part)
}

fn encode_content_type_part_name(path: &str) -> AppResult<String> {
    validate_part_name(path)?;
    Ok(format!("/{}", encode_package_path(path)))
}

fn is_slide_relationship(value: &str) -> bool {
    value == SLIDE_RELATIONSHIP_TYPE || value.ends_with("/relationships/slide")
}

fn clamp_slide_index(index: isize, slide_count: usize) -> usize {
    if index <= 0 {
        0
    } else {
        (index as usize).min(slide_count.saturating_sub(1))
    }
}

fn clamp_after_index(index: isize, slide_count: usize) -> Option<usize> {
    if index < 0 {
        None
    } else {
        Some((index as usize).min(slide_count.saturating_sub(1)))
    }
}

fn ensure_xml_limit(xml: &[u8]) -> AppResult<()> {
    if xml.len() > MAX_XML_BYTES {
        Err(invalid_presentation(
            "OOXML part exceeds the 16 MiB XML parsing limit",
        ))
    } else {
        Ok(())
    }
}

fn validate_opc_list_xml(
    xml: &[u8],
    root_name: &[u8],
    item_names: &[&[u8]],
    expected_namespace: &str,
) -> AppResult<()> {
    let mut reader = NsReader::from_reader(xml);
    reader.config_mut().check_end_names = true;
    let mut depth = 0_usize;
    let mut events = 0_usize;
    let mut saw_root = false;
    loop {
        let (namespace, event) = reader.read_resolved_event().map_err(xml_error)?;
        events = events
            .checked_add(1)
            .ok_or_else(|| invalid_presentation("XML event count overflow"))?;
        if events > MAX_XML_EVENTS {
            return Err(invalid_presentation(format!(
                "OOXML part contains more than {MAX_XML_EVENTS} XML events"
            )));
        }
        let namespace_matches = matches!(
            namespace,
            ResolveResult::Bound(namespace)
                if namespace.as_ref() == expected_namespace.as_bytes()
        );
        match event {
            Event::Start(event) => {
                let local = event.local_name();
                let local = local.as_ref();
                if depth == 0 {
                    if saw_root || local != root_name || !namespace_matches {
                        return Err(invalid_presentation(
                            "OOXML list has an unexpected root namespace or element",
                        ));
                    }
                    saw_root = true;
                } else if local == root_name
                    || item_names.contains(&local) && (depth != 1 || !namespace_matches)
                {
                    return Err(invalid_presentation(
                        "OOXML list item has an unexpected namespace or nesting level",
                    ));
                }
                depth = depth
                    .checked_add(1)
                    .ok_or_else(|| invalid_presentation("XML depth overflow"))?;
                if depth > MAX_XML_DEPTH {
                    return Err(invalid_presentation(format!(
                        "OOXML part exceeds the {MAX_XML_DEPTH}-level XML depth limit"
                    )));
                }
            }
            Event::Empty(event) => {
                let local = event.local_name();
                let local = local.as_ref();
                if depth == 0 {
                    if saw_root || local != root_name || !namespace_matches {
                        return Err(invalid_presentation(
                            "OOXML list has an unexpected root namespace or element",
                        ));
                    }
                    saw_root = true;
                } else if local == root_name
                    || item_names.contains(&local) && (depth != 1 || !namespace_matches)
                {
                    return Err(invalid_presentation(
                        "OOXML list item has an unexpected namespace or nesting level",
                    ));
                }
            }
            Event::End(_) => {
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| invalid_presentation("Unexpected XML end element"))?;
            }
            Event::Text(text) if depth == 0 => {
                if !text.decode().map_err(xml_error)?.trim().is_empty() {
                    return Err(invalid_presentation(
                        "OOXML contains data outside its root element",
                    ));
                }
            }
            Event::CData(text) if depth == 0 => {
                if !text.decode().map_err(xml_error)?.trim().is_empty() {
                    return Err(invalid_presentation(
                        "OOXML contains data outside its root element",
                    ));
                }
            }
            Event::DocType(_) => {
                return Err(invalid_presentation(
                    "DTD declarations are not allowed in OOXML",
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_root || depth != 0 {
        return Err(invalid_presentation(
            "OOXML list root element is missing or incomplete",
        ));
    }
    Ok(())
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn invalid_presentation(message: impl Into<String>) -> AppError {
    AppError::new("invalid-presentation", message)
}

fn zip_error(error: impl std::fmt::Display) -> AppError {
    invalid_presentation(format!("Invalid PPTX ZIP package: {error}"))
}

fn xml_error(error: impl std::fmt::Display) -> AppError {
    invalid_presentation(format!("Invalid OOXML: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RELS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
    const P_NS: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
    const A_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    fn request(data: Vec<u8>, operation: PresentationEditOperation) -> PresentationEditRequest {
        PresentationEditRequest { data, operation }
    }

    fn make_pptx(slides: &[(&str, &str)], marker: &[u8]) -> Vec<u8> {
        let mut entries = BTreeMap::new();
        let slide_overrides = (1..=slides.len())
            .map(|index| {
                format!(
                    "<Override PartName=\"/ppt/slides/slide{index}.xml\" ContentType=\"{SLIDE_CONTENT_TYPE}\"/>"
                )
            })
            .collect::<String>();
        entries.insert(
            CONTENT_TYPES_PART.to_owned(),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"bin\" ContentType=\"application/octet-stream\"/><Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>{slide_overrides}<Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/></Types>"
            )
            .into_bytes(),
        );
        entries.insert(
            "_rels/.rels".to_owned(),
            format!(
                "<Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/></Relationships>"
            )
            .into_bytes(),
        );
        let ids = (1..=slides.len())
            .map(|index| format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 255 + index, index))
            .collect::<String>();
        entries.insert(
            PRESENTATION_PART.to_owned(),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:presentation xmlns:a=\"{A_NS}\" xmlns:r=\"{R_NS}\" xmlns:p=\"{P_NS}\"><p:sldIdLst>{ids}</p:sldIdLst><p:extLst><p:ext uri=\"unknown-pres-extension\"/></p:extLst></p:presentation>"
            )
            .into_bytes(),
        );
        let relationships = (1..=slides.len())
            .map(|index| {
                format!(
                    "<Relationship Id=\"rId{index}\" Type=\"{SLIDE_RELATIONSHIP_TYPE}\" Target=\"slides/slide{index}.xml\"/>"
                )
            })
            .collect::<String>();
        entries.insert(
            PRESENTATION_RELS_PART.to_owned(),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"{RELS_NS}\">{relationships}<Relationship Id=\"rId99\" Type=\"urn:example:unknown\" Target=\"../custom/opaque.bin\"/></Relationships>"
            )
            .into_bytes(),
        );
        entries.insert(
            "ppt/slideLayouts/slideLayout1.xml".to_owned(),
            format!(
                "<p:sldLayout xmlns:a=\"{A_NS}\" xmlns:r=\"{R_NS}\" xmlns:p=\"{P_NS}\"><p:cSld><p:spTree/></p:cSld></p:sldLayout>"
            )
            .into_bytes(),
        );
        entries.insert("ppt/media/image1.bin".to_owned(), marker.to_vec());
        entries.insert(
            "ppt/customData/slide.bin".to_owned(),
            [b"custom-data:".as_slice(), marker].concat(),
        );
        entries.insert(
            "custom/opaque.bin".to_owned(),
            b"opaque-unknown-part".to_vec(),
        );
        for (offset, (title, body)) in slides.iter().enumerate() {
            let index = offset + 1;
            entries.insert(
                format!("ppt/slides/slide{index}.xml"),
                slide_xml(title, body).into_bytes(),
            );
            entries.insert(
                format!("ppt/slides/_rels/slide{index}.xml.rels"),
                format!(
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"{RELS_NS}\"><Relationship Id=\"rId1\" Type=\"{R_NS}/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/><Relationship Id=\"rId2\" Type=\"{R_NS}/image\" Target=\"../media/image1.bin\"/><Relationship Id=\"rId8\" Type=\"urn:example:unknown-internal\" Target=\"../customData/slide.bin\"/><Relationship Id=\"rId9\" Type=\"urn:example:unknown-external\" Target=\"https://example.invalid/kept\" TargetMode=\"External\"/></Relationships>"
                )
                .into_bytes(),
            );
        }
        write_test_zip(entries)
    }

    fn slide_xml(title: &str, body: &str) -> String {
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><p:sld xmlns:a=\"{A_NS}\" xmlns:r=\"{R_NS}\" xmlns:p=\"{P_NS}\"><p:cSld><p:spTree data-unknown=\"kept\"><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id=\"2\" name=\"Title\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"title\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id=\"3\" name=\"Body\"/><p:cNvSpPr/><p:nvPr><p:ph type=\"body\"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:extLst><p:ext uri=\"unknown-slide-extension\"/></p:extLst></p:sld>",
            quick_xml::escape::escape(title),
            quick_xml::escape::escape(body),
        )
    }

    fn write_test_zip(entries: BTreeMap<String, Vec<u8>>) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.set_comment("opaque-test-comment");
        for (name, data) in entries {
            writer
                .start_file(
                    name,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(&data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn read_test_zip(data: &[u8]) -> BTreeMap<String, Vec<u8>> {
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut entries = BTreeMap::new();
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).unwrap();
            let name = file.name().to_owned();
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            entries.insert(name, bytes);
        }
        entries
    }

    fn test_png(marker: &[u8]) -> Vec<u8> {
        test_png_with_dimensions(1, 1, marker)
    }

    fn test_png_with_dimensions(width: u32, height: u32, marker: &[u8]) -> Vec<u8> {
        let pixel = [
            marker.first().copied().unwrap_or(0),
            marker.get(1).copied().unwrap_or(0),
            marker.get(2).copied().unwrap_or(0),
            255,
        ];
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..u64::from(width) * u64::from(height) {
            pixels.extend_from_slice(&pixel);
        }
        let mut output = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut output, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&pixels)
                .unwrap();
        }
        output
    }

    fn corrupt_png_chunk_crc(mut data: Vec<u8>, chunk_type: &[u8; 4]) -> Vec<u8> {
        let type_offset = data
            .windows(chunk_type.len())
            .position(|window| window == chunk_type)
            .expect("PNG chunk is present");
        let length = u32::from_be_bytes(
            data[type_offset - 4..type_offset]
                .try_into()
                .expect("PNG chunk length"),
        ) as usize;
        let crc_offset = type_offset + chunk_type.len() + length;
        data[crc_offset] ^= 0xff;
        data
    }

    fn insert_bad_ancillary_png_chunk(mut data: Vec<u8>) -> Vec<u8> {
        let iend_type_offset = data
            .windows(4)
            .position(|window| window == b"IEND")
            .expect("PNG IEND chunk is present");
        let chunk_offset = iend_type_offset - 4;
        // The zero CRC is intentionally invalid for the tEXt payload. This
        // verifies that ancillary CRC errors are not silently skipped.
        let chunk = [0, 0, 0, 1, b't', b'E', b'X', b't', b'x', 0, 0, 0, 0];
        data.splice(chunk_offset..chunk_offset, chunk);
        data
    }

    fn with_cross_slide_relationships(data: Vec<u8>) -> Vec<u8> {
        let mut entries = read_test_zip(&data);
        for (from, to) in [(1, 2), (2, 1)] {
            let path = format!("ppt/slides/_rels/slide{from}.xml.rels");
            let xml = String::from_utf8(entries.remove(&path).unwrap()).unwrap();
            let relationship = format!(
                "<Relationship Id=\"rId7\" Type=\"{SLIDE_RELATIONSHIP_TYPE}\" Target=\"slide{to}.xml\"/>"
            );
            entries.insert(
                path,
                xml.replace(
                    "</Relationships>",
                    &format!("{relationship}</Relationships>"),
                )
                .into_bytes(),
            );
        }
        write_test_zip(entries)
    }

    fn with_legacy_metafiles(data: Vec<u8>) -> Vec<u8> {
        let mut entries = read_test_zip(&data);
        entries.insert("ppt/media/image1.wmf".to_owned(), b"wmf-source".to_vec());
        entries.insert("ppt/media/image2.EMF".to_owned(), b"emf-source".to_vec());
        entries.insert("ppt/media/image1.png".to_owned(), test_png(b"existing"));

        let content_types = String::from_utf8(entries.remove(CONTENT_TYPES_PART).unwrap()).unwrap();
        entries.insert(
            CONTENT_TYPES_PART.to_owned(),
            content_types
                .replace(
                    "</Types>",
                    "<Default Extension=\"wmf\" ContentType=\"image/x-wmf\"/><Default Extension=\"png\" ContentType=\"image/png\"/><Override PartName=\"/ppt/media/image2.EMF\" ContentType=\"image/x-emf\"/></Types>",
                )
                .into_bytes(),
        );
        let rels_path = "ppt/slides/_rels/slide1.xml.rels";
        let relationships = String::from_utf8(entries.remove(rels_path).unwrap()).unwrap();
        entries.insert(
            rels_path.to_owned(),
            relationships
                .replace(
                    "</Relationships>",
                    &format!(
                        "<Relationship Id=\"rId20\" Type=\"{R_NS}/image\" Target=\"../media/image1.wmf\" data-unknown=\"kept\"/><Relationship Id=\"rId21\" Type=\"{R_NS}/image\" Target=\"/ppt/media/image2.EMF\"/><Relationship Id=\"rId22\" Type=\"{R_NS}/image\" Target=\"https://example.invalid/external.wmf\" TargetMode=\"External\"/></Relationships>"
                    ),
                )
                .into_bytes(),
        );
        write_test_zip(entries)
    }

    fn read_zip_part(data: &[u8], name: &str) -> Vec<u8> {
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut file = archive.by_name(name).unwrap();
        let mut output = Vec::new();
        file.read_to_end(&mut output).unwrap();
        output
    }

    fn inspect(data: Vec<u8>, index: isize) -> PresentationSlideText {
        edit(
            request(
                data,
                PresentationEditOperation::Inspect { slide_index: index },
            ),
            None,
        )
        .unwrap()
        .slide
        .unwrap()
    }

    #[test]
    fn wire_shape_accepts_all_frontend_camel_case_operations() {
        let operations = [
            serde_json::json!({ "type": "inspect", "slideIndex": 2 }),
            serde_json::json!({ "type": "add", "afterSlideIndex": 2 }),
            serde_json::json!({
                "type": "updateText",
                "slideIndex": 2,
                "title": "Title",
                "body": "Body"
            }),
            serde_json::json!({
                "type": "updateNodeText",
                "slideIndex": 2,
                "nodeId": "7",
                "text": "updated"
            }),
            serde_json::json!({ "type": "duplicate", "slideIndex": 2 }),
            serde_json::json!({ "type": "delete", "slideIndex": 2 }),
            serde_json::json!({
                "type": "importOutline",
                "afterSlideIndex": 2,
                "slides": [{ "title": "Outline", "body": "Text" }]
            }),
            serde_json::json!({
                "type": "reuseSlides",
                "afterSlideIndex": 2,
                "sourcePath": "granted-source.pptx"
            }),
        ];
        for operation in operations {
            let decoded = serde_json::from_value::<PresentationEditRequest>(serde_json::json!({
                "data": [80, 75],
                "operation": operation
            }));
            assert!(decoded.is_ok());
        }

        let encoded = serde_json::to_value(result(Some(vec![80, 75]), 3, 1, None)).unwrap();
        assert_eq!(encoded["data"], serde_json::json!([80, 75]));
        assert_eq!(encoded["slideCount"], 3);
        assert_eq!(encoded["currentSlideIndex"], 1);
        assert_eq!(encoded["converter"], "powerpoint");
        assert_eq!(encoded["normalizedWmfCount"], 0);
    }

    #[test]
    fn text_edits_fill_valid_empty_text_bodies() {
        let xml = slide_xml("Old title", "Old body")
            .replace("<a:r><a:t>Old title</a:t></a:r>", "<a:endParaRPr/>")
            .replace("<a:r><a:t>Old body</a:t></a:r>", "<a:endParaRPr/>");
        let updated = update_slide_text(xml.as_bytes(), "New title", "New body").unwrap();
        let shapes = parse_shapes(&updated).unwrap();
        let (title, body) = select_title_and_body(&shapes);
        assert_eq!(title.unwrap().text, "New title");
        assert_eq!(body.unwrap().text, "New body");
    }

    #[test]
    fn inspect_update_text_and_node_text_preserve_unknown_parts_and_relationships() {
        let input = make_pptx(&[("First", "One"), ("Second", "Two")], b"dest-media");
        let untouched_input = input.clone();
        let original_slide_rels = read_zip_part(&input, "ppt/slides/_rels/slide1.xml.rels");
        let result = edit(
            request(
                input,
                PresentationEditOperation::UpdateText {
                    slide_index: 0,
                    title: "Roadmap & goals".to_owned(),
                    body: "Alpha < Beta".to_owned(),
                },
            ),
            None,
        )
        .unwrap();
        let output = result.data.unwrap();
        assert_eq!(result.slide_count, 2);
        assert_eq!(
            read_zip_part(&output, "custom/opaque.bin"),
            b"opaque-unknown-part"
        );
        assert_eq!(
            read_zip_part(&output, "ppt/slides/_rels/slide1.xml.rels"),
            original_slide_rels
        );
        let archive = ZipArchive::new(Cursor::new(&output)).unwrap();
        assert_eq!(archive.comment(), b"opaque-test-comment");
        assert_eq!(
            inspect(output.clone(), 0),
            PresentationSlideText {
                title: "Roadmap & goals".to_owned(),
                body: "Alpha < Beta".to_owned(),
            }
        );
        let node_result = edit(
            request(
                output,
                PresentationEditOperation::UpdateNodeText {
                    slide_index: 0,
                    node_id: "3".to_owned(),
                    text: "Node-specific edit".to_owned(),
                },
            ),
            None,
        )
        .unwrap();
        assert_eq!(
            inspect(node_result.data.unwrap(), 0).body,
            "Node-specific edit"
        );
        assert_eq!(
            untouched_input,
            make_pptx(&[("First", "One"), ("Second", "Two")], b"dest-media")
        );
    }

    #[test]
    fn add_duplicate_and_delete_update_slide_order_and_content_types() {
        let input = make_pptx(&[("First", "One"), ("Second", "Two")], b"media");
        let added = edit(
            request(
                input.clone(),
                PresentationEditOperation::Add {
                    after_slide_index: 0,
                },
            ),
            None,
        )
        .unwrap();
        assert_eq!((added.slide_count, added.current_slide_index), (3, 1));
        let added_data = added.data.unwrap();
        assert_eq!(
            inspect(added_data.clone(), 1),
            PresentationSlideText {
                title: String::new(),
                body: String::new(),
            }
        );
        let content_types =
            String::from_utf8(read_zip_part(&added_data, CONTENT_TYPES_PART)).unwrap();
        assert!(content_types.contains("/ppt/slides/slide3.xml"));
        let added_slide =
            String::from_utf8(read_zip_part(&added_data, "ppt/slides/slide3.xml")).unwrap();
        assert!(!added_slide.contains("unknown-slide-extension"));
        let added_relationships = parse_relationships(&read_zip_part(
            &added_data,
            "ppt/slides/_rels/slide3.xml.rels",
        ))
        .unwrap();
        assert_eq!(added_relationships.len(), 1);
        assert!(added_relationships[0]
            .relationship_type
            .ends_with("/slideLayout"));
        let presentation_rels =
            String::from_utf8(read_zip_part(&added_data, PRESENTATION_RELS_PART)).unwrap();
        assert!(presentation_rels.contains("urn:example:unknown"));

        let duplicated = edit(
            request(
                input.clone(),
                PresentationEditOperation::Duplicate { slide_index: 0 },
            ),
            None,
        )
        .unwrap();
        assert_eq!(
            (duplicated.slide_count, duplicated.current_slide_index),
            (3, 1)
        );
        assert_eq!(inspect(duplicated.data.unwrap(), 1).title, "First");

        let deleted = edit(
            request(input, PresentationEditOperation::Delete { slide_index: 0 }),
            None,
        )
        .unwrap();
        assert_eq!((deleted.slide_count, deleted.current_slide_index), (1, 0));
        let deleted_data = deleted.data.unwrap();
        assert_eq!(inspect(deleted_data.clone(), 0).title, "Second");
        let content_types =
            String::from_utf8(read_zip_part(&deleted_data, CONTENT_TYPES_PART)).unwrap();
        assert!(!content_types.contains("/ppt/slides/slide1.xml"));
        assert_eq!(
            read_zip_part(&deleted_data, "custom/opaque.bin"),
            b"opaque-unknown-part"
        );
    }

    #[test]
    fn outline_import_and_slide_reuse_preserve_order_and_remap_media_conflicts() {
        let destination = make_pptx(&[("Dest A", "A"), ("Dest B", "B")], b"dest-media");
        let outlined = edit(
            request(
                destination.clone(),
                PresentationEditOperation::ImportOutline {
                    after_slide_index: 0,
                    slides: vec![
                        PresentationSlideText {
                            title: "Outline 1".to_owned(),
                            body: "Body 1".to_owned(),
                        },
                        PresentationSlideText {
                            title: "Outline 2".to_owned(),
                            body: "Body 2".to_owned(),
                        },
                    ],
                },
            ),
            None,
        )
        .unwrap();
        let outlined_data = outlined.data.unwrap();
        assert_eq!((outlined.slide_count, outlined.current_slide_index), (4, 1));
        assert_eq!(inspect(outlined_data.clone(), 1).title, "Outline 1");
        assert_eq!(inspect(outlined_data, 2).title, "Outline 2");

        let source = with_cross_slide_relationships(make_pptx(
            &[("Source 1", "Source body 1"), ("Source 2", "Source body 2")],
            b"source-media",
        ));
        let reused = edit(
            request(
                destination,
                PresentationEditOperation::ReuseSlides {
                    after_slide_index: 0,
                    source_path: "granted-source.pptx".to_owned(),
                },
            ),
            Some(&source),
        )
        .unwrap();
        assert_eq!((reused.slide_count, reused.current_slide_index), (4, 1));
        let reused_data = reused.data.unwrap();
        assert_eq!(inspect(reused_data.clone(), 1).title, "Source 1");
        assert_eq!(inspect(reused_data.clone(), 2).title, "Source 2");
        assert_eq!(
            read_zip_part(&reused_data, "ppt/media/image1.bin"),
            b"dest-media"
        );
        assert_eq!(
            read_zip_part(&reused_data, "ppt/media/image1_wae1.bin"),
            b"source-media"
        );
        let imported_rels = String::from_utf8(read_zip_part(
            &reused_data,
            "ppt/slides/_rels/slide3.xml.rels",
        ))
        .unwrap();
        assert!(imported_rels.contains("../media/image1_wae1.bin"));
        assert!(imported_rels.contains("../customData/slide_wae1.bin"));
        assert!(imported_rels.contains("urn:example:unknown-internal"));
        assert!(imported_rels.contains("urn:example:unknown-external"));
        assert!(imported_rels.contains("Target=\"slide4.xml\""));
        let second_imported_rels = String::from_utf8(read_zip_part(
            &reused_data,
            "ppt/slides/_rels/slide4.xml.rels",
        ))
        .unwrap();
        assert!(second_imported_rels.contains("Target=\"slide3.xml\""));
        assert_eq!(
            read_zip_part(&reused_data, "ppt/customData/slide_wae1.bin"),
            b"custom-data:source-media"
        );
    }

    #[test]
    fn legacy_metafile_replacement_is_transactional_and_preserves_unknown_parts() {
        let input = with_legacy_metafiles(make_pptx(&[("Only", "Slide")], b"media"));
        let metafiles = extract_legacy_presentation_metafiles(&input).unwrap();
        assert_eq!(metafiles.len(), 2);
        assert!(metafiles
            .iter()
            .any(|item| item.package_path == "ppt/media/image1.wmf" && item.data == b"wmf-source"));
        assert!(metafiles
            .iter()
            .any(|item| item.package_path == "ppt/media/image2.EMF" && item.data == b"emf-source"));

        let converted = BTreeMap::from([
            ("ppt/media/image1.wmf".to_owned(), test_png(b"wmf-png")),
            ("ppt/media/image2.EMF".to_owned(), test_png(b"emf-png")),
        ]);
        let (output, count) = replace_legacy_presentation_metafiles(&input, &converted).unwrap();
        assert_eq!(count, 2);

        let entries = read_test_zip(&output);
        assert!(!entries.contains_key("ppt/media/image1.wmf"));
        assert!(!entries.contains_key("ppt/media/image2.EMF"));
        assert_eq!(entries["ppt/media/image1.png"], test_png(b"existing"));
        assert_eq!(entries["ppt/media/image1_wae1.png"], test_png(b"wmf-png"));
        assert_eq!(entries["ppt/media/image2.png"], test_png(b"emf-png"));
        assert_eq!(entries["custom/opaque.bin"], b"opaque-unknown-part");
        assert_eq!(
            entries[PRESENTATION_PART],
            read_test_zip(&input)[PRESENTATION_PART]
        );

        let relationships =
            String::from_utf8(entries["ppt/slides/_rels/slide1.xml.rels"].clone()).unwrap();
        assert!(relationships.contains("Target=\"../media/image1_wae1.png\""));
        assert!(relationships.contains("Target=\"/ppt/media/image2.png\""));
        assert!(relationships.contains("data-unknown=\"kept\""));
        assert!(relationships.contains("https://example.invalid/external.wmf"));

        let content_types = String::from_utf8(entries[CONTENT_TYPES_PART].clone()).unwrap();
        assert!(!content_types.contains("PartName=\"/ppt/media/image2.EMF\""));
        assert!(content_types.contains("PartName=\"/ppt/media/image1_wae1.png\""));
        assert!(content_types.contains("PartName=\"/ppt/media/image2.png\""));
        assert!(content_types.contains("Extension=\"wmf\""));

        let archive = ZipArchive::new(Cursor::new(&output)).unwrap();
        assert_eq!(archive.comment(), b"opaque-test-comment");
    }

    #[test]
    fn legacy_metafile_replacement_changes_only_successful_items() {
        let input = with_legacy_metafiles(make_pptx(&[("Only", "Slide")], b"media"));
        let converted = BTreeMap::from([("ppt/media/image1.wmf".to_owned(), test_png(b"wmf-png"))]);
        let (output, count) = replace_legacy_presentation_metafiles(&input, &converted).unwrap();
        assert_eq!(count, 1);

        let entries = read_test_zip(&output);
        assert!(!entries.contains_key("ppt/media/image1.wmf"));
        assert!(entries.contains_key("ppt/media/image1_wae1.png"));
        assert_eq!(entries["ppt/media/image2.EMF"], b"emf-source");

        let relationships =
            String::from_utf8(entries["ppt/slides/_rels/slide1.xml.rels"].clone()).unwrap();
        assert!(relationships.contains("Target=\"../media/image1_wae1.png\""));
        assert!(relationships.contains("Target=\"/ppt/media/image2.EMF\""));
        assert!(relationships.contains("https://example.invalid/external.wmf"));
        assert!(relationships.contains("data-unknown=\"kept\""));

        let content_types = String::from_utf8(entries[CONTENT_TYPES_PART].clone()).unwrap();
        assert!(content_types.contains("PartName=\"/ppt/media/image1_wae1.png\""));
        assert!(content_types.contains("PartName=\"/ppt/media/image2.EMF\""));
        assert!(content_types.contains("ContentType=\"image/x-emf\""));
    }

    #[test]
    fn rasterized_png_validation_checks_dimensions_checksums_and_end() {
        let valid = test_png(b"valid");
        validate_rasterized_png("ppt/media/valid.wmf", &valid).unwrap();

        let oversized = test_png_with_dimensions(MAX_RASTERIZED_IMAGE_DIMENSION + 1, 1, b"wide");
        assert!(validate_rasterized_png("ppt/media/wide.wmf", &oversized).is_err());

        let corrupt_idat = corrupt_png_chunk_crc(valid.clone(), b"IDAT");
        assert!(validate_rasterized_png("ppt/media/bad-idat.wmf", &corrupt_idat).is_err());

        let corrupt_ancillary = insert_bad_ancillary_png_chunk(valid.clone());
        assert!(
            validate_rasterized_png("ppt/media/bad-ancillary.wmf", &corrupt_ancillary).is_err()
        );

        let mut trailing = valid;
        trailing.extend_from_slice(b"unexpected");
        assert!(validate_rasterized_png("ppt/media/trailing.wmf", &trailing).is_err());
    }

    #[test]
    fn invalid_or_unmatched_metafile_outputs_are_never_counted() {
        let input = with_legacy_metafiles(make_pptx(&[("Only", "Slide")], b"media"));
        let invalid = BTreeMap::from([("ppt/media/image1.wmf".to_owned(), b"not-a-png".to_vec())]);
        assert_eq!(
            replace_legacy_presentation_metafiles(&input, &invalid)
                .unwrap_err()
                .code,
            "invalid-presentation"
        );

        let unmatched = BTreeMap::from([("ppt/media/missing.wmf".to_owned(), test_png(b"unused"))]);
        let (output, count) = replace_legacy_presentation_metafiles(&input, &unmatched).unwrap();
        assert_eq!(count, 0);
        assert_eq!(output, input);
    }

    #[test]
    fn unsafe_zip_names_dtds_and_merged_output_limits_are_rejected() {
        for name in ["../escape.bin", "ppt/./escape.bin", "ppt\\escape.bin"] {
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"unsafe").unwrap();
            let data = writer.finish().unwrap().into_inner();
            let error = match Package::open(&data) {
                Ok(_) => panic!("unsafe package name was accepted: {name}"),
                Err(error) => error,
            };
            assert_eq!(error.code, "invalid-presentation");
        }

        let dtd = br#"<?xml version="1.0"?><!DOCTYPE presentation [<!ENTITY x "bad">]><p:presentation xmlns:p="urn:p"><p:sldIdLst/></p:presentation>"#;
        assert_eq!(
            parse_slide_refs(dtd).unwrap_err().code,
            "invalid-presentation"
        );

        let package = Package {
            source: &[],
            original: BTreeMap::from([
                ("one.bin".to_owned(), vec![1, 2, 3]),
                ("two.bin".to_owned(), vec![4, 5, 6]),
            ]),
            replacements: BTreeMap::new(),
            additions: BTreeMap::new(),
            removals: HashSet::new(),
        };
        package.validate_active_limits(2, 3, 6).unwrap();
        assert!(package.validate_active_limits(1, 3, 6).is_err());
        assert!(package.validate_active_limits(2, 2, 6).is_err());
        assert!(package.validate_active_limits(2, 3, 5).is_err());
    }

    #[test]
    fn failed_edit_does_not_mutate_the_input_and_legacy_ppt_is_structured() {
        let input = make_pptx(&[("Only", "Slide")], b"media");
        let original = input.clone();
        let error = edit(
            request(input, PresentationEditOperation::Delete { slide_index: 0 }),
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, "presentation-cannot-delete-only-slide");
        assert_eq!(original, make_pptx(&[("Only", "Slide")], b"media"));

        let legacy = vec![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
        let error = edit(
            request(
                legacy,
                PresentationEditOperation::Inspect { slide_index: 0 },
            ),
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, "dependency-missing");
    }
}

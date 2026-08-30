use crate::error::{AppError, AppResult};
use quick_xml::{
    escape::{escape, unescape},
    events::{BytesEnd, BytesStart, Event},
    Reader, Writer,
};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Cursor, Read, Write},
    path::{Component, Path},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ARCHIVE_BYTES: usize = 100 * 1024 * 1024;
const MAX_ENTRIES: usize = 4_096;
const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_XML_BYTES: usize = 16 * 1024 * 1024;
const MAX_XML_DEPTH: usize = 256;
const MAX_XML_EVENTS: usize = 500_000;
const MAX_XML_ATTRIBUTES: usize = 256;
const MAX_PART_NAME_BYTES: usize = 512;

const WORD_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAWING_WORD_NS: &str =
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWING_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PICTURE_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/package/2006/relationships";
const VML_NS: &str = "urn:schemas-microsoft-com:vml";
const OFFICE_NS: &str = "urn:schemas-microsoft-com:office:office";

const CELL_BORDER_SIDES: [&str; 4] = ["top", "left", "bottom", "right"];
const TABLE_BORDER_SIDES: [&str; 6] = ["top", "left", "bottom", "right", "insideH", "insideV"];

#[derive(Debug)]
pub struct WordNormalization {
    pub data: Vec<u8>,
    pub normalized_legacy_image_count: usize,
    pub normalized_table_count: usize,
    pub removed_underline_run_count: usize,
}

#[derive(Debug, Default)]
struct XmlNormalization {
    data: Vec<u8>,
    legacy_images: usize,
    tables: usize,
    underline_runs: usize,
}

/// Normalizes only compatibility constructs whose effective appearance can be
/// materialized without changing package relationships or unrelated parts.
/// The source Vec is returned byte-for-byte when no rule applies.
pub fn normalize_package(source: Vec<u8>) -> AppResult<WordNormalization> {
    if source.len() > MAX_ARCHIVE_BYTES {
        return Err(limit_error(
            "archive",
            source.len() as u64,
            MAX_ARCHIVE_BYTES as u64,
        ));
    }

    let package = Package::open(&source)?;
    let preserve_trailing_underline_spaces = match package.optional_part("word/settings.xml")? {
        Some(settings) if is_utf8_xml(&settings) => contains_element(&settings, "w:ulTrailSpace")?,
        // OOXML also permits UTF-16 XML. The compatibility normalizer is
        // deliberately UTF-8-only, so an unparsed settings part must choose
        // the appearance-preserving behavior instead of rejecting the DOCX.
        Some(_) => true,
        None => false,
    };

    let mut replacements = BTreeMap::new();
    let mut normalized_legacy_image_count = 0_usize;
    let mut normalized_table_count = 0_usize;
    let mut removed_underline_run_count = 0_usize;

    for part_name in package.word_content_parts() {
        let source_xml = package.required_part(&part_name)?;
        // Leave supported-but-unhandled XML encodings byte-for-byte intact.
        // This normalizer is optional; it must never make a valid UTF-16 DOCX
        // impossible to open merely because no compatibility rule can run.
        if !is_utf8_xml(&source_xml) {
            continue;
        }
        let image_relationship_ids = package.image_relationship_ids(&part_name)?;
        let normalized = normalize_wordprocessing_xml(
            &source_xml,
            !preserve_trailing_underline_spaces,
            &image_relationship_ids,
        )?;
        if normalized.legacy_images == 0 && normalized.tables == 0 && normalized.underline_runs == 0
        {
            continue;
        }
        normalized_legacy_image_count = normalized_legacy_image_count
            .checked_add(normalized.legacy_images)
            .ok_or_else(|| invalid_word("Legacy image normalization count overflow"))?;
        normalized_table_count = normalized_table_count
            .checked_add(normalized.tables)
            .ok_or_else(|| invalid_word("Table normalization count overflow"))?;
        removed_underline_run_count = removed_underline_run_count
            .checked_add(normalized.underline_runs)
            .ok_or_else(|| invalid_word("Underline normalization count overflow"))?;
        replacements.insert(part_name, normalized.data);
    }

    let data = if replacements.is_empty() {
        source
    } else {
        package.finish(replacements)?
    };
    Ok(WordNormalization {
        data,
        normalized_legacy_image_count,
        normalized_table_count,
        removed_underline_run_count,
    })
}

struct Package<'a> {
    source: &'a [u8],
    names: HashSet<String>,
}

impl<'a> Package<'a> {
    fn open(source: &'a [u8]) -> AppResult<Self> {
        let mut archive = ZipArchive::new(Cursor::new(source)).map_err(zip_error)?;
        if archive.len() > MAX_ENTRIES {
            return Err(limit_error(
                "entry-count",
                archive.len() as u64,
                MAX_ENTRIES as u64,
            ));
        }

        let mut names = HashSet::with_capacity(archive.len());
        let mut folded_names = HashSet::with_capacity(archive.len());
        let mut total = 0_u64;
        for index in 0..archive.len() {
            let mut file = archive.by_index(index).map_err(zip_error)?;
            if file.encrypted() {
                return Err(invalid_word("Encrypted DOCX parts are not supported"));
            }
            if file.name_raw().contains(&b'\\') {
                return Err(invalid_word(
                    "OOXML ZIP part names must use forward slashes",
                ));
            }
            let name = file.name().to_owned();
            validate_part_name(&name)?;
            if !names.insert(name.clone()) || !folded_names.insert(name.to_ascii_lowercase()) {
                return Err(invalid_word(format!("Duplicate ZIP part: {name}")));
            }
            if file.size() > MAX_PART_BYTES {
                return Err(limit_error("part", file.size(), MAX_PART_BYTES)
                    .with_details(serde_json::json!({ "part": name })));
            }
            total = total
                .checked_add(file.size())
                .ok_or_else(|| invalid_word("Expanded DOCX size overflow"))?;
            if total > MAX_EXPANDED_BYTES {
                return Err(limit_error("expanded-archive", total, MAX_EXPANDED_BYTES));
            }
            if is_processed_xml_part(&name) && file.size() > MAX_XML_BYTES as u64 {
                return Err(limit_error("xml-part", file.size(), MAX_XML_BYTES as u64)
                    .with_details(serde_json::json!({ "part": name })));
            }
            if !file.is_dir() {
                let declared_size = file.size();
                let expanded = std::io::copy(
                    &mut file.by_ref().take(MAX_PART_BYTES + 1),
                    &mut std::io::sink(),
                )
                .map_err(|error| {
                    invalid_word(format!("Cannot validate DOCX part {name}: {error}"))
                })?;
                if expanded > MAX_PART_BYTES {
                    return Err(limit_error("expanded-part", expanded, MAX_PART_BYTES)
                        .with_details(serde_json::json!({ "part": name })));
                }
                if expanded != declared_size {
                    return Err(invalid_word(format!(
                        "Expanded size does not match ZIP metadata for part: {name}"
                    )));
                }
            }
        }

        for required in ["[Content_Types].xml", "word/document.xml"] {
            if !names.contains(required) {
                return Err(invalid_word(format!(
                    "Required OOXML part is missing: {required}"
                )));
            }
        }
        Ok(Self { source, names })
    }

    fn word_content_parts(&self) -> Vec<String> {
        let mut names = self
            .names
            .iter()
            .filter(|name| is_word_content_part(name))
            .cloned()
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    fn required_part(&self, name: &str) -> AppResult<Vec<u8>> {
        self.optional_part(name)?
            .ok_or_else(|| invalid_word(format!("Required OOXML part is missing: {name}")))
    }

    fn optional_part(&self, name: &str) -> AppResult<Option<Vec<u8>>> {
        if !self.names.contains(name) {
            return Ok(None);
        }
        let mut archive = ZipArchive::new(Cursor::new(self.source)).map_err(zip_error)?;
        let mut file = archive.by_name(name).map_err(zip_error)?;
        let limit = if is_processed_xml_part(name) {
            MAX_XML_BYTES as u64
        } else {
            MAX_PART_BYTES
        };
        let mut bytes = Vec::with_capacity(file.size().min(limit) as usize);
        file.by_ref()
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| invalid_word(format!("Cannot expand DOCX part {name}: {error}")))?;
        if bytes.len() as u64 > limit {
            return Err(limit_error("expanded-part", bytes.len() as u64, limit)
                .with_details(serde_json::json!({ "part": name })));
        }
        Ok(Some(bytes))
    }

    fn image_relationship_ids(&self, owner_part: &str) -> AppResult<HashSet<String>> {
        let Some(relationship_name) = relationship_part_name(owner_part) else {
            return Ok(HashSet::new());
        };
        let Some(xml) = self.optional_part(&relationship_name)? else {
            return Ok(HashSet::new());
        };
        if !is_utf8_xml(&xml) {
            return Ok(HashSet::new());
        }
        let document = XmlDocument::parse(&xml)?;
        if !document.root().is("Relationships")
            || document.root().attribute("xmlns") != Some(PACKAGE_RELATIONSHIPS_NS)
            || !namespace_binding_is_stable(&document, "xmlns", PACKAGE_RELATIONSHIPS_NS)
        {
            return Ok(HashSet::new());
        }
        let mut ids = HashSet::new();
        for node in &document.root().children {
            let XmlNode::Element(element) = node else {
                continue;
            };
            if !element.is("Relationship") {
                continue;
            }
            let Some(id) = element.attribute("Id") else {
                continue;
            };
            let Some(kind) = element.attribute("Type") else {
                continue;
            };
            let Some(target) = element.attribute("Target") else {
                continue;
            };
            let external = element
                .attribute("TargetMode")
                .is_some_and(|value| value.eq_ignore_ascii_case("external"));
            let target_exists = resolve_relationship_target(owner_part, target)
                .is_some_and(|target| self.names.contains(&target));
            if !external && kind.ends_with("/image") && target_exists {
                ids.insert(id.to_owned());
            }
        }
        Ok(ids)
    }

    fn finish(&self, mut replacements: BTreeMap<String, Vec<u8>>) -> AppResult<Vec<u8>> {
        for (name, bytes) in &replacements {
            if !self.names.contains(name) {
                return Err(invalid_word(format!(
                    "Cannot replace missing OOXML part: {name}"
                )));
            }
            if bytes.len() > MAX_XML_BYTES {
                return Err(limit_error(
                    "normalized-xml",
                    bytes.len() as u64,
                    MAX_XML_BYTES as u64,
                ));
            }
            // Validate every completed replacement before starting the ZIP
            // transaction. A malformed intermediate XML document never escapes.
            XmlDocument::parse(bytes)?;
        }

        let mut source = ZipArchive::new(Cursor::new(self.source)).map_err(zip_error)?;
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer.set_raw_comment(source.comment().to_vec().into_boxed_slice());
        for index in 0..source.len() {
            let file = source.by_index(index).map_err(zip_error)?;
            let name = file.name().to_owned();
            if let Some(data) = replacements.remove(&name) {
                let permissions = file.unix_mode().unwrap_or(0o644);
                drop(file);
                writer
                    .start_file(
                        name,
                        SimpleFileOptions::default()
                            .compression_method(CompressionMethod::Deflated)
                            .unix_permissions(permissions),
                    )
                    .map_err(zip_error)?;
                writer.write_all(&data).map_err(AppError::from)?;
            } else {
                // Unknown parts and all relationship parts retain their original
                // compressed payload and metadata.
                writer.raw_copy_file(file).map_err(zip_error)?;
            }
        }
        if !replacements.is_empty() {
            return Err(invalid_word("Not every normalized OOXML part was written"));
        }
        let output = writer.finish().map_err(zip_error)?.into_inner();
        if output.len() > MAX_ARCHIVE_BYTES {
            return Err(limit_error(
                "normalized-archive",
                output.len() as u64,
                MAX_ARCHIVE_BYTES as u64,
            ));
        }
        // Parsing the completed central directory makes the in-memory rewrite
        // atomic: callers receive either a complete ZIP or an error.
        let completed = Package::open(&output)?;
        if completed.names != self.names {
            return Err(invalid_word(
                "Normalized DOCX did not preserve the original part set",
            ));
        }
        Ok(output)
    }
}

#[derive(Debug, Clone)]
enum XmlNode {
    Element(XmlElement),
    Raw(Event<'static>),
}

#[derive(Debug, Clone)]
struct XmlElement {
    start: BytesStart<'static>,
    end: Option<BytesEnd<'static>>,
    attributes: Vec<(String, String)>,
    children: Vec<XmlNode>,
}

impl XmlElement {
    fn name(&self) -> &[u8] {
        self.start.name().into_inner()
    }

    fn is(&self, name: &str) -> bool {
        self.name() == name.as_bytes()
    }

    fn attribute(&self, name: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find_map(|(key, value)| (key == name).then_some(value.as_str()))
    }

    fn direct_element(&self, name: &str) -> Option<&XmlElement> {
        let mut matches = self.children.iter().filter_map(|node| match node {
            XmlNode::Element(element) if element.is(name) => Some(element),
            _ => None,
        });
        let first = matches.next()?;
        matches.next().is_none().then_some(first)
    }

    fn direct_element_mut(&mut self, name: &str) -> Option<&mut XmlElement> {
        let indexes = self
            .children
            .iter()
            .enumerate()
            .filter_map(|(index, node)| match node {
                XmlNode::Element(element) if element.is(name) => Some(index),
                _ => None,
            })
            .collect::<Vec<_>>();
        if indexes.len() != 1 {
            return None;
        }
        match &mut self.children[indexes[0]] {
            XmlNode::Element(element) => Some(element),
            XmlNode::Raw(_) => None,
        }
    }

    fn direct_elements(&self, name: &str) -> Vec<&XmlElement> {
        self.children
            .iter()
            .filter_map(|node| match node {
                XmlNode::Element(element) if element.is(name) => Some(element),
                _ => None,
            })
            .collect()
    }

    fn is_empty_element(&self) -> bool {
        self.end.is_none() && self.children.is_empty()
    }
}

#[derive(Debug)]
struct XmlDocument {
    nodes: Vec<XmlNode>,
}

impl XmlDocument {
    fn parse(source: &[u8]) -> AppResult<Self> {
        if source.len() > MAX_XML_BYTES {
            return Err(limit_error(
                "xml",
                source.len() as u64,
                MAX_XML_BYTES as u64,
            ));
        }
        std::str::from_utf8(source)
            .map_err(|_| invalid_word("Only UTF-8 OOXML parts can be normalized"))?;

        let mut reader = Reader::from_reader(source);
        reader.config_mut().check_end_names = true;
        let mut buffer = Vec::new();
        let mut nodes = Vec::new();
        let mut stack: Vec<XmlElement> = Vec::new();
        let mut events = 0_usize;
        loop {
            let event = reader
                .read_event_into(&mut buffer)
                .map_err(|error| invalid_word(format!("Invalid WordprocessingML XML: {error}")))?;
            events = events
                .checked_add(1)
                .ok_or_else(|| invalid_word("XML event count overflow"))?;
            if events > MAX_XML_EVENTS {
                return Err(limit_error(
                    "xml-events",
                    events as u64,
                    MAX_XML_EVENTS as u64,
                ));
            }
            match event {
                Event::Start(start) => {
                    if stack.len() >= MAX_XML_DEPTH {
                        return Err(limit_error(
                            "xml-depth",
                            (stack.len() + 1) as u64,
                            MAX_XML_DEPTH as u64,
                        ));
                    }
                    let attributes = parse_attributes(&start)?;
                    stack.push(XmlElement {
                        start: start.into_owned(),
                        end: None,
                        attributes,
                        children: Vec::new(),
                    });
                }
                Event::Empty(start) => {
                    let attributes = parse_attributes(&start)?;
                    append_xml_node(
                        &mut nodes,
                        &mut stack,
                        XmlNode::Element(XmlElement {
                            start: start.into_owned(),
                            end: None,
                            attributes,
                            children: Vec::new(),
                        }),
                    );
                }
                Event::End(end) => {
                    let mut element = stack
                        .pop()
                        .ok_or_else(|| invalid_word("Unexpected XML end element"))?;
                    element.end = Some(end.into_owned());
                    append_xml_node(&mut nodes, &mut stack, XmlNode::Element(element));
                }
                Event::DocType(_) => {
                    return Err(invalid_word("DTD declarations are not allowed in OOXML"))
                }
                Event::Eof => break,
                other => append_xml_node(&mut nodes, &mut stack, XmlNode::Raw(other.into_owned())),
            }
            buffer.clear();
        }
        if !stack.is_empty() {
            return Err(invalid_word("Unclosed XML element"));
        }
        let roots = nodes
            .iter()
            .filter(|node| matches!(node, XmlNode::Element(_)))
            .count();
        if roots != 1 {
            return Err(invalid_word(
                "OOXML part must contain exactly one root element",
            ));
        }
        let mut declarations = 0_usize;
        for node in &nodes {
            match node {
                XmlNode::Element(_) => {}
                XmlNode::Raw(Event::Decl(_)) => declarations += 1,
                XmlNode::Raw(Event::Comment(_) | Event::PI(_)) => {}
                XmlNode::Raw(event) if raw_event_is_whitespace(event) => {}
                XmlNode::Raw(_) => {
                    return Err(invalid_word(
                        "OOXML contains non-whitespace data outside the root element",
                    ))
                }
            }
        }
        if declarations > 1 {
            return Err(invalid_word("OOXML contains multiple XML declarations"));
        }
        Ok(Self { nodes })
    }

    fn root(&self) -> &XmlElement {
        self.nodes
            .iter()
            .find_map(|node| match node {
                XmlNode::Element(element) => Some(element),
                XmlNode::Raw(_) => None,
            })
            .expect("XML parser guarantees one root")
    }

    fn visit_elements(&self, visitor: &mut impl FnMut(&XmlElement)) {
        fn visit(nodes: &[XmlNode], visitor: &mut impl FnMut(&XmlElement)) {
            for node in nodes {
                if let XmlNode::Element(element) = node {
                    visitor(element);
                    visit(&element.children, visitor);
                }
            }
        }
        visit(&self.nodes, visitor);
    }

    fn serialize(&self) -> AppResult<Vec<u8>> {
        fn write_node(writer: &mut Writer<Vec<u8>>, node: &XmlNode) -> AppResult<()> {
            match node {
                XmlNode::Raw(event) => writer
                    .write_event(event.borrow())
                    .map_err(|error| invalid_word(format!("Cannot serialize OOXML: {error}")))?,
                XmlNode::Element(element) => {
                    if let Some(end) = &element.end {
                        writer
                            .write_event(Event::Start(element.start.borrow()))
                            .map_err(|error| {
                                invalid_word(format!("Cannot serialize OOXML: {error}"))
                            })?;
                        for child in &element.children {
                            write_node(writer, child)?;
                        }
                        writer
                            .write_event(Event::End(end.borrow()))
                            .map_err(|error| {
                                invalid_word(format!("Cannot serialize OOXML: {error}"))
                            })?;
                    } else {
                        writer
                            .write_event(Event::Empty(element.start.borrow()))
                            .map_err(|error| {
                                invalid_word(format!("Cannot serialize OOXML: {error}"))
                            })?;
                    }
                }
            }
            Ok(())
        }

        let mut writer = Writer::new(Vec::new());
        for node in &self.nodes {
            write_node(&mut writer, node)?;
        }
        let output = writer.into_inner();
        if output.len() > MAX_XML_BYTES {
            return Err(limit_error(
                "normalized-xml",
                output.len() as u64,
                MAX_XML_BYTES as u64,
            ));
        }
        Ok(output)
    }
}

fn append_xml_node(roots: &mut Vec<XmlNode>, stack: &mut [XmlElement], node: XmlNode) {
    if let Some(parent) = stack.last_mut() {
        parent.children.push(node);
    } else {
        roots.push(node);
    }
}

fn parse_attributes(start: &BytesStart<'_>) -> AppResult<Vec<(String, String)>> {
    let mut attributes = Vec::new();
    for attribute in start.attributes().with_checks(true) {
        let attribute =
            attribute.map_err(|error| invalid_word(format!("Invalid OOXML attribute: {error}")))?;
        if attributes.len() >= MAX_XML_ATTRIBUTES {
            return Err(limit_error(
                "xml-attributes",
                (attributes.len() + 1) as u64,
                MAX_XML_ATTRIBUTES as u64,
            ));
        }
        let key = std::str::from_utf8(attribute.key.as_ref())
            .map_err(|_| invalid_word("OOXML attribute name is not UTF-8"))?
            .to_owned();
        let raw_value = std::str::from_utf8(attribute.value.as_ref())
            .map_err(|_| invalid_word("OOXML attribute value is not UTF-8"))?;
        let value = unescape(raw_value)
            .map_err(|error| invalid_word(format!("Invalid OOXML entity: {error}")))?
            .into_owned();
        attributes.push((key, value));
    }
    Ok(attributes)
}

fn normalize_wordprocessing_xml(
    source: &[u8],
    remove_trailing_underline_spaces: bool,
    image_relationship_ids: &HashSet<String>,
) -> AppResult<XmlNormalization> {
    let mut document = XmlDocument::parse(source)?;
    if document.root().attribute("xmlns:w") != Some(WORD_NS)
        || !namespace_binding_is_stable(&document, "xmlns:w", WORD_NS)
    {
        return Ok(XmlNormalization {
            data: source.to_vec(),
            ..XmlNormalization::default()
        });
    }
    let has_vml_namespaces = document.root().attribute("xmlns:v") == Some(VML_NS)
        && document.root().attribute("xmlns:o") == Some(OFFICE_NS)
        && document.root().attribute("xmlns:r") == Some(RELATIONSHIPS_NS)
        && namespace_binding_is_stable(&document, "xmlns:v", VML_NS)
        && namespace_binding_is_stable(&document, "xmlns:o", OFFICE_NS)
        && namespace_binding_is_stable(&document, "xmlns:r", RELATIONSHIPS_NS);
    let underline_runs = if remove_trailing_underline_spaces {
        normalize_underlines(&mut document.nodes)
    } else {
        0
    };
    let tables = normalize_tables(&mut document.nodes);
    let mut next_document_property_id = next_document_property_id(&document)?;
    let legacy_images = if has_vml_namespaces {
        normalize_vml_images(
            &mut document.nodes,
            image_relationship_ids,
            &mut next_document_property_id,
        )?
    } else {
        0
    };

    if legacy_images == 0 && tables == 0 && underline_runs == 0 {
        return Ok(XmlNormalization {
            data: source.to_vec(),
            ..XmlNormalization::default()
        });
    }
    Ok(XmlNormalization {
        data: document.serialize()?,
        legacy_images,
        tables,
        underline_runs,
    })
}

fn contains_element(source: &[u8], name: &str) -> AppResult<bool> {
    let document = XmlDocument::parse(source)?;
    if document.root().attribute("xmlns:w") != Some(WORD_NS)
        || !namespace_binding_is_stable(&document, "xmlns:w", WORD_NS)
    {
        return Ok(false);
    }
    let mut found = false;
    document.visit_elements(&mut |element| found |= element.is(name));
    Ok(found)
}

fn namespace_binding_is_stable(document: &XmlDocument, attribute: &str, expected: &str) -> bool {
    let mut stable = true;
    document.visit_elements(&mut |element| {
        if element
            .attribute(attribute)
            .is_some_and(|value| value != expected)
        {
            stable = false;
        }
    });
    stable
}

fn normalize_underlines(nodes: &mut [XmlNode]) -> usize {
    let mut removed = 0_usize;
    for node in nodes.iter_mut() {
        let XmlNode::Element(element) = node else {
            continue;
        };
        removed += normalize_underlines(&mut element.children);
        if !element.is("w:p") || !paragraph_is_invisible_text_only(element) {
            continue;
        }
        let removable = element
            .children
            .iter()
            .enumerate()
            .filter_map(|(index, child)| match child {
                XmlNode::Element(run) if removable_underlined_run(run) => Some(index),
                _ => None,
            })
            .collect::<Vec<_>>();
        for index in removable.iter().rev() {
            element.children.remove(*index);
        }
        removed += removable.len();
    }
    removed
}

fn paragraph_is_invisible_text_only(paragraph: &XmlElement) -> bool {
    const FORBIDDEN: [&str; 14] = [
        "w:tab",
        "w:br",
        "w:cr",
        "w:drawing",
        "w:object",
        "w:pict",
        "w:fldChar",
        "w:instrText",
        "w:delText",
        "w:sym",
        "w:noBreakHyphen",
        "w:softHyphen",
        "w:pgNum",
        "w:lastRenderedPageBreak",
    ];
    if FORBIDDEN.iter().any(|name| has_descendant(paragraph, name)) {
        return false;
    }
    let texts = descendants(paragraph, "w:t");
    !texts.is_empty()
        && texts
            .into_iter()
            .all(|text| element_text(text).is_some_and(|value| xml_whitespace_only(&value)))
}

fn removable_underlined_run(run: &XmlElement) -> bool {
    if !run.is("w:r") {
        return false;
    }
    let mut has_text = false;
    for child in &run.children {
        match child {
            XmlNode::Element(element) if element.is("w:rPr") => {}
            XmlNode::Element(element) if element.is("w:t") => {
                has_text = true;
                if !element_text(element).is_some_and(|value| xml_whitespace_only(&value)) {
                    return false;
                }
            }
            XmlNode::Element(_) => return false,
            XmlNode::Raw(event) if raw_event_is_whitespace(event) => {}
            XmlNode::Raw(_) => return false,
        }
    }
    if !has_text {
        return false;
    }
    let Some(properties) = run.direct_element("w:rPr") else {
        return false;
    };
    if has_descendant(properties, "w:rPrChange") {
        return false;
    }
    let Some(underline) = properties.direct_element("w:u") else {
        return false;
    };
    !underline
        .attribute("w:val")
        .is_some_and(|value| value == "nil" || value == "none")
}

fn normalize_tables(nodes: &mut [XmlNode]) -> usize {
    let mut count = 0_usize;
    for node in nodes {
        let XmlNode::Element(element) = node else {
            continue;
        };
        count += normalize_tables(&mut element.children);
        if element.is("w:tbl") && normalize_table(element) {
            count += 1;
        }
    }
    count
}

#[derive(Clone)]
struct TableBorderSources {
    top: XmlElement,
    left: XmlElement,
    bottom: XmlElement,
    right: XmlElement,
    inside_h: XmlElement,
    inside_v: XmlElement,
}

impl TableBorderSources {
    fn get(&self, name: &str) -> &XmlElement {
        match name {
            "top" => &self.top,
            "left" => &self.left,
            "bottom" => &self.bottom,
            "right" => &self.right,
            "insideH" => &self.inside_h,
            "insideV" => &self.inside_v,
            _ => unreachable!("known table border side"),
        }
    }
}

fn normalize_table(table: &mut XmlElement) -> bool {
    let Some((sources, row_spans, column_count, needs_normalization)) = analyze_table(table) else {
        return false;
    };
    if !needs_normalization {
        return false;
    }

    let mut row_index = 0_usize;
    for child in &mut table.children {
        let XmlNode::Element(row) = child else {
            continue;
        };
        if !row.is("w:tr") {
            continue;
        }
        let spans = &row_spans[row_index];
        let mut cell_index = 0_usize;
        let mut column_index = 0_usize;
        for row_child in &mut row.children {
            let XmlNode::Element(cell) = row_child else {
                continue;
            };
            if !cell.is("w:tc") {
                continue;
            }
            let span = spans[cell_index];
            let last_column = column_index + span;
            let inherited = [
                if row_index == 0 { "top" } else { "insideH" },
                if column_index == 0 { "left" } else { "insideV" },
                if row_index + 1 == row_spans.len() {
                    "bottom"
                } else {
                    "insideH"
                },
                if last_column == column_count {
                    "right"
                } else {
                    "insideV"
                },
            ];
            materialize_cell_borders(cell, &sources, inherited);
            column_index = last_column;
            cell_index += 1;
        }
        row_index += 1;
    }

    let table_properties = table
        .direct_element_mut("w:tblPr")
        .expect("table was analyzed");
    let table_borders = table_properties
        .direct_element_mut("w:tblBorders")
        .expect("table borders were analyzed");
    for side in TABLE_BORDER_SIDES {
        replace_or_insert_border(table_borders, side, nil_border(&format!("w:{side}")));
    }
    true
}

fn analyze_table(table: &XmlElement) -> Option<(TableBorderSources, Vec<Vec<usize>>, usize, bool)> {
    let properties = table.direct_element("w:tblPr")?;
    if properties.direct_element("w:bidiVisual").is_some() {
        return None;
    }
    let borders = properties.direct_element("w:tblBorders")?;
    if borders.direct_element("w:start").is_some() || borders.direct_element("w:end").is_some() {
        return None;
    }
    let border = |name: &str| -> Option<XmlElement> {
        let value = borders.direct_element(&format!("w:{name}"))?;
        value.is_empty_element().then(|| value.clone())
    };
    let sources = TableBorderSources {
        top: border("top")?,
        left: border("left")?,
        bottom: border("bottom")?,
        right: border("right")?,
        inside_h: border("insideH")?,
        inside_v: border("insideV")?,
    };
    if TABLE_BORDER_SIDES
        .iter()
        .any(|side| sources.get(side).attribute("w:val").is_none())
    {
        return None;
    }
    let table_has_visible_border = TABLE_BORDER_SIDES.iter().any(|side| {
        !sources
            .get(side)
            .attribute("w:val")
            .is_some_and(|value| value == "nil" || value == "none")
    });
    if !table_has_visible_border {
        return None;
    }

    let grid = table.direct_element("w:tblGrid")?;
    let column_count = grid.direct_elements("w:gridCol").len();
    if column_count == 0 {
        return None;
    }
    let rows = table.direct_elements("w:tr");
    if rows.is_empty() {
        return None;
    }
    let mut row_spans = Vec::with_capacity(rows.len());
    let mut needs_normalization = false;
    for row in rows {
        if row.direct_element("w:trPr").is_some_and(|properties| {
            properties.direct_element("w:gridBefore").is_some()
                || properties.direct_element("w:gridAfter").is_some()
        }) {
            return None;
        }
        if row
            .direct_elements("w:tblPrEx")
            .iter()
            .any(|exception| exception.direct_element("w:tblBorders").is_some())
        {
            return None;
        }

        let cells = row.direct_elements("w:tc");
        if cells.is_empty() {
            return None;
        }
        let mut spans = Vec::with_capacity(cells.len());
        let mut occupied = 0_usize;
        for cell in cells {
            if cell.direct_elements("w:tcPr").len() > 1 {
                return None;
            }
            let properties = cell.direct_element("w:tcPr");
            if properties.is_some_and(|properties| {
                properties.direct_element("w:hMerge").is_some()
                    || properties.direct_element("w:vMerge").is_some()
            }) {
                return None;
            }
            let span =
                match properties.and_then(|properties| properties.direct_element("w:gridSpan")) {
                    Some(span) => span.attribute("w:val")?.parse::<usize>().ok()?,
                    None => 1,
                };
            if span == 0 || span > column_count {
                return None;
            }
            occupied = occupied.checked_add(span)?;
            spans.push(span);

            if properties.is_some_and(|value| value.direct_elements("w:tcBorders").len() > 1) {
                return None;
            }
            if let Some(cell_borders) =
                properties.and_then(|value| value.direct_element("w:tcBorders"))
            {
                for side in CELL_BORDER_SIDES {
                    if cell_borders.direct_elements(&format!("w:{side}")).len() > 1 {
                        return None;
                    }
                    if let Some(border) = cell_borders.direct_element(&format!("w:{side}")) {
                        if !border.is_empty_element() {
                            return None;
                        }
                        needs_normalization |= border
                            .attribute("w:val")
                            .is_some_and(|value| value == "nil" || value == "none");
                    }
                }
            }
        }
        if occupied != column_count {
            return None;
        }
        row_spans.push(spans);
    }
    Some((sources, row_spans, column_count, needs_normalization))
}

fn materialize_cell_borders(
    cell: &mut XmlElement,
    sources: &TableBorderSources,
    inherited: [&str; 4],
) {
    let properties_index = cell
        .children
        .iter()
        .position(|node| matches!(node, XmlNode::Element(element) if element.is("w:tcPr")));
    if properties_index.is_none() {
        cell.children.insert(
            0,
            XmlNode::Element(nonempty_element(
                "w:tcPr",
                vec![XmlNode::Element(cell_borders_from_sources(
                    None, sources, inherited,
                ))],
            )),
        );
        return;
    }
    let XmlNode::Element(properties) = &mut cell.children[properties_index.expect("checked")]
    else {
        unreachable!();
    };
    let borders_index = properties
        .children
        .iter()
        .position(|node| matches!(node, XmlNode::Element(element) if element.is("w:tcBorders")));
    let existing = borders_index.and_then(|index| match &properties.children[index] {
        XmlNode::Element(element) => Some(element),
        XmlNode::Raw(_) => None,
    });
    let materialized = cell_borders_from_sources(existing, sources, inherited);
    if let Some(index) = borders_index {
        properties.children[index] = XmlNode::Element(materialized);
        return;
    }

    const FOLLOWING_PROPERTIES: [&str; 9] = [
        "w:shd",
        "w:noWrap",
        "w:tcMar",
        "w:textDirection",
        "w:tcFitText",
        "w:vAlign",
        "w:hideMark",
        "w:headers",
        "w:tcPrChange",
    ];
    let insertion = properties
        .children
        .iter()
        .position(|node| match node {
            XmlNode::Element(element) => FOLLOWING_PROPERTIES.iter().any(|name| element.is(name)),
            XmlNode::Raw(_) => false,
        })
        .unwrap_or(properties.children.len());
    properties
        .children
        .insert(insertion, XmlNode::Element(materialized));
}

fn cell_borders_from_sources(
    existing: Option<&XmlElement>,
    sources: &TableBorderSources,
    inherited: [&str; 4],
) -> XmlElement {
    let mut output = existing
        .cloned()
        .unwrap_or_else(|| nonempty_element("w:tcBorders", Vec::new()));
    for (side, inherited_side) in CELL_BORDER_SIDES.into_iter().zip(inherited) {
        let replacement = existing
            .and_then(|borders| borders.direct_element(&format!("w:{side}")))
            .cloned()
            .unwrap_or_else(|| renamed_element(sources.get(inherited_side), &format!("w:{side}")));
        replace_or_insert_border(&mut output, side, replacement);
    }
    output
}

fn replace_or_insert_border(parent: &mut XmlElement, side: &str, replacement: XmlElement) {
    let qualified = format!("w:{side}");
    if let Some(index) = parent
        .children
        .iter()
        .position(|node| matches!(node, XmlNode::Element(element) if element.is(&qualified)))
    {
        parent.children[index] = XmlNode::Element(replacement);
        return;
    }
    let order = if parent.is("w:tblBorders") {
        &TABLE_BORDER_SIDES[..]
    } else {
        &CELL_BORDER_SIDES[..]
    };
    let side_index = order
        .iter()
        .position(|candidate| *candidate == side)
        .expect("known border side");
    let insertion = parent
        .children
        .iter()
        .position(|node| match node {
            XmlNode::Element(element) => order[side_index + 1..]
                .iter()
                .any(|candidate| element.is(&format!("w:{candidate}"))),
            XmlNode::Raw(_) => false,
        })
        .unwrap_or(parent.children.len());
    parent
        .children
        .insert(insertion, XmlNode::Element(replacement));
}

fn next_document_property_id(document: &XmlDocument) -> AppResult<u32> {
    let mut maximum = 0_u32;
    document.visit_elements(&mut |element| {
        if element.is("wp:docPr") {
            if let Some(id) = element.attribute("id").and_then(|value| value.parse().ok()) {
                maximum = maximum.max(id);
            }
        }
    });
    maximum
        .checked_add(1)
        .ok_or_else(|| invalid_word("Drawing document property ID space is exhausted"))
}

fn normalize_vml_images(
    nodes: &mut [XmlNode],
    image_relationship_ids: &HashSet<String>,
    next_document_property_id: &mut u32,
) -> AppResult<usize> {
    let mut count = 0_usize;
    for node in nodes {
        let XmlNode::Element(element) = node else {
            continue;
        };
        if matches!(element.name(), b"w:pict" | b"w:object") {
            if let Some(candidate) = simple_vml_image(element, image_relationship_ids) {
                let replacement = drawing_element(candidate, *next_document_property_id)?;
                *next_document_property_id =
                    next_document_property_id.checked_add(1).ok_or_else(|| {
                        invalid_word("Drawing document property ID space is exhausted")
                    })?;
                *node = XmlNode::Element(replacement);
                count += 1;
                continue;
            }
        }
        count += normalize_vml_images(
            &mut element.children,
            image_relationship_ids,
            next_document_property_id,
        )?;
    }
    Ok(count)
}

struct VmlImage<'a> {
    relationship_id: &'a str,
    width_emu: u64,
    height_emu: u64,
    description: &'a str,
}

fn simple_vml_image<'a>(
    container: &'a XmlElement,
    image_relationship_ids: &HashSet<String>,
) -> Option<VmlImage<'a>> {
    if container.is("w:pict") {
        if !only_element_and_whitespace(&container.children, "v:shape") {
            return None;
        }
    } else if container.is("w:object") {
        if !object_children_are_safe(container) {
            return None;
        }
    } else {
        return None;
    }
    let shape = container.direct_element("v:shape")?;
    if !attributes_allowed(
        shape,
        &[
            "id",
            "o:spid",
            "o:spt",
            "type",
            "style",
            "alt",
            "stroked",
            "filled",
            "o:ole",
            "o:preferrelative",
            "coordsize",
        ],
    ) {
        return None;
    }
    if shape.attribute("type") != Some("#_x0000_t75") {
        return None;
    }
    if !shape
        .attribute("stroked")
        .is_some_and(|value| matches!(value, "f" | "false" | "0"))
    {
        return None;
    }
    let (width_emu, height_emu) = parse_simple_image_style(shape.attribute("style")?)?;
    if !shape_children_are_safe(shape) {
        return None;
    }
    let image_data = shape.direct_element("v:imagedata")?;
    if !image_data.is_empty_element()
        || !attributes_allowed(image_data, &["r:id", "o:title", "embosscolor"])
    {
        return None;
    }
    let relationship_id = image_data.attribute("r:id")?;
    if relationship_id.len() > 256 || !image_relationship_ids.contains(relationship_id) {
        return None;
    }
    let description = shape
        .attribute("alt")
        .or_else(|| image_data.attribute("o:title"))
        .unwrap_or("Embedded image");
    if description.len() > 4_096 || !description.chars().all(valid_xml_char) {
        return None;
    }
    Some(VmlImage {
        relationship_id,
        width_emu,
        height_emu,
        description,
    })
}

fn shape_children_are_safe(shape: &XmlElement) -> bool {
    let mut image_count = 0_usize;
    let mut lock_count = 0_usize;
    for child in &shape.children {
        match child {
            XmlNode::Element(element) if element.is("v:imagedata") => image_count += 1,
            XmlNode::Element(element) if element.is("o:lock") => {
                lock_count += 1;
                if !element.is_empty_element()
                    || !attributes_allowed(
                        element,
                        &["v:ext", "aspectratio", "grouping", "rotation", "text"],
                    )
                    || element
                        .attribute("aspectratio")
                        .is_some_and(|value| !matches!(value, "t" | "true" | "1"))
                {
                    return false;
                }
            }
            XmlNode::Element(element)
                if element.is("v:path")
                    && element.is_empty_element()
                    && attributes_allowed(element, &["v:ext", "limo", "textboxrect"]) => {}
            XmlNode::Element(element)
                if element.is("v:fill")
                    && element.is_empty_element()
                    && attributes_allowed(
                        element,
                        &["on", "color", "color2", "focussize", "opacity"],
                    ) => {}
            XmlNode::Element(element)
                if element.is("v:stroke")
                    && element.is_empty_element()
                    && attributes_allowed(element, &["on", "color", "weight", "opacity"]) => {}
            XmlNode::Element(element)
                if element.is("w10:wrap")
                    && element.is_empty_element()
                    && attributes_allowed(element, &["type", "side", "anchorx", "anchory"])
                    && matches!(element.attribute("type"), None | Some("none")) => {}
            XmlNode::Element(element)
                if element.is("w10:anchorlock")
                    && element.is_empty_element()
                    && attributes_allowed(element, &[]) => {}
            XmlNode::Element(_) => return false,
            XmlNode::Raw(event) if raw_event_is_whitespace(event) => {}
            XmlNode::Raw(_) => return false,
        }
    }
    image_count == 1 && lock_count <= 1
}

fn object_children_are_safe(object: &XmlElement) -> bool {
    let mut shape_count = 0_usize;
    let mut ole_count = 0_usize;
    for child in &object.children {
        match child {
            XmlNode::Element(element) if element.is("v:shape") => shape_count += 1,
            XmlNode::Element(element) if element.is("o:OLEObject") => {
                ole_count += 1;
                if !ole_object_is_safe(element) {
                    return false;
                }
            }
            XmlNode::Raw(event) if raw_event_is_whitespace(event) => {}
            XmlNode::Element(_) | XmlNode::Raw(_) => return false,
        }
    }
    shape_count == 1 && ole_count <= 1
}

fn ole_object_is_safe(object: &XmlElement) -> bool {
    if !attributes_allowed(
        object,
        &[
            "Type",
            "ProgID",
            "ShapeID",
            "DrawAspect",
            "ObjectID",
            "r:id",
        ],
    ) {
        return false;
    }
    if object
        .attribute("Type")
        .is_some_and(|value| value != "Embed")
        || object
            .attribute("DrawAspect")
            .is_some_and(|value| value != "Content")
    {
        return false;
    }
    object.children.iter().all(|child| match child {
        XmlNode::Element(element) if element.is("o:LockedField") => {
            if !attributes_allowed(element, &[]) {
                return false;
            }
            element_text(element).is_some_and(|value| matches!(value.as_str(), "true" | "false"))
        }
        XmlNode::Raw(event) if raw_event_is_whitespace(event) => true,
        _ => false,
    })
}

fn parse_simple_image_style(style: &str) -> Option<(u64, u64)> {
    let mut width = None;
    let mut height = None;
    for declaration in style.split(';').filter(|value| !value.trim().is_empty()) {
        let (name, value) = declaration.split_once(':')?;
        let slot = match name.trim().to_ascii_lowercase().as_str() {
            "width" => &mut width,
            "height" => &mut height,
            _ => return None,
        };
        if slot.is_some() {
            return None;
        }
        *slot = Some(css_length_to_emu(value.trim())?);
    }
    Some((width?, height?))
}

fn css_length_to_emu(value: &str) -> Option<u64> {
    let split = value
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .unwrap_or(value.len());
    let number = value[..split].parse::<f64>().ok()?;
    if !number.is_finite() || number <= 0.0 {
        return None;
    }
    let unit = value[split..].trim().to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "" | "pt" => 12_700_f64,
        "in" => 914_400_f64,
        "cm" => 360_000_f64,
        "mm" => 36_000_f64,
        "px" => 9_525_f64,
        _ => return None,
    };
    let emu = number * multiplier;
    (emu.is_finite() && emu >= 1.0 && emu <= u32::MAX as f64).then(|| emu.round() as u64)
}

fn drawing_element(candidate: VmlImage<'_>, document_property_id: u32) -> AppResult<XmlElement> {
    let relationship_id = escape(candidate.relationship_id);
    let description = escape(candidate.description);
    let name = format!("Converted image {document_property_id}");
    let safe_name = escape(&name);
    let xml = format!(
        "<w:drawing xmlns:w=\"{WORD_NS}\" xmlns:wp=\"{DRAWING_WORD_NS}\" xmlns:a=\"{DRAWING_NS}\" xmlns:pic=\"{PICTURE_NS}\" xmlns:r=\"{RELATIONSHIPS_NS}\"><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"{}\" cy=\"{}\"/><wp:effectExtent l=\"0\" t=\"0\" r=\"0\" b=\"0\"/><wp:docPr id=\"{}\" name=\"{}\" descr=\"{}\"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect=\"1\"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:nvPicPr><pic:cNvPr id=\"0\" name=\"{}\" descr=\"{}\"/><pic:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed=\"{}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{}\" cy=\"{}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>",
        candidate.width_emu,
        candidate.height_emu,
        document_property_id,
        safe_name,
        description,
        safe_name,
        description,
        relationship_id,
        candidate.width_emu,
        candidate.height_emu,
    );
    let mut document = XmlDocument::parse(xml.as_bytes())?;
    match document.nodes.pop() {
        Some(XmlNode::Element(element)) if document.nodes.is_empty() => Ok(element),
        _ => Err(invalid_word("Generated DrawingML did not have one root")),
    }
}

fn attributes_allowed(element: &XmlElement, allowed: &[&str]) -> bool {
    element
        .attributes
        .iter()
        .all(|(name, _)| name.starts_with("xmlns") || allowed.iter().any(|allowed| name == allowed))
}

fn only_element_and_whitespace(children: &[XmlNode], name: &str) -> bool {
    let mut count = 0_usize;
    for child in children {
        match child {
            XmlNode::Element(element) if element.is(name) => count += 1,
            XmlNode::Element(_) => return false,
            XmlNode::Raw(event) if raw_event_is_whitespace(event) => {}
            XmlNode::Raw(_) => return false,
        }
    }
    count == 1
}

fn nonempty_element(name: &str, children: Vec<XmlNode>) -> XmlElement {
    XmlElement {
        start: BytesStart::new(name).into_owned(),
        end: Some(BytesEnd::new(name).into_owned()),
        attributes: Vec::new(),
        children,
    }
}

fn nil_border(name: &str) -> XmlElement {
    let mut start = BytesStart::new(name);
    start.push_attribute(("w:val", "nil"));
    XmlElement {
        start: start.into_owned(),
        end: None,
        attributes: vec![("w:val".to_owned(), "nil".to_owned())],
        children: Vec::new(),
    }
}

fn renamed_element(source: &XmlElement, name: &str) -> XmlElement {
    let mut output = source.clone();
    output.start.set_name(name.as_bytes());
    if output.end.is_some() {
        output.end = Some(BytesEnd::new(name).into_owned());
    }
    output
}

fn has_descendant(element: &XmlElement, name: &str) -> bool {
    element.children.iter().any(|node| match node {
        XmlNode::Element(child) => child.is(name) || has_descendant(child, name),
        XmlNode::Raw(_) => false,
    })
}

fn descendants<'a>(element: &'a XmlElement, name: &str) -> Vec<&'a XmlElement> {
    fn collect<'a>(nodes: &'a [XmlNode], name: &str, output: &mut Vec<&'a XmlElement>) {
        for node in nodes {
            if let XmlNode::Element(element) = node {
                if element.is(name) {
                    output.push(element);
                }
                collect(&element.children, name, output);
            }
        }
    }
    let mut output = Vec::new();
    collect(&element.children, name, &mut output);
    output
}

fn element_text(element: &XmlElement) -> Option<String> {
    let mut output = String::new();
    for child in &element.children {
        match child {
            XmlNode::Raw(Event::Text(text)) => {
                let decoded = text.decode().ok()?;
                output.push_str(&unescape(&decoded).ok()?);
            }
            XmlNode::Raw(Event::CData(text)) => output.push_str(&text.decode().ok()?),
            XmlNode::Raw(event) if raw_event_is_whitespace(event) => {}
            XmlNode::Raw(_) | XmlNode::Element(_) => return None,
        }
    }
    Some(output)
}

fn raw_event_is_whitespace(event: &Event<'_>) -> bool {
    match event {
        Event::Text(text) => text.decode().ok().is_some_and(|value| {
            unescape(&value)
                .ok()
                .is_some_and(|value| xml_whitespace_only(&value))
        }),
        Event::CData(text) => text
            .decode()
            .ok()
            .is_some_and(|value| xml_whitespace_only(&value)),
        _ => false,
    }
}

fn xml_whitespace_only(value: &str) -> bool {
    value
        .chars()
        .all(|character| matches!(character, ' ' | '\t' | '\r' | '\n'))
}

fn is_utf8_xml(source: &[u8]) -> bool {
    // XML 1.0 cannot contain NUL. Rejecting it here also distinguishes
    // BOM-less UTF-16/UTF-32 whose ASCII markup bytes would otherwise form a
    // technically valid UTF-8 byte sequence and reach the UTF-8-only parser.
    !source.contains(&0) && std::str::from_utf8(source).is_ok()
}

fn relationship_part_name(owner: &str) -> Option<String> {
    let (directory, file_name) = owner.rsplit_once('/')?;
    Some(format!("{directory}/_rels/{file_name}.rels"))
}

fn resolve_relationship_target(owner: &str, target: &str) -> Option<String> {
    if target.is_empty()
        || target.contains('\\')
        || target.contains(['?', '#'])
        || target.contains("://")
    {
        return None;
    }
    let decoded = percent_encoding::percent_decode_str(target)
        .decode_utf8()
        .ok()?;
    let mut segments = if decoded.starts_with('/') {
        Vec::new()
    } else {
        owner
            .rsplit_once('/')?
            .0
            .split('/')
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    for segment in decoded.trim_start_matches('/').split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            value => segments.push(value.to_owned()),
        }
    }
    let resolved = segments.join("/");
    validate_part_name(&resolved).ok()?;
    Some(resolved)
}

fn is_processed_xml_part(name: &str) -> bool {
    name == "word/settings.xml"
        || is_word_content_part(name)
        || name.ends_with(".xml.rels") && name.starts_with("word/_rels/")
        || name.contains("/_rels/") && name.ends_with(".xml.rels") && name.starts_with("word/")
}

fn is_word_content_part(name: &str) -> bool {
    if matches!(
        name,
        "word/document.xml" | "word/footnotes.xml" | "word/endnotes.xml"
    ) {
        return true;
    }
    ["word/header", "word/footer"].iter().any(|prefix| {
        name.strip_prefix(prefix)
            .and_then(|suffix| suffix.strip_suffix(".xml"))
            .is_some_and(|number| {
                !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
            })
    })
}

fn validate_part_name(name: &str) -> AppResult<()> {
    let path_name = name.strip_suffix('/').unwrap_or(name);
    if path_name.is_empty()
        || name.len() > MAX_PART_NAME_BYTES
        || name.starts_with('/')
        || name.contains('\0')
        || name.contains("//")
        || path_name
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || path_name
            .split('/')
            .next()
            .is_some_and(|segment| segment.as_bytes().get(1) == Some(&b':'))
    {
        return Err(invalid_word("Invalid ZIP part name"));
    }
    if Path::new(path_name).components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(invalid_word(format!("Unsafe ZIP part name: {name}")));
    }
    Ok(())
}

fn valid_xml_char(character: char) -> bool {
    matches!(character, '\u{9}' | '\u{A}' | '\u{D}')
        || ('\u{20}'..='\u{D7FF}').contains(&character)
        || ('\u{E000}'..='\u{FFFD}').contains(&character)
        || ('\u{10000}'..='\u{10FFFF}').contains(&character)
}

fn invalid_word(message: impl Into<String>) -> AppError {
    AppError::new("invalid-document", message)
}

fn zip_error(error: impl std::fmt::Display) -> AppError {
    invalid_word(format!("Invalid DOCX ZIP package: {error}"))
}

fn limit_error(stage: &str, actual: u64, limit: u64) -> AppError {
    AppError::new(
        "document-processing-limit",
        "DOCX processing limit exceeded",
    )
    .with_details(serde_json::json!({
        "stage": stage,
        "actual": actual,
        "limit": limit,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(parts: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in parts {
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn minimal_package(document: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut parts = vec![
            (
                "[Content_Types].xml",
                br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>"#.as_slice(),
            ),
            ("word/document.xml", document.as_bytes()),
        ];
        parts.extend_from_slice(extra);
        package(&parts)
    }

    fn utf16le_xml(source: &str) -> Vec<u8> {
        let mut output = vec![0xff, 0xfe];
        for unit in source.encode_utf16() {
            output.extend_from_slice(&unit.to_le_bytes());
        }
        output
    }

    fn utf16_xml_without_bom(source: &str, little_endian: bool) -> Vec<u8> {
        let mut output = Vec::new();
        for unit in source.encode_utf16() {
            let bytes = if little_endian {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            };
            output.extend_from_slice(&bytes);
        }
        output
    }

    fn read_part(data: &[u8], name: &str) -> Vec<u8> {
        let mut archive = ZipArchive::new(Cursor::new(data)).unwrap();
        let mut file = archive.by_name(name).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        bytes
    }

    const RELS: &[u8] = br#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/><Relationship Id="rIdUnknown" Type="urn:unknown" Target="../custom/item.bin"/></Relationships>"#;

    #[test]
    fn normalizes_safe_vml_table_and_invisible_underline() {
        let document = format!(
            r##"<?xml version="1.0"?><w:document xmlns:w="{WORD_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="{RELATIONSHIPS_NS}"><w:body>
<w:p><w:r><w:pict><v:shape id="_x0000_i1025" o:spid="_x0000_s1025" type="#_x0000_t75" style="width:72pt;height:36pt" stroked="f"><v:imagedata r:id="rIdImage" o:title="Legacy &amp; image"/><o:lock v:ext="edit" aspectratio="t"/></v:shape></w:pict></w:r></w:p>
<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcBorders><w:left w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>
<w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">   </w:t></w:r></w:p>
</w:body></w:document>"##,
        );
        let source = minimal_package(
            &document,
            &[
                ("word/_rels/document.xml.rels", RELS),
                ("word/media/image1.png", b"opaque-image"),
                ("custom/item.bin", b"unknown-part"),
            ],
        );
        let normalized = normalize_package(source.clone()).unwrap();
        assert_eq!(normalized.normalized_legacy_image_count, 1);
        assert_eq!(normalized.normalized_table_count, 1);
        assert_eq!(normalized.removed_underline_run_count, 1);

        let xml = String::from_utf8(read_part(&normalized.data, "word/document.xml")).unwrap();
        assert!(xml.contains("<w:drawing"));
        assert!(!xml.contains("<w:pict"));
        assert!(xml.contains("r:embed=\"rIdImage\""));
        assert!(xml.contains("cx=\"914400\" cy=\"457200\""));
        assert!(xml.contains("descr=\"Legacy &amp; image\""));
        assert!(xml.contains("<w:tblBorders><w:top w:val=\"nil\""));
        assert!(xml.matches("<w:tcBorders>").count() >= 2);
        assert!(!xml.contains("xml:space=\"preserve\">   </w:t>"));

        assert_eq!(
            read_part(&normalized.data, "custom/item.bin"),
            b"unknown-part"
        );
        assert_eq!(
            read_part(&normalized.data, "word/_rels/document.xml.rels"),
            RELS
        );
        let second = normalize_package(normalized.data.clone()).unwrap();
        assert_eq!(second.normalized_legacy_image_count, 0);
        assert_eq!(second.normalized_table_count, 0);
        assert_eq!(second.removed_underline_run_count, 0);
        assert_eq!(second.data, normalized.data);
    }

    #[test]
    fn respects_ul_trail_space_compatibility_setting() {
        let document = format!(
            r#"<w:document xmlns:w="{WORD_NS}"><w:body><w:p><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">  </w:t></w:r></w:p></w:body></w:document>"#,
        );
        let settings =
            format!(r#"<w:settings xmlns:w="{WORD_NS}"><w:ulTrailSpace/></w:settings>"#,);
        let source = minimal_package(&document, &[("word/settings.xml", settings.as_bytes())]);
        let normalized = normalize_package(source.clone()).unwrap();
        assert_eq!(normalized.removed_underline_run_count, 0);
        assert_eq!(normalized.data, source);
    }

    #[test]
    fn skips_positioned_vml_and_complex_merged_tables() {
        let document = format!(
            r##"<w:document xmlns:w="{WORD_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="{RELATIONSHIPS_NS}"><w:body>
<w:p><w:r><w:pict><v:shape type="#_x0000_t75" style="position:absolute;width:72pt;height:36pt"><v:imagedata r:id="rIdImage"/></v:shape></w:pict></w:r></w:p>
<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge/><w:tcBorders><w:left w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc></w:tr></w:tbl>
</w:body></w:document>"##,
        );
        let source = minimal_package(&document, &[("word/_rels/document.xml.rels", RELS)]);
        let normalized = normalize_package(source.clone()).unwrap();
        assert_eq!(normalized.normalized_legacy_image_count, 0);
        assert_eq!(normalized.normalized_table_count, 0);
        assert_eq!(normalized.data, source);
    }

    #[test]
    fn malformed_xml_fails_without_mutating_the_source_buffer() {
        let source = minimal_package(
            &format!(r#"<w:document xmlns:w="{WORD_NS}"><w:body><w:p></w:body></w:document>"#),
            &[],
        );
        let original = source.clone();
        let error = normalize_package(source.clone()).unwrap_err();
        assert_eq!(error.code, "invalid-document");
        assert_eq!(source, original);
    }

    #[test]
    fn rejects_dtd_depth_and_unsafe_zip_names() {
        let dtd = minimal_package(
            &format!(r#"<!DOCTYPE x [<!ENTITY x "boom">]><w:document xmlns:w="{WORD_NS}"/>"#),
            &[],
        );
        assert_eq!(normalize_package(dtd).unwrap_err().code, "invalid-document");

        let mut deep = format!(r#"<w:document xmlns:w="{WORD_NS}">"#);
        for _ in 0..MAX_XML_DEPTH {
            deep.push_str("<w:p>");
        }
        for _ in 0..MAX_XML_DEPTH {
            deep.push_str("</w:p>");
        }
        deep.push_str("</w:document>");
        let error = normalize_package(minimal_package(&deep, &[])).unwrap_err();
        assert_eq!(error.code, "document-processing-limit");
        assert_eq!(error.details.unwrap()["stage"], "xml-depth");

        let unsafe_package = package(&[
            ("[Content_Types].xml", b"<Types/>"),
            ("word/document.xml", b"<document/>"),
            ("word/../outside.bin", b"bad"),
        ]);
        assert_eq!(
            normalize_package(unsafe_package).unwrap_err().code,
            "invalid-document"
        );
    }

    #[test]
    fn unchanged_valid_package_is_byte_identical() {
        let source = minimal_package(
            &format!(
                r#"<?xml version="1.0"?><w:document xmlns:w="{WORD_NS}"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>"#
            ),
            &[("custom/opaque.bin", b"opaque")],
        );
        let normalized = normalize_package(source.clone()).unwrap();
        assert_eq!(normalized.data, source);
        assert_eq!(normalized.normalized_legacy_image_count, 0);
        assert_eq!(normalized.normalized_table_count, 0);
        assert_eq!(normalized.removed_underline_run_count, 0);
    }

    #[test]
    fn utf16_wordprocessing_parts_are_preserved_instead_of_rejected() {
        let xml = format!(
            r#"<?xml version="1.0" encoding="UTF-16"?><w:document xmlns:w="{WORD_NS}"><w:body><w:p><w:r><w:t>UTF-16</w:t></w:r></w:p></w:body></w:document>"#
        );
        for document in [
            utf16le_xml(&xml),
            utf16_xml_without_bom(&xml, true),
            utf16_xml_without_bom(&xml, false),
        ] {
            let source = package(&[
                (
                    "[Content_Types].xml",
                    br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>"#,
                ),
                ("word/document.xml", &document),
            ]);

            let normalized = normalize_package(source.clone()).unwrap();
            assert_eq!(normalized.data, source);
            assert_eq!(normalized.normalized_legacy_image_count, 0);
            assert_eq!(normalized.normalized_table_count, 0);
            assert_eq!(normalized.removed_underline_run_count, 0);
        }
    }

    #[test]
    fn accepts_directory_entries_and_rejects_corrupt_part_crc() {
        let document = format!(
            r#"<w:document xmlns:w="{WORD_NS}"><w:body><w:p><w:r><w:t>CRC</w:t></w:r></w:p></w:body></w:document>"#
        );
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .add_directory("word/", SimpleFileOptions::default())
            .unwrap();
        for (name, data) in [
            ("[Content_Types].xml", b"<Types/>".as_slice()),
            ("word/document.xml", document.as_bytes()),
            ("custom/crc.bin", b"crc-payload-unique".as_slice()),
        ] {
            writer
                .start_file(
                    name,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
                )
                .unwrap();
            writer.write_all(data).unwrap();
        }
        let source = writer.finish().unwrap().into_inner();
        assert_eq!(normalize_package(source.clone()).unwrap().data, source);

        let mut corrupt = source;
        let payload = b"crc-payload-unique";
        let offset = corrupt
            .windows(payload.len())
            .position(|window| window == payload)
            .expect("stored test payload");
        corrupt[offset] ^= 0xff;
        let error = normalize_package(corrupt).unwrap_err();
        assert_eq!(error.code, "invalid-document");
        assert!(error.message.contains("Cannot validate DOCX part"));
    }
}

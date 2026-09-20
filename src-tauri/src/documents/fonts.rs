use crate::error::{AppError, AppResult};
use fontdb::{Language, Source};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
    sync::OnceLock,
};

const MAX_FONT_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub font_id: String,
    pub family_name: String,
    pub display_name: String,
    pub face_name: String,
    pub face_index: u32,
    pub weight: u16,
    pub style: &'static str,
    pub stretch: u16,
    pub embedding: &'static str,
    pub subset_allowed: bool,
    pub outline_embedding_allowed: bool,
}

#[derive(Clone)]
struct CachedFontFace {
    font_id: String,
    source: Source,
    families: Vec<(String, Language)>,
    family_name: String,
    face_name: String,
    face_index: u32,
    weight: u16,
    style: &'static str,
    stretch: u16,
    embedding: &'static str,
    subset_allowed: bool,
    outline_embedding_allowed: bool,
}

struct FontCatalog {
    faces: Vec<CachedFontFace>,
    by_id: HashMap<String, CachedFontFace>,
}

const ENGLISH_FONT_LANGUAGES: &[Language] = &[Language::English_UnitedStates];
const CHINESE_FONT_LANGUAGES: &[Language] = &[
    Language::Chinese_PeoplesRepublicOfChina,
    Language::Chinese_Singapore,
    Language::Chinese_Taiwan,
    Language::Chinese_HongKongSAR,
    Language::Chinese_MacaoSAR,
];
const JAPANESE_FONT_LANGUAGES: &[Language] = &[Language::Japanese_Japan];
const SPANISH_FONT_LANGUAGES: &[Language] = &[
    Language::Spanish_ModernSort_Spain,
    Language::Spanish_TraditionalSort_Spain,
];
const PORTUGUESE_FONT_LANGUAGES: &[Language] = &[Language::Portuguese_Brazil];
const GERMAN_FONT_LANGUAGES: &[Language] = &[Language::German_Germany];
const FRENCH_FONT_LANGUAGES: &[Language] = &[Language::French_France];
const RUSSIAN_FONT_LANGUAGES: &[Language] = &[Language::Russian_Russia];
const ARABIC_FONT_LANGUAGES: &[Language] = &[Language::Arabic_SaudiArabia];

fn preferred_font_languages(language: Option<&str>) -> &'static [Language] {
    match language.unwrap_or("en").to_ascii_lowercase().as_str() {
        "zh-cn" | "zh" => CHINESE_FONT_LANGUAGES,
        "ja" | "ja-jp" => JAPANESE_FONT_LANGUAGES,
        "es" | "es-es" => SPANISH_FONT_LANGUAGES,
        "pt" | "pt-br" => PORTUGUESE_FONT_LANGUAGES,
        "de" | "de-de" => GERMAN_FONT_LANGUAGES,
        "fr" | "fr-fr" => FRENCH_FONT_LANGUAGES,
        "ru" | "ru-ru" => RUSSIAN_FONT_LANGUAGES,
        "ar" | "ar-sa" => ARABIC_FONT_LANGUAGES,
        _ => ENGLISH_FONT_LANGUAGES,
    }
}

fn localized_family_name<'a>(
    families: &'a [(String, Language)],
    language: Option<&str>,
) -> Option<&'a str> {
    for preferred in preferred_font_languages(language) {
        if let Some((name, _)) = families.iter().find(|(_, lang)| lang == preferred) {
            return Some(name.as_str());
        }
    }

    families
        .iter()
        .find(|(_, lang)| *lang == Language::English_UnitedStates)
        .or_else(|| families.first())
        .map(|(name, _)| name.as_str())
}

fn catalog() -> &'static FontCatalog {
    static CATALOG: OnceLock<FontCatalog> = OnceLock::new();
    CATALOG.get_or_init(build_catalog)
}

fn build_catalog() -> FontCatalog {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();
    let mut faces = BTreeMap::new();
    for face in database.faces() {
        let Some((family_name, _)) = face.families.first() else {
            continue;
        };
        if family_name.trim().is_empty() {
            continue;
        }
        let style = match face.style {
            fontdb::Style::Normal => "normal",
            fontdb::Style::Italic => "italic",
            fontdb::Style::Oblique => "oblique",
        };
        let face_name = match (face.weight.0 >= 700, face.style) {
            (true, fontdb::Style::Italic | fontdb::Style::Oblique) => "Bold Italic",
            (true, _) => "Bold",
            (false, fontdb::Style::Italic | fontdb::Style::Oblique) => "Italic",
            _ => "Regular",
        };
        let (embedding, subset_allowed, outline_embedding_allowed) = database
            .with_face_data(face.id, font_permissions)
            .unwrap_or(("unknown", false, false));
        let font_id = opaque_font_id(&face.source, face.index, &face.post_script_name);
        let item = CachedFontFace {
            font_id,
            source: face.source.clone(),
            families: face.families.clone(),
            family_name: family_name.clone(),
            face_name: face_name.to_owned(),
            face_index: face.index,
            weight: face.weight.0,
            style,
            stretch: face.stretch.to_number(),
            embedding,
            subset_allowed,
            outline_embedding_allowed,
        };
        faces.insert(
            format!(
                "{}\0{}\0{}\0{}",
                family_name.to_lowercase(),
                face.weight.0,
                style,
                face.stretch.to_number()
            ),
            item,
        );
    }
    let faces = faces.into_values().collect::<Vec<_>>();
    let by_id = faces
        .iter()
        .cloned()
        .map(|face| (face.font_id.clone(), face))
        .collect();
    FontCatalog { faces, by_id }
}

fn font_permissions(data: &[u8], face_index: u32) -> (&'static str, bool, bool) {
    let Ok(face) = ttf_parser::Face::parse(data, face_index) else {
        return ("unknown", false, false);
    };
    let embedding = match face.permissions() {
        Some(ttf_parser::Permissions::Installable) => "installable",
        Some(ttf_parser::Permissions::Editable) => "editable",
        Some(ttf_parser::Permissions::PreviewAndPrint) => "preview-print",
        Some(ttf_parser::Permissions::Restricted) => "restricted",
        None => "unknown",
    };
    let editable = matches!(embedding, "installable" | "editable");
    (
        embedding,
        editable && face.is_subsetting_allowed(),
        editable && face.is_outline_embedding_allowed(),
    )
}

fn opaque_font_id(source: &Source, face_index: u32, post_script_name: &str) -> String {
    let mut hash = Sha256::new();
    match source {
        Source::Binary(_) => hash.update(b"binary"),
        Source::File(path) => hash.update(path_key(path).as_bytes()),
        Source::SharedFile(path, _) => hash.update(path_key(path).as_bytes()),
    }
    hash.update(face_index.to_le_bytes());
    hash.update(post_script_name.as_bytes());
    hex::encode(hash.finalize())
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_ascii_lowercase()
    } else {
        value
    }
}

pub fn list_system_fonts(language: Option<String>) -> Vec<SystemFont> {
    catalog()
        .faces
        .iter()
        .map(|face| SystemFont {
            font_id: face.font_id.clone(),
            family_name: face.family_name.clone(),
            display_name: localized_family_name(&face.families, language.as_deref())
                .unwrap_or(&face.family_name)
                .to_owned(),
            face_name: face.face_name.clone(),
            face_index: face.face_index,
            weight: face.weight,
            style: face.style,
            stretch: face.stretch,
            embedding: face.embedding,
            subset_allowed: face.subset_allowed,
            outline_embedding_allowed: face.outline_embedding_allowed,
        })
        .collect()
}

pub fn read_font(font_id: &str) -> AppResult<Vec<u8>> {
    let font_id = font_id.trim();
    if font_id.len() != 64 || !font_id.bytes().all(|value| value.is_ascii_hexdigit()) {
        return Err(AppError::invalid("Invalid font id"));
    }
    let face = catalog()
        .by_id
        .get(font_id)
        .ok_or_else(|| AppError::not_found("Font was not found"))?;
    if !matches!(face.embedding, "installable" | "editable")
        || !face.subset_allowed
        || !face.outline_embedding_allowed
    {
        return Err(AppError::denied(
            "This font does not permit editable outline subset embedding",
        ));
    }
    let data = match &face.source {
        Source::Binary(data) => data.as_ref().as_ref().to_vec(),
        Source::File(path) | Source::SharedFile(path, _) => {
            let metadata = std::fs::metadata(path)?;
            if metadata.len() > MAX_FONT_BYTES {
                return Err(AppError::new(
                    "font-too-large",
                    "Font exceeds the 32 MiB read limit",
                ));
            }
            std::fs::read(path)?
        }
    };
    if data.len() as u64 > MAX_FONT_BYTES {
        return Err(AppError::new(
            "font-too-large",
            "Font exceeds the 32 MiB read limit",
        ));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_families() -> Vec<(String, Language)> {
        vec![
            (
                "Microsoft JhengHei".to_owned(),
                Language::English_UnitedStates,
            ),
            ("微軟正黑體".to_owned(), Language::Chinese_Taiwan),
        ]
    }

    #[test]
    fn chinese_ui_prefers_any_available_chinese_family_name() {
        let families = sample_families();
        assert_eq!(
            localized_family_name(&families, Some("zh-CN")),
            Some("微軟正黑體")
        );
    }

    #[test]
    fn other_ui_languages_fall_back_to_the_canonical_english_name() {
        let families = sample_families();
        assert_eq!(
            localized_family_name(&families, Some("fr")),
            Some("Microsoft JhengHei")
        );
    }

    #[test]
    fn exact_requested_language_wins_over_fallbacks() {
        let families = vec![
            ("SimSun".to_owned(), Language::English_UnitedStates),
            ("宋体".to_owned(), Language::Chinese_PeoplesRepublicOfChina),
            ("宋體".to_owned(), Language::Chinese_Taiwan),
        ];
        assert_eq!(
            localized_family_name(&families, Some("zh-CN")),
            Some("宋体")
        );
    }

    #[test]
    fn opaque_ids_do_not_expose_font_paths() {
        let id = opaque_font_id(
            &Source::File(std::path::PathBuf::from("/private/fonts/example.ttf")),
            0,
            "Example-Regular",
        );
        assert_eq!(id.len(), 64);
        assert!(!id.contains("private"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn installed_windows_fonts_keep_their_localized_chinese_family_name() {
        let faces = list_system_fonts(Some("zh-CN".to_owned()));
        let Some(sim_sun) = faces.iter().find(|face| face.family_name == "SimSun") else {
            return;
        };
        assert_eq!(sim_sun.display_name, "宋体");
    }
}

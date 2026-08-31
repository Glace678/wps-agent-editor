use fontdb::Language;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family_name: String,
    pub display_name: String,
    pub face_name: String,
    pub weight: u16,
    pub style: &'static str,
    pub stretch: u16,
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

pub fn list_system_fonts(language: Option<String>) -> Vec<SystemFont> {
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
        let item = SystemFont {
            family_name: family_name.clone(),
            display_name: localized_family_name(&face.families, language.as_deref())
                .unwrap_or(family_name)
                .to_owned(),
            face_name: face_name.to_owned(),
            weight: face.weight.0,
            style,
            stretch: face.stretch.to_number(),
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
    faces.into_values().collect()
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

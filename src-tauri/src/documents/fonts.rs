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

pub fn list_system_fonts(_language: Option<String>) -> Vec<SystemFont> {
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
            display_name: family_name.clone(),
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

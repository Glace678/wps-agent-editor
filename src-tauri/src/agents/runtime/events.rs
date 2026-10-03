use super::*;

pub(super) fn normalized_id(value: Option<&str>, prefix: &str) -> AppResult<String> {
    let value = value.unwrap_or_default().trim();
    if value.is_empty() {
        return Ok(format!("{prefix}-{}", Uuid::new_v4()));
    }
    if value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
    {
        return Err(AppError::invalid("Invalid Agent run id"));
    }
    Ok(value.to_owned())
}

pub(super) fn map_document_event_type(value: &str) -> Option<&'static str> {
    match value {
        "operation-prepared" => Some("document-operation-prepared"),
        "cursor-moved" => Some("document-cursor-moved"),
        "selection-changed" => Some("document-selection-changed"),
        "operation-applied" => Some("document-operation-applied"),
        "operation-rejected" => Some("document-operation-rejected"),
        "operation-undone" => Some("document-operation-undone"),
        "revision-changed" => Some("document-revision-changed"),
        "conflict" => Some("conflict"),
        "run-cancelled" => Some("run-cancelled"),
        _ => None,
    }
}

pub(super) fn ensure_json_size(value: &Value, maximum: usize, label: &str) -> AppResult<()> {
    let size = serde_json::to_vec(value)?.len();
    if size > maximum {
        return Err(AppError::new(
            "response-too-large",
            format!("{label} exceeded the {maximum}-byte limit"),
        ));
    }
    Ok(())
}

pub(super) fn truncate_chars(value: &str, maximum: usize) -> String {
    if value.chars().count() <= maximum {
        value.to_owned()
    } else {
        value.chars().take(maximum).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_renderer_document_events() {
        assert_eq!(
            map_document_event_type("operation-applied"),
            Some("document-operation-applied")
        );
        assert_eq!(map_document_event_type("unexpected"), None);
    }
}

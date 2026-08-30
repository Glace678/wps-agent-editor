use serde::Serialize;
use serde_json::Value;
use std::fmt::{Display, Formatter};

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message_key: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub details: Option<Value>,
    pub retryable: bool,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        let code = code.into();
        let retryable = matches!(
            code.as_str(),
            "timeout" | "connection-failed" | "http-error" | "provider-http-error"
        );
        Self {
            message_key: format!("errors.{code}"),
            code,
            message: message.into(),
            details: None,
            retryable,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid-argument", message)
    }

    pub fn denied(message: impl Into<String>) -> Self {
        Self::new("permission-denied", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not-found", message)
    }

    pub fn dependency_missing(message: impl Into<String>) -> Self {
        Self::new("dependency-missing", message)
    }

    pub fn unsupported(feature: impl Into<String>) -> Self {
        let feature = feature.into();
        Self::new(
            "unsupported",
            format!("{feature} is not implemented by the Tauri core yet"),
        )
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "not-found",
            std::io::ErrorKind::PermissionDenied => "permission-denied",
            std::io::ErrorKind::AlreadyExists => "already-exists",
            _ => "io-error",
        };
        Self::new(code, error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("invalid-data", error.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(error: reqwest::Error) -> Self {
        let code = if error.is_timeout() {
            "timeout"
        } else if error.is_connect() {
            "connection-failed"
        } else {
            "http-error"
        };
        Self::new(code, error.to_string())
    }
}

impl From<url::ParseError> for AppError {
    fn from(error: url::ParseError) -> Self {
        Self::new("invalid-url", error.to_string())
    }
}

impl From<tauri_plugin_updater::Error> for AppError {
    fn from(error: tauri_plugin_updater::Error) -> Self {
        let message = error.to_string();
        let lower = message.to_ascii_lowercase();
        let code = if lower.contains("signature") {
            "update-signature-invalid"
        } else if lower.contains("network") {
            "update-network-error"
        } else {
            "update-failed"
        };
        Self::new(code, message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_stable_error_shape() {
        let value = serde_json::to_value(AppError::invalid("bad input")).unwrap();
        assert_eq!(value["code"], "invalid-argument");
        assert_eq!(value["messageKey"], "errors.invalid-argument");
        assert_eq!(value["message"], "bad input");
        assert_eq!(value["retryable"], false);
        assert!(value.get("details").is_none());
    }
}

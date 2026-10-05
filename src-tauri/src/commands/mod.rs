pub mod agents;
pub mod app;
pub mod documents;
pub mod files;
pub mod process;
pub mod providers;

use serde::Serialize;

/// Shared "the command succeeded" payload. Previously defined independently in
/// `commands::process` and `commands::app` with identical wire shape (`{ "success": bool }`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResult {
    pub success: bool,
}

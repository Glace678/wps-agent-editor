use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::error::AppResult;

use super::{app_error, models::FileDialogKind};

pub fn select_folder(app: &AppHandle) -> AppResult<Option<PathBuf>> {
    app.dialog()
        .file()
        .set_title("Select folder")
        .blocking_pick_folder()
        .map(file_path_to_path)
        .transpose()
}

pub fn select_file(app: &AppHandle, kind: FileDialogKind) -> AppResult<Option<PathBuf>> {
    let dialog = app.dialog().file().set_title("Open file");
    let dialog = match kind {
        FileDialogKind::Text => {
            dialog.add_filter("Text", &["txt", "md", "markdown", "json", "log"])
        }
        FileDialogKind::Presentation => dialog.add_filter("Presentations", &["pptx", "ppt"]),
        FileDialogKind::All => dialog
            .add_filter(
                "Supported files",
                &[
                    "docx", "doc", "xlsx", "xls", "csv", "pptx", "ppt", "pdf", "odt", "ods", "txt",
                    "md", "markdown", "json", "log", "png", "jpg", "jpeg", "gif", "bmp", "webp",
                    "heic", "ico", "tif", "tiff", "c", "cpp", "h", "rs", "go", "java", "kt", "py",
                    "js", "jsx", "ts", "tsx", "html", "css", "xml", "yaml", "yml", "toml", "sh",
                    "ps1", "bat",
                ],
            )
            .add_filter("All files", &["*"]),
    };
    dialog
        .blocking_pick_file()
        .map(file_path_to_path)
        .transpose()
}

pub fn select_attachments(app: &AppHandle) -> AppResult<Vec<PathBuf>> {
    app.dialog()
        .file()
        .set_title("Select attachments")
        .add_filter("All files", &["*"])
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .map(file_path_to_path)
        .collect()
}

pub fn select_save_file(app: &AppHandle, default_name: Option<&str>) -> AppResult<Option<PathBuf>> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save file")
        .add_filter("Text", &["txt"])
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("JSON", &["json"])
        .add_filter("Log", &["log"])
        .add_filter("All files", &["*"]);
    if let Some(default_name) = default_name.filter(|value| !value.trim().is_empty()) {
        if let Some(file_name) = std::path::Path::new(default_name)
            .file_name()
            .and_then(|value| value.to_str())
        {
            dialog = dialog.set_file_name(file_name);
        }
    }
    dialog
        .blocking_save_file()
        .map(file_path_to_path)
        .transpose()
}

fn file_path_to_path(path: FilePath) -> AppResult<PathBuf> {
    path.into_path().map_err(|error| {
        app_error(
            "invalid-path",
            format!("The selected path is not local: {error}"),
        )
    })
}

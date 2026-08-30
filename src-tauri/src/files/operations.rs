use std::{
    collections::VecDeque,
    ffi::OsStr,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::error::AppResult;

use super::{
    access::AccessRegistry,
    app_error,
    models::{FileEntry, FileOperationResult, FileStatInfo},
    path_string,
};

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "docx",
    "doc",
    "xlsx",
    "xls",
    "pptx",
    "ppt",
    "pdf",
    "txt",
    "md",
    "markdown",
    "csv",
    "odt",
    "ods",
    "log",
    "c",
    "h",
    "cc",
    "cpp",
    "cxx",
    "hh",
    "hpp",
    "hxx",
    "ipp",
    "tpp",
    "inl",
    "cu",
    "cuh",
    "m",
    "mm",
    "cs",
    "fs",
    "fsx",
    "vb",
    "java",
    "kt",
    "kts",
    "scala",
    "groovy",
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "cjs",
    "py",
    "pyw",
    "pyi",
    "go",
    "rs",
    "swift",
    "dart",
    "rb",
    "php",
    "pl",
    "pm",
    "lua",
    "r",
    "jl",
    "ex",
    "exs",
    "clj",
    "cljs",
    "coffee",
    "sol",
    "pas",
    "asm",
    "s",
    "sql",
    "mysql",
    "pgsql",
    "graphql",
    "gql",
    "html",
    "htm",
    "xhtml",
    "vue",
    "svelte",
    "css",
    "scss",
    "sass",
    "less",
    "json",
    "jsonc",
    "xml",
    "svg",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "properties",
    "proto",
    "tf",
    "hcl",
    "dockerfile",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "bat",
    "cmd",
    "tcl",
    "sv",
    "svh",
    "wgsl",
];

const SPECIAL_FILE_NAMES: &[&str] = &[
    "dockerfile",
    "makefile",
    "cmakelists.txt",
    "jenkinsfile",
    "rakefile",
    "gemfile",
    "podfile",
];

pub fn list_directory(
    owner: &str,
    parent_grant_id: &str,
    path: &Path,
    access: &AccessRegistry,
) -> AppResult<Vec<FileEntry>> {
    let mut output = Vec::new();
    let entries = std::fs::read_dir(path)?;
    for entry in entries.flatten() {
        if entry
            .file_type()
            .map(|kind| kind.is_symlink())
            .unwrap_or(true)
        {
            continue;
        }
        let entry_path = entry.path();
        let Ok(metadata) = std::fs::metadata(&entry_path) else {
            continue;
        };
        if !metadata.is_dir() && !is_supported(&entry_path) {
            continue;
        }
        let granted = match access.grant_child(owner, parent_grant_id, path, &entry_path) {
            Ok(granted) => granted,
            Err(_) => continue,
        };
        output.push(to_entry(entry_path, metadata, granted.grant_id)?);
    }
    output.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(output)
}

pub fn search_files(
    owner: &str,
    parent_grant_id: &str,
    root: &Path,
    query: &str,
    access: &AccessRegistry,
) -> AppResult<Vec<FileEntry>> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut output = Vec::new();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0_u8)]);
    while let Some((directory, depth)) = queue.pop_front() {
        if output.len() >= 100 || depth > 4 {
            break;
        }
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if output.len() >= 100 {
                break;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry
                .file_type()
                .map(|kind| kind.is_symlink())
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            if metadata.is_dir() {
                if depth < 4 && !name.starts_with('.') && name != "node_modules" {
                    queue.push_back((path, depth + 1));
                }
            } else if name.to_lowercase().contains(&query) && is_supported(&path) {
                if let Ok(granted) = access.grant_child(owner, parent_grant_id, root, &path) {
                    output.push(to_entry(path, metadata, granted.grant_id)?);
                }
            }
        }
    }
    Ok(output)
}

pub fn stat_file(path: &Path) -> AppResult<FileStatInfo> {
    let extension = extension(path);
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(FileStatInfo {
            exists: metadata.is_file(),
            size: metadata.len(),
            modified_at: system_time_ms(metadata.modified().ok()),
            created_at: system_time_ms(
                metadata.created().ok().or_else(|| metadata.modified().ok()),
            ),
            extension,
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(FileStatInfo {
            exists: false,
            size: 0,
            modified_at: 0,
            created_at: 0,
            extension,
        }),
        Err(error) => Err(error.into()),
    }
}

pub fn rename_file(
    path: &Path,
    new_name: &str,
) -> AppResult<(FileOperationResult, Option<PathBuf>)> {
    let trimmed = new_name.trim();
    if !valid_file_name(trimmed) {
        return Ok((FileOperationResult::failure("invalid-name"), None));
    }
    if !path.is_file() {
        return Ok((FileOperationResult::failure("not-found"), None));
    }
    let target = path
        .parent()
        .ok_or_else(|| app_error("invalid-path", "The file has no parent directory"))?
        .join(trimmed);
    if target == path {
        return Ok((
            FileOperationResult {
                success: true,
                error_code: None,
                path: Some(path_string(path)?),
                grant_id: None,
                recent: None,
            },
            Some(path.to_path_buf()),
        ));
    }
    let case_only = cfg!(windows)
        && path.to_string_lossy().to_lowercase() == target.to_string_lossy().to_lowercase();
    if !case_only && target.exists() {
        return Ok((FileOperationResult::failure("name-exists"), None));
    }
    match std::fs::rename(path, &target) {
        Ok(()) => Ok((
            FileOperationResult {
                success: true,
                error_code: None,
                path: Some(path_string(&target)?),
                grant_id: None,
                recent: None,
            },
            Some(target),
        )),
        Err(_) => Ok((FileOperationResult::failure("failed"), None)),
    }
}

pub fn trash_file(path: &Path) -> AppResult<FileOperationResult> {
    if !path.exists() {
        return Ok(FileOperationResult {
            success: true,
            error_code: None,
            path: None,
            grant_id: None,
            recent: None,
        });
    }
    if !path.is_file() {
        return Ok(FileOperationResult::failure("failed"));
    }
    match trash::delete(path) {
        Ok(()) => Ok(FileOperationResult {
            success: true,
            error_code: None,
            path: None,
            grant_id: None,
            recent: None,
        }),
        Err(_) => Ok(FileOperationResult::failure("failed")),
    }
}

pub fn show_in_folder(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(app_error("not-found", "The file no longer exists"));
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        command.arg(format!("/select,{}", path.display()));
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R").arg(path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(path));
        command
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| app_error("open-failed", format!("Failed to reveal the file: {error}")))
}

fn to_entry(path: PathBuf, metadata: std::fs::Metadata, grant_id: String) -> AppResult<FileEntry> {
    Ok(FileEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path_string(&path)?,
        grant_id,
        is_directory: metadata.is_dir(),
        size: metadata.len(),
        modified_at: system_time_ms(metadata.modified().ok()),
        extension: if metadata.is_dir() {
            String::new()
        } else {
            extension(&path)
        },
    })
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| format!(".{}", extension.to_lowercase()))
        .unwrap_or_default()
}

fn is_supported(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_lowercase();
    if SPECIAL_FILE_NAMES.contains(&name.as_str()) || name == ".env" || name.starts_with(".env.") {
        return true;
    }
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| SUPPORTED_EXTENSIONS.contains(&extension.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn valid_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name
            .chars()
            .any(|character| "\\/:*?\"<>|".contains(character))
        && !matches!(
            name.split('.')
                .next()
                .unwrap_or_default()
                .to_uppercase()
                .as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
}

fn system_time_ms(time: Option<SystemTime>) -> u64 {
    time.and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or(0)
}

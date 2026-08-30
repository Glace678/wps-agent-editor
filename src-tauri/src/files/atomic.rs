use std::{fs, io::Write, path::Path};

use uuid::Uuid;

use crate::error::AppResult;

use super::app_error;

pub(crate) fn write_atomic(path: &Path, data: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| app_error("invalid-path", "The destination has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| {
        app_error(
            "io-error",
            format!("Failed to create {}: {error}", parent.display()),
        )
    })?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| {
                app_error(
                    "io-error",
                    format!("Failed to create temporary file: {error}"),
                )
            })?;
        file.write_all(data)
            .and_then(|_| file.sync_all())
            .map_err(|error| {
                app_error(
                    "io-error",
                    format!("Failed to flush temporary file: {error}"),
                )
            })?;
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> AppResult<()> {
    fs::rename(source, destination).map_err(|error| {
        app_error(
            "io-error",
            format!("Failed to replace {}: {error}", destination.display()),
        )
    })?;
    if let Some(parent) = destination.parent() {
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    }

    let destination_display = destination.display().to_string();
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(app_error(
            "io-error",
            format!(
                "Failed to replace {}: {}",
                destination_display,
                std::io::Error::last_os_error()
            ),
        ));
    }
    Ok(())
}

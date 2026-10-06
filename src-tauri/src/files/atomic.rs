use std::{fs, io::Write, path::Path};

use uuid::Uuid;

use crate::error::{codes, AppResult};

use super::app_error;

pub(crate) fn write_atomic(path: &Path, data: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| app_error(codes::INVALID_PATH, "The destination has no parent directory"))?;
    fs::create_dir_all(parent).map_err(|error| {
        app_error(
            "io-error",
            format!("Failed to create {}: {error}", parent.display()),
        )
    })?;

    // Snapshot the security attributes of an existing destination so the
    // rename-replacement below does not silently widen them (wps_01 N-6).
    let preserved = PreservedSecurity::capture(path);

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        // Anchor the parent directory before writing so a directory swap between
        // grant validation and the rename can be detected (wps_01 N-7).
        let parent_before = fs::canonicalize(parent).map_err(|error| {
            app_error(
                "io-error",
                format!("Failed to resolve {}: {error}", parent.display()),
            )
        })?;
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
        // Re-check the parent right before the rename; a symlink/junction swap
        // changes the canonical form and aborts the write. The residual window
        // between this check and the rename is acknowledged; closing it fully
        // requires openat/renameat (Unix) and handle-based replacement (Win).
        let parent_after = fs::canonicalize(parent).map_err(|error| {
            app_error(
                "io-error",
                format!("Failed to re-resolve {}: {error}", parent.display()),
            )
        })?;
        if parent_after != parent_before {
            return Err(app_error(
                codes::ACCESS_DENIED,
                "The destination directory changed while the file was being written",
            ));
        }
        replace_file(&temporary, path)?;
        if let Some(preserved) = preserved {
            preserved.restore(path);
        }
        Ok(())
    })();
    if result.is_err() {
        // wps_10 D1: a failed cleanup leaves an orphaned .{name}.{uuid}.tmp;
        // log at debug so orphan accumulation is diagnosable without noise.
        if let Err(error) = fs::remove_file(&temporary) {
            log::debug!(
                "could not remove temporary file {} after failed atomic write: {error}",
                temporary.display()
            );
        }
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
    #[allow(non_snake_case)]
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

/// Security attributes of an existing destination that must survive the
/// rename replacement. Capture before the temporary file is moved into place,
/// restore afterwards.
#[cfg(unix)]
struct PreservedSecurity(fs::Permissions);

#[cfg(unix)]
impl PreservedSecurity {
    fn capture(path: &Path) -> Option<Self> {
        fs::metadata(path)
            .map(|metadata| Self(metadata.permissions()))
            .ok()
    }

    fn restore(self, path: &Path) {
        if let Err(error) = fs::set_permissions(path, self.0) {
            log::warn!(
                "Failed to restore permissions on {} after atomic replace: {error}",
                path.display()
            );
        }
    }
}

/// DACL of an existing destination. The pointer belongs to the security
/// descriptor returned by `GetNamedSecurityInfoW` and is released after it has
/// been applied to the replacement file (wps_01 N-6).
#[cfg(windows)]
struct PreservedSecurity {
    dacl: *mut windows_sys::Win32::Security::ACL,
    descriptor: *mut core::ffi::c_void,
}

#[cfg(windows)]
impl PreservedSecurity {
    fn capture(path: &Path) -> Option<Self> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Security::{
            Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
            DACL_SECURITY_INFORMATION,
        };

        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut dacl = core::ptr::null_mut();
        let mut descriptor = core::ptr::null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                target.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                &mut dacl,
                core::ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 || dacl.is_null() {
            if !descriptor.is_null() {
                unsafe { windows_sys::Win32::Foundation::LocalFree(descriptor) };
            }
            return None;
        }
        Some(Self { dacl, descriptor })
    }

    fn restore(self, path: &Path) {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Security::{
            Authorization::{SetNamedSecurityInfoW, SE_FILE_OBJECT},
            DACL_SECURITY_INFORMATION,
        };

        let target: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let status = unsafe {
            SetNamedSecurityInfoW(
                target.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                self.dacl,
                core::ptr::null_mut(),
            )
        };
        unsafe { windows_sys::Win32::Foundation::LocalFree(self.descriptor) };
        if status != 0 {
            log::warn!(
                "Failed to restore DACL on {} after atomic replace (Win32 error {status})",
                path.display()
            );
        }
    }
}

#[cfg(not(any(windows, unix)))]
struct PreservedSecurity;

#[cfg(not(any(windows, unix)))]
impl PreservedSecurity {
    fn capture(_: &Path) -> Option<Self> {
        None
    }

    fn restore(self, _: &Path) {}
}

#[cfg(test)]
mod tests {
    use super::write_atomic;

    #[cfg(unix)]
    #[test]
    fn preserves_existing_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("private.txt");
        std::fs::write(&target, b"old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&target, b"new contents").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new contents");
        let mode = std::fs::metadata(&target).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "restrictive mode must survive the replace");
    }

    #[test]
    fn writes_and_replaces_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("notes.txt");
        write_atomic(&target, b"first").unwrap();
        write_atomic(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
    }
}

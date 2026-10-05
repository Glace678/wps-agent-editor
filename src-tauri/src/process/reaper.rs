//! Shared process-group / process-tree teardown primitives for the code
//! runner, terminal and debugger modules.
//!
//! Previously each module kept a near-duplicate copy of
//! `configure_process_group` and `terminate_tree`, and the runner's Unix path
//! omitted the direct `kill(pid)` backstop. They now live here exactly once
//! (review report D1 / P1).

use std::process::Stdio;
use tokio::process::Command;

/// Cumulative output ceiling shared by runner / terminal / debugger (4 MiB).
///
/// The value is identical everywhere, but the *policy* differs, which is why
/// the single number is annotated here:
/// - `runner.rs`: a **per-stream drain cap**. Once a stream exceeds this many
///   bytes the child is *not* killed; excess bytes are dropped while the pipe
///   keeps draining so the process can exit naturally.
/// - `terminal.rs` / `debugger.rs`: a **session-lethal cumulative dose**. Once
///   the session has emitted this many bytes in total, the session is killed.
pub const OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;

/// Absolute lifetime of an interactive terminal / debug session (8 h), shared
/// by the terminal reaper thread and the debugger's monitor loops.
pub const MAX_SESSION_AGE: std::time::Duration = std::time::Duration::from_secs(8 * 60 * 60);

#[cfg(unix)]
pub fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.as_std_mut().process_group(0);
}

#[cfg(windows)]
pub fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command
        .as_std_mut()
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

/// `std::process::Command` variant of [`configure_process_group`]. The
/// debugger spawns its Node/Python children from blocking reader threads with
/// the std Command, not the tokio one. Same flags, same semantics.
#[cfg(unix)]
pub fn configure_std_process_group(command: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
pub fn configure_std_process_group(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

/// Terminate a process and (best effort) its whole tree.
///
/// Unix: the child was started in its own process group, so `kill(-pgid)`
/// floods the group; a direct `kill(pid)` backstops the tiny window where a
/// descendant forked before joining the group.
///
/// Windows: `CREATE_NEW_PROCESS_GROUP` alone cannot be tree-killed by signal,
/// so the actual tree kill relies on `taskkill /T /F`; this comment records
/// that dependency rather than implying otherwise (review report P2).
pub async fn terminate_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    #[cfg(unix)]
    {
        let pid = pid as i32;
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
            libc::kill(pid, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
}

/// Synchronous variant for plain reader / monitor threads (terminal,
/// debugger) that have no async runtime available. Same semantics as
/// [`terminate_process_tree`].
pub fn terminate_process_tree_sync(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    #[cfg(unix)]
    {
        let pid = pid as i32;
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
            libc::kill(pid, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

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
/// The value is identical everywhere; the over-limit *policy* is annotated
/// here:
/// - `runner.rs` / `terminal.rs`: a **drain cap**. Once a stream exceeds this
///   many bytes the process is *not* killed; excess bytes are read and
///   discarded while the pipe keeps draining so it can exit naturally, and
///   (terminal) a one-time limit notice is emitted (wps_10 B2).
/// - `debugger.rs`: a **session-lethal cumulative dose**. Once a debug session
///   has emitted this many bytes in total, its process tree is terminated.
pub const OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;

/// Absolute lifetime of an interactive terminal / debug session (8 h), shared
/// by the terminal reaper thread and the debugger's monitor loops.
pub const MAX_SESSION_AGE: std::time::Duration = std::time::Duration::from_secs(8 * 60 * 60);

#[cfg(unix)]
pub fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    let std_command = command.as_std_mut();
    std_command.process_group(0);
    #[cfg(target_os = "linux")]
    install_parent_death_signal(std_command);
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
    #[cfg(target_os = "linux")]
    install_parent_death_signal(command);
}

/// Install a child-side hook (Linux) that queues SIGKILL to the child when the
/// thread that forked it dies — no orphans after a parent crash (wps_02 D-3).
///
/// macOS has no equivalent prctl and stays on process-group isolation only.
#[cfg(target_os = "linux")]
fn install_parent_death_signal(command: &mut std::process::Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            // SAFETY: async-signal-safe calls only. The getppid recheck closes
            // the fork→pre_exec race: if the parent already died we have been
            // reparented to init and the death signal would never arrive.
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            if libc::getppid() == 1 {
                libc::kill(libc::getpid(), libc::SIGKILL);
                libc::_exit(1);
            }
            Ok(())
        });
    }
}

#[cfg(windows)]
pub fn configure_std_process_group(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
}

// ---------------------------------------------------------------------------
// Parent-death binding (wps_02 D-3).
//
// Windows: one anonymous job object with KILL_ON_JOB_CLOSE. The handle lives
// for the whole process; when our process exits — normally or by crash — the
// OS closes the handle and terminates every assigned process (assignment is
// inherited by children created afterwards, so descendants die as well).
// ---------------------------------------------------------------------------
#[cfg(windows)]
mod parent_job {
    use std::ptr;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    // HANDLE is an `isize` in windows-sys; 0 stands in for the null pointer.
    const NULL_HANDLE: HANDLE = 0;

    fn create_job() -> HANDLE {
        unsafe {
            let job = CreateJobObjectW(ptr::null(), ptr::null());
            if job == NULL_HANDLE {
                return NULL_HANDLE;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return NULL_HANDLE;
            }
            job
        }
    }

    fn job() -> HANDLE {
        static JOB: OnceLock<HANDLE> = OnceLock::new();
        *JOB.get_or_init(create_job)
    }

    pub fn assign_handle(handle: HANDLE) {
        unsafe {
            let job = job();
            if job != NULL_HANDLE {
                AssignProcessToJobObject(job, handle);
            }
        }
    }

    pub fn assign_pid(pid: u32) {
        unsafe {
            let handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
            if handle != NULL_HANDLE {
                assign_handle(handle);
                CloseHandle(handle);
            }
        }
    }
}

/// Bind an already-spawned child so it dies together with this process.
/// Windows assigns the child into the kill-on-close job. On Linux the death
/// signal is installed pre-spawn via [`configure_process_group`], so these are
/// no-ops on Unix; spawn sites call them unconditionally.
#[cfg(windows)]
pub fn bind_std_child(child: &std::process::Child) {
    use std::os::windows::io::AsRawHandle;
    parent_job::assign_handle(child.as_raw_handle() as isize);
}

#[cfg(windows)]
pub fn bind_tokio_child(child: &tokio::process::Child) {
    // tokio's Child exposes the raw handle through its inherent `raw_handle`
    // (its AsRawHandle impl only exists on the unix configuration). It is
    // optional because stdin/stdout handles may already have been taken.
    if let Some(handle) = child.raw_handle() {
        parent_job::assign_handle(handle as isize);
    }
}

#[cfg(windows)]
pub fn bind_pid(pid: u32) {
    parent_job::assign_pid(pid);
}

#[cfg(unix)]
pub fn bind_std_child(_child: &std::process::Child) {}

#[cfg(unix)]
pub fn bind_tokio_child(_child: &tokio::process::Child) {}

#[cfg(unix)]
pub fn bind_pid(_pid: u32) {}

/// Terminate a process and (best effort) its whole tree.
///
/// Unix: the child was started in its own process group, so `kill(-pgid)`
/// floods the group; a direct `kill(pid)` backstops the tiny window where a
/// descendant forked before joining the group.
///
/// Windows: `CREATE_NEW_PROCESS_GROUP` alone cannot be tree-killed by signal,
/// so the actual tree kill relies on `taskkill /T /F`; this comment records
/// that dependency rather than implying otherwise (review report P2).
///
/// # PID-reuse contract (wps_02 D-11)
///
/// Signals identify processes by PID only, and a zombie's PID is released for
/// reuse the moment its parent reaps it. Callers MUST therefore:
/// 1. only call this function **before** the matching final `wait`/reap of the
///    child — never afterwards (the runner's `kill → wait` ordering obeys
///    this; until we reap, our child stays a zombie and its PID cannot be
///    reused);
/// 2. in multi-threaded sessions (debugger), gate the call on the session's
///    `stopping` flag so a reader thread cannot signal concurrently with the
///    monitor's reap.
///
/// A residual micro-window remains inherent to PID-based signaling; the
/// reuse-proof paradigm is pidfd + identity verification, used by the update
/// rollback path in `update_health.rs`.
pub async fn terminate_process_tree(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    #[cfg(unix)]
    {
        // wps_09 B-3: a raw `as i32` could wrap a (theoretical) > i32 pid into a
        // different value and signal an unrelated process group; refuse instead.
        let Ok(pid) = i32::try_from(pid) else {
            log::warn!("Refusing to signal process tree: pid {pid} does not fit i32");
            return;
        };
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
        // wps_09 B-3: see terminate_process_tree; guard the i32 conversion so
        // the negated pid cannot name an unrelated process group.
        let Ok(pid) = i32::try_from(pid) else {
            log::warn!("Refusing to signal process tree: pid {pid} does not fit i32");
            return;
        };
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

use crate::{
    error::{codes, AppError, AppResult},
    process::reaper::{self, OUTPUT_LIMIT_BYTES},
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, Instant},
};
use tempfile::TempDir;
use tokio::{io::AsyncReadExt, process::Command};

/// Time budget for a compile step. Cold `kotlinc` / large `javac` / first
/// `go build` / `swift` runs routinely exceed 30 s, so compilation gets its
/// own, longer budget; `RUN_TIMEOUT` only applies once the built binary
/// actually executes (review report P4).
const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);
const RUN_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct CodeRunResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub error_code: Option<&'static str>,
}

#[derive(Debug, Clone)]
struct CommandSpec {
    executable: PathBuf,
    args: Vec<String>,
}

struct RunPlan {
    compile: Option<CommandSpec>,
    run: Vec<CommandSpec>,
}

struct CommandOutput {
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    error_code: Option<&'static str>,
}

pub async fn run_file(file_path: &Path) -> AppResult<CodeRunResult> {
    let started = Instant::now();
    let metadata = tokio::fs::metadata(file_path).await?;
    if !metadata.is_file() {
        return Err(AppError::invalid("Code runner accepts files only"));
    }
    if metadata.len() > 10 * 1024 * 1024 {
        return Err(AppError::new(
            codes::FILE_TOO_LARGE,
            "Code runner source files are limited to 10 MiB",
        ));
    }
    let temp_dir = tempfile::tempdir()?;
    let Some(plan) = build_plan(file_path, &temp_dir).await? else {
        return Ok(unsupported(started));
    };
    let cwd = file_path
        .parent()
        .ok_or_else(|| AppError::invalid("Code file has no parent directory"))?;
    let mut display = Vec::new();
    let mut stdout = String::new();
    let mut stderr = String::new();

    if let Some(spec) = plan.compile {
        display.push(display_command(&spec));
        // Compilation uses the longer COMPILE_TIMEOUT budget; run steps below
        // use RUN_TIMEOUT.
        let result = execute(&spec, cwd, COMPILE_TIMEOUT).await;
        stdout.push_str(&result.stdout);
        stderr.push_str(&result.stderr);
        if !result.success {
            // P9 note: this early return does NOT route stdout/stderr through
            // truncate_output(). Each stream was already capped individually by
            // read_capped (per-stream drain limit), so the *merged* strings
            // below share a single OUTPUT_LIMIT_BYTES truncation budget rather
            // than the per-stream one. This is intentional: compile output is
            // normally small, and merging keeps the error display complete.
            return Ok(CodeRunResult {
                success: false,
                exit_code: result.exit_code,
                stdout,
                stderr,
                command: display.join("\n"),
                duration_ms: started.elapsed().as_millis() as u64,
                error_code: result.error_code,
            });
        }
    }

    let mut last_missing = None;
    for spec in plan.run {
        display.push(display_command(&spec));
        let result = execute(&spec, cwd, RUN_TIMEOUT).await;
        if result.error_code == Some("runtime-missing") {
            last_missing = Some(result);
            continue;
        }
        stdout.push_str(&result.stdout);
        stderr.push_str(&result.stderr);
        return Ok(CodeRunResult {
            success: result.success,
            exit_code: result.exit_code,
            stdout: truncate_output(stdout),
            stderr: truncate_output(stderr),
            command: display.join("\n"),
            duration_ms: started.elapsed().as_millis() as u64,
            error_code: result.error_code,
        });
    }

    let result = last_missing.unwrap_or(CommandOutput {
        success: false,
        exit_code: None,
        stdout: String::new(),
        stderr: "No runtime is configured for this file".into(),
        error_code: Some("runtime-missing"),
    });
    Ok(CodeRunResult {
        success: false,
        exit_code: None,
        stdout,
        stderr: format!("{stderr}{}", result.stderr),
        command: display.join("\n"),
        duration_ms: started.elapsed().as_millis() as u64,
        error_code: Some("runtime-missing"),
    })
}

async fn build_plan(file: &Path, temp: &TempDir) -> AppResult<Option<RunPlan>> {
    let extension = file
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let source = file.to_string_lossy().into_owned();
    let output = temp.path().join(if cfg!(windows) {
        "program.exe"
    } else {
        "program"
    });
    let output = output.to_string_lossy().into_owned();

    let interpreted = |commands: &[(&str, &[&str])]| RunPlan {
        compile: None,
        run: commands
            .iter()
            .map(|(command, prefix)| spec(command, prefix.iter().copied().chain([source.as_str()])))
            .collect(),
    };
    let plan = match extension.as_str() {
        "js" | "mjs" | "cjs" => {
            interpreted(&[("node", &[]), ("bun", &["run"]), ("deno", &["run"])])
        }
        "jsx" | "ts" | "tsx" => {
            let compiled = temp.path().join("program.cjs");
            let compiled_string = compiled.to_string_lossy().into_owned();
            RunPlan {
                compile: Some(CommandSpec {
                    executable: bundled_esbuild_path(),
                    args: vec![
                        source,
                        "--bundle".into(),
                        "--platform=node".into(),
                        "--format=cjs".into(),
                        "--log-level=warning".into(),
                        format!("--outfile={compiled_string}"),
                    ],
                }),
                run: vec![spec("node", [compiled_string.as_str()])],
            }
        }
        "py" | "pyw" if cfg!(windows) => interpreted(&[("python", &[]), ("py", &["-3"])]),
        "py" | "pyw" => interpreted(&[("python3", &[]), ("python", &[])]),
        "c" => RunPlan {
            compile: Some(spec("gcc", [source.as_str(), "-o", output.as_str()])),
            run: vec![spec(output.as_str(), [])],
        },
        "cc" | "cpp" | "cxx" => RunPlan {
            compile: Some(spec(
                "g++",
                [source.as_str(), "-std=c++17", "-o", output.as_str()],
            )),
            run: vec![spec(output.as_str(), [])],
        },
        "java" => {
            let source_text = tokio::fs::read_to_string(file).await?;
            let class_name = file
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Main");
            let package = java_package(&source_text);
            let qualified = package.map_or_else(
                || class_name.to_owned(),
                |package| format!("{package}.{class_name}"),
            );
            RunPlan {
                compile: Some(spec(
                    "javac",
                    [
                        "-encoding",
                        "UTF-8",
                        "-d",
                        temp.path().to_string_lossy().as_ref(),
                        source.as_str(),
                    ],
                )),
                run: vec![spec(
                    "java",
                    [
                        "-cp",
                        temp.path().to_string_lossy().as_ref(),
                        qualified.as_str(),
                    ],
                )],
            }
        }
        "go" => interpreted(&[("go", &["run"])]),
        "rs" => RunPlan {
            compile: Some(spec("rustc", [source.as_str(), "-o", output.as_str()])),
            run: vec![spec(output.as_str(), [])],
        },
        "kt" | "kts" => {
            let jar = temp
                .path()
                .join("program.jar")
                .to_string_lossy()
                .into_owned();
            RunPlan {
                compile: Some(spec(
                    "kotlinc",
                    [source.as_str(), "-include-runtime", "-d", jar.as_str()],
                )),
                run: vec![spec("java", ["-jar", jar.as_str()])],
            }
        }
        "swift" => interpreted(&[("swift", &[])]),
        "dart" => interpreted(&[("dart", &["run"])]),
        "rb" => interpreted(&[("ruby", &[])]),
        "php" => interpreted(&[("php", &[])]),
        "pl" | "pm" => interpreted(&[("perl", &[])]),
        "lua" => interpreted(&[("lua", &[])]),
        "r" => interpreted(&[("Rscript", &[])]),
        "jl" => interpreted(&[("julia", &[])]),
        "sh" | "bash" | "zsh" => interpreted(&[("bash", &[])]),
        "fish" => interpreted(&[("fish", &[])]),
        "ps1" if cfg!(windows) => interpreted(&[(
            "powershell.exe",
            &["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"],
        )]),
        "ps1" => interpreted(&[("pwsh", &["-NoProfile", "-File"])]),
        "bat" | "cmd" if cfg!(windows) => interpreted(&[("cmd.exe", &["/d", "/c"])]),
        _ => return Ok(None),
    };
    Ok(Some(plan))
}

fn spec<'a>(command: &str, args: impl IntoIterator<Item = &'a str>) -> CommandSpec {
    CommandSpec {
        executable: PathBuf::from(command),
        args: args.into_iter().map(str::to_owned).collect(),
    }
}

pub(crate) fn bundled_esbuild_path() -> PathBuf {
    if let Some(path) = std::env::var_os("WAE_ESBUILD_PATH") {
        return PathBuf::from(path);
    }
    let file_name = if cfg!(windows) {
        "esbuild.exe"
    } else {
        "esbuild"
    };
    let executable = std::env::current_exe().ok();
    let candidates = executable
        .as_deref()
        .and_then(Path::parent)
        .into_iter()
        .flat_map(|directory| {
            [
                directory.join(file_name),
                directory.parent().unwrap_or(directory).join(file_name),
            ]
        })
        .collect::<Vec<_>>();
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .unwrap_or_else(|| PathBuf::from(file_name))
}

async fn execute(spec: &CommandSpec, cwd: &Path, timeout: Duration) -> CommandOutput {
    let mut command = Command::new(&spec.executable);
    command
        .args(&spec.args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    reaper::configure_process_group(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return CommandOutput {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: format!("Runtime not found: {}", spec.executable.display()),
                error_code: Some("runtime-missing"),
            }
        }
        Err(error) => {
            return CommandOutput {
                success: false,
                exit_code: None,
                stdout: String::new(),
                stderr: error.to_string(),
                error_code: Some("failed"),
            }
        }
    };
    let pid = child.id();
    let stdout_task = child
        .stdout
        .take()
        .map(|stream| tokio::spawn(read_capped(stream)));
    let stderr_task = child
        .stderr
        .take()
        .map(|stream| tokio::spawn(read_capped(stream)));
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => Some(status),
        Ok(Err(error)) => {
            reaper::terminate_process_tree(pid).await;
            let _ = child.kill().await;
            // P3: drain the zombie on error branches too, not just on timeout.
            let _ = child.wait().await;
            return output_from_tasks(
                stdout_task,
                stderr_task,
                None,
                Some(error.to_string()),
                "failed",
            )
            .await;
        }
        Err(_) => {
            reaper::terminate_process_tree(pid).await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            return output_from_tasks(
                stdout_task,
                stderr_task,
                None,
                Some(format!(
                    "Process timed out after {} seconds",
                    timeout.as_secs()
                )),
                "timeout",
            )
            .await;
        }
    };
    output_from_tasks(
        stdout_task,
        stderr_task,
        status.and_then(|value| value.code()),
        None,
        "failed",
    )
    .await
}

async fn read_capped<R: tokio::io::AsyncRead + Unpin>(mut reader: R) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut buffer = [0_u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = OUTPUT_LIMIT_BYTES.saturating_sub(kept.len());
                kept.extend_from_slice(&buffer[..count.min(remaining)]);
                truncated |= count > remaining;
            }
        }
    }
    (kept, truncated)
}

async fn output_from_tasks(
    stdout_task: Option<tokio::task::JoinHandle<(Vec<u8>, bool)>>,
    stderr_task: Option<tokio::task::JoinHandle<(Vec<u8>, bool)>>,
    exit_code: Option<i32>,
    extra_error: Option<String>,
    failure_code: &'static str,
) -> CommandOutput {
    let (stdout, stdout_truncated) = join_output(stdout_task).await;
    let (stderr, stderr_truncated) = join_output(stderr_task).await;
    let mut stderr = String::from_utf8_lossy(&stderr).into_owned();
    let has_extra_error = extra_error.is_some();
    if let Some(extra) = extra_error {
        if !stderr.is_empty() {
            stderr.push('\n');
        }
        stderr.push_str(&extra);
    }
    if stdout_truncated || stderr_truncated {
        stderr.push_str(&format!(
            "\n[output truncated at {} MiB]",
            OUTPUT_LIMIT_BYTES / (1024 * 1024)
        ));
    }
    let success = exit_code == Some(0) && !has_extra_error;
    CommandOutput {
        success,
        exit_code,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr,
        error_code: (!success).then_some(failure_code),
    }
}

async fn join_output(task: Option<tokio::task::JoinHandle<(Vec<u8>, bool)>>) -> (Vec<u8>, bool) {
    match task {
        Some(task) => task.await.unwrap_or_default(),
        None => (Vec::new(), false),
    }
}

fn display_command(spec: &CommandSpec) -> String {
    std::iter::once(spec.executable.to_string_lossy().into_owned())
        .chain(spec.args.iter().cloned())
        .map(|argument| {
            if argument.chars().any(char::is_whitespace) {
                format!("\"{}\"", argument.replace('"', "\\\""))
            } else {
                argument
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn java_package(source: &str) -> Option<&str> {
    source.lines().find_map(|line| {
        let value = line.trim().strip_prefix("package ")?.trim();
        value.strip_suffix(';').map(str::trim)
    })
}

/// Truncate merged output to OUTPUT_LIMIT_BYTES. `String::truncate` panics
/// when the cut lands inside a multi-byte UTF-8 sequence (Chinese output hits
/// 4 MiB constantly), so walk back to the nearest char boundary first
/// (review report P5).
fn truncate_output(value: String) -> String {
    truncate_to_limit(value, OUTPUT_LIMIT_BYTES)
}

fn truncate_to_limit(mut value: String, limit: usize) -> String {
    if value.len() <= limit {
        return value;
    }
    let mut kept = limit;
    while !value.is_char_boundary(kept) {
        kept -= 1;
    }
    value.truncate(kept);
    value.push_str(&format!(
        "\n[output truncated at {} MiB]",
        OUTPUT_LIMIT_BYTES / (1024 * 1024)
    ));
    value
}

fn unsupported(started: Instant) -> CodeRunResult {
    CodeRunResult {
        success: false,
        exit_code: None,
        stdout: String::new(),
        stderr: "This file type does not have a configured runner".into(),
        command: String::new(),
        duration_ms: started.elapsed().as_millis() as u64,
        error_code: Some("unsupported"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_java_package() {
        assert_eq!(
            java_package("package com.example;\nclass Main {}"),
            Some("com.example")
        );
        assert_eq!(java_package("class Main {}"), None);
    }

    #[test]
    fn sidecar_path_uses_platform_executable_name() {
        let path = bundled_esbuild_path();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        assert_eq!(
            file_name,
            if cfg!(windows) {
                "esbuild.exe"
            } else {
                "esbuild"
            }
        );
    }

    #[test]
    fn truncate_never_cuts_inside_a_multibyte_character() {
        // '中' is 3 bytes; limits 2 and 3 must walk back to the 1-byte boundary
        // instead of panicking like `String::truncate` would.
        let mut input = String::from("a");
        input.push('中');
        input.push('中');
        input.push('中');
        for limit in 1..=input.len() {
            let out = truncate_to_limit(input.clone(), limit);
            assert!(std::str::from_utf8(out.as_bytes()).is_ok());
        }
    }
}

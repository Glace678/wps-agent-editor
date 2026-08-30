use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::{process::Command, time::Duration};

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub id: &'static str,
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub capabilities: Vec<&'static str>,
}

struct DependencySpec {
    id: &'static str,
    commands: &'static [&'static str],
    version_args: &'static [&'static str],
    capabilities: &'static [&'static str],
}

const DEPENDENCIES: &[DependencySpec] = &[
    DependencySpec {
        id: "libreoffice",
        commands: &["soffice", "libreoffice"],
        version_args: &["--version"],
        capabilities: &["word-convert", "presentation-convert", "presentation-edit"],
    },
    DependencySpec {
        id: "node",
        commands: &["node"],
        version_args: &["--version"],
        capabilities: &["javascript-run", "node-debug"],
    },
    DependencySpec {
        id: "bun",
        commands: &["bun"],
        version_args: &["--version"],
        capabilities: &["javascript-run", "typescript-run"],
    },
    DependencySpec {
        id: "deno",
        commands: &["deno"],
        version_args: &["--version"],
        capabilities: &["javascript-run", "typescript-run"],
    },
    DependencySpec {
        id: "python",
        commands: if cfg!(windows) {
            &["python", "py"]
        } else {
            &["python3", "python"]
        },
        version_args: &["--version"],
        capabilities: &["python-run", "python-debug", "libreoffice-uno"],
    },
    DependencySpec {
        id: "gcc",
        commands: &["gcc"],
        version_args: &["--version"],
        capabilities: &["c-run"],
    },
    DependencySpec {
        id: "g++",
        commands: &["g++"],
        version_args: &["--version"],
        capabilities: &["cpp-run"],
    },
    DependencySpec {
        id: "java",
        commands: &["java"],
        version_args: &["--version"],
        capabilities: &["java-run", "kotlin-run"],
    },
    DependencySpec {
        id: "javac",
        commands: &["javac"],
        version_args: &["--version"],
        capabilities: &["java-compile"],
    },
    DependencySpec {
        id: "go",
        commands: &["go"],
        version_args: &["version"],
        capabilities: &["go-run"],
    },
    DependencySpec {
        id: "rustc",
        commands: &["rustc"],
        version_args: &["--version"],
        capabilities: &["rust-run"],
    },
    DependencySpec {
        id: "kotlinc",
        commands: &["kotlinc"],
        version_args: &["-version"],
        capabilities: &["kotlin-compile"],
    },
    DependencySpec {
        id: "swift",
        commands: &["swift"],
        version_args: &["--version"],
        capabilities: &["swift-run"],
    },
    DependencySpec {
        id: "dart",
        commands: &["dart"],
        version_args: &["--version"],
        capabilities: &["dart-run"],
    },
    DependencySpec {
        id: "ruby",
        commands: &["ruby"],
        version_args: &["--version"],
        capabilities: &["ruby-run"],
    },
    DependencySpec {
        id: "php",
        commands: &["php"],
        version_args: &["--version"],
        capabilities: &["php-run"],
    },
    DependencySpec {
        id: "perl",
        commands: &["perl"],
        version_args: &["--version"],
        capabilities: &["perl-run"],
    },
    DependencySpec {
        id: "lua",
        commands: &["lua"],
        version_args: &["-v"],
        capabilities: &["lua-run"],
    },
    DependencySpec {
        id: "r",
        commands: &["Rscript"],
        version_args: &["--version"],
        capabilities: &["r-run"],
    },
    DependencySpec {
        id: "julia",
        commands: &["julia"],
        version_args: &["--version"],
        capabilities: &["julia-run"],
    },
    DependencySpec {
        id: "bash",
        commands: &["bash"],
        version_args: &["--version"],
        capabilities: &["shell-run"],
    },
    DependencySpec {
        id: "pwsh",
        commands: if cfg!(windows) {
            &["powershell.exe", "pwsh"]
        } else {
            &["pwsh"]
        },
        version_args: &[
            "-NoProfile",
            "-Command",
            "$PSVersionTable.PSVersion.ToString()",
        ],
        capabilities: &["powershell-run"],
    },
];

pub async fn probe_all() -> Vec<DependencyStatus> {
    let esbuild = super::runner::bundled_esbuild_path();
    let mut results = Vec::with_capacity(DEPENDENCIES.len() + 1);
    results.push(DependencyStatus {
        id: "esbuild-sidecar",
        available: esbuild.is_file(),
        version: command_version(&esbuild, &["--version"]).await,
        path: esbuild.is_file().then(|| path_string(&esbuild)),
        capabilities: vec!["typescript-transpile", "tsx-transpile"],
    });
    for spec in DEPENDENCIES {
        results.push(probe(spec).await);
    }
    results
}

async fn probe(spec: &DependencySpec) -> DependencyStatus {
    let path = spec
        .commands
        .iter()
        .find_map(|command| resolve_executable(command));
    let version = match &path {
        Some(path) => command_version(path, spec.version_args).await,
        None => None,
    };
    DependencyStatus {
        id: spec.id,
        available: path.is_some(),
        path: path.as_deref().map(path_string),
        version,
        capabilities: spec.capabilities.to_vec(),
    }
}

pub fn resolve_executable(command: &str) -> Option<PathBuf> {
    if let Ok(path) = which::which(command) {
        return Some(path);
    }
    if command == "soffice" || command == "libreoffice" {
        for candidate in libreoffice_candidates() {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn libreoffice_candidates() -> Vec<PathBuf> {
    if cfg!(windows) {
        vec![
            PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
            PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        vec![PathBuf::from(
            "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        )]
    } else {
        vec![
            PathBuf::from("/usr/bin/libreoffice"),
            PathBuf::from("/usr/bin/soffice"),
            PathBuf::from("/snap/bin/libreoffice"),
        ]
    }
}

async fn command_version(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    command.args(args);
    let output = command_output_with_timeout(command, Duration::from_secs(3)).await?;
    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr)
    } else {
        String::from_utf8_lossy(&output.stdout)
    };
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.chars().take(240).collect())
}

async fn command_output_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Option<std::process::Output> {
    command.kill_on_drop(true);
    tokio::time::timeout(timeout, command.output())
        .await
        .ok()?
        .ok()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROBE_CHILD_MARKER: &str = "WAE_DEPENDENCY_PROBE_CHILD_MARKER";

    #[test]
    fn delayed_version_probe_child() {
        let Some(marker) = std::env::var_os(PROBE_CHILD_MARKER) else {
            return;
        };
        std::thread::sleep(Duration::from_millis(700));
        std::fs::write(marker, b"completed").expect("write child marker");
    }

    #[tokio::test]
    async fn timed_out_version_probe_terminates_the_child() {
        let temp = tempfile::tempdir().expect("temporary directory");
        let marker = temp.path().join("probe-completed");
        let mut command = Command::new(std::env::current_exe().expect("test executable"));
        command
            .args([
                "--exact",
                "process::dependencies::tests::delayed_version_probe_child",
                "--nocapture",
            ])
            .env(PROBE_CHILD_MARKER, &marker);

        assert!(
            command_output_with_timeout(command, Duration::from_millis(100))
                .await
                .is_none()
        );
        tokio::time::sleep(Duration::from_millis(900)).await;
        assert!(
            !marker.exists(),
            "the timed-out dependency probe continued running"
        );
    }
}

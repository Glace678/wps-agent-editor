pub mod agents;
pub mod commands;
pub mod documents;
pub mod error;
pub mod files;
pub mod process;
pub mod providers;
mod runtime_smoke;
pub mod security;
pub mod state;
mod update_health;
mod updater_smoke;

use crate::{
    error::AppError,
    files::{access::GrantSource, is_executable_file},
    state::AppState,
};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

pub fn run() {
    match update_health::run_guardian_from_process() {
        Ok(true) => return,
        Ok(false) => {}
        Err(error) => {
            eprintln!("Updater health guardian failed: {error}");
            std::process::exit(71);
        }
    }

    let builder = tauri::Builder::default().plugin(security::navigation_guard());

    // Windows and Linux render the localized application menu inside the WebView.
    // Keep a native application menu only on macOS, where the in-app menu is hidden.
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(commands::app::build_application_menu)
        .on_menu_event(|app, event| {
            commands::app::handle_native_menu(app, event.id().as_ref());
        });

    builder
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    state.revoke_window(window.label());
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, working_directory| {
                handle_second_instance(app, arguments, working_directory);
            },
        ))
        .setup(|app| {
            update_health::record_startup(app.handle())?;
            let updater_smoke = updater_smoke::SmokeSpec::from_process()?;
            let runtime_smoke = runtime_smoke::SmokeSpec::from_process()?;
            if updater_smoke.is_some() && runtime_smoke.is_some() {
                return Err(AppError::invalid("Only one acceptance mode may run").into());
            }
            let state = AppState::initialize(app.handle())?;
            if let Some(spec) = updater_smoke {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                app.manage(state);
                updater_smoke::start(app.handle().clone(), spec);
                return Ok(());
            }
            if let Some(spec) = runtime_smoke {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
                app.manage(state);
                runtime_smoke::start(app.handle().clone(), spec);
                return Ok(());
            }
            register_initial_file(&state, "main");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::files::files_list,
            commands::files::files_open,
            commands::files::files_open_external,
            commands::files::files_read_binary,
            commands::files::files_save_text,
            commands::files::files_search,
            commands::files::files_get_recent,
            commands::files::files_get_home,
            commands::files::files_session_load,
            commands::files::files_session_save,
            commands::files::files_stat,
            commands::files::files_rename,
            commands::files::files_delete,
            commands::files::files_show_in_folder,
            commands::files::files_remove_recent,
            commands::files::files_copy_to_clipboard,
            commands::files::files_history_list,
            commands::files::files_history_restore,
            commands::files::files_select_folder,
            commands::files::files_select_file,
            commands::files::files_select_attachments,
            commands::files::files_select_save_file,
            commands::documents::documents_prepare_word,
            commands::documents::documents_prepare_presentation,
            commands::documents::documents_prepare_spreadsheet,
            commands::documents::documents_read_file,
            commands::documents::documents_save_binary,
            commands::documents::documents_save_text,
            commands::documents::documents_set_current_file,
            commands::documents::documents_edit_presentation,
            commands::documents::documents_list_fonts,
            commands::documents::documents_write_png_clipboard,
            commands::agents::agents_list,
            commands::agents::agents_save,
            commands::agents::agents_delete,
            commands::agents::agents_conversations_list,
            commands::agents::agents_conversations_get,
            commands::agents::agents_conversations_save,
            commands::agents::agents_conversations_delete,
            commands::agents::agents_conversations_import_codex,
            commands::agents::agents_chat,
            commands::agents::agents_run_task,
            commands::agents::agents_cancel,
            commands::agents::agents_document_result,
            commands::agents::agents_document_event,
            commands::providers::providers_list,
            commands::providers::providers_get,
            commands::providers::providers_detect_ollama,
            commands::providers::providers_set_base_url,
            commands::providers::providers_auth_status,
            commands::providers::providers_auth_set,
            commands::providers::providers_auth_remove,
            commands::providers::providers_custom_list,
            commands::providers::providers_custom_save,
            commands::providers::providers_custom_delete,
            commands::providers::providers_custom_test,
            commands::providers::providers_stream_chat,
            commands::process::process_probe_dependencies,
            commands::process::process_run_code,
            commands::process::process_debug_start,
            commands::process::process_debug_stop,
            commands::process::process_debug_command,
            commands::process::process_debug_evaluate,
            commands::process::process_terminal_start,
            commands::process::process_terminal_exec,
            commands::process::process_terminal_write,
            commands::process::process_terminal_resize,
            commands::process::process_terminal_kill,
            commands::app::app_window_new,
            commands::app::app_window_minimize,
            commands::app::app_window_toggle_maximize,
            commands::app::app_window_toggle_fullscreen,
            commands::app::app_window_close,
            commands::app::app_quit,
            commands::app::app_theme_set,
            commands::app::app_i18n_set_language,
            commands::app::app_menu_perform,
            commands::app::app_take_startup_files,
            commands::app::app_update_check,
            commands::app::app_update_install,
            commands::app::app_startup_healthy,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run WPS Agent Editor");
}

fn register_initial_file(state: &AppState, window_label: &str) {
    let current_dir = std::env::current_dir().ok();
    let Some(path) = find_file_argument(std::env::args_os().skip(1), current_dir.as_deref()) else {
        return;
    };
    if let Ok(grant) =
        state
            .files
            .access
            .grant_existing(window_label, &path, true, GrantSource::Startup)
    {
        state.enqueue_startup_file(window_label, grant);
    }
}

fn handle_second_instance(
    app: &tauri::AppHandle,
    arguments: Vec<String>,
    working_directory: String,
) {
    if let Some(state) = app.try_state::<AppState>() {
        let cwd = PathBuf::from(working_directory);
        if let Some(path) = find_second_instance_file_argument(arguments, Some(&cwd)) {
            let target = app.get_webview_window("main");
            let Some(window) = target else {
                log::warn!("Cannot deliver second-instance file: main window is unavailable");
                return;
            };
            match state.files.access.grant_existing(
                window.label(),
                &path,
                true,
                GrantSource::Startup,
            ) {
                Ok(grant) => {
                    state.enqueue_startup_file(window.label(), grant);
                    let _ = window.emit("app:open-file", ());
                }
                Err(error) => log::warn!("Cannot grant second-instance file: {error}"),
            }
        }
    }
    commands::app::focus_main_window(app);
}

fn find_second_instance_file_argument(
    arguments: Vec<String>,
    cwd: Option<&Path>,
) -> Option<PathBuf> {
    // The single-instance plugin forwards argv including argv[0]. Treating that
    // executable path as a document can make the renderer load the application binary.
    find_file_argument(arguments.into_iter().skip(1), cwd)
}

fn find_file_argument<I, S>(arguments: I, cwd: Option<&Path>) -> Option<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    arguments.into_iter().find_map(|argument| {
        let argument = PathBuf::from(argument.as_ref());
        if argument.as_os_str().to_string_lossy().starts_with('-') {
            return None;
        }
        let candidate = if argument.is_absolute() {
            argument
        } else {
            cwd?.join(argument)
        };
        (candidate.is_file() && !is_executable_file(&candidate)).then_some(candidate)
    })
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        AppError::internal(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::find_second_instance_file_argument;
    use std::fs;

    #[test]
    fn second_instance_never_opens_argv_zero_as_a_document() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let executable = directory.path().join("wps-agent-editor.exe");
        fs::write(&executable, b"binary").expect("write executable fixture");

        let arguments = vec![executable.to_string_lossy().into_owned()];
        assert_eq!(
            find_second_instance_file_argument(arguments, Some(directory.path())),
            None
        );
    }

    #[test]
    fn second_instance_finds_a_document_after_argv_zero() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let executable = directory.path().join("wps-agent-editor.exe");
        let document = directory.path().join("notes.txt");
        fs::write(&executable, b"binary").expect("write executable fixture");
        fs::write(&document, b"notes").expect("write document fixture");

        let arguments = vec![
            executable.to_string_lossy().into_owned(),
            "--ignored-option".to_owned(),
            "notes.txt".to_owned(),
        ];
        assert_eq!(
            find_second_instance_file_argument(arguments, Some(directory.path())),
            Some(document)
        );
    }

    #[test]
    fn second_instance_skips_executable_file_arguments() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let application = directory.path().join("wps-agent-editor.exe");
        let executable = directory.path().join("payload.EXE");
        let document = directory.path().join("notes.txt");
        fs::write(&application, b"application").expect("write application fixture");
        fs::write(&executable, b"payload").expect("write executable fixture");
        fs::write(&document, b"notes").expect("write document fixture");

        let arguments = vec![
            application.to_string_lossy().into_owned(),
            executable.to_string_lossy().into_owned(),
            document.to_string_lossy().into_owned(),
        ];
        assert_eq!(
            find_second_instance_file_argument(arguments, Some(directory.path())),
            Some(document)
        );
    }
}

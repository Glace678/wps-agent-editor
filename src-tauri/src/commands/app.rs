use crate::{
    error::{AppError, AppResult},
    files::{access::GrantSource, models::GrantedPath},
    state::AppState,
    update_health::UpdateHealthTransaction,
};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager, State, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};
use tauri_plugin_updater::UpdaterExt;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResult {
    pub success: bool,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    event: &'static str,
    version: String,
    downloaded: u64,
    total: Option<u64>,
}

#[tauri::command]
pub fn app_window_minimize(window: WebviewWindow) -> AppResult<SuccessResult> {
    window
        .minimize()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(success())
}

#[tauri::command]
pub fn app_window_toggle_maximize(window: WebviewWindow) -> AppResult<SuccessResult> {
    if window
        .is_maximized()
        .map_err(|error| AppError::internal(error.to_string()))?
    {
        window
            .unmaximize()
            .map_err(|error| AppError::internal(error.to_string()))?;
    } else {
        window
            .maximize()
            .map_err(|error| AppError::internal(error.to_string()))?;
    }
    Ok(success())
}

#[tauri::command]
pub fn app_window_toggle_fullscreen(window: WebviewWindow) -> AppResult<SuccessResult> {
    let fullscreen = window
        .is_fullscreen()
        .map_err(|error| AppError::internal(error.to_string()))?;
    window
        .set_fullscreen(!fullscreen)
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(success())
}

#[tauri::command]
pub fn app_window_close(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<SuccessResult> {
    state.revoke_window(window.label());
    window
        .close()
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(success())
}

#[tauri::command]
pub fn app_window_new(
    app: tauri::AppHandle,
    path: Option<String>,
    grant_id: Option<String>,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<SuccessResult> {
    let label = format!("document-{}", Uuid::new_v4());
    if let Some(path) = path {
        let grant_id = grant_id.ok_or_else(|| AppError::denied("A file grant is required"))?;
        let child_grant = state.files.access.derive_for_owner(
            window.label(),
            &label,
            &path,
            &grant_id,
            GrantSource::Startup,
        )?;
        state.enqueue_startup_file(&label, child_grant);
    }
    let result = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("WPS Agent Editor")
        .inner_size(1400.0, 900.0)
        .min_inner_size(1000.0, 600.0)
        .build();
    if let Err(error) = result {
        state.revoke_window(&label);
        return Err(AppError::internal(error.to_string()));
    }
    Ok(success())
}

#[tauri::command]
pub fn app_quit(app: tauri::AppHandle) -> SuccessResult {
    app.exit(0);
    success()
}

#[tauri::command]
pub fn app_theme_set(
    preference: String,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<SuccessResult> {
    let theme = match preference.as_str() {
        "system" => None,
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => return Err(AppError::invalid("Theme must be system, light, or dark")),
    };
    window
        .set_theme(theme)
        .map_err(|error| AppError::internal(error.to_string()))?;
    *state.theme.write() = preference;
    Ok(success())
}

#[tauri::command]
pub fn app_i18n_set_language(
    language: String,
    state: State<'_, AppState>,
) -> AppResult<SuccessResult> {
    const LANGUAGES: &[&str] = &["zh-CN", "en", "de", "es", "fr", "ja", "pt", "ru", "ar"];
    if !LANGUAGES.contains(&language.as_str()) {
        return Err(AppError::invalid("Unsupported language"));
    }
    *state.language.write() = language;
    Ok(success())
}

#[tauri::command]
pub fn app_menu_perform(action: String, window: WebviewWindow) -> AppResult<SuccessResult> {
    match action.as_str() {
        "quit" => window.app_handle().exit(0),
        "toggle-fullscreen" => {
            let fullscreen = window
                .is_fullscreen()
                .map_err(|error| AppError::internal(error.to_string()))?;
            window
                .set_fullscreen(!fullscreen)
                .map_err(|error| AppError::internal(error.to_string()))?;
        }
        "open-file" | "open-folder" | "save" | "print" | "undo" | "redo" | "cut" | "copy"
        | "paste" | "select-all" | "reload" | "force-reload" | "toggle-dev-tools"
        | "reset-zoom" | "zoom-in" | "zoom-out" | "new-agent" | "run-multi-agent"
        | "show-about" => {
            window
                .emit(&format!("menu:{action}"), ())
                .map_err(|error| AppError::internal(error.to_string()))?;
        }
        _ => return Err(AppError::invalid("Unsupported application menu action")),
    }
    Ok(success())
}

#[tauri::command]
pub fn app_take_startup_files(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> AppResult<Vec<GrantedPath>> {
    Ok(state.take_startup_files(window.label()))
}

#[tauri::command]
pub async fn app_update_check(app: tauri::AppHandle) -> AppResult<UpdateInfo> {
    let current_version = app.package_info().version.to_string();
    let update = app.updater()?.check().await?;
    Ok(match update {
        Some(update) => UpdateInfo {
            available: true,
            current_version,
            version: Some(update.version),
            notes: update.body,
            published_at: update.date.map(|value| value.to_string()),
        },
        None => UpdateInfo {
            available: false,
            current_version,
            version: None,
            notes: None,
            published_at: None,
        },
    })
}

#[tauri::command]
pub async fn app_update_install(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> AppResult<SuccessResult> {
    let update =
        app.updater()?.check().await?.ok_or_else(|| {
            AppError::new("update-not-available", "No newer release is available")
        })?;
    let version = update.version.clone();
    let downloaded = Arc::new(AtomicU64::new(0));
    let progress_downloaded = Arc::clone(&downloaded);
    let progress_window = window.clone();
    let progress_version = version.clone();
    let payload = update
        .download(
            move |chunk_size, total| {
                let downloaded = progress_downloaded
                    .fetch_add(chunk_size as u64, Ordering::Relaxed)
                    + chunk_size as u64;
                let _ = progress_window.emit(
                    "app:update-progress",
                    UpdateProgress {
                        event: "download",
                        version: progress_version.clone(),
                        downloaded,
                        total,
                    },
                );
            },
            || {},
        )
        .await?;
    let _ = window.emit(
        "app:update-progress",
        UpdateProgress {
            event: "verified",
            version: version.clone(),
            downloaded: downloaded.load(Ordering::Relaxed),
            total: None,
        },
    );
    let health = UpdateHealthTransaction::prepare(&app, &version)?;
    if let Err(error) = update.install(&payload) {
        let error: AppError = error.into();
        let _ = health.abort(error.to_string());
        return Err(error);
    }

    let _ = window.emit(
        "app:update-progress",
        UpdateProgress {
            event: "installed",
            version,
            downloaded: 0,
            total: None,
        },
    );
    app.request_restart();
    Ok(success())
}

#[tauri::command]
pub fn app_startup_healthy(app: tauri::AppHandle) -> AppResult<SuccessResult> {
    crate::update_health::mark_startup_healthy(&app)?;
    Ok(success())
}

pub(crate) fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn build_application_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<Wry>> {
    let open_file = MenuItemBuilder::with_id("open-file", "Open File…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_folder = MenuItemBuilder::with_id("open-folder", "Open Folder…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let save = MenuItemBuilder::with_id("save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let print = MenuItemBuilder::with_id("print", "Print…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&open_file)
        .item(&open_folder)
        .item(&save)
        .item(&print)
        .separator()
        .close_window()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let fullscreen = MenuItemBuilder::with_id("toggle-fullscreen", "Toggle Full Screen")
        .accelerator("F11")
        .build(app)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&reload)
        .item(&fullscreen)
        .build()?;
    let new_agent = MenuItemBuilder::with_id("new-agent", "New Agent").build(app)?;
    let run_multi_agent = MenuItemBuilder::with_id("run-multi-agent", "Run Multi-Agent Task…")
        .accelerator("CmdOrCtrl+Shift+A")
        .build(app)?;
    let agent = SubmenuBuilder::new(app, "Agent")
        .item(&new_agent)
        .item(&run_multi_agent)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help").about(None).build()?;
    MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&agent)
        .item(&help)
        .build()
}

pub(crate) fn handle_native_menu(app: &tauri::AppHandle, action: &str) {
    let window = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| app.get_webview_window("main"));
    if let Some(window) = window {
        let _ = window.emit(&format!("menu:{action}"), ());
    }
}

fn success() -> SuccessResult {
    SuccessResult { success: true }
}

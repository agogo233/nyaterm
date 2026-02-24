//! Tauri command handlers and app entry point.
//!
//! Registers all invoke handlers, manages SessionManager state, and sets up tracing.

mod config;
mod crypto;
mod error;
mod fuzzy;
mod pty;
mod session;
mod sftp;
mod ssh;
pub mod watcher;

use config::{Group, QuickCommand, QuickCommandsConfig, SavedConnection, UiConfig};
use error::{AppError, AppResult};
use fuzzy::FuzzyResult;
use session::{SessionCommand, SessionManager};
use ssh::{SshAuth, SshConfig};
use std::sync::Arc;
use tauri::Manager;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

fn init_tracing(log_dir: std::path::PathBuf) {
    let _ = std::fs::create_dir_all(&log_dir);

    let file_appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("dragonfly")
        .filename_suffix("log")
        .max_log_files(7)
        .build(&log_dir)
        .expect("failed to initialize rolling file appender");

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("dragonfly=info,warn"));

    tracing_subscriber::registry()
        .with(filter)
        .with(
            fmt::layer()
                .with_writer(file_appender)
                .with_ansi(false)
                .with_target(true),
        )
        .with(fmt::layer().with_writer(std::io::stderr).compact())
        .init();

    tracing::info!("Dragonfly starting");
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn create_ssh_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    connection_id: String,
) -> AppResult<String> {
    let conn = config::load_connection_by_id(&app, &connection_id)?;

    let auth = match conn.auth_type.as_str() {
        "password" => SshAuth::Password {
            password: conn
                .password
                .ok_or_else(|| AppError::Auth("No password saved for this connection. Please edit and re-save it.".to_string()))?,
        },
        "key" => {
            let key_data = config::decrypt_key_data(&conn)?
                .ok_or_else(|| AppError::Auth("No private key stored for this connection.".to_string()))?;
            SshAuth::Key {
                key_data,
                passphrase: conn.passphrase,
            }
        },
        other => return Err(AppError::Auth(format!("Unknown auth type: {}", other))),
    };

    let ssh_config = SshConfig {
        name: conn.name,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        auth,
    };

    ssh::create_ssh_session(app, state.inner().clone(), ssh_config).await
}

#[tauri::command]
async fn create_local_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<String> {
    pty::create_local_session(app, state.inner().clone()).await
}

#[tauri::command]
async fn write_to_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::Write(data.into_bytes()))
        .await
}

#[tauri::command]
async fn resize_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::Resize { cols, rows })
        .await
}

#[tauri::command]
async fn attach_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::Attach)
        .await
}

#[tauri::command]
async fn close_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    let session_id_clone = session_id.clone();
    
    // Broadcast the close command
    let res = state
        .send_command(&session_id, SessionCommand::Close)
        .await;

    // Concurrently tidy up any downloaded/watcher temporary files stored in the OS temp directory
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        if let Ok(temp_dir) = app.path().temp_dir() {
            let session_temp_dir = temp_dir.join("dragonfly").join(&session_id_clone);
            if session_temp_dir.exists() {
                if let Err(e) = tokio::fs::remove_dir_all(&session_temp_dir).await {
                    tracing::warn!("Failed to clean up temp directory {}: {}", session_temp_dir.display(), e);
                } else {
                    tracing::info!("Successfully cleaned up temp directory for session: {}", session_id_clone);
                }
            }
        }
    });

    res
}

#[tauri::command]
async fn list_sessions(
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<Vec<session::SessionInfo>> {
    Ok(state.list_sessions().await)
}

#[tauri::command]
async fn add_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    command: String,
) -> AppResult<()> {
    state.add_command(&session_id, command).await;
    Ok(())
}

#[tauri::command]
async fn get_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<Vec<String>> {
    Ok(state.get_all_history().await)
}

#[tauri::command]
async fn fuzzy_search_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    pattern: String,
    limit: usize,
) -> AppResult<Vec<FuzzyResult>> {
    Ok(state.fuzzy_search(&pattern, limit).await)
}

// ── SFTP Commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn get_home_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<String> {
    sftp::get_home_dir(app, state.inner().clone(), &session_id).await
}

#[tauri::command]
async fn list_remote_dir(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
) -> AppResult<Vec<sftp::FileEntry>> {
    sftp::list_remote_dir(app, state.inner().clone(), &session_id, &path).await
}

#[tauri::command]
async fn delete_remote_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
) -> AppResult<()> {
    sftp::delete_remote_file(app, state.inner().clone(), &session_id, &path).await
}

#[tauri::command]
async fn rename_remote_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> AppResult<()> {
    sftp::rename_remote_file(app, state.inner().clone(), &session_id, &old_path, &new_path).await
}

#[tauri::command]
async fn download_remote_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> AppResult<()> {
    sftp::download_remote_file(app, state.inner().clone(), &session_id, &remote_path, &local_path).await
}

#[tauri::command]
async fn upload_local_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> AppResult<()> {
    sftp::upload_local_file(app, state.inner().clone(), &session_id, &local_path, &remote_path).await
}

#[tauri::command]
async fn get_file_properties(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
) -> AppResult<sftp::FileProperties> {
    sftp::get_file_properties(app, state.inner().clone(), &session_id, &path).await
}

#[tauri::command]
async fn chmod_remote_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    path: String,
    mode: String,
) -> AppResult<()> {
    sftp::chmod_remote_file(app, state.inner().clone(), &session_id, &path, &mode).await
}

// ── Config Commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_saved_connections(app: tauri::AppHandle) -> AppResult<Vec<SavedConnection>> {
    let mut cfg = config::load_config(&app)?;
    for conn in &mut cfg.connections {
        // Clear ciphertext — frontend only needs has_key_data, not the raw bytes.
        conn.password = None;
        conn.passphrase = None;
        conn.key = None;
    }
    Ok(cfg.connections)
}

#[tauri::command]
fn save_connection(app: tauri::AppHandle, mut connection: SavedConnection) -> AppResult<String> {
    let mut cfg = config::load_config(&app)?;

    if connection.id.is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
    }
    let target_id = connection.id.clone();
    let existing = cfg.connections.iter().find(|c| c.id == target_id);

    // Encrypt new password, or preserve existing ciphertext if none provided.
    connection.password = match connection.password.as_deref() {
        Some(plain) if !plain.is_empty() => Some(crypto::encrypt(plain)?),
        _ => existing.and_then(|e| e.password.clone()),
    };

    // Encrypt new passphrase, or preserve existing ciphertext.
    connection.passphrase = match connection.passphrase.as_deref() {
        Some(plain) if !plain.is_empty() => Some(crypto::encrypt(plain)?),
        _ => existing.and_then(|e| e.passphrase.clone()),
    };

    // Read and encrypt key file, or preserve existing ciphertext.
    connection.key = match connection.key_file_path.as_deref() {
        Some(path) => {
            let content = std::fs::read_to_string(path)
                .map_err(|e| AppError::Config(format!("failed to read key file: {e}")))?;
            Some(crypto::encrypt(&content)?)
        }
        None => existing.and_then(|e| e.key.clone()),
    };

    if let Some(ex) = cfg.connections.iter_mut().find(|c| c.id == target_id) {
        *ex = connection;
    } else {
        cfg.connections.push(connection);
    }
    config::save_config(&app, &cfg)?;
    Ok(target_id)
}

#[tauri::command]
fn delete_connection(app: tauri::AppHandle, id: String) -> AppResult<()> {
    let mut cfg = config::load_config(&app)?;
    cfg.connections.retain(|c| c.id != id);
    config::save_config(&app, &cfg)
}

// ── Group Commands ─────────────────────────────────────────────────────────

#[tauri::command]
fn get_groups(app: tauri::AppHandle) -> AppResult<Vec<Group>> {
    let cfg = config::load_config(&app)?;
    Ok(cfg.groups)
}

#[tauri::command]
fn save_group(app: tauri::AppHandle, mut group: Group) -> AppResult<String> {
    let mut cfg = config::load_config(&app)?;

    if group.id.is_empty() {
        group.id = uuid::Uuid::new_v4().to_string();
    }
    let target_id = group.id.clone();

    if let Some(existing) = cfg.groups.iter_mut().find(|g| g.id == target_id) {
        *existing = group;
    } else {
        cfg.groups.push(group);
    }
    config::save_config(&app, &cfg)?;
    Ok(target_id)
}

#[tauri::command]
fn delete_group(app: tauri::AppHandle, id: String) -> AppResult<()> {
    let mut cfg = config::load_config(&app)?;
    let group_name = cfg.groups.iter().find(|g| g.id == id).map(|g| g.name.clone());
    cfg.groups.retain(|g| g.id != id);
    if let Some(name) = group_name {
        for conn in &mut cfg.connections {
            if conn.group.as_deref() == Some(&name) {
                conn.group = None;
            }
        }
    }
    config::save_config(&app, &cfg)
}

// ── UI Config Commands ─────────────────────────────────────────────────────

#[tauri::command]
fn get_ui_config(app: tauri::AppHandle) -> AppResult<UiConfig> {
    config::load_ui_config(&app)
}

#[tauri::command]
fn save_ui_config(app: tauri::AppHandle, config: UiConfig) -> AppResult<()> {
    config::save_ui_config(&app, &config)
}

// ── Quick Command Commands ─────────────────────────────────────────────────

#[tauri::command]
fn get_quick_commands(app: tauri::AppHandle) -> AppResult<Vec<QuickCommand>> {
    let cfg = config::load_quick_commands(&app)?;
    Ok(cfg.commands)
}

#[tauri::command]
fn save_quick_commands(app: tauri::AppHandle, commands: Vec<QuickCommand>) -> AppResult<()> {
    let cfg = QuickCommandsConfig { commands };
    config::save_quick_commands(&app, &cfg)
}

// ── App Settings Commands ──────────────────────────────────────────────────

#[tauri::command]
fn get_app_settings(app: tauri::AppHandle) -> AppResult<config::AppSettings> {
    config::load_app_settings(&app)
}

#[tauri::command]
fn save_app_settings(app: tauri::AppHandle, settings: config::AppSettings) -> AppResult<()> {
    config::save_app_settings(&app, &settings)
}

// ── App Entry ───────────────────────────────────────────────────────────────

/// Initializes tracing, builds the Tauri app, and runs the event loop.
#[tauri::command]
fn get_system_fonts() -> Vec<String> {
    use font_kit::source::SystemSource;
    if let Ok(mut families) = SystemSource::new().all_families() {
        families.sort();
        families.dedup();
        return families;
    }
    Vec::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let session_manager = Arc::new(SessionManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(session_manager.clone())
        .setup(move |app| {
            let home_dir = app
                .path()
                .home_dir()
                .map_err(|e: tauri::Error| e.to_string())?;

            let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
            init_tracing(log_dir);

            let config_dir = home_dir.join(".dragonfly");
            let mgr = session_manager.clone();
            tauri::async_runtime::spawn(async move {
                mgr.init_history_store(config_dir).await;
            });
            
            // Build system tray icon
            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Dragonfly")
                .on_tray_icon_event(|tray, event| match event {
                    tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } => {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Ok(settings) = crate::config::load_app_settings(window.app_handle()) {
                    if settings.general.minimize_to_tray {
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_system_fonts,
            create_ssh_session,
            create_local_session,
            write_to_session,
            resize_session,
            attach_session,
            close_session,
            list_sessions,
            add_command_history,
            get_command_history,
            fuzzy_search_history,
            get_home_dir,
            list_remote_dir,
            delete_remote_file,
            rename_remote_file,
            download_remote_file,
            upload_local_file,
            get_file_properties,
            chmod_remote_file,
            get_saved_connections,
            save_connection,
            delete_connection,
            get_groups,
            save_group,
            delete_group,
            get_ui_config,
            save_ui_config,
            get_quick_commands,
            save_quick_commands,
            get_app_settings,
            save_app_settings,
            watcher::start_file_watch,
            watcher::stop_file_watch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

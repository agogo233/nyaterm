use crate::config;
use crate::error::{AppError, AppResult};
use crate::fuzzy::{fuzzy_search_items, FuzzyResult};
use crate::runtime::{self, RecordingManager, SessionCommand, SessionInfo, SessionManager};
use crate::ssh::{self};
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
pub async fn create_ssh_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    connection_id: String,
) -> AppResult<String> {
    let ssh_config = ssh::load_saved_ssh_config(&app, &connection_id)?;

    ssh::create_ssh_session(app, state.inner().clone(), ssh_config, Some(connection_id)).await
}

#[tauri::command]
pub async fn create_local_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<String> {
    runtime::create_local_session(app, state.inner().clone()).await
}

#[tauri::command]
pub async fn write_to_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::Write(data.into_bytes()))
        .await
}

#[tauri::command]
pub async fn resize_session(
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
pub async fn attach_session(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    state
        .send_command(&session_id, SessionCommand::Attach)
        .await
}

#[tauri::command]
pub async fn close_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<()> {
    let session_id_clone = session_id.clone();

    let res = state.send_command(&session_id, SessionCommand::Close).await;

    // Concurrently tidy up any downloaded/watcher temporary files stored in the OS temp directory
    tauri::async_runtime::spawn(async move {
        if let Ok(temp_dir) = app.path().temp_dir() {
            let session_temp_dir = temp_dir.join("dragonfly").join(&session_id_clone);
            if session_temp_dir.exists() {
                if let Err(e) = tokio::fs::remove_dir_all(&session_temp_dir).await {
                    tracing::warn!(
                        "Failed to clean up temp directory {}: {}",
                        session_temp_dir.display(),
                        e
                    );
                } else {
                    tracing::info!(
                        "Successfully cleaned up temp directory for session: {}",
                        session_id_clone
                    );
                }
            }
        }
    });

    res
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<Vec<SessionInfo>> {
    Ok(state.list_sessions().await)
}

#[tauri::command]
pub async fn add_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
    command: String,
) -> AppResult<()> {
    state.add_command(&session_id, command).await;
    Ok(())
}

#[tauri::command]
pub async fn get_command_history(
    state: tauri::State<'_, Arc<SessionManager>>,
) -> AppResult<Vec<String>> {
    Ok(state.get_all_history().await)
}

#[tauri::command]
pub async fn fuzzy_search_history(
    state: tauri::State<'_, Arc<SessionManager>>,
    pattern: String,
    limit: usize,
) -> AppResult<Vec<FuzzyResult>> {
    Ok(state.fuzzy_search(&pattern, limit).await)
}

#[tauri::command]
pub fn fuzzy_search_commands(
    app: tauri::AppHandle,
    pattern: String,
    limit: usize,
) -> AppResult<Vec<FuzzyResult>> {
    let cfg = config::load_quick_commands(&app)?;
    let items: Vec<(String, String)> = cfg
        .commands
        .into_iter()
        .map(|c| (c.label, c.command))
        .collect();
    Ok(fuzzy_search_items(&items, &pattern, "quickCommand", limit))
}

#[tauri::command]
pub async fn start_recording(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
    file_path: String,
) -> AppResult<()> {
    state.start(&session_id, &file_path)
}

#[tauri::command]
pub async fn stop_recording(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
) -> AppResult<String> {
    state.stop(&session_id)
}

#[tauri::command]
pub async fn is_recording(
    state: tauri::State<'_, Arc<RecordingManager>>,
    session_id: String,
) -> AppResult<bool> {
    Ok(state.is_recording(&session_id))
}

#[tauri::command]


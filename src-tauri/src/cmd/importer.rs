use crate::error::AppResult;

#[tauri::command]
pub fn import_sessions(app: tauri::AppHandle, file_path: String) -> AppResult<usize> {
    let count = crate::core::importer::import_sessions(app.clone(), file_path)?;
    tauri::async_runtime::spawn(async move {
        crate::core::cloud_sync::notify_config_changed(&app).await;
    });
    Ok(count)
}

#[tauri::command]
pub fn import_termius_sessions(
    app: tauri::AppHandle,
    indexed_db_path: Option<String>,
) -> AppResult<usize> {
    let count = crate::core::importer::import_termius_sessions(app.clone(), indexed_db_path)?;
    tauri::async_runtime::spawn(async move {
        crate::core::cloud_sync::notify_config_changed(&app).await;
    });
    Ok(count)
}

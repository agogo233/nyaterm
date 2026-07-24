use tauri::ipc::Channel;

use crate::error::AppResult;
use crate::portable_updater::{PortableUpdateInfo, PortableUpdateProgress, PortableUpdateState};

#[tauri::command]
pub async fn check_portable_update(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, crate::runtime::AppRuntime>,
) -> AppResult<Option<PortableUpdateInfo>> {
    crate::portable_updater::check(&app, &runtime).await
}

#[tauri::command]
pub async fn download_portable_update(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, crate::runtime::AppRuntime>,
    state: tauri::State<'_, PortableUpdateState>,
    on_progress: Channel<PortableUpdateProgress>,
) -> AppResult<()> {
    crate::portable_updater::download(&app, &runtime, state, on_progress).await
}

#[tauri::command]
pub fn apply_portable_update(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, crate::runtime::AppRuntime>,
    state: tauri::State<'_, PortableUpdateState>,
) -> AppResult<()> {
    crate::portable_updater::apply(&app, &runtime, state)
}

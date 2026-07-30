use crate::external_open::{ExternalOpenRequest, ExternalOpenState};

#[tauri::command]
pub fn claim_external_open_requests(
    window: tauri::Window,
    state: tauri::State<ExternalOpenState>,
) -> Vec<ExternalOpenRequest> {
    state.claim_for_window(window.label())
}

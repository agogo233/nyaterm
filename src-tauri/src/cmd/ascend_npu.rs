use crate::core::SessionManager;
use crate::core::monitoring::ascend_npu::{
    ASCEND_NPU_OVERVIEW_SCRIPT, RemoteNpuOverview, parse_npu_overview_output,
};
use crate::core::remote_exec::{ensure_success, exec_ssh_session_command};
use crate::error::AppResult;
use std::sync::Arc;
use std::time::Duration;

const ASCEND_NPU_TIMEOUT: Duration = Duration::from_secs(15);

#[tauri::command]
pub async fn get_remote_ascend_npu_overview(
    state: tauri::State<'_, Arc<SessionManager>>,
    session_id: String,
) -> AppResult<RemoteNpuOverview> {
    let output = exec_ssh_session_command(
        state.inner(),
        &session_id,
        ASCEND_NPU_OVERVIEW_SCRIPT.as_bytes(),
        ASCEND_NPU_TIMEOUT,
    )
    .await?;
    let output = ensure_success(output, "Failed to fetch Ascend NPU overview")?;

    Ok(parse_npu_overview_output(&output.stdout))
}

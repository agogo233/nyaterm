use crate::config;
use crate::core::SessionManager;
use crate::core::ai::{
    self, AgentApprovalManager, AiAuditLog, AiChatRequest, AiMessage, AiSession, AiSessionScope,
    AiStreamStart, AppendAiAuditRequest, ClaudeCodeAccountStatus, ClaudeCodeCliStatus,
    ClaudeCodeRuntime, CodexAccountStatus, CodexCliStatus, CodexLoginFlow, CodexLoginStart,
};
use crate::error::AppResult;
use std::sync::Arc;

#[tauri::command]
pub fn start_ai_chat_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<SessionManager>>,
    request: AiChatRequest,
) -> AppResult<AiStreamStart> {
    ai::start_chat_stream(app, state.inner().clone(), request)
}

#[tauri::command]
pub async fn list_ai_model_names(app: tauri::AppHandle) -> AppResult<Vec<ai::AiModelDiscovery>> {
    let mut models = ai::list_model_names(&app).await?;
    let settings = config::load_app_settings(&app)?;
    let manager = ai::manager_from_app(&app).await?;
    models.extend(manager.list_models(&settings.ai).await?);
    Ok(models)
}

#[tauri::command]
pub fn cancel_ai_chat_stream(stream_id: String) -> AppResult<()> {
    ai::cancel_chat_stream(stream_id)
}

#[tauri::command]
pub async fn detect_codex_cli(app: tauri::AppHandle) -> AppResult<CodexCliStatus> {
    let settings = config::load_app_settings(&app)?;
    Ok(ai::CodexAppServerManager::detect_cli(settings.ai.codex.executable_path).await)
}

#[tauri::command]
pub async fn get_codex_account_status(app: tauri::AppHandle) -> AppResult<CodexAccountStatus> {
    let settings = config::load_app_settings(&app)?;
    let manager = ai::manager_from_app(&app).await?;
    manager.account_read(&settings.ai).await
}

#[tauri::command]
pub async fn start_codex_login(
    app: tauri::AppHandle,
    flow: CodexLoginFlow,
) -> AppResult<CodexLoginStart> {
    let settings = config::load_app_settings(&app)?;
    let manager = ai::manager_from_app(&app).await?;
    manager.login_start(&settings.ai, flow).await
}

#[tauri::command]
pub async fn cancel_codex_login(app: tauri::AppHandle, login_id: String) -> AppResult<()> {
    let settings = config::load_app_settings(&app)?;
    let manager = ai::manager_from_app(&app).await?;
    manager.login_cancel(&settings.ai, login_id).await
}

#[tauri::command]
pub async fn logout_codex(app: tauri::AppHandle) -> AppResult<()> {
    let settings = config::load_app_settings(&app)?;
    let manager = ai::manager_from_app(&app).await?;
    manager.logout(&settings.ai).await
}

#[tauri::command]
pub async fn detect_claude_code_cli(app: tauri::AppHandle) -> AppResult<ClaudeCodeCliStatus> {
    let settings = config::load_app_settings(&app)?;
    Ok(ai::ClaudeCodeRuntime::detect_cli(settings.ai.claude_code.executable_path).await)
}

#[tauri::command]
pub async fn get_claude_code_account_status(
    app: tauri::AppHandle,
) -> AppResult<ClaudeCodeAccountStatus> {
    use tauri::Manager;

    let settings = config::load_app_settings(&app)?;
    let runtime = app.state::<Arc<ClaudeCodeRuntime>>().inner().clone();
    runtime.auth_status(&settings.ai).await
}

#[tauri::command]
pub async fn respond_agent_step(
    state: tauri::State<'_, Arc<AgentApprovalManager>>,
    stream_id: String,
    step_index: u16,
    approved: bool,
) -> AppResult<()> {
    let key = format!("{stream_id}-{step_index}");
    state.respond(&key, approved).await;
    Ok(())
}

#[tauri::command]
pub fn get_ai_sessions(app: tauri::AppHandle) -> AppResult<Vec<AiSession>> {
    ai::get_ai_sessions(&app)
}

#[tauri::command]
pub fn get_ai_messages(app: tauri::AppHandle, session_id: String) -> AppResult<Vec<AiMessage>> {
    ai::get_ai_messages(&app, session_id)
}

#[tauri::command]
pub fn clear_ai_history(app: tauri::AppHandle) -> AppResult<()> {
    ai::clear_ai_history(&app)
}

#[tauri::command]
pub fn delete_ai_session(app: tauri::AppHandle, session_id: String) -> AppResult<()> {
    ai::delete_ai_session(&app, session_id)
}

#[tauri::command]
pub fn rebind_ai_session(
    app: tauri::AppHandle,
    session_id: String,
    owner_scope: AiSessionScope,
) -> AppResult<AiSession> {
    ai::rebind_ai_session(&app, session_id, owner_scope)
}

#[tauri::command]
pub fn append_ai_audit(
    app: tauri::AppHandle,
    request: AppendAiAuditRequest,
) -> AppResult<AiAuditLog> {
    ai::append_ai_audit(&app, request)
}

#[tauri::command]
pub fn get_ai_audit_logs(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> AppResult<Vec<AiAuditLog>> {
    ai::get_ai_audit_logs(&app, limit)
}

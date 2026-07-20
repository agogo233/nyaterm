use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{Mutex, RwLock, oneshot};

use crate::config::{AiBackendKind, AiMode, AiModelSource, AiSettings, CodexThreadMode};
use crate::core::SessionManager;
use crate::error::{AppError, AppResult};

use super::agent::{AgentApprovalManager, run_external_agent_command_step};
use super::history::{
    append_message, get_session_backend_metadata, save_user_message, set_session_backend_metadata,
};
use super::model::resolve_request_model_config;
use super::prompt::build_prompt;
use super::redaction::{redact_context, redact_sensitive_text};
use super::stream::{active_streams, emit_stream_event};
use super::types::{
    AiChatRequest, AiMessage, AiMessageRole, AiModelDiscovery, AiSessionBackendMetadata,
    AiStreamEventPayload, CommandObservation, now_rfc3339, uuid,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CodexRuntimeState {
    Stopped,
    Starting,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliStatus {
    pub installed: bool,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountStatus {
    pub connected: bool,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub plan_type: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub requires_openai_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStart {
    pub login_id: Option<String>,
    pub login_type: String,
    #[serde(default)]
    pub auth_url: Option<String>,
    #[serde(default)]
    pub verification_url: Option<String>,
    #[serde(default)]
    pub user_code: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexLoginFlow {
    Browser,
    DeviceCode,
}

pub struct CodexAppServerManager {
    state: RwLock<CodexRuntimeState>,
    writer: Mutex<Option<BufWriter<ChildStdin>>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<AppResult<Value>>>>,
    active_turns: Mutex<HashMap<String, Arc<CodexTurnContext>>>,
    next_request_id: AtomicU64,
    last_account: Mutex<Option<CodexAccountStatus>>,
}

struct CodexTurnContext {
    app: AppHandle,
    session_manager: Arc<SessionManager>,
    approval_manager: Arc<AgentApprovalManager>,
    stream_id: String,
    session_id: String,
    request: AiChatRequest,
    settings: AiSettings,
    step_counter: Mutex<u16>,
    text_accumulator: Mutex<String>,
}

impl CodexAppServerManager {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(CodexRuntimeState::Stopped),
            writer: Mutex::new(None),
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            active_turns: Mutex::new(HashMap::new()),
            next_request_id: AtomicU64::new(1),
            last_account: Mutex::new(None),
        }
    }

    pub async fn detect_cli(path: Option<String>) -> CodexCliStatus {
        let executable = codex_executable(path.as_deref());
        match Command::new(&executable).arg("--version").output().await {
            Ok(output) if output.status.success() => CodexCliStatus {
                installed: true,
                path: Some(executable),
                version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
                error: None,
            },
            Ok(output) => CodexCliStatus {
                installed: false,
                path: Some(executable),
                version: None,
                error: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
            },
            Err(error) => CodexCliStatus {
                installed: false,
                path: Some(executable),
                version: None,
                error: Some(error.to_string()),
            },
        }
    }

    pub async fn ensure_started(self: &Arc<Self>, path: Option<String>) -> AppResult<()> {
        if *self.state.read().await == CodexRuntimeState::Ready {
            return Ok(());
        }

        let mut child_guard = self.child.lock().await;
        if *self.state.read().await == CodexRuntimeState::Ready {
            return Ok(());
        }

        *self.state.write().await = CodexRuntimeState::Starting;
        let executable = codex_executable(path.as_deref());
        let mut child = Command::new(&executable)
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| {
                AppError::Config(format!("Failed to start codex app-server: {error}"))
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Channel("codex stdin unavailable".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Channel("codex stdout unavailable".to_string()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Channel("codex stderr unavailable".to_string()))?;

        *self.writer.lock().await = Some(BufWriter::new(stdin));
        *child_guard = Some(child);

        let reader_manager = self.clone();
        tauri::async_runtime::spawn(async move {
            reader_manager.read_stdout(stdout).await;
        });
        tauri::async_runtime::spawn(async move {
            read_stderr(stderr).await;
        });

        self.request(
            "initialize",
            json!({
                "clientInfo": {
                    "name": "nyaterm",
                    "title": "NyaTerm",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true
                }
            }),
        )
        .await?;
        self.notify("initialized", json!({})).await?;
        *self.state.write().await = CodexRuntimeState::Ready;
        Ok(())
    }

    pub async fn account_read(
        self: &Arc<Self>,
        settings: &AiSettings,
    ) -> AppResult<CodexAccountStatus> {
        self.ensure_started(settings.codex.executable_path.clone())
            .await?;
        let value = self
            .request("account/read", json!({ "refreshToken": false }))
            .await?;
        let status = parse_account_status(&value);
        *self.last_account.lock().await = Some(status.clone());
        Ok(status)
    }

    pub async fn login_start(
        self: &Arc<Self>,
        settings: &AiSettings,
        flow: CodexLoginFlow,
    ) -> AppResult<CodexLoginStart> {
        self.ensure_started(settings.codex.executable_path.clone())
            .await?;
        let params = match flow {
            CodexLoginFlow::Browser => json!({
                "type": "chatgpt",
                "useHostedLoginSuccessPage": true,
                "appBrand": "codex"
            }),
            CodexLoginFlow::DeviceCode => json!({ "type": "chatgptDeviceCode" }),
        };
        let value = self.request("account/login/start", params).await?;
        Ok(CodexLoginStart {
            login_id: value
                .get("loginId")
                .and_then(Value::as_str)
                .map(str::to_string),
            login_type: value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("chatgpt")
                .to_string(),
            auth_url: value
                .get("authUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            verification_url: value
                .get("verificationUrl")
                .and_then(Value::as_str)
                .map(str::to_string),
            user_code: value
                .get("userCode")
                .and_then(Value::as_str)
                .map(str::to_string),
        })
    }

    pub async fn login_cancel(
        self: &Arc<Self>,
        settings: &AiSettings,
        login_id: String,
    ) -> AppResult<()> {
        self.ensure_started(settings.codex.executable_path.clone())
            .await?;
        self.request("account/login/cancel", json!({ "loginId": login_id }))
            .await?;
        Ok(())
    }

    pub async fn logout(self: &Arc<Self>, settings: &AiSettings) -> AppResult<()> {
        self.ensure_started(settings.codex.executable_path.clone())
            .await?;
        self.request("account/logout", json!({})).await?;
        *self.last_account.lock().await = Some(CodexAccountStatus::default());
        Ok(())
    }

    pub async fn list_models(
        self: &Arc<Self>,
        settings: &AiSettings,
    ) -> AppResult<Vec<AiModelDiscovery>> {
        if !settings.codex.enabled {
            return Ok(Vec::new());
        }
        self.ensure_started(settings.codex.executable_path.clone())
            .await?;
        let value = self
            .request("model/list", json!({ "includeHidden": false }))
            .await?;
        let items = value
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(items
            .into_iter()
            .filter_map(|item| {
                let model = item
                    .get("model")
                    .or_else(|| item.get("id"))
                    .and_then(Value::as_str)?;
                Some(AiModelDiscovery {
                    id: format!("codex:{model}"),
                    name: model.to_string(),
                    backend: AiBackendKind::Codex,
                    provider_kind: None,
                    credential_id: None,
                    source: AiModelSource::RustGenai,
                })
            })
            .collect())
    }

    async fn request(&self, method: &str, params: Value) -> AppResult<Value> {
        let id = self.next_request_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        self.write_message(json!({ "method": method, "id": id, "params": params }))
            .await?;
        rx.await
            .map_err(|_| AppError::Channel("codex response channel closed".to_string()))?
    }

    async fn notify(&self, method: &str, params: Value) -> AppResult<()> {
        self.write_message(json!({ "method": method, "params": params }))
            .await
    }

    async fn write_message(&self, value: Value) -> AppResult<()> {
        let mut writer = self.writer.lock().await;
        let Some(writer) = writer.as_mut() else {
            return Err(AppError::Channel(
                "codex app-server is not started".to_string(),
            ));
        };
        let line = serde_json::to_string(&value)?;
        writer.write_all(line.as_bytes()).await?;
        writer.write_all(b"\n").await?;
        writer.flush().await?;
        Ok(())
    }

    async fn read_stdout(self: Arc<Self>, stdout: tokio::process::ChildStdout) {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                tracing::warn!("Ignoring invalid codex app-server JSONL line");
                continue;
            };
            self.handle_message(value).await;
        }
        *self.state.write().await = CodexRuntimeState::Failed;
        let mut pending = self.pending.lock().await;
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(AppError::Channel(
                "codex app-server exited".to_string(),
            )));
        }
    }

    async fn handle_message(&self, value: Value) {
        if let Some(id) = value.get("id").and_then(Value::as_u64) {
            if value.get("method").is_some() {
                self.handle_server_request(id, value).await;
                return;
            }
            let sender = self.pending.lock().await.remove(&id);
            if let Some(sender) = sender {
                let result = if let Some(error) = value.get("error") {
                    let message = error
                        .get("message")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| error.to_string());
                    Err(AppError::Config(format!(
                        "Codex app-server error: {message}"
                    )))
                } else {
                    Ok(value.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = sender.send(result);
            }
            return;
        }

        if let Some(method) = value.get("method").and_then(Value::as_str) {
            self.handle_notification(method, value.get("params").cloned().unwrap_or(Value::Null))
                .await;
        }
    }

    async fn handle_server_request(&self, id: u64, value: Value) {
        let method = value
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let params = value.get("params").cloned().unwrap_or(Value::Null);
        let result = match method.as_str() {
            "item/tool/call" => self.handle_dynamic_tool_call(params).await,
            "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
                Ok(json!({ "decision": "decline" }))
            }
            "item/permissions/requestApproval" => Ok(json!({ "decision": "decline" })),
            "mcpServer/elicitation/request" => Ok(json!({ "action": "decline", "content": null })),
            _ => Ok(json!({})),
        };

        let response = match result {
            Ok(result) => json!({ "id": id, "result": result }),
            Err(error) => json!({
                "id": id,
                "error": { "code": -32000, "message": error.to_string() }
            }),
        };
        let _ = self.write_message(response).await;
    }

    async fn handle_dynamic_tool_call(&self, params: Value) -> AppResult<Value> {
        let turn_id = params
            .get("turnId")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Config("Codex tool call missing turnId".to_string()))?;
        let namespace = params
            .get("namespace")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let tool = params
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if namespace != "nyaterm_terminal" {
            return Ok(dynamic_text(false, "Unsupported dynamic tool namespace"));
        }
        let context = {
            let active = self.active_turns.lock().await;
            active.get(turn_id).cloned()
        }
        .ok_or_else(|| AppError::Config("No active Codex turn for tool call".to_string()))?;

        match tool {
            "get_context" => Ok(dynamic_text(true, &terminal_context_text(&context.request))),
            "execute_command" => {
                let args = params.get("arguments").cloned().unwrap_or(Value::Null);
                let command = args
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| AppError::Config("terminal command is required".to_string()))?
                    .to_string();
                let target = args
                    .get("targetTerminalSessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let reason = args
                    .get("reason")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let step_index = {
                    let mut counter = context.step_counter.lock().await;
                    *counter = counter.saturating_add(1);
                    *counter
                };
                match run_external_agent_command_step(
                    &context.app,
                    context.session_manager.clone(),
                    context.approval_manager.clone(),
                    &context.stream_id,
                    &context.session_id,
                    &context.request,
                    &context.settings,
                    step_index,
                    command,
                    reason,
                    target,
                )
                .await
                {
                    Ok(observation) => Ok(dynamic_text(true, &observation_text(&observation))),
                    Err(error) => Ok(dynamic_text(false, &error.to_string())),
                }
            }
            _ => Ok(dynamic_text(false, "Unsupported dynamic tool")),
        }
    }

    async fn handle_notification(&self, method: &str, params: Value) {
        match method {
            "account/updated" => {
                let status = CodexAccountStatus {
                    connected: params
                        .get("authMode")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty()),
                    auth_mode: params
                        .get("authMode")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    plan_type: params
                        .get("planType")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    email: None,
                    requires_openai_auth: true,
                };
                *self.last_account.lock().await = Some(status);
            }
            "item/agentMessage/delta" => {
                if let Some(turn_id) = params.get("turnId").and_then(Value::as_str) {
                    let context = {
                        let active = self.active_turns.lock().await;
                        active.get(turn_id).cloned()
                    };
                    if let Some(context) = context
                        && let Some(delta) = params.get("delta").and_then(Value::as_str)
                        && !delta.is_empty()
                    {
                        context.text_accumulator.lock().await.push_str(delta);
                        emit_stream_event(
                            &context.app,
                            &context.stream_id,
                            AiStreamEventPayload {
                                event_type: "delta".to_string(),
                                stream_id: context.stream_id.clone(),
                                session_id: Some(context.session_id.clone()),
                                text_delta: Some(delta.to_string()),
                                reasoning_delta: None,
                                message: None,
                                command_cards: vec![],
                                usage: None,
                                error: None,
                            },
                        );
                    }
                }
            }
            "item/reasoning/delta" | "item/reasoning/summaryDelta" => {
                if let Some(turn_id) = params.get("turnId").and_then(Value::as_str) {
                    let context = {
                        let active = self.active_turns.lock().await;
                        active.get(turn_id).cloned()
                    };
                    if let Some(context) = context {
                        let delta = params
                            .get("delta")
                            .or_else(|| params.get("text"))
                            .and_then(Value::as_str)
                            .unwrap_or_default();
                        if !delta.is_empty() {
                            emit_stream_event(
                                &context.app,
                                &context.stream_id,
                                AiStreamEventPayload {
                                    event_type: "reasoning_delta".to_string(),
                                    stream_id: context.stream_id.clone(),
                                    session_id: Some(context.session_id.clone()),
                                    text_delta: None,
                                    reasoning_delta: Some(delta.to_string()),
                                    message: None,
                                    command_cards: vec![],
                                    usage: None,
                                    error: None,
                                },
                            );
                        }
                    }
                }
            }
            "turn/completed" => {
                let turn_id = params
                    .get("turn")
                    .and_then(|turn| turn.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(turn_id) = turn_id {
                    self.complete_turn(&turn_id, params).await;
                }
            }
            "error" => {
                let message = params
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Codex request failed")
                    .to_string();
                let contexts: Vec<Arc<CodexTurnContext>> =
                    self.active_turns.lock().await.values().cloned().collect();
                for context in contexts {
                    emit_stream_event(
                        &context.app,
                        &context.stream_id,
                        AiStreamEventPayload {
                            event_type: "error".to_string(),
                            stream_id: context.stream_id.clone(),
                            session_id: Some(context.session_id.clone()),
                            text_delta: None,
                            reasoning_delta: None,
                            message: None,
                            command_cards: vec![],
                            usage: None,
                            error: Some(message.clone()),
                        },
                    );
                }
            }
            _ => {}
        }
    }

    async fn complete_turn(&self, turn_id: &str, params: Value) {
        let context = self.active_turns.lock().await.remove(turn_id);
        let Some(context) = context else {
            return;
        };
        active_streams().lock().unwrap().remove(&context.stream_id);

        let turn = params.get("turn").cloned().unwrap_or(Value::Null);
        let status = turn.get("status").and_then(Value::as_str).unwrap_or("");
        if status == "failed" {
            let error = turn
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Codex turn failed")
                .to_string();
            emit_stream_event(
                &context.app,
                &context.stream_id,
                AiStreamEventPayload {
                    event_type: "error".to_string(),
                    stream_id: context.stream_id.clone(),
                    session_id: Some(context.session_id.clone()),
                    text_delta: None,
                    reasoning_delta: None,
                    message: None,
                    command_cards: vec![],
                    usage: None,
                    error: Some(error),
                },
            );
            return;
        }

        let content = {
            let final_text = final_agent_text(&turn);
            if final_text.is_empty() {
                context.text_accumulator.lock().await.clone()
            } else {
                final_text
            }
        };
        let message = AiMessage {
            id: format!("msg-{}", uuid()),
            session_id: context.session_id.clone(),
            role: AiMessageRole::Assistant,
            content,
            created_at: now_rfc3339(),
            reasoning_content: None,
            command_cards: vec![],
        };
        if context.settings.record_history {
            let _ = append_message(&context.app, message.clone());
        }
        emit_stream_event(
            &context.app,
            &context.stream_id,
            AiStreamEventPayload {
                event_type: "done".to_string(),
                stream_id: context.stream_id.clone(),
                session_id: Some(context.session_id.clone()),
                text_delta: None,
                reasoning_delta: None,
                message: Some(message),
                command_cards: vec![],
                usage: turn.get("usage").cloned(),
                error: None,
            },
        );
    }
}

pub async fn run_codex_stream(
    app: AppHandle,
    session_manager: Arc<SessionManager>,
    approval_manager: Arc<AgentApprovalManager>,
    manager: Arc<CodexAppServerManager>,
    stream_id: String,
    session_id: String,
    mut request: AiChatRequest,
    settings: AiSettings,
    mut cancel_rx: oneshot::Receiver<()>,
) {
    let result = run_codex_stream_inner(
        app.clone(),
        session_manager,
        approval_manager,
        manager.clone(),
        stream_id.clone(),
        session_id.clone(),
        &mut request,
        settings,
        &mut cancel_rx,
    )
    .await;

    if let Err(error) = result {
        active_streams().lock().unwrap().remove(&stream_id);
        emit_stream_event(
            &app,
            &stream_id,
            AiStreamEventPayload {
                event_type: "error".to_string(),
                stream_id: stream_id.clone(),
                session_id: Some(session_id),
                text_delta: None,
                reasoning_delta: None,
                message: None,
                command_cards: vec![],
                usage: None,
                error: Some(error.to_string()),
            },
        );
    }
}

async fn run_codex_stream_inner(
    app: AppHandle,
    session_manager: Arc<SessionManager>,
    approval_manager: Arc<AgentApprovalManager>,
    manager: Arc<CodexAppServerManager>,
    stream_id: String,
    session_id: String,
    request: &mut AiChatRequest,
    settings: AiSettings,
    cancel_rx: &mut oneshot::Receiver<()>,
) -> AppResult<()> {
    let selected_model = resolve_request_model_config(&settings, request)?;
    if selected_model.backend != AiBackendKind::Codex {
        return Err(AppError::Config(
            "Selected model is not a Codex model".to_string(),
        ));
    }
    if !settings.codex.enabled {
        return Err(AppError::Config(
            "Codex integration is disabled".to_string(),
        ));
    }

    manager
        .ensure_started(settings.codex.executable_path.clone())
        .await?;

    emit_stream_event(
        &app,
        &stream_id,
        AiStreamEventPayload {
            event_type: "start".to_string(),
            stream_id: stream_id.clone(),
            session_id: Some(session_id.clone()),
            text_delta: None,
            reasoning_delta: None,
            message: None,
            command_cards: vec![],
            usage: None,
            error: None,
        },
    );

    if settings.redaction_enabled {
        redact_context(&mut request.context);
        request.user_input = redact_sensitive_text(&request.user_input);
    }
    if settings.record_history {
        save_user_message(&app, &session_id, request)?;
    }

    let thread_id = get_session_backend_metadata(&app, &session_id)?
        .filter(|metadata| metadata.backend == AiBackendKind::Codex)
        .and_then(|metadata| metadata.external_thread_id);

    let thread_id = if let Some(thread_id) = thread_id {
        manager
            .request("thread/resume", json!({ "threadId": thread_id }))
            .await?;
        thread_id
    } else {
        let params = json!({
            "model": selected_model.name,
            "cwd": null,
            "ephemeral": settings.codex.thread_mode == CodexThreadMode::Ephemeral,
            "approvalPolicy": {
                "granular": {
                    "rules": false,
                    "mcp_elicitations": false,
                    "request_permissions": false,
                    "sandbox_approval": false
                }
            },
            "approvalsReviewer": "user",
            "sandbox": "read-only",
            "dynamicTools": if request.mode == AiMode::Agent && settings.codex.remote_terminal_agent_enabled {
                json!([terminal_tool_namespace()])
            } else {
                Value::Null
            }
        });
        let response = manager.request("thread/start", params).await?;
        let new_thread_id = response
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .and_then(Value::as_str)
            .or_else(|| response.get("id").and_then(Value::as_str))
            .ok_or_else(|| {
                AppError::Config("Codex thread/start returned no thread id".to_string())
            })?
            .to_string();
        set_session_backend_metadata(
            &app,
            &session_id,
            AiSessionBackendMetadata {
                backend: AiBackendKind::Codex,
                external_thread_id: Some(new_thread_id.clone()),
            },
        )?;
        new_thread_id
    };

    let prompt = build_prompt(request, &settings);
    let response = manager
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "clientUserMessageId": format!("msg-{}", uuid()),
                "input": [{ "type": "text", "text": prompt }],
                "model": selected_model.name,
            }),
        )
        .await?;
    let turn_id = response
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Config("Codex turn/start returned no turn id".to_string()))?
        .to_string();

    manager.active_turns.lock().await.insert(
        turn_id.clone(),
        Arc::new(CodexTurnContext {
            app,
            session_manager,
            approval_manager,
            stream_id: stream_id.clone(),
            session_id,
            request: request.clone(),
            settings,
            step_counter: Mutex::new(0),
            text_accumulator: Mutex::new(String::new()),
        }),
    );

    tokio::select! {
        _ = cancel_rx => {
            let _ = manager
                .request(
                    "turn/interrupt",
                    json!({ "threadId": thread_id.clone(), "turnId": turn_id.clone() }),
                )
                .await;
            manager.active_turns.lock().await.remove(&turn_id);
            Err(AppError::Cancelled("AI stream cancelled".to_string()))
        }
        _ = wait_until_turn_removed(manager.clone(), turn_id.clone()) => Ok(())
    }
}

async fn wait_until_turn_removed(manager: Arc<CodexAppServerManager>, turn_id: String) {
    loop {
        if !manager.active_turns.lock().await.contains_key(&turn_id) {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

fn codex_executable(path: Option<&str>) -> String {
    path.map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("codex")
        .to_string()
}

fn parse_account_status(value: &Value) -> CodexAccountStatus {
    let account = value.get("account").unwrap_or(&Value::Null);
    let auth_mode = account
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string);
    CodexAccountStatus {
        connected: auth_mode.is_some(),
        auth_mode,
        plan_type: account
            .get("planType")
            .and_then(Value::as_str)
            .map(str::to_string),
        email: account
            .get("email")
            .and_then(Value::as_str)
            .map(str::to_string),
        requires_openai_auth: value
            .get("requiresOpenaiAuth")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn terminal_tool_namespace() -> Value {
    json!({
        "type": "namespace",
        "name": "nyaterm_terminal",
        "description": "Operate the active NyaTerm terminal sessions. Use these tools instead of local shell or file tools when working with remote terminals.",
        "tools": [
            {
                "type": "function",
                "name": "get_context",
                "description": "Read the available NyaTerm terminal targets and recent terminal context.",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "type": "function",
                "name": "execute_command",
                "description": "Execute a shell command in a NyaTerm terminal session after NyaTerm approval policy is applied.",
                "inputSchema": {
                    "type": "object",
                    "required": ["targetTerminalSessionId", "command"],
                    "properties": {
                        "targetTerminalSessionId": { "type": "string" },
                        "command": { "type": "string" },
                        "reason": { "type": "string" }
                    }
                }
            }
        ]
    })
}

fn terminal_context_text(request: &AiChatRequest) -> String {
    serde_json::to_string_pretty(&json!({
        "primaryContext": request.context,
        "targets": request.targets,
        "targetContexts": request.target_contexts,
        "instruction": "Use nyaterm_terminal.execute_command for remote terminal actions. Do not use local shell/file tools for the user's remote terminal."
    }))
    .unwrap_or_else(|_| "Terminal context unavailable".to_string())
}

fn observation_text(observation: &CommandObservation) -> String {
    serde_json::to_string_pretty(observation).unwrap_or_else(|_| observation.output.clone())
}

fn dynamic_text(success: bool, text: &str) -> Value {
    json!({
        "success": success,
        "contentItems": [{ "type": "inputText", "text": text }]
    })
}

fn final_agent_text(turn: &Value) -> String {
    turn.get("items")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().rev().find_map(|item| {
                if item.get("type").and_then(Value::as_str) != Some("agentMessage") {
                    return None;
                }
                item.get("text").and_then(Value::as_str).map(str::to_string)
            })
        })
        .unwrap_or_default()
}

async fn read_stderr(stderr: tokio::process::ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let sanitized = sanitize_codex_log_line(&line);
        if !sanitized.trim().is_empty() {
            tracing::debug!(target: "codex_app_server", message = %sanitized);
        }
    }
}

fn sanitize_codex_log_line(line: &str) -> String {
    let mut sanitized = line.to_string();
    for marker in ["access_token=", "refresh_token=", "id_token=", "code="] {
        while let Some(index) = sanitized.find(marker) {
            let start = index + marker.len();
            let end = sanitized[start..]
                .find(['&', ' ', '"'])
                .map(|offset| start + offset)
                .unwrap_or(sanitized.len());
            sanitized.replace_range(start..end, "[redacted]");
        }
    }
    sanitized
}

pub async fn manager_from_app(app: &AppHandle) -> AppResult<Arc<CodexAppServerManager>> {
    Ok(app.state::<Arc<CodexAppServerManager>>().inner().clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_codex_auth_material_from_logs() {
        let line =
            r#"login access_token=abc123 refresh_token=def456 id_token=ghi789 code=xyz&state=ok"#;

        let sanitized = sanitize_codex_log_line(line);

        assert!(!sanitized.contains("abc123"));
        assert!(!sanitized.contains("def456"));
        assert!(!sanitized.contains("ghi789"));
        assert!(!sanitized.contains("code=xyz"));
        assert!(sanitized.contains("access_token=[redacted]"));
        assert!(sanitized.contains("refresh_token=[redacted]"));
        assert!(sanitized.contains("id_token=[redacted]"));
        assert!(sanitized.contains("code=[redacted]"));
    }

    #[test]
    fn extracts_final_agent_text_from_turn_items() {
        let turn = json!({
            "items": [
                { "type": "reasoning", "text": "thinking" },
                { "type": "agentMessage", "text": "first" },
                { "type": "agentMessage", "text": "final" }
            ]
        });

        assert_eq!(final_agent_text(&turn), "final");
    }
}

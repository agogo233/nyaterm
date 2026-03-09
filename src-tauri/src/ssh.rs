//! SSH session creation, TOFU known_hosts verification, and I/O loop.
//!
//! Uses russh for connection/auth and emits terminal output via Tauri events.

use crate::error::{AppError, AppResult};
use crate::session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
use russh::client;
use russh::keys::PublicKeyBase64;
use russh::ChannelMsg;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;

/// Extracts the path from an OSC 7 sequence.
/// Shell emits: `\x1b]7;file://hostname/path\x07` (or ST `\x1b\\` terminator).
fn parse_osc7(text: &str) -> Option<String> {
    let start = text.find("\x1b]7;")?;
    let rest = &text[start + 4..];
    // Terminated by BEL (\x07) or ST (\x1b\)
    let end = rest.find('\x07').or_else(|| rest.find("\x1b\\"))?;
    let payload = &rest[..end];
    let after_scheme = payload.strip_prefix("file://")?;
    let path = if after_scheme.starts_with('/') {
        after_scheme.to_string()
    } else {
        let slash = after_scheme.find('/')?;
        after_scheme[slash..].to_string()
    };
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Connection parameters for SSH (host, port, user, auth method).
#[derive(Debug, Clone, Deserialize)]
pub struct SshConfig {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

/// Authentication method: password or key (with optional passphrase).
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type")]
pub enum SshAuth {
    #[serde(rename = "password")]
    Password { password: String },
    #[serde(rename = "key")]
    Key {
        key_data: String,
        passphrase: Option<String>,
    },
}

/// russh client handler; performs TOFU known_hosts verification.
pub(crate) struct SshHandler {
    app: AppHandle,
    host: String,
    port: u16,
}

impl SshHandler {
    pub fn new(app: AppHandle, host: String, port: u16) -> Self {
        Self { app, host, port }
    }

    fn get_known_hosts_path(&self) -> Option<std::path::PathBuf> {
        self.app
            .path()
            .home_dir()
            .ok()
            .map(|h: std::path::PathBuf| h.join(".dragonfly").join("known_hosts"))
    }
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let path = match self.get_known_hosts_path() {
            Some(p) => p,
            None => return Ok(false),
        };

        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let key_type = server_public_key.algorithm().to_string();
        let key_base64 = server_public_key.public_key_base64();
        let fingerprint = server_public_key.fingerprint(Default::default());

        let host_identifier = if self.port != 22 {
            format!("[{}]:{}", self.host, self.port)
        } else {
            self.host.clone()
        };

        let host_entry = format!("{} {} {}", host_identifier, key_type, key_base64);

        let content = std::fs::read_to_string(&path).unwrap_or_default();

        for line in content.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 && parts[0] == host_identifier {
                if parts[1] == key_type && parts[2] == key_base64 {
                    return Ok(true);
                }
                // Host key mismatch — potential MITM
                let _ = self.app.emit(
                    "ssh-error",
                    format!(
                        "SECURITY ALERT: Host key for {}:{} has changed! New fingerprint: {}",
                        self.host, self.port, fingerprint
                    ),
                );
                return Ok(false);
            }
        }

        // TOFU: trust on first use — add new host key
        use std::io::Write;
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            if let Err(e) = writeln!(file, "{}", host_entry) {
                let _ = self
                    .app
                    .emit("ssh-error", format!("Failed to save known_hosts: {}", e));
                return Ok(false);
            }
        }

        Ok(true)
    }
}

pub async fn connect_with_proxy(
    app: &AppHandle,
    config: &SshConfig,
    ssh_config: Arc<client::Config>,
    handler: SshHandler,
) -> AppResult<client::Handle<SshHandler>> {
    let mut proxy_settings = None;
    if let Ok(app_settings) = crate::config::load_app_settings(app) {
        if app_settings.proxy.enabled {
            proxy_settings = Some(app_settings.proxy);
        }
    }

    let target = (config.host.as_str(), config.port);
    let handle = if let Some(proxy) = proxy_settings {
        let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
        match proxy.protocol.as_str() {
            "socks5" => {
                let stream = tokio_socks::tcp::Socks5Stream::connect(proxy_addr.as_str(), target)
                    .await
                    .map_err(|e| {
                        AppError::Auth(format!("SOCKS5 proxy connection failed: {}", e))
                    })?;
                client::connect_stream(ssh_config, stream.into_inner(), handler).await
            }
            "http" => {
                let mut stream = tokio::net::TcpStream::connect(&proxy_addr)
                    .await
                    .map_err(|e| AppError::Auth(format!("HTTP proxy connection failed: {}", e)))?;
                async_http_proxy::http_connect_tokio(&mut stream, &config.host, config.port)
                    .await
                    .map_err(|e| AppError::Auth(format!("HTTP proxy tunnel failed: {}", e)))?;
                client::connect_stream(ssh_config, stream, handler).await
            }
            _ => client::connect(ssh_config, target, handler).await,
        }
    } else {
        client::connect(ssh_config, target, handler).await
    }
    .map_err(|e| AppError::Auth(format!("SSH connection failed: {}", e)))?;

    Ok(handle)
}

/// Connects via SSH, opens a PTY shell, and spawns the I/O loop.
pub async fn create_ssh_session(
    app: AppHandle,
    manager: Arc<SessionManager>,
    config: SshConfig,
) -> AppResult<String> {
    tracing::info!(host = %config.host, port = config.port, user = %config.username, "Creating SSH session");
    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

    let mut ssh_config_obj = client::Config {
        window_size: 32 * 1024 * 1024,
        maximum_packet_size: 32 * 1024,
        nodelay: true,
        ..Default::default()
    };
    if let Ok(app_settings) = crate::config::load_app_settings(&app) {
        let interval = app_settings.terminal.keep_alive_interval;
        if interval > 0 {
            ssh_config_obj.keepalive_interval =
                Some(std::time::Duration::from_secs(interval as u64));
        }
    }
    let ssh_config = Arc::new(ssh_config_obj);
    let handler = SshHandler::new(app.clone(), config.host.clone(), config.port);

    let mut handle = connect_with_proxy(&app, &config, ssh_config, handler).await?;

    match &config.auth {
        SshAuth::Password { password } => {
            let authenticated = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err(|e| AppError::Auth(format!("Authentication failed: {}", e)))?;
            if !authenticated.success() {
                return Err(AppError::Auth(
                    "Authentication failed: invalid credentials".to_string(),
                ));
            }
        }
        SshAuth::Key {
            key_data,
            passphrase,
        } => {
            let key = russh::keys::decode_secret_key(key_data, passphrase.as_deref())?;
            let hash_alg = handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let authenticated = handle
                .authenticate_publickey(
                    &config.username,
                    russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
                )
                .await
                .map_err(|e| AppError::Auth(format!("Key authentication failed: {}", e)))?;
            if !authenticated.success() {
                return Err(AppError::Auth(
                    "Authentication failed: key rejected".to_string(),
                ));
            }
        }
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Channel(format!("Failed to open channel: {}", e)))?;

    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| AppError::Channel(format!("PTY request failed: {}", e)))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| AppError::Channel(format!("Shell request failed: {}", e)))?;

    // Detect remote shell type to inject correct OSC 7 integration script
    let shell_type = {
        let mut shell = "sh".to_string();
        if let Ok(mut exec_ch) = handle.channel_open_session().await {
            if exec_ch.exec(true, "echo $SHELL").await.is_ok() {
                let mut out = String::new();
                while let Some(msg) = exec_ch.wait().await {
                    if let ChannelMsg::Data { ref data } = msg {
                        out.push_str(&String::from_utf8_lossy(data));
                    }
                }
                let s = out.trim().to_lowercase();
                if s.contains("fish") {
                    shell = "fish".to_string();
                } else if s.contains("zsh") {
                    shell = "zsh".to_string();
                } else if s.contains("bash") {
                    shell = "bash".to_string();
                }
            }
        }
        shell
    };

    // Inject OSC 7 integration scripts; the I/O loop discards all output until
    // the DflyReady marker is seen, so the injection is invisible to the user.
    let inject_sh = " if [ -z \"$DFLY_INJ\" ]; then export DFLY_INJ=1; __dfc() { printf \"\\033]7;file://%s%s\\007\" \"$HOSTNAME\" \"$PWD\"; }; [ -n \"$BASH_VERSION\" ] && PROMPT_COMMAND=\"__dfc; $PROMPT_COMMAND\"; [ -n \"$ZSH_VERSION\" ] && precmd_functions+=(__dfc); fi; if [ -n \"$BASH_VERSION\" ]; then __df_hl=$(HISTTIMEFORMAT= builtin history 1); if [ \"${__df_hl#*DFLY_INJ}\" != \"$__df_hl\" ]; then __df_hn=$(echo \"$__df_hl\" | awk '{print $1}'); if [ -n \"$__df_hn\" ]; then builtin history -d \"$__df_hn\" >/dev/null 2>&1 || true; fi; fi; unset __df_hl __df_hn; fi; printf '\\033]7777;DflyReady\\007'\n";
    let inject_fish = " if not set -q DFLY_INJ; set -gx DFLY_INJ 1; function __dfc_hook --on-event fish_prompt; printf \"\\033]7;file://%s%s\\007\" (hostname) $PWD; end; end; printf '\\033]7777;DflyReady\\007'\n";
    let inject_cmd = if shell_type == "fish" {
        inject_fish
    } else {
        inject_sh
    };
    let _ = channel.data(inject_cmd.as_bytes()).await;

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: config.name.clone(),
        session_type: SessionType::SSH,
        connected: true,
    };

    let cwd: SharedCwd = Arc::new(tokio::sync::Mutex::new(None));
    let ssh_config_arc: Arc<dyn std::any::Any + Send + Sync> = Arc::new(config.clone());
    let handle_arc = Arc::new(handle);
    let ssh_handle_arc: Arc<dyn std::any::Any + Send + Sync> = handle_arc.clone();

    let session_handle = SessionHandle {
        info: session_info,
        cmd_tx,
        ssh_config: Some(ssh_config_arc),
        ssh_handle: Some(ssh_handle_arc),
        cwd: cwd.clone(),
    };
    manager.add_session(session_handle).await;

    let sid = session_id.clone();
    let mgr = manager.clone();
    tokio::spawn(async move {
        ssh_io_loop(app, sid, mgr, channel, handle_arc, cmd_rx, cwd).await;
    });

    tracing::info!(session_id = %session_id, "SSH session created");
    Ok(session_id)
}

async fn ssh_io_loop(
    app: AppHandle,
    session_id: String,
    manager: Arc<SessionManager>,
    mut channel: russh::Channel<client::Msg>,
    _handle: Arc<client::Handle<SshHandler>>,
    mut cmd_rx: mpsc::UnboundedReceiver<SessionCommand>,
    cwd: SharedCwd,
) {
    const READY_MARKER: &str = "\x1b]7777;DflyReady\x07";

    let output_event = format!("terminal-output-{}", session_id);
    let cwd_event = format!("cwd-changed-{}", session_id);
    let closed_event = format!("session-closed-{}", session_id);

    let mut attached = false;
    let mut buffer: Vec<String> = Vec::new();
    let mut injecting = true;
    let mut leftover = String::new();

    loop {
        tokio::select! {
            biased;

            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Attach) => {
                        attached = true;
                        for text in buffer.drain(..) {
                            let _ = app.emit(&output_event, &text);
                        }
                    }
                    Some(SessionCommand::Write(data)) => {
                        let _ = channel.data(&data[..]).await;
                    }
                    Some(SessionCommand::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(SessionCommand::Close) | None => {
                        let _ = channel.close().await;
                        break;
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let text = String::from_utf8_lossy(data).to_string();

                        let text = if injecting {
                            leftover.push_str(&text);
                            if let Some(pos) = leftover.find(READY_MARKER) {
                                injecting = false;
                                let after = leftover[pos + READY_MARKER.len()..].to_string();
                                leftover.clear();
                                after
                            } else {
                                continue;
                            }
                        } else {
                            text
                        };

                        if text.is_empty() {
                            continue;
                        }

                        if let Some(path) = parse_osc7(&text) {
                            *cwd.lock().await = Some(path.clone());
                            let _ = app.emit(&cwd_event, &path);
                        }
                        if attached {
                            let _ = app.emit(&output_event, &text);
                        } else {
                            buffer.push(text);
                        }
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        let text = String::from_utf8_lossy(data).to_string();
                        if attached {
                            let _ = app.emit(&output_event, &text);
                        } else {
                            buffer.push(text);
                        }
                    }
                    Some(ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }

    manager.remove_session(&session_id).await;
    tracing::info!(session_id = %session_id, "SSH session closed");
    let _ = app.emit(&closed_event, ());
}

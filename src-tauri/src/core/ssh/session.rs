use super::auth::{authenticate_handle, load_saved_ssh_config};
use super::client::{
    SshConfig, SshConnectionHandles, SshHandle, SshHandler, SshRawHandle, SshStartupCommand,
    build_client_config, connect_via_stream, connect_with_proxy,
};
use super::io::{open_shell_channel, ssh_io_loop};
use crate::config::AiExecutionProfile;
use crate::core::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
use crate::error::{AppError, AppResult};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, oneshot};

async fn create_authenticated_connection(
    app: &AppHandle,
    config: &SshConfig,
) -> AppResult<(
    SshHandle,
    Option<mpsc::UnboundedReceiver<super::x11_forwarding::X11ChannelOpen>>,
)> {
    let ssh_client_config = Arc::new(build_client_config(app));
    let (x11_tx, x11_rx) = if config.x11_forwarding {
        let (tx, rx) = mpsc::unbounded_channel();
        (Some(tx), Some(rx))
    } else {
        (None, None)
    };

    if let Some(jump_config) = config.proxy_jump.as_deref() {
        tracing::info!(
            jump_host = %jump_config.host,
            jump_port = jump_config.port,
            target_host = %config.host,
            target_port = config.port,
            "Creating SSH connection via ProxyJump"
        );

        let jump_handler = SshHandler::new(
            app.clone(),
            jump_config.host.clone(),
            jump_config.port,
            config.owner_window_label.clone(),
        );
        let mut jump_handle =
            connect_with_proxy(jump_config, ssh_client_config.clone(), jump_handler).await?;
        let jump_password_error =
            "Authentication failed for jump host: invalid credentials".to_string();
        let jump_key_error = "Authentication failed for jump host: key rejected".to_string();
        authenticate_handle(
            &mut jump_handle,
            jump_config,
            app,
            &jump_password_error,
            &jump_key_error,
        )
        .await?;
        tracing::info!(
            jump_host = %jump_config.host,
            jump_port = jump_config.port,
            "ProxyJump host authenticated"
        );

        let channel = jump_handle
            .channel_open_direct_tcpip(&config.host, config.port.into(), "127.0.0.1", 0)
            .await
            .map_err(|error| {
                AppError::Channel(format!("Failed to open ProxyJump channel: {}", error))
            })?;
        tracing::info!(
            jump_host = %jump_config.host,
            jump_port = jump_config.port,
            target_host = %config.host,
            target_port = config.port,
            "ProxyJump direct-tcpip channel opened"
        );

        let mut target_handler = SshHandler::new(
            app.clone(),
            config.host.clone(),
            config.port,
            config.owner_window_label.clone(),
        );
        if let Some(tx) = x11_tx.clone() {
            target_handler = target_handler.with_x11_sender(tx);
        }
        let mut target_handle =
            connect_via_stream(channel.into_stream(), ssh_client_config, target_handler).await?;
        authenticate_handle(
            &mut target_handle,
            config,
            app,
            "Authentication failed: invalid credentials",
            "Authentication failed: key rejected",
        )
        .await?;
        tracing::info!(
            host = %config.host,
            port = config.port,
            "Target host authenticated via ProxyJump"
        );

        let target_handle: SshRawHandle = Arc::new(tokio::sync::Mutex::new(target_handle));
        let jump_handle: SshRawHandle = Arc::new(tokio::sync::Mutex::new(jump_handle));
        return Ok((
            Arc::new(SshConnectionHandles::new(target_handle, Some(jump_handle))),
            x11_rx,
        ));
    }

    let mut handler = SshHandler::new(
        app.clone(),
        config.host.clone(),
        config.port,
        config.owner_window_label.clone(),
    );
    if let Some(tx) = x11_tx {
        handler = handler.with_x11_sender(tx);
    }
    let mut handle = connect_with_proxy(config, ssh_client_config, handler).await?;
    authenticate_handle(
        &mut handle,
        config,
        app,
        "Authentication failed: invalid credentials",
        "Authentication failed: key rejected",
    )
    .await?;
    tracing::info!(
        host = %config.host,
        port = config.port,
        "Target host authenticated"
    );

    let handle: SshRawHandle = Arc::new(tokio::sync::Mutex::new(handle));
    Ok((Arc::new(SshConnectionHandles::new(handle, None)), x11_rx))
}

fn set_owner_window_label(config: &mut SshConfig, owner_window_label: Option<String>) {
    config.owner_window_label = owner_window_label.clone();
    if let Some(proxy_jump) = config.proxy_jump.as_mut() {
        set_owner_window_label(proxy_jump, owner_window_label);
    }
}

/// Creates an authenticated SSH handle for a saved connection without opening a PTY/shell.
/// Used by tunnels to establish their own independent SSH connections.
pub async fn create_ssh_handle(app: &AppHandle, connection_id: &str) -> AppResult<SshHandle> {
    let ssh_config = load_saved_ssh_config(app, connection_id)?;
    let (handle, _x11_rx) = create_authenticated_connection(app, &ssh_config).await?;

    tracing::info!(
        host = %ssh_config.host,
        port = ssh_config.port,
        "Tunnel SSH handle created"
    );

    Ok(handle)
}

/// Connects via SSH, opens a PTY shell, and spawns the I/O loop.
pub async fn create_ssh_session(
    app: AppHandle,
    manager: Arc<SessionManager>,
    config: SshConfig,
    connection_id: Option<String>,
    owner_window_label: Option<String>,
    cancel_rx: Option<oneshot::Receiver<()>>,
    startup_command: Option<SshStartupCommand>,
) -> AppResult<String> {
    if let Some(mut cancel_rx) = cancel_rx {
        return tokio::select! {
            result = create_ssh_session_inner(app, manager, config, connection_id, owner_window_label, startup_command) => result,
            _ = &mut cancel_rx => Err(AppError::Cancelled("Session creation cancelled".to_string())),
        };
    }

    create_ssh_session_inner(
        app,
        manager,
        config,
        connection_id,
        owner_window_label,
        startup_command,
    )
    .await
}

async fn create_ssh_session_inner(
    app: AppHandle,
    manager: Arc<SessionManager>,
    mut config: SshConfig,
    connection_id: Option<String>,
    owner_window_label: Option<String>,
    startup_command: Option<SshStartupCommand>,
) -> AppResult<String> {
    set_owner_window_label(&mut config, owner_window_label.clone());
    tracing::info!(
        host = %config.host,
        port = config.port,
        user = %config.username,
        "Creating SSH session"
    );

    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

    let x11_config = if config.x11_forwarding {
        Some(super::x11_forwarding::prepare_x11_forwarding(&config.x11_display).await)
    } else {
        None
    };
    let (ssh_connection, x11_rx) = create_authenticated_connection(&app, &config).await?;
    let handle_mtx = ssh_connection.target_handle();
    let mut handle = handle_mtx.lock().await;

    let (channel, injection_script, ready_marker, initial_notice) = open_shell_channel(
        &mut handle,
        &session_id,
        x11_config.as_ref().map(|cfg| cfg.fake_cookie_hex.as_str()),
    )
    .await?;
    drop(handle);
    let injection_active = injection_script.is_some();

    if let (Some(rx), Some(x11_config)) = (x11_rx, x11_config) {
        super::x11_forwarding::spawn_x11_forwarder(app.clone(), session_id.clone(), rx, x11_config);
    }

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: config.name.clone(),
        session_type: SessionType::SSH,
        connected: true,
        owner_window_label,
        ai_execution_profile: AiExecutionProfile::Posix,
        injection_active,
    };

    let cwd: SharedCwd = Arc::new(tokio::sync::Mutex::new(None));
    let ssh_config_arc: Arc<dyn std::any::Any + Send + Sync> = Arc::new(config.clone());
    let ssh_handle_arc: Arc<dyn std::any::Any + Send + Sync> = ssh_connection.clone();

    let session_handle = SessionHandle {
        info: session_info,
        cmd_tx,
        ssh_config: Some(ssh_config_arc),
        ssh_handle: Some(ssh_handle_arc),
        cwd: cwd.clone(),
        remote_fs: None,
    };
    manager.add_session(session_handle).await;

    if let Some(ref conn_id) = connection_id {
        if let Some(tunnel_mgr) = app.try_state::<Arc<super::TunnelManager>>() {
            let tunnel_manager = tunnel_mgr.inner().clone();
            let connection_id = conn_id.clone();
            let app_handle = app.clone();
            tokio::spawn(async move {
                tunnel_manager
                    .auto_open_for_connection(&app_handle, &connection_id)
                    .await;
            });
        }
    }

    let io_session_id = session_id.clone();
    let io_manager = manager.clone();
    let io_handle = ssh_connection.clone();
    let io_connection_id = connection_id.clone();
    let post_login = config.post_login.clone();
    let startup_command = startup_command.clone();
    let backspace_mode = config.backspace_mode.clone();
    tokio::spawn(async move {
        ssh_io_loop(
            app,
            io_session_id,
            io_manager,
            channel,
            io_handle,
            cmd_rx,
            cwd,
            io_connection_id,
            injection_script,
            ready_marker,
            post_login,
            startup_command,
            backspace_mode,
            initial_notice,
        )
        .await;
    });

    tracing::info!(session_id = %session_id, "SSH session created");
    Ok(session_id)
}

/// Opens a new PTY shell channel on an existing authenticated SSH connection.
pub async fn create_multiplexed_ssh_session(
    app: AppHandle,
    manager: Arc<SessionManager>,
    source_session_id: &str,
    startup_command: Option<SshStartupCommand>,
) -> AppResult<String> {
    let (config, ssh_connection, owner_window_label) = {
        let sessions = manager.sessions.lock().await;
        let source = sessions.get(source_session_id).ok_or_else(|| {
            AppError::SessionNotFound(format!("Session '{}' not found", source_session_id))
        })?;

        if source.info.session_type != SessionType::SSH {
            return Err(AppError::Config(
                "Source session is not an SSH session".to_string(),
            ));
        }

        let config = source
            .ssh_config
            .as_ref()
            .and_then(|cfg| cfg.downcast_ref::<SshConfig>())
            .cloned()
            .ok_or_else(|| AppError::Config("Failed to get SSH config".to_string()))?;

        let ssh_connection = source
            .ssh_handle
            .as_ref()
            .ok_or_else(|| AppError::Config("Source session has no SSH handle".to_string()))?
            .clone()
            .downcast::<SshConnectionHandles>()
            .map_err(|_| AppError::Config("Failed to get SSH handle".to_string()))?;

        (
            config,
            ssh_connection,
            source.info.owner_window_label.clone(),
        )
    };

    tracing::info!(
        source_session_id,
        host = %config.host,
        port = config.port,
        user = %config.username,
        "Creating multiplexed SSH session"
    );

    let session_id = uuid::Uuid::new_v4().to_string();
    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();

    if config.x11_forwarding {
        let connection_id = config.connection_id.clone().ok_or_else(|| {
            AppError::Config("X11 forwarding requires a saved SSH connection".to_string())
        })?;
        return create_ssh_session(
            app,
            manager,
            config,
            Some(connection_id),
            owner_window_label,
            None,
            startup_command,
        )
        .await;
    }

    let handle_mtx = ssh_connection.target_handle();
    let mut handle = handle_mtx.lock().await;
    let (channel, injection_script, ready_marker, initial_notice) =
        open_shell_channel(&mut handle, &session_id, None).await?;
    drop(handle);
    let injection_active = injection_script.is_some();

    let session_info = SessionInfo {
        id: session_id.clone(),
        name: config.name.clone(),
        session_type: SessionType::SSH,
        connected: true,
        owner_window_label,
        ai_execution_profile: AiExecutionProfile::Posix,
        injection_active,
    };

    let cwd: SharedCwd = Arc::new(tokio::sync::Mutex::new(None));
    let ssh_config_arc: Arc<dyn std::any::Any + Send + Sync> = Arc::new(config.clone());
    let ssh_handle_arc: Arc<dyn std::any::Any + Send + Sync> = ssh_connection.clone();

    let session_handle = SessionHandle {
        info: session_info,
        cmd_tx,
        ssh_config: Some(ssh_config_arc),
        ssh_handle: Some(ssh_handle_arc),
        cwd: cwd.clone(),
        remote_fs: None,
    };
    manager.add_session(session_handle).await;

    let io_session_id = session_id.clone();
    let io_manager = manager.clone();
    let io_handle = ssh_connection.clone();
    let io_connection_id = config.connection_id.clone();
    let post_login = config.post_login.clone();
    let startup_command = startup_command.clone();
    let backspace_mode = config.backspace_mode.clone();
    tokio::spawn(async move {
        ssh_io_loop(
            app,
            io_session_id,
            io_manager,
            channel,
            io_handle,
            cmd_rx,
            cwd,
            io_connection_id,
            injection_script,
            ready_marker,
            post_login,
            startup_command,
            backspace_mode,
            initial_notice,
        )
        .await;
    });

    tracing::info!(
        session_id = %session_id,
        source_session_id,
        "Multiplexed SSH session created"
    );
    Ok(session_id)
}

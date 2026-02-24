//! Remote file operations via the SFTP subsystem (russh-sftp).
//!
//! Opens a temporary SSH connection, requests the SFTP subsystem, then
//! performs file operations using proper SFTP protocol calls.

use crate::error::{AppError, AppResult};
use crate::session::SessionManager;
use crate::ssh::{SshAuth, SshConfig, SshHandler};
use russh::client;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;
use serde::Serialize;
use std::sync::Arc;
use tauri::Emitter;

/// Event payload emitted to the frontend to track file transfer lifecycle.
#[derive(Debug, Clone, Serialize)]
pub struct TransferEvent {
    pub id: String,
    pub session_id: String,
    pub file_name: String,
    /// "upload" or "download"
    pub direction: String,
    /// "started", "progress", "completed", or "error"
    pub status: String,
    pub size: u64,
    pub bytes_transferred: u64,
    pub total_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_msg: Option<String>,
}

/// Parsed entry from SFTP readdir for the file explorer.
#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileProperties {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub uid: String,
    pub gid: String,
    pub mtime: u64,
    pub atime: u64,
}

/// Opens a temporary SSH connection + SFTP session.
async fn open_sftp(
    app: &tauri::AppHandle,
    manager: &SessionManager,
    session_id: &str,
) -> AppResult<(client::Handle<SshHandler>, SftpSession)> {
    let config = {
        let sessions = manager.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::SessionNotFound(format!("Session '{}' not found", session_id)))?;

        session
            .ssh_config
            .as_ref()
            .ok_or_else(|| AppError::Config("Not an SSH session".to_string()))?
            .clone()
            .downcast::<SshConfig>()
            .map_err(|_| AppError::Config("Failed to get SSH config".to_string()))?
    };

    let mut ssh_config_obj = client::Config::default();
    if let Ok(app_settings) = crate::config::load_app_settings(app) {
        let interval = app_settings.terminal.keep_alive_interval;
        if interval > 0 {
            ssh_config_obj.keepalive_interval = Some(std::time::Duration::from_secs(interval as u64));
        }
    }
    let ssh_config = Arc::new(ssh_config_obj);
    let mut handle = crate::ssh::connect_with_proxy(
        app,
        &config,
        ssh_config,
        SshHandler::new(app.clone(), config.host.clone(), config.port),
    )
    .await?;

    match &config.auth {
        SshAuth::Password { password } => {
            let ok = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err(|e| AppError::Auth(format!("Auth failed: {}", e)))?;
            if !ok {
                return Err(AppError::Auth(
                    "Auth failed: invalid credentials".to_string(),
                ));
            }
        }
        SshAuth::Key {
            key_data,
            passphrase,
        } => {
            let key = russh_keys::decode_secret_key(key_data, passphrase.as_deref())?;
            let ok = handle
                .authenticate_publickey(&config.username, Arc::new(key))
                .await
                .map_err(|e| AppError::Auth(format!("Key auth failed: {}", e)))?;
            if !ok {
                return Err(AppError::Auth("Auth failed: key rejected".to_string()));
            }
        }
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Channel(format!("Failed to open channel: {}", e)))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| AppError::Channel(format!("Failed to start SFTP subsystem: {}", e)))?;

    let sftp = SftpSession::new(channel.into_stream()).await?;

    Ok((handle, sftp))
}

/// Helper to disconnect after SFTP operations.
async fn disconnect(handle: client::Handle<SshHandler>) {
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "", "English")
        .await;
}

/// Convert a SFTP permission bitmask (u32) to the classic `ls -l` string like `-rwxr-xr-x`.
fn permissions_to_string(mode: u32, is_dir: bool) -> String {
    let mut s = String::with_capacity(10);

    // File type character
    s.push(if is_dir { 'd' } else { '-' });

    // Owner
    s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    s.push(match (mode & 0o100 != 0, mode & 0o4000 != 0) {
        (true, true) => 's',
        (false, true) => 'S',
        (true, false) => 'x',
        (false, false) => '-',
    });

    // Group
    s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    s.push(match (mode & 0o010 != 0, mode & 0o2000 != 0) {
        (true, true) => 's',
        (false, true) => 'S',
        (true, false) => 'x',
        (false, false) => '-',
    });

    // Other
    s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    s.push(match (mode & 0o001 != 0, mode & 0o1000 != 0) {
        (true, true) => 't',
        (false, true) => 'T',
        (true, false) => 'x',
        (false, false) => '-',
    });

    s
}

/// Resolves `$HOME` on the remote host via SFTP `canonicalize(".")`.
pub async fn get_home_dir(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
) -> AppResult<String> {
    let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;
    let home = sftp.canonicalize(".").await?;
    let _ = sftp.close().await;
    disconnect(handle).await;

    if home.is_empty() {
        Err(AppError::Config(
            "Failed to determine home directory".to_string(),
        ))
    } else {
        Ok(home)
    }
}

/// Lists a remote directory via SFTP `read_dir`.
pub async fn list_remote_dir(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
) -> AppResult<Vec<FileEntry>> {
    let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;

    let dir = sftp.read_dir(path).await?;
    let _ = sftp.close().await;
    disconnect(handle).await;

    let mut entries = Vec::new();
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let is_dir = entry.file_type() == FileType::Dir;
        let attrs = entry.metadata();
        let size = attrs.size.unwrap_or(0);
        let perms = attrs.permissions.unwrap_or(0);
        let permissions = permissions_to_string(perms, is_dir);

        entries.push(FileEntry {
            name,
            is_dir,
            size,
            permissions,
        });
    }

    Ok(entries)
}

pub async fn delete_remote_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
) -> AppResult<()> {
    let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;

    // Check if directory or file
    let meta = sftp.metadata(path).await?;
    let is_dir = meta.permissions.map_or(false, |p| p & 0o40000 != 0);

    if is_dir {
        // Recursively delete directory contents first
        remove_dir_recursive(&sftp, path).await?;
    } else {
        sftp.remove_file(path).await?;
    }

    let _ = sftp.close().await;
    disconnect(handle).await;
    Ok(())
}

/// Recursively remove a directory and all its contents via SFTP.
async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> AppResult<()> {
    let dir = sftp.read_dir(path).await?;
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child = format!("{}/{}", path, name);
        let is_dir = entry.file_type() == FileType::Dir;
        if is_dir {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child).await?;
        }
    }
    sftp.remove_dir(path).await?;
    Ok(())
}

pub async fn rename_remote_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    old_path: &str,
    new_path: &str,
) -> AppResult<()> {
    let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;
    sftp.rename(old_path, new_path).await?;
    let _ = sftp.close().await;
    disconnect(handle).await;
    Ok(())
}

pub async fn download_remote_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
) -> AppResult<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let file_name = remote_path.split('/').last().unwrap_or(remote_path).to_string();
    let transfer_id = uuid::Uuid::new_v4().to_string();

    let make_event = |status: &str, bytes_transferred: u64, total_size: u64, error_msg: Option<String>| {
        TransferEvent {
            id: transfer_id.clone(),
            session_id: session_id.to_string(),
            file_name: file_name.clone(),
            direction: "download".to_string(),
            status: status.to_string(),
            size: total_size,
            bytes_transferred,
            total_size,
            error_msg,
        }
    };

    let _ = app.emit("transfer-event", &make_event("started", 0, 0, None));

    let result: AppResult<u64> = async {
        if let Some(parent) = std::path::Path::new(local_path).parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| AppError::Channel(format!("Failed to create local dir: {}", e)))?;
            }
        }

        let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;

        // Get file size for progress tracking
        let total_size = sftp.metadata(remote_path).await
            .map(|m| m.size.unwrap_or(0))
            .unwrap_or(0);

        // Open remote file handle for chunked reading
        let mut remote_file = sftp.open(remote_path).await?;

        let mut local_file = tokio::fs::File::create(local_path)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to create local file: {}", e)))?;

        const CHUNK_SIZE: usize = 32 * 1024; // 32KB chunks
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut bytes_transferred: u64 = 0;

        loop {
            let n = remote_file.read(&mut buf).await
                .map_err(|e| AppError::Channel(format!("SFTP read failed: {}", e)))?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n]).await
                .map_err(|e| AppError::Channel(format!("Write failed: {}", e)))?;
            bytes_transferred += n as u64;

            let _ = app.emit("transfer-event", &make_event("progress", bytes_transferred, total_size, None));
        }

        local_file.flush().await
            .map_err(|e| AppError::Channel(format!("Flush failed: {}", e)))?;

        let _ = sftp.close().await;
        disconnect(handle).await;

        Ok(bytes_transferred)
    }.await;

    match result {
        Ok(size) => {
            let _ = app.emit("transfer-event", &make_event("completed", size, size, None));
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("transfer-event", &make_event("error", 0, 0, Some(e.to_string())));
            Err(e)
        }
    }
}

pub async fn upload_local_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
) -> AppResult<()> {
    use tokio::io::AsyncWriteExt;

    let file_name = remote_path.split('/').last().unwrap_or(remote_path).to_string();
    let transfer_id = uuid::Uuid::new_v4().to_string();

    let make_event = |status: &str, bytes_transferred: u64, total_size: u64, error_msg: Option<String>| {
        TransferEvent {
            id: transfer_id.clone(),
            session_id: session_id.to_string(),
            file_name: file_name.clone(),
            direction: "upload".to_string(),
            status: status.to_string(),
            size: total_size,
            bytes_transferred,
            total_size,
            error_msg,
        }
    };

    let _ = app.emit("transfer-event", &make_event("started", 0, 0, None));

    let result: AppResult<u64> = async {
        let data = tokio::fs::read(local_path)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to read local file: {}", e)))?;
        let total_size = data.len() as u64;

        let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;

        // Open remote file for writing (truncate if exists)
        let mut remote_file = sftp.create(remote_path).await?;

        const CHUNK_SIZE: usize = 32 * 1024; // 32KB chunks
        let mut bytes_transferred: u64 = 0;

        for chunk in data.chunks(CHUNK_SIZE) {
            remote_file.write_all(chunk).await
                .map_err(|e| AppError::Channel(format!("SFTP write failed: {}", e)))?;
            bytes_transferred += chunk.len() as u64;

            let _ = app.emit("transfer-event", &make_event("progress", bytes_transferred, total_size, None));
        }

        remote_file.shutdown().await
            .map_err(|e| AppError::Channel(format!("SFTP flush failed: {}", e)))?;

        let _ = sftp.close().await;
        disconnect(handle).await;

        Ok(total_size)
    }.await;

    match result {
        Ok(size) => {
            let _ = app.emit("transfer-event", &make_event("completed", size, size, None));
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("transfer-event", &make_event("error", 0, 0, Some(e.to_string())));
            Err(e)
        }
    }
}



pub async fn chmod_remote_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    mode: &str,
) -> AppResult<()> {
    let mode_u32 = u32::from_str_radix(mode, 8)
        .map_err(|_| AppError::Channel(format!("Invalid octal mode: {}", mode)))?;

    let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;

    let mut attrs = sftp.metadata(path).await?;
    attrs.permissions = Some(mode_u32);
    sftp.set_metadata(path, attrs).await?;

    let _ = sftp.close().await;
    disconnect(handle).await;
    Ok(())
}

pub async fn get_file_properties(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
) -> AppResult<FileProperties> {
    let (handle, sftp) = open_sftp(&app, &manager, session_id).await?;
    let attrs = sftp.metadata(path).await?;
    let _ = sftp.close().await;
    disconnect(handle).await;

    let perms = attrs.permissions.unwrap_or(0);
    let is_dir = perms & 0o40000 != 0;
    let permissions = permissions_to_string(perms, is_dir);
    let name = path.split('/').last().unwrap_or(path).to_string();

    Ok(FileProperties {
        name,
        is_dir,
        size: attrs.size.unwrap_or(0),
        permissions,
        owner: attrs.user.unwrap_or_default(),
        group: attrs.group.unwrap_or_default(),
        uid: attrs.uid.map_or_else(String::new, |v| v.to_string()),
        gid: attrs.gid.map_or_else(String::new, |v| v.to_string()),
        mtime: u64::from(attrs.mtime.unwrap_or(0)),
        atime: u64::from(attrs.atime.unwrap_or(0)),
    })
}

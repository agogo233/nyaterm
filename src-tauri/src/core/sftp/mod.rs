//! Auto-fallback remote file system.
//!
//! Transparently picks the best available backend for each SSH session:
//! SFTP subsystem → SCP Enhanced (find/stat/tar) → SCP Normal (ls/cat).
//! The upper layers and the frontend never need to know which protocol is in use.

mod cache;
pub(crate) mod duplicate;
mod scp_enhanced;
mod scp_normal;
mod sftp_backend;
pub(crate) mod traits;
pub(crate) mod transfer;
pub(crate) mod util;

use cache::{cache_key, load_cached_backend, save_cached_backend};
use scp_enhanced::ScpEnhancedBackend;
use scp_normal::ScpNormalBackend;
use sftp_backend::SftpBackend;
use traits::RemoteFs;

use crate::core::SessionManager;
use crate::core::ssh::SshConnectionHandles;
use crate::error::{AppError, AppResult};
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::StatusCode;
use std::sync::Arc;
use tokio::sync::RwLock;

pub(crate) use duplicate::TransferDuplicateManager;
pub(crate) use transfer::{active_transfer_count, transfer_target_directory};
pub use transfer::{cancel_transfer, pause_transfer, resume_transfer};
pub(crate) use util::RemotePathRef;
pub(crate) use util::sanitize_download_file_name;
pub use util::{
    FileEntry, FileProperties, RemoteFileAttributeUpdate, RemoteTextFile, WriteRemoteTextResult,
};

fn is_remote_delete_not_found(error: &AppError) -> bool {
    match error {
        AppError::Sftp(SftpError::Status(status)) => status.status_code == StatusCode::NoSuchFile,
        AppError::Channel(message) => {
            let lower = message.to_ascii_lowercase();
            lower.contains("no such file")
                || lower.contains("not found")
                || lower.contains("no such file or directory")
        }
        _ => false,
    }
}

/// Orchestrator that lazily initialises the best available remote file system
/// backend and delegates all operations through it.
pub(crate) struct AutoRemoteFs {
    inner: RwLock<Option<Box<dyn RemoteFs>>>,
    ssh_handle: Arc<SshConnectionHandles>,
    cache_key: String,
    sftp_encoding: String,
}

impl AutoRemoteFs {
    pub(crate) fn new(
        ssh_handle: Arc<SshConnectionHandles>,
        host: &str,
        port: u16,
        username: &str,
        sftp_encoding: &str,
    ) -> Self {
        Self {
            inner: RwLock::new(None),
            ssh_handle,
            cache_key: cache_key(host, port, username),
            sftp_encoding: sftp_encoding.to_string(),
        }
    }

    async fn ensure_backend(&self) -> AppResult<()> {
        {
            let guard = self.inner.read().await;
            if guard.is_some() {
                return Ok(());
            }
        }

        let mut guard = self.inner.write().await;
        if guard.is_some() {
            return Ok(());
        }

        let backend = self.probe_backends().await?;
        tracing::info!(
            backend = backend.backend_name(),
            cache_key = %self.cache_key,
            "Active remote file backend selected"
        );
        *guard = Some(backend);
        Ok(())
    }

    async fn probe_backends(&self) -> AppResult<Box<dyn RemoteFs>> {
        if let Some(cached) = load_cached_backend(&self.cache_key) {
            tracing::debug!(cached_backend = %cached, "Trying cached backend first");
            if let Some(backend) = self.try_cached_backend(&cached).await {
                return Ok(backend);
            }
            tracing::debug!(cached_backend = %cached, "Cached backend failed, probing all");
        }

        let sftp_failure;

        tracing::debug!("Probing SFTP backend");
        match SftpBackend::probe(&self.ssh_handle).await {
            Ok(()) => {
                save_cached_backend(&self.cache_key, "sftp", false, None);
                return Ok(Box::new(SftpBackend::new(
                    self.ssh_handle.clone(),
                    &self.sftp_encoding,
                )));
            }
            Err(e) => {
                let reason = e.to_string();
                tracing::debug!(error = %reason, "SFTP backend unavailable, trying SCP Enhanced");
                sftp_failure = Some(reason);
            }
        }

        tracing::debug!("Probing SCP Enhanced backend");
        match ScpEnhancedBackend::probe(&self.ssh_handle).await {
            Ok(()) => {
                save_cached_backend(&self.cache_key, "scp_enhanced", true, sftp_failure);
                return Ok(Box::new(ScpEnhancedBackend::new(self.ssh_handle.clone())));
            }
            Err(e) => {
                tracing::debug!(error = %e, "SCP Enhanced backend unavailable, trying SCP Normal");
            }
        }

        tracing::debug!("Probing SCP Normal backend");
        match ScpNormalBackend::probe(&self.ssh_handle).await {
            Ok(()) => {
                save_cached_backend(&self.cache_key, "scp_normal", true, sftp_failure);
                return Ok(Box::new(ScpNormalBackend::new(self.ssh_handle.clone())));
            }
            Err(e) => {
                tracing::debug!(error = %e, "SCP Normal backend unavailable");
            }
        }

        Err(AppError::Channel(
            "Terminal connection is working, but the remote file manager could not be initialized"
                .to_string(),
        ))
    }

    async fn try_cached_backend(&self, name: &str) -> Option<Box<dyn RemoteFs>> {
        match name {
            "sftp" => {
                SftpBackend::probe(&self.ssh_handle)
                    .await
                    .ok()
                    .map(|()| -> Box<dyn RemoteFs> {
                        Box::new(SftpBackend::new(
                            self.ssh_handle.clone(),
                            &self.sftp_encoding,
                        ))
                    })
            }
            "scp_enhanced" => ScpEnhancedBackend::probe(&self.ssh_handle).await.ok().map(
                |()| -> Box<dyn RemoteFs> {
                    Box::new(ScpEnhancedBackend::new(self.ssh_handle.clone()))
                },
            ),
            "scp_normal" => ScpNormalBackend::probe(&self.ssh_handle).await.ok().map(
                |()| -> Box<dyn RemoteFs> {
                    Box::new(ScpNormalBackend::new(self.ssh_handle.clone()))
                },
            ),
            _ => None,
        }
    }

    async fn backend(
        &self,
    ) -> AppResult<tokio::sync::RwLockReadGuard<'_, Option<Box<dyn RemoteFs>>>> {
        self.ensure_backend().await?;
        Ok(self.inner.read().await)
    }
}

// ---------------------------------------------------------------------------
// Public API functions called by cmd/sftp.rs
// ---------------------------------------------------------------------------

async fn get_ssh_info(
    manager: &SessionManager,
    session_id: &str,
) -> AppResult<(
    Arc<SshConnectionHandles>,
    String,
    u16,
    String,
    String,
    String,
)> {
    let sessions = manager.sessions.lock().await;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| AppError::SessionNotFound(format!("Session '{}' not found", session_id)))?;

    let ssh_handle = session
        .ssh_handle
        .as_ref()
        .ok_or_else(|| AppError::Config("Not an SSH session".to_string()))?
        .clone()
        .downcast::<SshConnectionHandles>()
        .map_err(|_| AppError::Config("Failed to get SSH handle".to_string()))?;

    let (host, port, username, encoding, sftp_encoding) =
        if let Some(ref cfg_any) = session.ssh_config {
            if let Some(cfg) = cfg_any.downcast_ref::<crate::core::ssh::SshConfig>() {
                let sftp_encoding = if cfg.sftp.filename_encoding.trim().is_empty() {
                    cfg.encoding.clone()
                } else {
                    cfg.sftp.filename_encoding.clone()
                };
                (
                    cfg.host.clone(),
                    cfg.port,
                    cfg.username.clone(),
                    cfg.encoding.clone(),
                    sftp_encoding,
                )
            } else {
                (
                    "unknown".to_string(),
                    22,
                    "unknown".to_string(),
                    "UTF-8".to_string(),
                    "UTF-8".to_string(),
                )
            }
        } else {
            (
                "unknown".to_string(),
                22,
                "unknown".to_string(),
                "UTF-8".to_string(),
                "UTF-8".to_string(),
            )
        };

    Ok((ssh_handle, host, port, username, encoding, sftp_encoding))
}

async fn get_or_create_auto_fs(
    manager: &SessionManager,
    session_id: &str,
) -> AppResult<Arc<AutoRemoteFs>> {
    {
        let sessions = manager.sessions.lock().await;
        let session = sessions.get(session_id).ok_or_else(|| {
            AppError::SessionNotFound(format!("Session '{}' not found", session_id))
        })?;
        if !session.info.remote_file_browser_enabled {
            return Err(AppError::Config(
                "Remote file browser is disabled for this SSH connection".to_string(),
            ));
        }
        if let Some(ref fs) = session.remote_fs {
            return Ok(fs.clone());
        }
    }

    let (ssh_handle, host, port, username, _encoding, sftp_encoding) =
        get_ssh_info(manager, session_id).await?;
    let auto_fs = Arc::new(AutoRemoteFs::new(
        ssh_handle,
        &host,
        port,
        &username,
        &sftp_encoding,
    ));

    {
        let mut sessions = manager.sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            if session.remote_fs.is_none() {
                session.remote_fs = Some(auto_fs.clone());
            } else {
                return Ok(session.remote_fs.as_ref().unwrap().clone());
            }
        }
    }

    Ok(auto_fs)
}

pub async fn get_home_dir(manager: Arc<SessionManager>, session_id: &str) -> AppResult<String> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    let result = fs.home_dir().await?;

    if result.is_empty() {
        Err(AppError::Config(
            "Failed to determine home directory".to_string(),
        ))
    } else {
        Ok(result)
    }
}

pub async fn list_remote_dir(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    raw_path_token: Option<&str>,
) -> AppResult<Vec<FileEntry>> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    let path_ref = RemotePathRef::new(path, raw_path_token)?;
    let entries = fs.list_dir_ref(&path_ref).await?;

    tracing::debug!(
        target: "user_action",
        action = "list",
        entity = "remote_directory",
        session_id = %session_id,
        remote_path = path,
        item_count = entries.len(),
        "User listed remote directory"
    );

    Ok(entries)
}

pub async fn delete_remote_file(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    raw_path_token: Option<&str>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    let path_ref = RemotePathRef::new(path, raw_path_token)?;
    match fs.remove_file_ref(&path_ref).await {
        Ok(()) => {}
        Err(error) if is_remote_delete_not_found(&error) => {
            tracing::debug!(
                target: "user_action",
                action = "delete",
                entity = "remote_entry",
                session_id = %session_id,
                remote_path = path,
                "Remote entry was already absent during delete"
            );
        }
        Err(error) => return Err(error),
    }

    tracing::debug!(
        target: "user_action",
        action = "delete",
        entity = "remote_entry",
        session_id = %session_id,
        remote_path = path,
        "User deleted remote entry"
    );

    Ok(())
}

pub async fn rename_remote_file(
    manager: Arc<SessionManager>,
    session_id: &str,
    old_path: &str,
    new_path: &str,
    old_raw_path_token: Option<&str>,
    new_raw_path_token: Option<&str>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    let old_path_ref = RemotePathRef::new(old_path, old_raw_path_token)?;
    let new_path_ref = RemotePathRef::new(new_path, new_raw_path_token)?;
    fs.rename_ref(&old_path_ref, &new_path_ref).await?;

    tracing::debug!(
        target: "user_action",
        action = "update",
        entity = "remote_entry",
        session_id = %session_id,
        old_path = old_path,
        new_path = new_path,
        "User renamed or moved remote entry"
    );

    Ok(())
}

pub async fn download_remote_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let transfer_settings = crate::config::load_app_settings(&app)
        .map(|s| s.transfer)
        .unwrap_or_default();
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.download_file(
        &app,
        session_id,
        remote_path,
        local_path,
        &transfer_settings,
        transfer_id,
    )
    .await
}

pub async fn upload_local_file(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
    transfer_id: Option<String>,
    duplicate_strategy_override: Option<String>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let mut transfer_settings = crate::config::load_app_settings(&app)
        .map(|s| s.transfer)
        .unwrap_or_default();
    if let Some(strategy) = duplicate_strategy_override {
        transfer_settings.duplicate_strategy = strategy;
    }
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.upload_file(
        &app,
        session_id,
        local_path,
        remote_path,
        &transfer_settings,
        transfer_id,
    )
    .await
}

pub async fn get_file_properties(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    raw_path_token: Option<&str>,
) -> AppResult<FileProperties> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    let path_ref = RemotePathRef::new(path, raw_path_token)?;
    let props = fs.stat_ref(&path_ref).await?;

    tracing::debug!(
        target: "user_action",
        action = "read",
        entity = "remote_properties",
        session_id = %session_id,
        remote_path = path,
        "User read remote entry properties"
    );

    Ok(props)
}

pub async fn read_remote_file_text(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    max_bytes: u64,
) -> AppResult<RemoteTextFile> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.read_file_text(path, max_bytes).await
}

pub async fn write_remote_file_text(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    content: &str,
    expected_mtime: Option<u64>,
    expected_size: Option<u64>,
    force: bool,
) -> AppResult<WriteRemoteTextResult> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.write_file_text(path, content, expected_mtime, expected_size, force)
        .await
}

pub async fn create_remote_file(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    mode: Option<String>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.create_file(path, mode.clone()).await?;

    tracing::debug!(
        target: "user_action",
        action = "create",
        entity = "remote_file",
        session_id = %session_id,
        remote_path = path,
        requested_mode = ?mode,
        "User created remote file"
    );

    Ok(())
}

pub async fn create_remote_dir(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    mode: Option<String>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.mkdir(path, mode.clone()).await?;

    tracing::debug!(
        target: "user_action",
        action = "create",
        entity = "remote_directory",
        session_id = %session_id,
        remote_path = path,
        requested_mode = ?mode,
        "User created remote directory"
    );

    Ok(())
}

pub async fn create_remote_symlink(
    manager: Arc<SessionManager>,
    session_id: &str,
    link_path: &str,
    target_path: &str,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.create_symlink(link_path, target_path).await?;

    tracing::debug!(
        target: "user_action",
        action = "create",
        entity = "remote_symlink",
        session_id = %session_id,
        remote_path = link_path,
        target_path = target_path,
        "User created remote symlink"
    );

    Ok(())
}

pub async fn chmod_remote_file(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    mode: &str,
) -> AppResult<()> {
    update_remote_file_attributes(
        manager,
        session_id,
        path,
        None,
        RemoteFileAttributeUpdate {
            mode: Some(mode.to_string()),
            owner: None,
            group: None,
            recursive: false,
        },
    )
    .await
}

pub async fn update_remote_file_attributes(
    manager: Arc<SessionManager>,
    session_id: &str,
    path: &str,
    raw_path_token: Option<&str>,
    update: RemoteFileAttributeUpdate,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    let path_ref = RemotePathRef::new(path, raw_path_token)?;
    fs.update_attrs_ref(&path_ref, &update).await?;

    tracing::debug!(
        target: "user_action",
        action = "update",
        entity = "remote_attributes",
        session_id = %session_id,
        remote_path = path,
        requested_mode = ?update.mode,
        requested_owner = ?update.owner,
        requested_group = ?update.group,
        recursive = update.recursive,
        "User changed remote file attributes"
    );

    Ok(())
}

pub async fn download_remote_directory(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    remote_path: &str,
    local_path: &str,
    transfer_id: Option<String>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.download_directory(&app, session_id, remote_path, local_path, transfer_id)
        .await
}

pub async fn upload_local_directory(
    app: tauri::AppHandle,
    manager: Arc<SessionManager>,
    session_id: &str,
    local_path: &str,
    remote_path: &str,
    transfer_id: Option<String>,
    duplicate_strategy_override: Option<String>,
) -> AppResult<()> {
    let auto_fs = get_or_create_auto_fs(&manager, session_id).await?;
    let mut transfer_settings = crate::config::load_app_settings(&app)
        .map(|s| s.transfer)
        .unwrap_or_default();
    if let Some(strategy) = duplicate_strategy_override {
        transfer_settings.duplicate_strategy = strategy;
    }
    let guard = auto_fs.backend().await?;
    let fs = guard.as_ref().unwrap();
    fs.upload_directory(
        &app,
        session_id,
        local_path,
        remote_path,
        &transfer_settings,
        transfer_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::get_home_dir;
    use crate::config::AiExecutionProfile;
    use crate::core::{SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType};
    use std::sync::Arc;
    use tokio::sync::{Mutex, mpsc};

    #[tokio::test]
    async fn disabled_remote_file_browser_rejects_sftp_commands() {
        let manager = Arc::new(SessionManager::new());
        let (cmd_tx, _cmd_rx) = mpsc::unbounded_channel::<SessionCommand>();
        manager
            .add_session(SessionHandle {
                info: SessionInfo {
                    id: "ssh-disabled-files".to_string(),
                    name: "ssh-disabled-files".to_string(),
                    session_type: SessionType::SSH,
                    connected: true,
                    owner_window_label: None,
                    ai_execution_profile: AiExecutionProfile::Posix,
                    injection_active: true,
                    remote_file_browser_enabled: false,
                },
                cmd_tx,
                ssh_config: None,
                ssh_handle: None,
                cwd: Arc::new(Mutex::new(None)),
                remote_fs: None,
            })
            .await;

        let error = get_home_dir(manager, "ssh-disabled-files")
            .await
            .expect_err("remote file browser should be blocked");

        assert!(
            error
                .to_string()
                .contains("Remote file browser is disabled")
        );
    }
}

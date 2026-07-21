//! SFTP backend: standard SSH SFTP subsystem via russh-sftp.
//!
//! This is the preferred backend when the server supports `Subsystem sftp`.

use super::CopyResolvedTarget;
use super::traits::RemoteFs;
use super::transfer::*;
use super::util::*;
use crate::core::ssh::SshConnectionHandles;
use crate::error::{AppError, AppResult};
use crate::observability::{StructuredLog, StructuredLogLevel, log_event};
use encoding_rs::{Encoding, UTF_8};
use russh::{ChannelMsg, ChannelOpenFailure};
use russh_sftp::client::{Config as SftpClientConfig, SftpSession, error::Error as SftpError};
use russh_sftp::protocol::{FileAttributes, FileType, StatusCode};
use std::collections::{HashMap, HashSet, VecDeque};
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};
use tokio::sync::{OwnedSemaphorePermit, RwLock, Semaphore};

const SFTP_MIN_REQUEST_KIB: usize = 64;
const SFTP_MAX_REQUEST_KIB: usize = 256;
const SFTP_PIPELINE_TARGET_KIB: usize = 1024;
const SFTP_WRITE_PIPELINE_TARGET_KIB: usize = 2048;
const SFTP_MIN_PIPELINE_DEPTH: usize = 4;
const SFTP_MAX_PIPELINE_DEPTH: usize = 16;
const SFTP_MIN_CONCURRENT_WRITES: usize = 8;
const SFTP_MAX_CONCURRENT_WRITES: usize = 16;
const SFTP_PACKET_OVERHEAD_RESERVE: usize = 1024;
const TRANSFER_PROGRESS_INTERVAL: Duration = Duration::from_millis(50);
const SFTP_SMALL_FILE_THRESHOLD: u64 = 512 * 1024;
const SFTP_DEFAULT_SMALL_FILE_CONCURRENCY: usize = 64;
const SFTP_MAX_SMALL_FILE_CONCURRENCY: usize = 256;
const SFTP_DEFAULT_SESSION_POOL_SIZE: usize = 2;
const SFTP_MAX_SESSION_POOL_SIZE: usize = 4;
const SFTP_LARGE_FILE_CONCURRENCY: usize = 2;
const SFTP_HANDLE_RESERVE: usize = 8;
const SFTP_CHANNEL_OPEN_RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(50),
    Duration::from_millis(150),
    Duration::from_millis(300),
];

fn sftp_pipeline_config(ts: &crate::config::TransferSettings) -> (usize, usize, usize) {
    let request_kib =
        (ts.transfer_buffer_size as usize).clamp(SFTP_MIN_REQUEST_KIB, SFTP_MAX_REQUEST_KIB);
    let pipeline_depth = SFTP_PIPELINE_TARGET_KIB
        .div_ceil(request_kib)
        .clamp(SFTP_MIN_PIPELINE_DEPTH, SFTP_MAX_PIPELINE_DEPTH);
    let max_concurrent_writes = SFTP_WRITE_PIPELINE_TARGET_KIB
        .div_ceil(request_kib)
        .clamp(SFTP_MIN_CONCURRENT_WRITES, SFTP_MAX_CONCURRENT_WRITES);
    (request_kib, pipeline_depth, max_concurrent_writes)
}

fn sftp_client_config(request_kib: usize, max_concurrent_writes: usize) -> SftpClientConfig {
    SftpClientConfig {
        max_packet_len: (request_kib * 1024) as u32,
        max_concurrent_writes,
        ..SftpClientConfig::default()
    }
}

fn is_sftp_not_found(error: &SftpError) -> bool {
    matches!(
        error,
        SftpError::Status(status) if status.status_code == StatusCode::NoSuchFile
    )
}

#[allow(dead_code)]
fn remote_same_endpoint_copy_command(
    source_path: &str,
    target_path: &str,
    is_directory: bool,
) -> String {
    let preflight = "case \"$(uname -s 2>/dev/null)\" in CYGWIN*|MINGW*|MSYS*|Windows*) exit 97;; esac; command -v cp >/dev/null 2>&1 || exit 98;";
    if is_directory {
        format!(
            "{} if [ -d {} ]; then cp -a -- {}/. {}/; else cp -a -- {} {}; fi",
            preflight,
            sh_quote(target_path),
            sh_quote(source_path),
            sh_quote(target_path),
            sh_quote(source_path),
            sh_quote(target_path),
        )
    } else {
        format!(
            "{} cp -a -- {} {}",
            preflight,
            sh_quote(source_path),
            sh_quote(target_path),
        )
    }
}

#[allow(dead_code)]
fn ignore_sftp_not_found(result: Result<(), SftpError>) -> AppResult<()> {
    match result {
        Ok(()) => Ok(()),
        Err(error) if is_sftp_not_found(&error) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn is_retryable_sftp_channel_open_error(error: &russh::Error) -> bool {
    matches!(
        error,
        russh::Error::ChannelOpenFailure(
            ChannelOpenFailure::ConnectFailed | ChannelOpenFailure::ResourceShortage
        )
    )
}

#[allow(dead_code)]
fn sftp_remove_error(path: &str, kind: &str, error: SftpError) -> Option<String> {
    if is_sftp_not_found(&error) {
        None
    } else {
        Some(format!("Failed to remove {kind} '{}': {error}", path))
    }
}

fn sftp_payload_size(request_kib: usize) -> usize {
    (request_kib * 1024)
        .saturating_sub(SFTP_PACKET_OVERHEAD_RESERVE)
        .max(32 * 1024)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SftpDirectoryConcurrency {
    session_pool_size: usize,
    small_file_concurrency: usize,
    large_file_concurrency: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadReadProgress {
    Continue(u64),
    Complete,
}

fn unexpected_download_eof_error(
    remote_path: &str,
    local_path: &str,
    remote_size: u64,
    bytes_written: u64,
    request_kib: usize,
    payload_bytes: usize,
) -> AppError {
    AppError::Channel(format!(
        "Unexpected EOF while downloading {remote_path}: expected {remote_size} bytes, got {bytes_written} bytes (local_path={local_path}, request_kib={request_kib}, payload_bytes={payload_bytes})"
    ))
}

fn classify_download_read_progress(
    remote_path: &str,
    local_path: &str,
    remote_size: u64,
    offset: u64,
    bytes_written: u64,
    bytes_read: usize,
    request_kib: usize,
    payload_bytes: usize,
) -> AppResult<DownloadReadProgress> {
    if offset >= remote_size {
        return Ok(DownloadReadProgress::Complete);
    }

    if bytes_read == 0 {
        return Err(unexpected_download_eof_error(
            remote_path,
            local_path,
            remote_size,
            bytes_written,
            request_kib,
            payload_bytes,
        ));
    }

    let next_offset = offset.saturating_add(bytes_read as u64);
    if next_offset >= remote_size {
        Ok(DownloadReadProgress::Complete)
    } else {
        Ok(DownloadReadProgress::Continue(next_offset))
    }
}

fn ensure_download_complete(
    remote_path: &str,
    local_path: &str,
    remote_size: u64,
    bytes_written: u64,
    request_kib: usize,
    payload_bytes: usize,
) -> AppResult<()> {
    if bytes_written == remote_size {
        Ok(())
    } else {
        Err(unexpected_download_eof_error(
            remote_path,
            local_path,
            remote_size,
            bytes_written,
            request_kib,
            payload_bytes,
        ))
    }
}

fn sftp_directory_concurrency(max_open_handles: Option<u64>) -> SftpDirectoryConcurrency {
    let small_file_concurrency = match max_open_handles {
        Some(handles) => (handles.saturating_sub(SFTP_HANDLE_RESERVE as u64) as usize)
            .clamp(1, SFTP_MAX_SMALL_FILE_CONCURRENCY),
        None => SFTP_DEFAULT_SMALL_FILE_CONCURRENCY,
    };
    let large_file_concurrency = SFTP_LARGE_FILE_CONCURRENCY
        .min(small_file_concurrency)
        .max(1);
    let session_pool_size = SFTP_DEFAULT_SESSION_POOL_SIZE
        .min(SFTP_MAX_SESSION_POOL_SIZE)
        .min(small_file_concurrency)
        .max(1);

    SftpDirectoryConcurrency {
        session_pool_size,
        small_file_concurrency,
        large_file_concurrency,
    }
}

#[derive(Clone)]
struct SftpSessionPool {
    sessions: Arc<Vec<Arc<ManagedSftpSession>>>,
}

impl SftpSessionPool {
    async fn new(backend: &SftpBackend, size: usize, config: SftpClientConfig) -> AppResult<Self> {
        let mut sessions = Vec::with_capacity(size);
        for _ in 0..size {
            sessions.push(Arc::new(
                backend.open_sftp_with_client_config(config.clone()).await?,
            ));
        }
        Ok(Self {
            sessions: Arc::new(sessions),
        })
    }

    fn session_for(&self, index: usize) -> Arc<ManagedSftpSession> {
        self.sessions[index % self.sessions.len()].clone()
    }

    async fn close_all(self) {
        for session in self.sessions.iter() {
            let _ = session.close().await;
        }
    }
}

struct ManagedSftpSession {
    inner: SftpSession,
    _permit: OwnedSemaphorePermit,
}

impl ManagedSftpSession {
    fn new(inner: SftpSession, permit: OwnedSemaphorePermit) -> Self {
        Self {
            inner,
            _permit: permit,
        }
    }
}

impl Deref for ManagedSftpSession {
    type Target = SftpSession;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

fn log_transfer_performance(
    direction: &str,
    kind: &str,
    bytes: u64,
    elapsed: Duration,
    request_kib: usize,
    pipeline_depth: usize,
    max_concurrent_writes: usize,
    concurrent_tasks: usize,
) {
    let elapsed_secs = elapsed.as_secs_f64().max(0.001);
    let mbps = bytes as f64 / 1024.0 / 1024.0 / elapsed_secs;
    log_event(StructuredLog {
        level: StructuredLogLevel::Info,
        domain: "transfer.performance".to_string(),
        event: "sftp.transfer.completed".to_string(),
        message: "SFTP transfer performance summary".to_string(),
        ids: None,
        data: Some(serde_json::json!({
            "backend": "sftp",
            "direction": direction,
            "kind": kind,
            "bytes": bytes,
            "elapsed_ms": elapsed.as_millis(),
            "average_mbps": mbps,
            "request_kib": request_kib,
            "payload_bytes": sftp_payload_size(request_kib),
            "pipeline_depth": pipeline_depth,
            "max_concurrent_writes": max_concurrent_writes,
            "concurrent_tasks": concurrent_tasks,
        })),
        error: None,
        client_timestamp: None,
    });
}

#[derive(Clone)]
pub(crate) struct SftpBackend {
    ssh_handle: Arc<SshConnectionHandles>,
    identity_cache: Arc<RwLock<RemoteIdentityCache>>,
    /// Cache mapping decoded paths to their raw byte representations.
    /// Used to preserve original encoding for non-UTF-8 file names.
    path_cache: Arc<RwLock<HashMap<String, Vec<u8>>>>,
    /// Encoding for this connection (e.g., "UTF-8", "GBK")
    encoding: String,
}

#[derive(Default)]
struct RemoteIdentityCache {
    users_by_uid: HashMap<u32, String>,
    groups_by_gid: HashMap<u32, String>,
    uids_by_user: HashMap<String, u32>,
    gids_by_group: HashMap<String, u32>,
}

struct ExecResult {
    exit_code: u32,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl SftpBackend {
    pub(crate) fn new(ssh_handle: Arc<SshConnectionHandles>, encoding: &str) -> Self {
        Self {
            ssh_handle,
            identity_cache: Arc::new(RwLock::new(RemoteIdentityCache::default())),
            path_cache: Arc::new(RwLock::new(HashMap::new())),
            encoding: encoding.to_string(),
        }
    }

    /// Get the encoding setting for this connection
    pub(crate) fn encoding(&self) -> &str {
        &self.encoding
    }

    /// Convert UTF-8 path to raw bytes for SFTP operations.
    /// Uses the connection's encoding setting.
    fn encode_path_for_sftp(&self, path: &str) -> Vec<u8> {
        let encoding = Encoding::for_label(self.encoding.trim().as_bytes()).unwrap_or(UTF_8);
        if encoding == UTF_8 || path.bytes().all(|b| b < 128) {
            return path.as_bytes().to_vec();
        }

        let (encoded, _, _) = encoding.encode(path);
        encoded.into_owned()
    }

    /// Decode raw bytes to string using the connection's encoding.
    fn decode_path_from_sftp(&self, bytes: &[u8]) -> String {
        let encoding = Encoding::for_label(self.encoding.trim().as_bytes()).unwrap_or(UTF_8);
        if encoding == UTF_8 {
            return String::from_utf8_lossy(bytes).into_owned();
        }
        let (decoded, _, had_errors) = encoding.decode(bytes);
        if had_errors {
            String::from_utf8_lossy(bytes).into_owned()
        } else {
            decoded.into_owned()
        }
    }

    fn remote_path_bytes(&self, path: &RemotePathRef) -> Vec<u8> {
        path.raw_path()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| self.encode_path_for_sftp(path.display_path()))
    }

    /// Attempt to open a throwaway SFTP session to verify subsystem availability.
    pub(crate) async fn probe(ssh_handle: &Arc<SshConnectionHandles>) -> AppResult<()> {
        let sftp = Self::open_sftp_raw(ssh_handle.clone(), SftpClientConfig::default()).await?;
        let _ = sftp.close().await;
        Ok(())
    }

    async fn open_sftp_raw(
        ssh_handle: Arc<SshConnectionHandles>,
        config: SftpClientConfig,
    ) -> AppResult<ManagedSftpSession> {
        for attempt in 0..=SFTP_CHANNEL_OPEN_RETRY_DELAYS.len() {
            let permit = ssh_handle.acquire_sftp_channel_permit().await?;
            let channel_result = {
                let handle_mtx = ssh_handle.target_handle();
                let handle = handle_mtx.lock().await;
                handle.channel_open_session().await
            };

            let channel = match channel_result {
                Ok(channel) => channel,
                Err(error)
                    if attempt < SFTP_CHANNEL_OPEN_RETRY_DELAYS.len()
                        && is_retryable_sftp_channel_open_error(&error) =>
                {
                    drop(permit);
                    tokio::time::sleep(SFTP_CHANNEL_OPEN_RETRY_DELAYS[attempt]).await;
                    continue;
                }
                Err(error) => {
                    drop(permit);
                    return Err(AppError::Channel(format!(
                        "Failed to open SFTP channel: {}",
                        error
                    )));
                }
            };

            channel
                .request_subsystem(true, "sftp")
                .await
                .map_err(|e| AppError::Channel(format!("Failed to start SFTP subsystem: {}", e)))?;

            let sftp = SftpSession::new_with_config(channel.into_stream(), config).await?;
            return Ok(ManagedSftpSession::new(sftp, permit));
        }

        unreachable!("SFTP channel open retry loop always returns or continues");
    }

    async fn open_sftp(&self) -> AppResult<ManagedSftpSession> {
        Self::open_sftp_raw(self.ssh_handle.clone(), SftpClientConfig::default()).await
    }

    async fn open_sftp_with_client_config(
        &self,
        config: SftpClientConfig,
    ) -> AppResult<ManagedSftpSession> {
        Self::open_sftp_raw(self.ssh_handle.clone(), config).await
    }

    async fn exec(&self, command: &str) -> AppResult<ExecResult> {
        let handle_mtx = self.ssh_handle.target_handle();
        let mut channel = {
            let handle = handle_mtx.lock().await;
            handle
                .channel_open_session()
                .await
                .map_err(|e| AppError::Channel(format!("Failed to open exec channel: {}", e)))?
        };

        channel.exec(true, command.as_bytes()).await?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<u32> = None;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    stdout.extend_from_slice(&data);
                }
                Some(ChannelMsg::ExtendedData { data, ext }) => {
                    if ext == 1 {
                        stderr.extend_from_slice(&data);
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = Some(exit_status);
                }
                Some(ChannelMsg::Eof) | None => {
                    if exit_code.is_none() {
                        if let Some(ChannelMsg::ExitStatus { exit_status }) = channel.wait().await {
                            exit_code = Some(exit_status);
                        }
                    }
                    break;
                }
                _ => {}
            }
        }

        Ok(ExecResult {
            exit_code: exit_code.unwrap_or(255),
            stdout,
            stderr,
        })
    }

    async fn exec_ok(&self, command: &str) -> AppResult<Vec<u8>> {
        let result = self.exec(command).await?;
        if result.exit_code != 0 {
            let msg = String::from_utf8_lossy(&result.stderr);
            return Err(AppError::Channel(format!(
                "Remote command failed (exit {}): {}",
                result.exit_code,
                msg.trim()
            )));
        }
        Ok(result.stdout)
    }

    async fn cleanup_remote_copy_temp(&self, sftp: &SftpSession, path: &str) {
        let _ = sftp
            .remove_file_bytes(self.encode_path_for_sftp(path))
            .await;
    }

    async fn create_remote_copy_temp_file(
        &self,
        sftp: &SftpSession,
        temp_path: &str,
    ) -> AppResult<russh_sftp::client::fs::File> {
        if self.encoding() != "UTF-8" {
            use russh_sftp::protocol::OpenFlags;
            sftp.open_with_flags_bytes(
                self.encode_path_for_sftp(temp_path),
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|error| {
                AppError::Channel(format!("Failed to create temporary remote file: {error}"))
            })
        } else {
            sftp.create(temp_path).await.map_err(|error| {
                AppError::Channel(format!("Failed to create temporary remote file: {error}"))
            })
        }
    }

    async fn commit_remote_copy_temp(
        &self,
        sftp: &SftpSession,
        temp_path: &str,
        target_path: &str,
    ) -> AppResult<()> {
        let target_bytes = self.encode_path_for_sftp(target_path);
        let target_meta = sftp.metadata_bytes(target_bytes.clone()).await.ok();
        if target_meta.as_ref().is_some_and(sftp_attrs_is_dir) {
            self.cleanup_remote_copy_temp(sftp, temp_path).await;
            return Err(AppError::Channel(format!(
                "Cannot overwrite existing remote directory '{target_path}' with a file"
            )));
        }

        let backup_path = target_meta
            .as_ref()
            .map(|_| copy_remote_sidecar_path(target_path, "backup"));
        if let Some(backup) = backup_path.as_ref() {
            sftp.rename_bytes(target_bytes.clone(), self.encode_path_for_sftp(backup))
                .await
                .map_err(|error| {
                    AppError::Channel(format!("Failed to protect existing remote target: {error}"))
                })?;
        }

        let commit_result = sftp
            .rename_bytes(self.encode_path_for_sftp(temp_path), target_bytes.clone())
            .await
            .map_err(|error| AppError::Channel(format!("Failed to commit remote copy: {error}")));

        match commit_result {
            Ok(()) => {
                if let Some(backup) = backup_path {
                    let _ = sftp
                        .remove_file_bytes(self.encode_path_for_sftp(&backup))
                        .await;
                }
                Ok(())
            }
            Err(error) => {
                self.cleanup_remote_copy_temp(sftp, temp_path).await;
                if let Some(backup) = backup_path {
                    let _ = sftp
                        .rename_bytes(self.encode_path_for_sftp(&backup), target_bytes)
                        .await;
                    let _ = sftp
                        .remove_file_bytes(self.encode_path_for_sftp(&backup))
                        .await;
                }
                Err(error)
            }
        }
    }

    async fn resolve_uid_names(&self, uids: HashSet<u32>) -> HashMap<u32, String> {
        let missing: Vec<u32> = {
            let cache = self.identity_cache.read().await;
            uids.iter()
                .copied()
                .filter(|uid| !cache.users_by_uid.contains_key(uid))
                .collect()
        };
        if missing.is_empty() {
            let cache = self.identity_cache.read().await;
            return uids
                .into_iter()
                .filter_map(|uid| cache.users_by_uid.get(&uid).map(|name| (uid, name.clone())))
                .collect();
        }

        let id_list = missing
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        let command = format!(
            "ids={}; for id in $ids; do name=$(getent passwd \"$id\" 2>/dev/null | cut -d: -f1); if [ -z \"$name\" ] && [ -r /etc/passwd ]; then name=$(awk -F: -v id=\"$id\" '$3==id {{print $1; exit}}' /etc/passwd 2>/dev/null); fi; if [ -n \"$name\" ]; then printf '%s:%s\\n' \"$id\" \"$name\"; fi; done",
            sh_quote(&id_list)
        );

        let mut resolved = HashMap::new();
        if let Ok(output) = self.exec_ok(&command).await {
            for line in String::from_utf8_lossy(&output).lines() {
                if let Some((id, name)) = line.split_once(':') {
                    if let Ok(uid) = id.parse::<u32>() {
                        let trimmed = name.trim();
                        if !trimmed.is_empty() {
                            resolved.insert(uid, trimmed.to_string());
                        }
                    }
                }
            }
        }

        let mut cache = self.identity_cache.write().await;
        for (uid, name) in &resolved {
            cache.users_by_uid.insert(*uid, name.clone());
            cache.uids_by_user.insert(name.clone(), *uid);
        }
        uids.into_iter()
            .filter_map(|uid| cache.users_by_uid.get(&uid).map(|name| (uid, name.clone())))
            .collect()
    }

    async fn resolve_gid_names(&self, gids: HashSet<u32>) -> HashMap<u32, String> {
        let missing: Vec<u32> = {
            let cache = self.identity_cache.read().await;
            gids.iter()
                .copied()
                .filter(|gid| !cache.groups_by_gid.contains_key(gid))
                .collect()
        };
        if missing.is_empty() {
            let cache = self.identity_cache.read().await;
            return gids
                .into_iter()
                .filter_map(|gid| {
                    cache
                        .groups_by_gid
                        .get(&gid)
                        .map(|name| (gid, name.clone()))
                })
                .collect();
        }

        let id_list = missing
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        let command = format!(
            "ids={}; for id in $ids; do name=$(getent group \"$id\" 2>/dev/null | cut -d: -f1); if [ -z \"$name\" ] && [ -r /etc/group ]; then name=$(awk -F: -v id=\"$id\" '$3==id {{print $1; exit}}' /etc/group 2>/dev/null); fi; if [ -n \"$name\" ]; then printf '%s:%s\\n' \"$id\" \"$name\"; fi; done",
            sh_quote(&id_list)
        );

        let mut resolved = HashMap::new();
        if let Ok(output) = self.exec_ok(&command).await {
            for line in String::from_utf8_lossy(&output).lines() {
                if let Some((id, name)) = line.split_once(':') {
                    if let Ok(gid) = id.parse::<u32>() {
                        let trimmed = name.trim();
                        if !trimmed.is_empty() {
                            resolved.insert(gid, trimmed.to_string());
                        }
                    }
                }
            }
        }

        let mut cache = self.identity_cache.write().await;
        for (gid, name) in &resolved {
            cache.groups_by_gid.insert(*gid, name.clone());
            cache.gids_by_group.insert(name.clone(), *gid);
        }
        gids.into_iter()
            .filter_map(|gid| {
                cache
                    .groups_by_gid
                    .get(&gid)
                    .map(|name| (gid, name.clone()))
            })
            .collect()
    }

    async fn resolve_user_to_uid(&self, owner: &str) -> AppResult<u32> {
        if let Ok(uid) = owner.parse::<u32>() {
            return Ok(uid);
        }
        if let Some(uid) = self
            .identity_cache
            .read()
            .await
            .uids_by_user
            .get(owner)
            .copied()
        {
            return Ok(uid);
        }
        let command = format!(
            "name={}; id=$(getent passwd \"$name\" 2>/dev/null | cut -d: -f3); if [ -z \"$id\" ] && [ -r /etc/passwd ]; then id=$(awk -F: -v name=\"$name\" '$1==name {{print $3; exit}}' /etc/passwd 2>/dev/null); fi; [ -n \"$id\" ] && printf '%s\\n' \"$id\"",
            sh_quote(owner)
        );
        let output = self.exec_ok(&command).await?;
        let text = String::from_utf8_lossy(&output);
        let uid = text
            .trim()
            .parse::<u32>()
            .map_err(|_| AppError::Channel(format!("Failed to resolve remote user '{}'", owner)))?;
        let mut cache = self.identity_cache.write().await;
        cache.uids_by_user.insert(owner.to_string(), uid);
        cache.users_by_uid.insert(uid, owner.to_string());
        Ok(uid)
    }

    async fn resolve_group_to_gid(&self, group: &str) -> AppResult<u32> {
        if let Ok(gid) = group.parse::<u32>() {
            return Ok(gid);
        }
        if let Some(gid) = self
            .identity_cache
            .read()
            .await
            .gids_by_group
            .get(group)
            .copied()
        {
            return Ok(gid);
        }
        let command = format!(
            "name={}; id=$(getent group \"$name\" 2>/dev/null | cut -d: -f3); if [ -z \"$id\" ] && [ -r /etc/group ]; then id=$(awk -F: -v name=\"$name\" '$1==name {{print $3; exit}}' /etc/group 2>/dev/null); fi; [ -n \"$id\" ] && printf '%s\\n' \"$id\"",
            sh_quote(group)
        );
        let output = self.exec_ok(&command).await?;
        let text = String::from_utf8_lossy(&output);
        let gid = text.trim().parse::<u32>().map_err(|_| {
            AppError::Channel(format!("Failed to resolve remote group '{}'", group))
        })?;
        let mut cache = self.identity_cache.write().await;
        cache.gids_by_group.insert(group.to_string(), gid);
        cache.groups_by_gid.insert(gid, group.to_string());
        Ok(gid)
    }
}

fn sftp_attrs_is_dir(attrs: &FileAttributes) -> bool {
    attrs.permissions.map_or(false, |permissions| {
        (permissions & SFTP_FILE_TYPE_MASK) == 0o040000
    })
}

fn sftp_attrs_is_symlink(attrs: &FileAttributes) -> bool {
    attrs.permissions.map_or(false, |permissions| {
        (permissions & SFTP_FILE_TYPE_MASK) == 0o120000
    })
}

fn normalize_remote_dir_path(path: &str) -> &str {
    if path == "/" {
        "/"
    } else {
        path.trim_end_matches('/')
    }
}

fn normalize_remote_dir_path_bytes(path: &[u8]) -> Vec<u8> {
    if path == b"/" {
        return b"/".to_vec();
    }

    let trimmed = path
        .iter()
        .rposition(|byte| *byte != b'/')
        .map(|index| &path[..=index])
        .unwrap_or(path);
    if trimmed.is_empty() {
        path.to_vec()
    } else {
        trimmed.to_vec()
    }
}

fn join_remote_child(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

fn join_remote_child_bytes(parent: &[u8], name: &[u8]) -> Vec<u8> {
    let mut path = Vec::with_capacity(parent.len() + name.len() + 1);
    if parent == b"/" {
        path.push(b'/');
        path.extend_from_slice(name);
    } else {
        path.extend_from_slice(parent);
        path.push(b'/');
        path.extend_from_slice(name);
    }
    path
}

#[allow(dead_code)]
fn is_safe_recursive_remove_target(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() || matches!(trimmed, "/" | "." | "..") {
        return false;
    }

    let normalized = normalize_remote_dir_path(trimmed);
    !normalized.is_empty()
        && !matches!(normalized, "/" | "." | "..")
        && !normalized.split('/').any(|part| part == "..")
}

fn is_safe_recursive_remove_target_bytes(path: &[u8]) -> bool {
    let normalized = normalize_remote_dir_path_bytes(path);
    if normalized.is_empty() || normalized == b"/" || normalized == b"." || normalized == b".." {
        return false;
    }

    !normalized
        .split(|byte| *byte == b'/')
        .any(|part| part == b"..")
}

async fn resolve_remote_path(
    app: &tauri::AppHandle,
    session_manager: &crate::core::SessionManager,
    sftp: &SftpSession,
    session_id: &str,
    remote_path: &str,
    strategy: &str,
) -> Option<String> {
    let exists = sftp.metadata(remote_path).await.is_ok();
    if !exists {
        return Some(remote_path.to_string());
    }
    let file_name = remote_path.split('/').last().unwrap_or(remote_path);
    let is_directory = sftp
        .metadata(remote_path)
        .await
        .map(|attrs| sftp_attrs_is_dir(&attrs))
        .unwrap_or(false);
    match strategy {
        "skip" => None,
        "rename" => {
            let path = std::path::Path::new(remote_path);
            let stem = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let ext = path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            let parent = path
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "/".to_string());
            for i in 1..=999 {
                let candidate = format!("{}/{}({}){}", parent.trim_end_matches('/'), stem, i, ext);
                if sftp.metadata(&candidate).await.is_err() {
                    return Some(candidate);
                }
            }
            Some(remote_path.to_string())
        }
        "ask" => {
            match super::duplicate::prompt_duplicate_choice(
                app,
                session_manager,
                session_id,
                remote_path,
                file_name,
                is_directory,
            )
            .await
            {
                Ok(super::duplicate::DuplicateChoice::Skip) => None,
                Ok(super::duplicate::DuplicateChoice::Overwrite) => Some(remote_path.to_string()),
                Err(_) => None,
            }
        }
        _ => Some(remote_path.to_string()),
    }
}

async fn ensure_remote_upload_target_allowed(
    app: &tauri::AppHandle,
    session_manager: &crate::core::SessionManager,
    sftp: &SftpSession,
    session_id: &str,
    remote_path: &str,
    strategy: &str,
) -> bool {
    let exists = sftp.metadata(remote_path).await.is_ok();
    if !exists {
        return true;
    }

    let file_name = file_name_from_path(remote_path);
    let is_directory = sftp
        .metadata(remote_path)
        .await
        .map(|attrs| sftp_attrs_is_dir(&attrs))
        .unwrap_or(false);

    match strategy {
        "skip" => false,
        "rename" => true,
        "ask" => {
            matches!(
                super::duplicate::prompt_duplicate_choice(
                    app,
                    session_manager,
                    session_id,
                    remote_path,
                    &file_name,
                    is_directory,
                )
                .await,
                Ok(super::duplicate::DuplicateChoice::Overwrite)
            )
        }
        _ => true,
    }
}

async fn apply_remote_mode_bytes(
    sftp: &SftpSession,
    display_path: &str,
    path_bytes: Vec<u8>,
    requested_mode: u32,
) -> AppResult<()> {
    let original_attrs = sftp.metadata_bytes(path_bytes.clone()).await?;
    let original_permissions = original_attrs.permissions;
    let requested_permissions = requested_mode & POSIX_MODE_MASK;

    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(requested_permissions);
    sftp.set_metadata_bytes(path_bytes.clone(), attrs)
        .await
        .map_err(|error| {
            tracing::warn!(
                remote_path = display_path,
                original_permissions = %describe_permissions(original_permissions),
                requested_permissions = format!("{requested_permissions:#06o}"),
                error = %error,
                "Failed to update remote permissions with a permissions-only SETSTAT payload"
            );
            AppError::from(error)
        })?;

    let actual_permissions = sftp
        .metadata_bytes(path_bytes)
        .await
        .ok()
        .and_then(|attrs| attrs.permissions);
    tracing::debug!(
        target: "user_action",
        action = "chmod",
        remote_path = display_path,
        original_permissions = %describe_permissions(original_permissions),
        requested_permissions = format!("{requested_permissions:#06o}"),
        actual_permissions = %describe_permissions(actual_permissions),
        "Applied remote permissions"
    );

    Ok(())
}

async fn apply_remote_attrs_bytes(
    sftp: &SftpSession,
    display_path: &str,
    path_bytes: Vec<u8>,
    mode: Option<u32>,
    uid: Option<u32>,
    gid: Option<u32>,
) -> AppResult<()> {
    let original_attrs = sftp.symlink_metadata_bytes(path_bytes.clone()).await?;
    let mut attrs = FileAttributes::empty();
    if let Some(mode) = mode {
        let type_bits = original_attrs.permissions.unwrap_or(0) & SFTP_FILE_TYPE_MASK;
        attrs.permissions = Some(type_bits | (mode & POSIX_MODE_MASK));
    }
    if uid.is_some() || gid.is_some() {
        let effective_uid = uid.or(original_attrs.uid);
        let effective_gid = gid.or(original_attrs.gid);
        match (effective_uid, effective_gid) {
            (Some(effective_uid), Some(effective_gid)) => {
                attrs.uid = Some(effective_uid);
                attrs.gid = Some(effective_gid);
            }
            _ => {
                return Err(AppError::Channel(
                    "Cannot update SFTP ownership because the server did not provide the current UID/GID; set both owner and group."
                        .to_string(),
                ));
            }
        }
    }
    if attrs.permissions.is_none() && attrs.uid.is_none() && attrs.gid.is_none() {
        return Ok(());
    }

    sftp.set_metadata_bytes(path_bytes, attrs)
        .await
        .map_err(|error| {
            tracing::warn!(
                remote_path = display_path,
                requested_mode = ?mode,
                requested_uid = ?uid,
                requested_gid = ?gid,
                error = %error,
                "Failed to update remote file attributes"
            );
            AppError::from(error)
        })?;

    Ok(())
}

async fn apply_remote_attrs_recursive_bytes(
    sftp: &SftpSession,
    display_path: &str,
    path_bytes: Vec<u8>,
    mode: Option<u32>,
    uid: Option<u32>,
    gid: Option<u32>,
) -> AppResult<()> {
    let path_bytes = normalize_remote_dir_path_bytes(&path_bytes);
    let meta = sftp.symlink_metadata_bytes(path_bytes.clone()).await?;
    let is_dir = sftp_attrs_is_dir(&meta);
    let is_symlink = sftp_attrs_is_symlink(&meta);

    apply_remote_attrs_bytes(sftp, display_path, path_bytes.clone(), mode, uid, gid).await?;

    if !is_dir || is_symlink {
        return Ok(());
    }

    let dir = sftp.read_dir_bytes(path_bytes.clone()).await?;
    let mut errors: Vec<String> = Vec::new();
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child_bytes = join_remote_child_bytes(&path_bytes, entry.file_name_bytes());
        let child_display = join_remote_child(display_path, &name);
        let attrs = entry.metadata();
        if sftp_attrs_is_dir(&attrs) && !sftp_attrs_is_symlink(&attrs) {
            if let Err(error) = Box::pin(apply_remote_attrs_recursive_bytes(
                sftp,
                &child_display,
                child_bytes,
                mode,
                uid,
                gid,
            ))
            .await
            {
                errors.push(error.to_string());
            }
        } else if let Err(error) =
            apply_remote_attrs_bytes(sftp, &child_display, child_bytes, mode, uid, gid).await
        {
            errors.push(format!("'{}': {}", child_display, error));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Channel(format!(
            "{} item(s) could not be updated:\n{}",
            errors.len(),
            errors.join("\n")
        )))
    }
}

async fn apply_remote_mode_after_create_bytes(
    sftp: &SftpSession,
    display_path: &str,
    path_bytes: Vec<u8>,
    mode: &str,
    item_kind: &str,
) -> AppResult<()> {
    let requested_mode = parse_octal_mode(mode)?;

    match apply_remote_mode_bytes(sftp, display_path, path_bytes.clone(), requested_mode).await {
        Ok(()) => Ok(()),
        Err(error) => {
            if sftp.metadata_bytes(path_bytes).await.is_ok() {
                tracing::warn!(
                    remote_path = display_path,
                    requested_mode = mode,
                    item_kind = %item_kind,
                    error = %error,
                    "Remote item created, but failed to apply requested permissions"
                );
                Ok(())
            } else {
                Err(error)
            }
        }
    }
}

async fn cleanup_cancelled_upload(backend: &SftpBackend, remote_path: &str) -> AppResult<()> {
    let sftp = backend.open_sftp().await?;
    if sftp.metadata(remote_path).await.is_ok() {
        let _ = sftp.remove_file(remote_path).await;
    }
    let _ = sftp.close().await;
    Ok(())
}

fn copy_remote_sidecar_path(target_path: &str, suffix: &str) -> String {
    let name = target_path
        .rsplit('/')
        .find(|part| !part.is_empty())
        .filter(|part| !part.is_empty())
        .unwrap_or("nyaterm-copy");
    let sidecar = format!(".{name}.nyaterm-{suffix}-{}", uuid::Uuid::new_v4());
    match target_path.rsplit_once('/') {
        Some(("", _)) => format!("/{sidecar}"),
        Some((parent, _)) if !parent.is_empty() => format!("{parent}/{sidecar}"),
        _ => sidecar,
    }
}

fn copy_local_sidecar_path(target: &Path, suffix: &str) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("nyaterm-copy");
    let sidecar = format!(".{name}.nyaterm-{suffix}-{}", uuid::Uuid::new_v4());
    target
        .parent()
        .map(|parent| parent.join(&sidecar))
        .unwrap_or_else(|| PathBuf::from(sidecar))
}

async fn cleanup_local_copy_temp(path: &Path) {
    let _ = tokio::fs::remove_file(path).await;
}

async fn commit_local_copy_temp(temp_path: &Path, target_path: &Path) -> AppResult<()> {
    let target_meta = tokio::fs::metadata(target_path).await.ok();
    if target_meta.as_ref().is_some_and(|meta| meta.is_dir()) {
        cleanup_local_copy_temp(temp_path).await;
        return Err(AppError::Channel(format!(
            "Cannot overwrite existing directory '{}' with a file",
            target_path.display()
        )));
    }

    let backup_path = target_meta
        .as_ref()
        .map(|_| copy_local_sidecar_path(target_path, "backup"));
    if let Some(backup) = backup_path.as_ref() {
        tokio::fs::rename(target_path, backup)
            .await
            .map_err(|error| {
                AppError::Channel(format!("Failed to protect existing target file: {error}"))
            })?;
    }

    let commit_result = tokio::fs::rename(temp_path, target_path)
        .await
        .map_err(|error| AppError::Channel(format!("Failed to commit copied file: {error}")));
    match commit_result {
        Ok(()) => {
            if let Some(backup) = backup_path {
                let _ = tokio::fs::remove_file(backup).await;
            }
            Ok(())
        }
        Err(error) => {
            cleanup_local_copy_temp(temp_path).await;
            if let Some(backup) = backup_path {
                let _ = tokio::fs::rename(&backup, target_path).await;
                let _ = tokio::fs::remove_file(backup).await;
            }
            Err(error)
        }
    }
}

async fn read_sftp_chunk(
    remote_file: russh_sftp::client::fs::File,
    offset: u64,
    len: usize,
    remote_path: String,
    remote_size: u64,
    payload_bytes: usize,
) -> AppResult<(u64, Vec<u8>, bool, russh_sftp::client::fs::File)> {
    let mut data = Vec::with_capacity(len);
    let mut read_offset = offset;
    let end_offset = offset.saturating_add(len as u64).min(remote_size);
    let mut completed_range = true;

    while read_offset < end_offset {
        let remaining = (end_offset - read_offset) as usize;
        let chunk = remote_file
            .read_at(read_offset, remaining.min(payload_bytes))
            .await
            .map_err(|e| {
                AppError::Channel(format!(
                    "SFTP read failed for {remote_path} at offset {read_offset}: {e}"
                ))
            })?;
        if chunk.is_empty() {
            completed_range = false;
            break;
        }
        read_offset = match classify_download_read_progress(
            &remote_path,
            "",
            end_offset,
            read_offset,
            data.len() as u64,
            chunk.len(),
            0,
            payload_bytes,
        )? {
            DownloadReadProgress::Continue(next_offset) => next_offset,
            DownloadReadProgress::Complete => end_offset,
        };
        data.extend_from_slice(&chunk);
    }

    Ok((offset, data, completed_range, remote_file))
}

async fn download_known_size_to_local_file<F, G>(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &str,
    local_file: &mut tokio::fs::File,
    total_size: u64,
    request_kib: usize,
    pipeline_depth: usize,
    max_pipeline_depth: usize,
    controller: &Arc<TransferController>,
    parent_controller: Option<&Arc<TransferController>>,
    path_cache: &RwLock<HashMap<String, Vec<u8>>>,
    mut on_bytes: F,
    mut on_progress_interval: G,
) -> AppResult<u64>
where
    F: FnMut(u64, u64),
    G: FnMut(u64),
{
    use std::io::SeekFrom;
    use tokio::io::{AsyncSeekExt, AsyncWriteExt};
    use tokio::task::JoinSet;

    if total_size == 0 {
        ensure_download_complete(
            remote_path,
            local_path,
            total_size,
            0,
            request_kib,
            sftp_payload_size(request_kib),
        )?;
        return Ok(0);
    }

    let chunk_size = sftp_payload_size(request_kib) as u64;
    let num_chunks = total_size.div_ceil(chunk_size) as usize;
    let concurrency = pipeline_depth
        .min(max_pipeline_depth.max(1))
        .min(num_chunks);

    // Look up raw bytes path from cache for non-UTF-8 file names
    let cache = path_cache.read().await;
    let raw_path = cache.get(remote_path).cloned();
    drop(cache);

    let mut handle_pool: Vec<russh_sftp::client::fs::File> = Vec::with_capacity(concurrency);
    for _ in 0..concurrency {
        handle_pool.push(if let Some(ref bytes) = raw_path {
            sftp.open_bytes(bytes.clone())
                .await
                .map_err(|e| AppError::Channel(format!("Failed to open remote file: {}", e)))?
        } else {
            sftp.open(remote_path)
                .await
                .map_err(|e| AppError::Channel(format!("Failed to open remote file: {}", e)))?
        });
    }

    type Task = AppResult<(u64, Vec<u8>, bool, russh_sftp::client::fs::File)>;
    let mut join_set: JoinSet<Task> = JoinSet::new();
    let mut next_offset: u64 = 0;
    let mut last_progress = Instant::now();
    let mut bytes_transferred: u64 = 0;

    while let Some(fh) = handle_pool.pop() {
        if next_offset >= total_size {
            break;
        }
        wait_for_transfer_chain(controller, parent_controller).await?;
        let len = chunk_size.min(total_size - next_offset) as usize;
        let offset = next_offset;
        next_offset += len as u64;
        join_set.spawn(read_sftp_chunk(
            fh,
            offset,
            len,
            remote_path.to_string(),
            total_size,
            chunk_size as usize,
        ));
    }

    while let Some(res) = join_set.join_next().await {
        wait_for_transfer_chain(controller, parent_controller).await?;
        let (chunk_offset, data, completed_range, fh) =
            res.map_err(|e| AppError::Channel(format!("Task panicked: {}", e)))??;

        if !data.is_empty() {
            local_file
                .seek(SeekFrom::Start(chunk_offset))
                .await
                .map_err(|e| AppError::Channel(format!("Local seek failed: {}", e)))?;
            local_file
                .write_all(&data)
                .await
                .map_err(|e| AppError::Channel(format!("Local write failed: {}", e)))?;

            let delta = data.len() as u64;
            bytes_transferred = bytes_transferred.saturating_add(delta);
            on_bytes(bytes_transferred, delta);
        }

        if !completed_range {
            return Err(unexpected_download_eof_error(
                remote_path,
                local_path,
                total_size,
                bytes_transferred,
                request_kib,
                chunk_size as usize,
            ));
        }

        if next_offset < total_size {
            wait_for_transfer_chain(controller, parent_controller).await?;
            let len = chunk_size.min(total_size - next_offset) as usize;
            let offset = next_offset;
            next_offset += len as u64;
            join_set.spawn(read_sftp_chunk(
                fh,
                offset,
                len,
                remote_path.to_string(),
                total_size,
                chunk_size as usize,
            ));
        }

        if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
            last_progress = Instant::now();
            on_progress_interval(bytes_transferred);
        }
    }

    ensure_download_complete(
        remote_path,
        local_path,
        total_size,
        bytes_transferred,
        request_kib,
        chunk_size as usize,
    )?;

    Ok(bytes_transferred)
}

async fn download_remote_file_inner_with_controller(
    backend: &SftpBackend,
    app: &tauri::AppHandle,
    _session_id: &str,
    remote_path: &str,
    actual_path: &str,
    ts: &crate::config::TransferSettings,
    controller: Arc<TransferController>,
    parent_controller: Option<Arc<TransferController>>,
) -> AppResult<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    register_transfer(controller.clone());
    let _ = app.emit(
        "transfer-event",
        &controller.build_event("started", 0, None),
    );

    let (request_kib, pipeline_depth, max_concurrent_writes) = sftp_pipeline_config(ts);
    let chunk_size = sftp_payload_size(request_kib) as u64;
    let transfer_started = Instant::now();

    let result: AppResult<u64> = async {
        if let Some(parent) = std::path::Path::new(&actual_path).parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| AppError::Channel(format!("Failed to create local dir: {}", e)))?;
            }
        }

        let sftp = backend
            .open_sftp_with_client_config(sftp_client_config(request_kib, max_concurrent_writes))
            .await?;

        let remote_attrs = sftp.metadata(remote_path).await.ok();
        let remote_size = remote_attrs.as_ref().and_then(|m| m.size);
        let total_size = remote_size.unwrap_or(0);
        controller.update_progress(0, total_size);

        let mut local_file = tokio::fs::File::create(&actual_path)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to create local file: {}", e)))?;

        if total_size > 0 {
            let _ = local_file.set_len(total_size).await;
        }

        let mut bytes_transferred: u64 = 0;

        if let Some(total_size) = remote_size {
            bytes_transferred = download_known_size_to_local_file(
                &sftp,
                remote_path,
                actual_path,
                &mut local_file,
                total_size,
                request_kib,
                pipeline_depth,
                pipeline_depth,
                &controller,
                parent_controller.as_ref(),
                &backend.path_cache,
                |current, _delta| {
                    controller.update_progress(current, total_size);
                },
                |current| {
                    controller.update_progress(current, total_size);
                    emit_parent_progress(app, parent_controller.as_ref());
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("progress", total_size, None),
                    );
                },
            )
            .await?;
        } else {
            // Look up raw bytes path from cache for non-UTF-8 file names
            let cache = backend.path_cache.read().await;
            let raw_path = cache.get(remote_path).cloned();
            drop(cache);

            let mut last_progress = Instant::now();
            let mut remote_file = if let Some(ref bytes) = raw_path {
                sftp.open_bytes(bytes.clone())
                    .await
                    .map_err(|e| AppError::Channel(format!("Failed to open remote file: {}", e)))?
            } else {
                sftp.open(remote_path)
                    .await
                    .map_err(|e| AppError::Channel(format!("Failed to open remote file: {}", e)))?
            };

            let seq_chunk = (chunk_size as usize).max(64 * 1024);
            let mut buf = vec![0u8; seq_chunk];
            loop {
                wait_for_transfer_chain(&controller, parent_controller.as_ref()).await?;
                let n = remote_file
                    .read(&mut buf)
                    .await
                    .map_err(|e| AppError::Channel(format!("SFTP read failed: {}", e)))?;
                if n == 0 {
                    break;
                }
                local_file
                    .write_all(&buf[..n])
                    .await
                    .map_err(|e| AppError::Channel(format!("Write failed: {}", e)))?;
                bytes_transferred += n as u64;
                controller.update_progress(bytes_transferred, 0);

                if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                    last_progress = Instant::now();
                    emit_parent_progress(app, parent_controller.as_ref());
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("progress", 0, None),
                    );
                }
            }
        }

        local_file
            .flush()
            .await
            .map_err(|e| AppError::Channel(format!("Flush failed: {}", e)))?;

        if let Some(remote_size) = remote_size {
            ensure_download_complete(
                remote_path,
                actual_path,
                remote_size,
                bytes_transferred,
                request_kib,
                chunk_size as usize,
            )?;
        }

        if ts.preserve_timestamps {
            if let Some(ref attrs) = remote_attrs {
                let mtime = attrs.mtime.unwrap_or(0);
                if mtime > 0 {
                    use std::time::UNIX_EPOCH;
                    let set_mtime = UNIX_EPOCH + std::time::Duration::from_secs(u64::from(mtime));
                    let local_file_for_ts = std::fs::File::open(actual_path);
                    if let Ok(f) = local_file_for_ts {
                        let _ = f.set_modified(set_mtime);
                    }
                }
            }
        }

        let _ = sftp.close().await;

        Ok(bytes_transferred)
    }
    .await;

    match result {
        Ok(size) => {
            log_transfer_performance(
                "download",
                "file",
                size,
                transfer_started.elapsed(),
                request_kib,
                pipeline_depth,
                max_concurrent_writes,
                1,
            );
            controller.update_progress(size, size);
            let _ = app.emit(
                "transfer-event",
                &controller.build_event("completed", size, None),
            );
            unregister_transfer(&controller.id());
            Ok(())
        }
        Err(e) => {
            if matches!(e, AppError::Cancelled(_)) {
                cleanup_cancelled_download(actual_path).await;
            } else {
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("error", 0, Some(e.to_string())),
                );
            }
            unregister_transfer(&controller.id());
            Err(e)
        }
    }
}

async fn upload_local_file_inner_with_controller(
    backend: &SftpBackend,
    app: &tauri::AppHandle,
    _session_id: &str,
    local_path: &str,
    remote_path: &str,
    ts: &crate::config::TransferSettings,
    controller: Arc<TransferController>,
    parent_controller: Option<Arc<TransferController>>,
) -> AppResult<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    register_transfer(controller.clone());
    let _ = app.emit(
        "transfer-event",
        &controller.build_event("started", 0, None),
    );

    let (request_kib, pipeline_depth, max_concurrent_writes) = sftp_pipeline_config(ts);
    let chunk_size = sftp_payload_size(request_kib);
    let transfer_started = Instant::now();

    let result: AppResult<u64> = async {
        let local_meta = tokio::fs::metadata(local_path).await;
        let total_size = local_meta.as_ref().map(|m| m.len()).unwrap_or(0);
        controller.update_progress(0, total_size);

        let sftp = backend
            .open_sftp_with_client_config(sftp_client_config(request_kib, max_concurrent_writes))
            .await?;
        let mut bytes_transferred: u64 = 0;

        let mut last_progress = Instant::now();
        let mut local_file = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to open local file: {}", e)))?;
        let mut remote_file = if backend.encoding() != "UTF-8" {
            let path_bytes = backend.encode_path_for_sftp(remote_path);
            use russh_sftp::protocol::OpenFlags;
            sftp.open_with_flags_bytes(
                path_bytes,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
            .map_err(|e| AppError::Channel(format!("Failed to create remote file: {}", e)))?
        } else {
            sftp.create(remote_path)
                .await
                .map_err(|e| AppError::Channel(format!("Failed to create remote file: {}", e)))?
        };

        if total_size > 0 {
            let mut buf = vec![0u8; chunk_size];
            loop {
                wait_for_transfer_chain(&controller, parent_controller.as_ref()).await?;
                let read = local_file
                    .read(&mut buf)
                    .await
                    .map_err(|e| AppError::Channel(format!("Failed to read local file: {}", e)))?;
                if read == 0 {
                    break;
                }

                // russh-sftp >= 2.3 pipelines write ACKs internally according to
                // client::Config::max_concurrent_writes; shutdown below drains them.
                remote_file
                    .write_all(&buf[..read])
                    .await
                    .map_err(|e| AppError::Channel(format!("SFTP write failed: {}", e)))?;

                bytes_transferred += read as u64;
                controller.update_progress(bytes_transferred, total_size);

                if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                    last_progress = Instant::now();
                    emit_parent_progress(app, parent_controller.as_ref());
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("progress", total_size, None),
                    );
                }
            }
        }

        remote_file
            .shutdown()
            .await
            .map_err(|e| AppError::Channel(format!("SFTP flush failed: {}", e)))?;

        if ts.preserve_timestamps {
            if let Ok(ref meta) = local_meta {
                if let Ok(mtime) = meta.modified() {
                    if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                        let atime_secs = meta
                            .accessed()
                            .ok()
                            .and_then(|a| a.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as u32)
                            .unwrap_or(dur.as_secs() as u32);
                        if let Ok(mut attrs) = sftp.metadata(remote_path).await {
                            attrs.mtime = Some(dur.as_secs() as u32);
                            attrs.atime = Some(atime_secs);
                            let _ = sftp.set_metadata(remote_path, attrs).await;
                        }
                    }
                }
            }
        }

        let _ = sftp.close().await;

        Ok(bytes_transferred)
    }
    .await;

    match result {
        Ok(size) => {
            log_transfer_performance(
                "upload",
                "file",
                size,
                transfer_started.elapsed(),
                request_kib,
                pipeline_depth,
                max_concurrent_writes,
                1,
            );
            controller.update_progress(size, size);
            let _ = app.emit(
                "transfer-event",
                &controller.build_event("completed", size, None),
            );
            unregister_transfer(&controller.id());
            Ok(())
        }
        Err(e) => {
            if matches!(e, AppError::Cancelled(_)) {
                let _ = cleanup_cancelled_upload(backend, remote_path).await;
            } else {
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("error", 0, Some(e.to_string())),
                );
            }
            unregister_transfer(&controller.id());
            Err(e)
        }
    }
}

fn copy_transfer_settings(app: &tauri::AppHandle) -> crate::config::TransferSettings {
    crate::config::load_app_settings(app)
        .map(|settings| settings.transfer)
        .unwrap_or_default()
}

async fn ensure_remote_dir_exists(sftp: &SftpSession, path: &str) -> AppResult<()> {
    let mut current = String::new();
    for part in normalize_remote_dir_path(path)
        .split('/')
        .filter(|part| !part.is_empty())
    {
        current.push('/');
        current.push_str(part);
        if sftp.metadata(&current).await.is_ok() {
            continue;
        }
        sftp.create_dir(&current)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to create remote dir: {error}")))?;
    }
    Ok(())
}

#[allow(dead_code)]
pub(crate) async fn copy_local_file_with_controller(
    app: &tauri::AppHandle,
    source_session_id: &str,
    source_path: &str,
    target_path: &str,
    controller: Arc<TransferController>,
) -> AppResult<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    register_transfer(controller.clone());
    let _ = app.emit(
        "transfer-event",
        &controller.build_event("started", 0, None),
    );

    let result: AppResult<u64> = async {
        let metadata = tokio::fs::metadata(source_path).await.map_err(|error| {
            AppError::Channel(format!("Failed to read source file metadata: {error}"))
        })?;
        let total_size = metadata.len();
        controller.update_progress(0, total_size);

        if let Some(parent) = std::path::Path::new(target_path).parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                AppError::Channel(format!("Failed to create target directory: {error}"))
            })?;
        }

        let mut source = tokio::fs::File::open(source_path)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to open source file: {error}")))?;
        let mut target = tokio::fs::File::create(target_path)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to create target file: {error}")))?;
        let mut buffer = vec![0_u8; 512 * 1024];
        let mut bytes_written = 0_u64;
        let mut last_progress = Instant::now();

        loop {
            wait_for_transfer_ready(&controller).await?;
            let read = source.read(&mut buffer).await.map_err(|error| {
                AppError::Channel(format!("Failed to read source file: {error}"))
            })?;
            if read == 0 {
                break;
            }
            wait_for_transfer_ready(&controller).await?;
            target.write_all(&buffer[..read]).await.map_err(|error| {
                AppError::Channel(format!("Failed to write target file: {error}"))
            })?;
            bytes_written = bytes_written.saturating_add(read as u64);
            controller.update_progress(bytes_written, total_size);
            if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                last_progress = Instant::now();
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("progress", total_size, None),
                );
            }
        }
        target
            .flush()
            .await
            .map_err(|error| AppError::Channel(format!("Failed to flush target file: {error}")))?;

        Ok(bytes_written)
    }
    .await;

    match result {
        Ok(size) => {
            controller.update_progress(size, size);
            let _ = app.emit(
                "transfer-event",
                &controller.build_event("completed", size, None),
            );
            unregister_transfer(&controller.id());
            Ok(())
        }
        Err(error) => {
            if matches!(error, AppError::Cancelled(_)) {
                let _ = tokio::fs::remove_file(target_path).await;
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("cancelled", 0, None),
                );
            } else {
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("error", 0, Some(error.to_string())),
                );
            }
            tracing::debug!(
                target: "user_action",
                action = "copy",
                entity = "local_file",
                session_id = %source_session_id,
                source_path = source_path,
                target_path = target_path,
                "Local file copy ended with error"
            );
            unregister_transfer(&controller.id());
            Err(error)
        }
    }
}

#[derive(Clone, Debug)]
struct RemoteCopyFile {
    source_path: String,
    target_path: String,
    size: u64,
}

impl SftpBackend {
    pub(crate) async fn resolve_remote_copy_target_info(
        &self,
        app: &tauri::AppHandle,
        session_manager: &crate::core::SessionManager,
        session_id: &str,
        target_path: &str,
        strategy: &str,
    ) -> Option<CopyResolvedTarget> {
        let sftp = self.open_sftp().await.ok()?;
        let original_existed = sftp
            .metadata_bytes(self.encode_path_for_sftp(target_path))
            .await
            .is_ok();
        let resolved = resolve_remote_path(
            app,
            session_manager,
            &sftp,
            session_id,
            target_path,
            strategy,
        )
        .await;
        let _ = sftp.close().await;
        resolved.map(|path| CopyResolvedTarget {
            existed: if path == target_path {
                original_existed
            } else {
                false
            },
            path,
        })
    }

    pub(crate) async fn copy_local_file_to_remote(
        &self,
        app: &tauri::AppHandle,
        target_session_id: &str,
        source_path: &str,
        target_path: &str,
        _target_existed: bool,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let settings = copy_transfer_settings(app);
        let (request_kib, pipeline_depth, max_concurrent_writes) = sftp_pipeline_config(&settings);
        let chunk_size = sftp_payload_size(request_kib);
        let started = Instant::now();
        let controller = create_child_file_transfer_controller(
            transfer_id,
            target_session_id,
            file_name_from_path(source_path),
            target_path,
            source_path,
            "copy",
            None,
        );
        register_transfer(controller.clone());
        let _ = app.emit(
            "transfer-event",
            &controller.build_event("started", 0, None),
        );

        let temp_path = copy_remote_sidecar_path(target_path, "tmp");
        let result: AppResult<u64> = async {
            let local_meta = tokio::fs::metadata(source_path).await;
            let total_size = local_meta.as_ref().map(|meta| meta.len()).unwrap_or(0);
            controller.update_progress(0, total_size);

            let sftp = self
                .open_sftp_with_client_config(sftp_client_config(
                    request_kib,
                    max_concurrent_writes,
                ))
                .await?;
            if let Some(parent) = target_path.rsplit_once('/').map(|(parent, _)| parent) {
                if !parent.is_empty() {
                    ensure_remote_dir_exists(&sftp, parent).await?;
                }
            }

            let mut local_file = tokio::fs::File::open(source_path).await.map_err(|error| {
                AppError::Channel(format!("Failed to open local file: {error}"))
            })?;
            let mut remote_file = self.create_remote_copy_temp_file(&sftp, &temp_path).await?;

            let mut bytes_written = 0_u64;
            let mut last_progress = Instant::now();
            let mut buffer = vec![0_u8; chunk_size];
            loop {
                wait_for_transfer_ready(&controller).await?;
                let read = local_file.read(&mut buffer).await.map_err(|error| {
                    AppError::Channel(format!("Failed to read local file: {error}"))
                })?;
                if read == 0 {
                    break;
                }
                remote_file
                    .write_all(&buffer[..read])
                    .await
                    .map_err(|error| AppError::Channel(format!("SFTP write failed: {error}")))?;
                bytes_written = bytes_written.saturating_add(read as u64);
                controller.update_progress(bytes_written, total_size);
                if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                    last_progress = Instant::now();
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("progress", total_size, None),
                    );
                }
            }
            remote_file.shutdown().await.map_err(|error| {
                AppError::Channel(format!("SFTP flush failed for temporary file: {error}"))
            })?;
            self.commit_remote_copy_temp(&sftp, &temp_path, target_path)
                .await?;
            if settings.preserve_timestamps {
                if let Ok(ref meta) = local_meta {
                    if let Ok(mtime) = meta.modified() {
                        if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                            if let Ok(mut attrs) = sftp.metadata(target_path).await {
                                attrs.mtime = Some(dur.as_secs() as u32);
                                attrs.atime = meta
                                    .accessed()
                                    .ok()
                                    .and_then(|atime| {
                                        atime.duration_since(std::time::UNIX_EPOCH).ok()
                                    })
                                    .map(|duration| duration.as_secs() as u32);
                                let _ = sftp.set_metadata(target_path, attrs).await;
                            }
                        }
                    }
                }
            }
            let _ = sftp.close().await;
            Ok(bytes_written)
        }
        .await;

        match result {
            Ok(size) => {
                log_transfer_performance(
                    "copy",
                    "file",
                    size,
                    started.elapsed(),
                    request_kib,
                    pipeline_depth,
                    max_concurrent_writes,
                    1,
                );
                controller.update_progress(size, size);
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("completed", size, None),
                );
                unregister_transfer(&controller.id());
                Ok(())
            }
            Err(error) => {
                if let Ok(sftp) = self.open_sftp().await {
                    self.cleanup_remote_copy_temp(&sftp, &temp_path).await;
                    let _ = sftp.close().await;
                }
                let status = if matches!(error, AppError::Cancelled(_)) {
                    "cancelled"
                } else {
                    "error"
                };
                let message = (status == "error").then(|| error.to_string());
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event(status, 0, message),
                );
                unregister_transfer(&controller.id());
                Err(error)
            }
        }
    }

    pub(crate) async fn copy_remote_file_to_local(
        &self,
        app: &tauri::AppHandle,
        source_session_id: &str,
        source_path: &str,
        target_path: &str,
        _target_existed: bool,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let controller = create_child_file_transfer_controller(
            transfer_id,
            source_session_id,
            file_name_from_path(source_path),
            source_path,
            target_path,
            "copy",
            None,
        );
        register_transfer(controller.clone());
        let _ = app.emit(
            "transfer-event",
            &controller.build_event("started", 0, None),
        );

        let target = PathBuf::from(target_path);
        let temp = copy_local_sidecar_path(&target, "tmp");
        let result: AppResult<u64> = async {
            if let Some(parent) = target.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|error| {
                    AppError::Channel(format!("Failed to create target directory: {error}"))
                })?;
            }

            let sftp = self.open_sftp().await?;
            let total_size = sftp
                .metadata(source_path)
                .await
                .ok()
                .and_then(|attrs| attrs.size)
                .unwrap_or(0);
            controller.update_progress(0, total_size);
            let mut source_file = sftp.open(source_path).await.map_err(|error| {
                AppError::Channel(format!("Source connection read open failed: {error}"))
            })?;
            let mut temp_file = tokio::fs::File::create(&temp).await.map_err(|error| {
                AppError::Channel(format!("Failed to create temporary target file: {error}"))
            })?;
            let mut buffer = vec![0_u8; 512 * 1024];
            let mut bytes_written = 0_u64;
            let mut last_progress = Instant::now();

            loop {
                wait_for_transfer_ready(&controller).await?;
                let read = source_file.read(&mut buffer).await.map_err(|error| {
                    AppError::Channel(format!(
                        "Source connection disconnected or read failed for {source_path}: {error}"
                    ))
                })?;
                if read == 0 {
                    break;
                }
                temp_file
                    .write_all(&buffer[..read])
                    .await
                    .map_err(|error| {
                        AppError::Channel(format!("Failed to write temporary target file: {error}"))
                    })?;
                bytes_written = bytes_written.saturating_add(read as u64);
                controller.update_progress(bytes_written, total_size);
                if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                    last_progress = Instant::now();
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("progress", total_size, None),
                    );
                }
            }
            temp_file.flush().await.map_err(|error| {
                AppError::Channel(format!("Failed to flush temporary target file: {error}"))
            })?;
            drop(temp_file);
            commit_local_copy_temp(&temp, &target).await?;
            let _ = sftp.close().await;
            Ok(bytes_written)
        }
        .await;

        match result {
            Ok(size) => {
                controller.update_progress(size, size);
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("completed", size, None),
                );
                unregister_transfer(&controller.id());
                Ok(())
            }
            Err(error) => {
                cleanup_local_copy_temp(&temp).await;
                let status = if matches!(error, AppError::Cancelled(_)) {
                    "cancelled"
                } else {
                    "error"
                };
                let message = (status == "error").then(|| error.to_string());
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event(status, 0, message),
                );
                unregister_transfer(&controller.id());
                Err(error)
            }
        }
    }

    pub(crate) async fn copy_remote_file_to_remote_streaming(
        &self,
        target: &SftpBackend,
        app: &tauri::AppHandle,
        source_session_id: &str,
        source_path: &str,
        target_path: &str,
        _target_existed: bool,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let controller = create_child_file_transfer_controller(
            transfer_id,
            source_session_id,
            file_name_from_path(source_path),
            source_path,
            target_path,
            "copy",
            None,
        );
        register_transfer(controller.clone());
        let _ = app.emit(
            "transfer-event",
            &controller.build_event("started", 0, None),
        );

        let temp_path = copy_remote_sidecar_path(target_path, "tmp");
        let result: AppResult<u64> = async {
            let source_sftp = self.open_sftp().await?;
            let target_sftp = target.open_sftp().await?;
            if let Some(parent) = target_path.rsplit_once('/').map(|(parent, _)| parent) {
                if !parent.is_empty() {
                    ensure_remote_dir_exists(&target_sftp, parent).await?;
                }
            }

            let total_size = source_sftp
                .metadata(source_path)
                .await
                .ok()
                .and_then(|attrs| attrs.size)
                .unwrap_or(0);
            controller.update_progress(0, total_size);

            let mut source_file = source_sftp.open(source_path).await.map_err(|error| {
                AppError::Channel(format!("Source connection read open failed: {error}"))
            })?;
            let mut target_file = target
                .create_remote_copy_temp_file(&target_sftp, &temp_path)
                .await
                .map_err(|error| {
                    AppError::Channel(format!("Target connection write open failed: {error}"))
                })?;
            let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(4);
            let reader_controller = controller.clone();
            let source_path_owned = source_path.to_string();
            let reader = tokio::spawn(async move {
                let mut buffer = vec![0_u8; 512 * 1024];
                loop {
                    wait_for_transfer_ready(&reader_controller).await?;
                    let read = source_file.read(&mut buffer).await.map_err(|error| {
                        AppError::Channel(format!(
                            "Source connection disconnected or read failed for {source_path_owned}: {error}"
                        ))
                    })?;
                    if read == 0 {
                        break;
                    }
                    tx.send(buffer[..read].to_vec()).await.map_err(|_| {
                        AppError::Channel("Target writer stopped before source completed".to_string())
                    })?;
                }
                AppResult::Ok(())
            });

            let mut bytes_written = 0_u64;
            let mut last_progress = Instant::now();
            while let Some(chunk) = rx.recv().await {
                wait_for_transfer_ready(&controller).await?;
                target_file.write_all(&chunk).await.map_err(|error| {
                    AppError::Channel(format!(
                        "Target connection disconnected or write failed for {target_path}: {error}"
                    ))
                })?;
                bytes_written = bytes_written.saturating_add(chunk.len() as u64);
                controller.update_progress(bytes_written, total_size);
                if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                    last_progress = Instant::now();
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("progress", total_size, None),
                    );
                }
            }

            reader
                .await
                .map_err(|error| AppError::Channel(format!("Source reader task failed: {error}")))??;
            target_file.shutdown().await.map_err(|error| {
                AppError::Channel(format!("Target connection flush failed for {target_path}: {error}"))
            })?;
            target
                .commit_remote_copy_temp(&target_sftp, &temp_path, target_path)
                .await?;
            let _ = source_sftp.close().await;
            let _ = target_sftp.close().await;
            Ok(bytes_written)
        }
        .await;

        match result {
            Ok(size) => {
                controller.update_progress(size, size);
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("completed", size, None),
                );
                unregister_transfer(&controller.id());
                Ok(())
            }
            Err(error) => {
                if let Ok(sftp) = target.open_sftp().await {
                    target.cleanup_remote_copy_temp(&sftp, &temp_path).await;
                    let _ = sftp.close().await;
                }
                let status = if matches!(error, AppError::Cancelled(_)) {
                    "cancelled"
                } else {
                    "error"
                };
                let message = (status == "error").then(|| error.to_string());
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event(status, 0, message),
                );
                unregister_transfer(&controller.id());
                Err(error)
            }
        }
    }

    #[allow(dead_code)]
    pub(crate) async fn copy_remote_same_endpoint_fast(
        &self,
        source_path: &str,
        target_path: &str,
        is_directory: bool,
    ) -> AppResult<()> {
        let command = remote_same_endpoint_copy_command(source_path, target_path, is_directory);
        self.exec_ok(&command).await.map(|_| ())
    }

    async fn collect_remote_copy_files(
        &self,
        source_root: &str,
        target_root: &str,
    ) -> AppResult<(Vec<RemoteCopyFile>, u64)> {
        let sftp = self.open_sftp().await?;
        let mut files = Vec::new();
        let mut total_size = 0_u64;
        let mut stack = vec![(source_root.to_string(), target_root.to_string())];

        while let Some((source_dir, target_dir)) = stack.pop() {
            let entries = sftp.read_dir(&source_dir).await?;
            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let source_child = join_remote_child(&source_dir, &name);
                let target_child = join_remote_child(&target_dir, &name);
                let attrs = entry.metadata();
                if sftp_attrs_is_dir(&attrs) {
                    stack.push((source_child, target_child));
                } else {
                    let size = attrs.size.unwrap_or(0);
                    total_size = total_size.saturating_add(size);
                    files.push(RemoteCopyFile {
                        source_path: source_child,
                        target_path: target_child,
                        size,
                    });
                }
            }
        }
        let _ = sftp.close().await;
        Ok((files, total_size))
    }

    pub(crate) async fn copy_local_directory_to_remote(
        &self,
        app: &tauri::AppHandle,
        target_session_id: &str,
        source_path: &str,
        target_path: &str,
        _target_existed: bool,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let settings = copy_transfer_settings(app);
        let (request_kib, pipeline_depth, max_concurrent_writes) = sftp_pipeline_config(&settings);
        let chunk_size = sftp_payload_size(request_kib);
        let started = Instant::now();
        let controller = create_directory_transfer_controller(
            transfer_id,
            target_session_id,
            file_name_from_path(source_path),
            target_path,
            source_path,
            "copy",
            0,
            0,
        );
        register_transfer(controller.clone());
        let _ = app.emit(
            "transfer-event",
            &controller.build_event("started", 0, None),
        );

        let result = async {
            let inventory = self
                .collect_local_directory_inventory(source_path, target_path, &controller, &settings)
                .await?;
            let total_files = inventory.total_files;
            let total_size = inventory.total_size;
            let mut completed = 0_u64;
            let mut bytes_written = 0_u64;
            let mut last_progress = Instant::now();

            for file in inventory.files {
                wait_for_transfer_ready(&controller).await?;
                let temp_path = copy_remote_sidecar_path(&file.remote_path, "tmp");
                let sftp = self
                    .open_sftp_with_client_config(sftp_client_config(
                        request_kib,
                        max_concurrent_writes,
                    ))
                    .await?;
                if let Some(parent) = file.remote_path.rsplit_once('/').map(|(parent, _)| parent) {
                    if !parent.is_empty() {
                        ensure_remote_dir_exists(&sftp, parent).await?;
                    }
                }
                let mut source =
                    tokio::fs::File::open(&file.local_path)
                        .await
                        .map_err(|error| {
                            AppError::Channel(format!("Failed to open local source file: {error}"))
                        })?;
                let mut target_file = self.create_remote_copy_temp_file(&sftp, &temp_path).await?;
                let mut buffer = vec![0_u8; chunk_size];
                let write_result: AppResult<()> = async {
                    loop {
                        wait_for_transfer_ready(&controller).await?;
                        let read = source.read(&mut buffer).await.map_err(|error| {
                            AppError::Channel(format!("Failed to read local source file: {error}"))
                        })?;
                        if read == 0 {
                            break;
                        }
                        target_file
                            .write_all(&buffer[..read])
                            .await
                            .map_err(|error| {
                                AppError::Channel(format!("SFTP write failed: {error}"))
                            })?;
                        bytes_written = bytes_written.saturating_add(read as u64);
                        controller.update_progress(bytes_written, total_size);
                        if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                            last_progress = Instant::now();
                            let _ = app.emit(
                                "transfer-event",
                                &controller.build_event("progress", file.size, None),
                            );
                        }
                    }
                    target_file.shutdown().await.map_err(|error| {
                        AppError::Channel(format!("SFTP flush failed for temporary file: {error}"))
                    })?;
                    Ok(())
                }
                .await;
                drop(target_file);
                if let Err(error) = write_result {
                    self.cleanup_remote_copy_temp(&sftp, &temp_path).await;
                    let _ = sftp.close().await;
                    return Err(error);
                }
                if let Err(error) = self
                    .commit_remote_copy_temp(&sftp, &temp_path, &file.remote_path)
                    .await
                {
                    let _ = sftp.close().await;
                    return Err(error);
                }
                if settings.preserve_timestamps {
                    if let Some(mtime) = file.mtime {
                        if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                            if let Ok(mut attrs) = sftp.metadata(&file.remote_path).await {
                                attrs.mtime = Some(dur.as_secs() as u32);
                                attrs.atime = file.atime.and_then(|atime| {
                                    atime
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .ok()
                                        .map(|duration| duration.as_secs() as u32)
                                });
                                let _ = sftp.set_metadata(&file.remote_path, attrs).await;
                            }
                        }
                    }
                }
                let _ = sftp.close().await;
                completed = completed.saturating_add(1);
                controller.update_item_progress(completed, total_files);
            }

            Ok(DirectoryTransferSummary {
                completed,
                total_files,
                bytes: bytes_written,
                small_file_concurrency: 1,
            })
        }
        .await;

        match result {
            Ok(summary) => {
                log_transfer_performance(
                    "copy",
                    "directory",
                    summary.bytes,
                    started.elapsed(),
                    request_kib,
                    pipeline_depth,
                    max_concurrent_writes,
                    summary.small_file_concurrency,
                );
                controller.update_progress(summary.bytes, summary.bytes);
                controller.update_item_progress(summary.completed, summary.total_files);
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("completed", 0, None),
                );
                unregister_transfer(&controller.id());
                Ok(())
            }
            Err(error) => {
                if matches!(error, AppError::Cancelled(_)) {
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("cancelled", 0, None),
                    );
                } else {
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("error", 0, Some(error.to_string())),
                    );
                }
                unregister_transfer(&controller.id());
                Err(error)
            }
        }
    }

    pub(crate) async fn copy_remote_directory_to_local(
        &self,
        app: &tauri::AppHandle,
        source_session_id: &str,
        source_path: &str,
        target_path: &str,
        _target_existed: bool,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let settings = copy_transfer_settings(app);
        let (request_kib, pipeline_depth, max_concurrent_writes) = sftp_pipeline_config(&settings);
        let started = Instant::now();
        let controller = create_directory_transfer_controller(
            transfer_id,
            source_session_id,
            file_name_from_path(source_path),
            source_path,
            target_path,
            "copy",
            0,
            0,
        );
        register_transfer(controller.clone());
        let _ = app.emit(
            "transfer-event",
            &controller.build_event("started", 0, None),
        );

        let result = async {
            let inventory = self
                .collect_remote_directory_inventory(source_path, target_path, &controller)
                .await?;
            let total_files = inventory.total_files;
            let total_size = inventory.total_size;
            let mut completed = 0_u64;
            let mut bytes_written = 0_u64;
            let mut last_progress = Instant::now();

            for file in inventory.files {
                wait_for_transfer_ready(&controller).await?;
                let target = PathBuf::from(&file.local_path);
                let temp = copy_local_sidecar_path(&target, "tmp");
                if let Some(parent) = target.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|error| {
                        AppError::Channel(format!("Failed to create local target dir: {error}"))
                    })?;
                }
                let sftp = self.open_sftp().await?;
                let mut source_file = sftp.open(&file.remote_path).await.map_err(|error| {
                    AppError::Channel(format!(
                        "Source connection read open failed for {}: {error}",
                        file.remote_path
                    ))
                })?;
                let mut temp_file = tokio::fs::File::create(&temp).await.map_err(|error| {
                    AppError::Channel(format!("Failed to create temporary target file: {error}"))
                })?;
                let mut buffer = vec![0_u8; 512 * 1024];
                let write_result: AppResult<()> = async {
                    loop {
                        wait_for_transfer_ready(&controller).await?;
                        let read = source_file.read(&mut buffer).await.map_err(|error| {
                            AppError::Channel(format!(
                                "Source connection disconnected or read failed for {}: {error}",
                                file.remote_path
                            ))
                        })?;
                        if read == 0 {
                            break;
                        }
                        temp_file
                            .write_all(&buffer[..read])
                            .await
                            .map_err(|error| {
                                AppError::Channel(format!(
                                    "Failed to write temporary target file: {error}"
                                ))
                            })?;
                        bytes_written = bytes_written.saturating_add(read as u64);
                        controller.update_progress(bytes_written, total_size);
                        if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                            last_progress = Instant::now();
                            let _ = app.emit(
                                "transfer-event",
                                &controller.build_event("progress", file.size, None),
                            );
                        }
                    }
                    temp_file.flush().await.map_err(|error| {
                        AppError::Channel(format!("Failed to flush temporary target file: {error}"))
                    })?;
                    Ok(())
                }
                .await;
                drop(temp_file);
                let _ = sftp.close().await;
                if let Err(error) = write_result {
                    cleanup_local_copy_temp(&temp).await;
                    return Err(error);
                }
                if let Err(error) = commit_local_copy_temp(&temp, &target).await {
                    return Err(error);
                }
                if settings.preserve_timestamps {
                    if let Some(mtime) = file.mtime {
                        let modified =
                            std::time::UNIX_EPOCH + std::time::Duration::from_secs(mtime as u64);
                        if let Ok(local_file) = std::fs::OpenOptions::new().read(true).open(&target)
                        {
                            let _ = local_file.set_modified(modified);
                        }
                    }
                }
                completed = completed.saturating_add(1);
                controller.update_item_progress(completed, total_files);
            }

            Ok(DirectoryTransferSummary {
                completed,
                total_files,
                bytes: bytes_written,
                small_file_concurrency: 1,
            })
        }
        .await;

        match result {
            Ok(summary) => {
                log_transfer_performance(
                    "copy",
                    "directory",
                    summary.bytes,
                    started.elapsed(),
                    request_kib,
                    pipeline_depth,
                    max_concurrent_writes,
                    summary.small_file_concurrency,
                );
                controller.update_progress(summary.bytes, summary.bytes);
                controller.update_item_progress(summary.completed, summary.total_files);
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("completed", 0, None),
                );
                unregister_transfer(&controller.id());
                Ok(())
            }
            Err(error) => {
                if matches!(error, AppError::Cancelled(_)) {
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("cancelled", 0, None),
                    );
                } else {
                    let _ = app.emit(
                        "transfer-event",
                        &controller.build_event("error", 0, Some(error.to_string())),
                    );
                }
                unregister_transfer(&controller.id());
                Err(error)
            }
        }
    }

    pub(crate) async fn copy_remote_directory_to_remote_streaming(
        &self,
        target: &SftpBackend,
        app: &tauri::AppHandle,
        source_session_id: &str,
        source_path: &str,
        target_path: &str,
        _target_existed: bool,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let (files, total_size) = self
            .collect_remote_copy_files(source_path, target_path)
            .await?;
        let total_files = files.len() as u64;
        let controller = create_directory_transfer_controller(
            transfer_id,
            source_session_id,
            file_name_from_path(source_path),
            source_path,
            target_path,
            "copy",
            total_files,
            total_size,
        );
        register_transfer(controller.clone());
        let _ = app.emit(
            "transfer-event",
            &controller.build_event("started", 0, None),
        );

        let active_remote_temp = Arc::new(StdMutex::new(None::<String>));
        let active_remote_temp_for_loop = active_remote_temp.clone();
        let result: AppResult<(u64, u64)> = async {
            let mut bytes_written = 0_u64;
            let mut completed = 0_u64;
            let mut last_progress = Instant::now();

            for file in files {
                wait_for_transfer_ready(&controller).await?;
                let source_sftp = self.open_sftp().await?;
                let target_sftp = target.open_sftp().await?;
                let temp_path = copy_remote_sidecar_path(&file.target_path, "tmp");
                *active_remote_temp_for_loop.lock().unwrap() = Some(temp_path.clone());
                if let Some(parent) = file.target_path.rsplit_once('/').map(|(parent, _)| parent) {
                    if !parent.is_empty() {
                        ensure_remote_dir_exists(&target_sftp, parent).await?;
                    }
                }

                let mut source_file = source_sftp.open(&file.source_path).await.map_err(|error| {
                    AppError::Channel(format!(
                        "Source connection read open failed for {}: {error}",
                        file.source_path
                    ))
                })?;
                let mut target_file = target
                    .create_remote_copy_temp_file(&target_sftp, &temp_path)
                    .await
                    .map_err(|error| {
                        AppError::Channel(format!(
                            "Target connection write open failed for {}: {error}",
                            file.target_path
                        ))
                    })?;
                let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(4);
                let reader_controller = controller.clone();
                let source_path_owned = file.source_path.clone();
                let reader = tokio::spawn(async move {
                    let mut buffer = vec![0_u8; 512 * 1024];
                    loop {
                        wait_for_transfer_ready(&reader_controller).await?;
                        let read = source_file.read(&mut buffer).await.map_err(|error| {
                            AppError::Channel(format!(
                                "Source connection disconnected or read failed for {source_path_owned}: {error}"
                            ))
                        })?;
                        if read == 0 {
                            break;
                        }
                        tx.send(buffer[..read].to_vec()).await.map_err(|_| {
                            AppError::Channel(
                                "Target writer stopped before source completed".to_string(),
                            )
                        })?;
                    }
                    AppResult::Ok(())
                });

                while let Some(chunk) = rx.recv().await {
                    wait_for_transfer_ready(&controller).await?;
                    target_file.write_all(&chunk).await.map_err(|error| {
                        AppError::Channel(format!(
                            "Target connection disconnected or write failed for {}: {error}",
                            file.target_path
                        ))
                    })?;
                    bytes_written = bytes_written.saturating_add(chunk.len() as u64);
                    controller.update_progress(bytes_written, total_size);
                    if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
                        last_progress = Instant::now();
                        let _ = app.emit(
                            "transfer-event",
                            &controller.build_event("progress", file.size, None),
                        );
                    }
                }
                reader.await.map_err(|error| {
                    AppError::Channel(format!("Source reader task failed: {error}"))
                })??;
                target_file.shutdown().await.map_err(|error| {
                    AppError::Channel(format!(
                        "Target connection flush failed for {}: {error}",
                        file.target_path
                    ))
                })?;
                target
                    .commit_remote_copy_temp(&target_sftp, &temp_path, &file.target_path)
                    .await?;
                *active_remote_temp_for_loop.lock().unwrap() = None;
                let _ = source_sftp.close().await;
                let _ = target_sftp.close().await;
                completed = completed.saturating_add(1);
                controller.update_item_progress(completed, total_files);
            }

            Ok((bytes_written, completed))
        }
        .await;

        match result {
            Ok((bytes, completed)) => {
                controller.update_progress(bytes, total_size);
                controller.update_item_progress(completed, total_files);
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event("completed", 0, None),
                );
                unregister_transfer(&controller.id());
                Ok(())
            }
            Err(error) => {
                if let Ok(sftp) = target.open_sftp().await {
                    let temp_path = active_remote_temp.lock().unwrap().clone();
                    if let Some(temp_path) = temp_path {
                        target.cleanup_remote_copy_temp(&sftp, &temp_path).await;
                    }
                    let _ = sftp.close().await;
                }
                let status = if matches!(error, AppError::Cancelled(_)) {
                    "cancelled"
                } else {
                    "error"
                };
                let message = (status == "error").then(|| error.to_string());
                let _ = app.emit(
                    "transfer-event",
                    &controller.build_event(status, 0, message),
                );
                unregister_transfer(&controller.id());
                Err(error)
            }
        }
    }
}

#[async_trait::async_trait]
impl RemoteFs for SftpBackend {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn backend_name(&self) -> &'static str {
        "sftp"
    }

    async fn home_dir(&self) -> AppResult<String> {
        let sftp = self.open_sftp().await?;
        let home = sftp.canonicalize(".").await?;
        let _ = sftp.close().await;

        if home.is_empty() {
            Err(AppError::Config(
                "Failed to determine home directory".to_string(),
            ))
        } else {
            Ok(home)
        }
    }

    async fn list_dir(&self, path: &str) -> AppResult<Vec<FileEntry>> {
        let path_ref = RemotePathRef::new(path, None)?;
        self.list_dir_ref(&path_ref).await
    }

    async fn list_dir_ref(&self, path: &RemotePathRef) -> AppResult<Vec<FileEntry>> {
        let sftp = self.open_sftp().await?;

        let path_bytes = normalize_remote_dir_path_bytes(&self.remote_path_bytes(path));
        if path.raw_path().is_some() {
            self.path_cache
                .write()
                .await
                .insert(path.display_path().to_string(), path_bytes.clone());
        }
        let dir = sftp.read_dir_bytes(path_bytes.clone()).await?;

        let mut pending = Vec::new();
        let mut uid_set = HashSet::new();
        let mut gid_set = HashSet::new();
        let normalized_path = normalize_remote_dir_path(path.display_path());

        for entry in dir {
            let name_from_entry = entry.file_name();
            if name_from_entry == "." || name_from_entry == ".." {
                continue;
            }

            // Get raw bytes for the file name to preserve original encoding
            let name_bytes = entry.file_name_bytes().to_vec();

            // Decode using the connection's encoding setting
            let name = self.decode_path_from_sftp(&name_bytes);

            let full_path = join_remote_child(&normalized_path, &name);

            let full_path_bytes = join_remote_child_bytes(&path_bytes, &name_bytes);
            let raw_path_token = raw_path_token(&full_path_bytes);
            self.path_cache
                .write()
                .await
                .insert(full_path.clone(), full_path_bytes.clone());

            let file_type = entry.file_type();
            let is_symlink = file_type == FileType::Symlink;

            // Use raw bytes for metadata operation to handle non-UTF-8 paths
            let is_symlink_to_dir = is_symlink
                && sftp
                    .metadata_bytes(full_path_bytes.clone())
                    .await
                    .ok()
                    .as_ref()
                    .map_or(false, sftp_attrs_is_dir);
            let is_dir = file_type == FileType::Dir || is_symlink_to_dir;
            let type_char = if is_dir {
                if is_symlink { 'l' } else { 'd' }
            } else if is_symlink {
                'l'
            } else {
                '-'
            };

            let attrs = entry.metadata();
            let size = attrs.size.unwrap_or(0);
            let perms = attrs.permissions.unwrap_or(0);
            let permissions = permissions_to_string(perms, type_char);
            let mtime = u64::from(attrs.mtime.unwrap_or(0));

            if attrs
                .user
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
            {
                if let Some(uid) = attrs.uid {
                    uid_set.insert(uid);
                }
            }
            if attrs
                .group
                .as_deref()
                .is_none_or(|value| value.trim().is_empty())
            {
                if let Some(gid) = attrs.gid {
                    gid_set.insert(gid);
                }
            }

            pending.push((
                name,
                is_dir,
                is_symlink,
                size,
                permissions,
                attrs,
                mtime,
                raw_path_token,
            ));
        }

        let _ = sftp.close().await;
        let user_names = self.resolve_uid_names(uid_set).await;
        let group_names = self.resolve_gid_names(gid_set).await;
        let entries = pending
            .into_iter()
            .map(
                |(name, is_dir, is_symlink, size, permissions, attrs, mtime, raw_path_token)| {
                    FileEntry {
                        name,
                        is_dir,
                        is_symlink,
                        size,
                        permissions,
                        owner: attrs
                            .uid
                            .and_then(|uid| user_names.get(&uid).cloned())
                            .unwrap_or_else(|| owner_or_id(&attrs.user, attrs.uid)),
                        group: attrs
                            .gid
                            .and_then(|gid| group_names.get(&gid).cloned())
                            .unwrap_or_else(|| group_or_id(&attrs.group, attrs.gid)),
                        mtime,
                        raw_path_token: Some(raw_path_token),
                    }
                },
            )
            .collect();
        Ok(entries)
    }

    async fn stat(&self, path: &str) -> AppResult<FileProperties> {
        let path_ref = RemotePathRef::new(path, None)?;
        self.stat_ref(&path_ref).await
    }

    async fn stat_ref(&self, path: &RemotePathRef) -> AppResult<FileProperties> {
        let sftp = self.open_sftp().await?;
        let raw_path = self.remote_path_bytes(path);
        let attrs = sftp.symlink_metadata_bytes(raw_path.clone()).await?;
        let is_symlink = sftp_attrs_is_symlink(&attrs);
        let target_attrs = if is_symlink {
            sftp.metadata_bytes(raw_path).await.ok()
        } else {
            None
        };
        let _ = sftp.close().await;

        let perms = attrs.permissions.unwrap_or(0);
        let is_dir =
            sftp_attrs_is_dir(&attrs) || target_attrs.as_ref().map_or(false, sftp_attrs_is_dir);
        let type_char = if is_dir {
            if is_symlink { 'l' } else { 'd' }
        } else if is_symlink {
            'l'
        } else {
            '-'
        };
        let permissions = permissions_to_string(perms, type_char);
        let name = path
            .display_path()
            .split('/')
            .last()
            .unwrap_or(path.display_path())
            .to_string();
        let owner = if let Some(uid) = attrs.uid {
            self.resolve_uid_names(HashSet::from([uid]))
                .await
                .get(&uid)
                .cloned()
                .unwrap_or_else(|| owner_or_id(&attrs.user, attrs.uid))
        } else {
            owner_or_id(&attrs.user, attrs.uid)
        };
        let group = if let Some(gid) = attrs.gid {
            self.resolve_gid_names(HashSet::from([gid]))
                .await
                .get(&gid)
                .cloned()
                .unwrap_or_else(|| group_or_id(&attrs.group, attrs.gid))
        } else {
            group_or_id(&attrs.group, attrs.gid)
        };

        Ok(FileProperties {
            name,
            is_dir,
            is_symlink,
            size: attrs.size.unwrap_or(0),
            permissions,
            owner,
            group,
            uid: attrs.uid.map_or_else(String::new, |v| v.to_string()),
            gid: attrs.gid.map_or_else(String::new, |v| v.to_string()),
            mtime: u64::from(attrs.mtime.unwrap_or(0)),
            atime: u64::from(attrs.atime.unwrap_or(0)),
        })
    }

    async fn mkdir(&self, path: &str, mode: Option<String>) -> AppResult<()> {
        let sftp = self.open_sftp().await?;
        let path_bytes = self.encode_path_for_sftp(path);
        sftp.create_dir_bytes(path_bytes.clone()).await?;
        if let Some(ref m) = mode {
            apply_remote_mode_after_create_bytes(&sftp, path, path_bytes, m, "directory").await?;
        }
        let _ = sftp.close().await;
        Ok(())
    }

    async fn remove_file(&self, path: &str) -> AppResult<()> {
        let path_ref = RemotePathRef::new(path, None)?;
        self.remove_file_ref(&path_ref).await
    }

    async fn remove_file_ref(&self, path: &RemotePathRef) -> AppResult<()> {
        let sftp = self.open_sftp().await?;
        let raw_path = self.remote_path_bytes(path);

        let meta = match sftp.symlink_metadata_bytes(raw_path.clone()).await {
            Ok(meta) => meta,
            Err(error) if is_sftp_not_found(&error) => {
                let _ = sftp.close().await;
                return Ok(());
            }
            Err(error) => {
                let _ = sftp.close().await;
                return Err(error.into());
            }
        };

        if sftp_attrs_is_symlink(&meta) {
            ignore_sftp_not_found(sftp.remove_file_bytes(raw_path).await)?;
        } else if sftp_attrs_is_dir(&meta) {
            let _ = sftp.close().await;
            self.remove_dir_fast_ref(path).await?;
            return Ok(());
        } else {
            ignore_sftp_not_found(sftp.remove_file_bytes(raw_path).await)?;
        }
        let _ = sftp.close().await;
        Ok(())
    }

    async fn rename(&self, old_path: &str, new_path: &str) -> AppResult<()> {
        let old_ref = RemotePathRef::new(old_path, None)?;
        let new_ref = RemotePathRef::new(new_path, None)?;
        self.rename_ref(&old_ref, &new_ref).await
    }

    async fn rename_ref(
        &self,
        old_path: &RemotePathRef,
        new_path: &RemotePathRef,
    ) -> AppResult<()> {
        let sftp = self.open_sftp().await?;
        sftp.rename_bytes(
            self.remote_path_bytes(old_path),
            self.remote_path_bytes(new_path),
        )
        .await?;
        let _ = sftp.close().await;
        Ok(())
    }

    async fn create_file(&self, path: &str, mode: Option<String>) -> AppResult<()> {
        let sftp = self.open_sftp().await?;

        // For non-UTF-8 encodings, encode the path in the target encoding
        // and use open_bytes with WRITE flag to create the file
        let result = if self.encoding != "UTF-8" {
            let path_bytes = self.encode_path_for_sftp(path);
            use russh_sftp::protocol::OpenFlags;
            sftp.open_with_flags_bytes(
                path_bytes,
                OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            )
            .await
        } else {
            sftp.create(path).await
        };

        match result {
            Ok(file) => {
                drop(file);
                if let Some(ref m) = mode {
                    let path_bytes = self.encode_path_for_sftp(path);
                    apply_remote_mode_after_create_bytes(&sftp, path, path_bytes, m, "file")
                        .await?;
                }
                let _ = sftp.close().await;
                Ok(())
            }
            Err(error) => {
                let _ = sftp.close().await;
                Err(error.into())
            }
        }
    }

    async fn create_symlink(&self, link_path: &str, target_path: &str) -> AppResult<()> {
        let sftp = self.open_sftp().await?;
        sftp.symlink_openssh(target_path, link_path).await?;
        let _ = sftp.close().await;
        Ok(())
    }

    async fn update_attrs(&self, path: &str, update: &RemoteFileAttributeUpdate) -> AppResult<()> {
        let path_ref = RemotePathRef::new(path, None)?;
        self.update_attrs_ref(&path_ref, update).await
    }

    async fn update_attrs_ref(
        &self,
        path: &RemotePathRef,
        update: &RemoteFileAttributeUpdate,
    ) -> AppResult<()> {
        let mode = update
            .mode
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(parse_octal_mode)
            .transpose()?
            .map(|value| value & POSIX_MODE_MASK);
        let uid = match update
            .owner
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(owner) => Some(self.resolve_user_to_uid(owner).await?),
            None => None,
        };
        let gid = match update
            .group
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(group) => Some(self.resolve_group_to_gid(group).await?),
            None => None,
        };

        if mode.is_none() && uid.is_none() && gid.is_none() {
            return Ok(());
        }

        let sftp = self.open_sftp().await?;
        let path_bytes = self.remote_path_bytes(path);
        if update.recursive {
            apply_remote_attrs_recursive_bytes(
                &sftp,
                path.display_path(),
                path_bytes,
                mode,
                uid,
                gid,
            )
            .await?;
        } else {
            apply_remote_attrs_bytes(&sftp, path.display_path(), path_bytes, mode, uid, gid)
                .await?;
        }
        let _ = sftp.close().await;
        Ok(())
    }

    async fn read_file_text(&self, path: &str, max_bytes: u64) -> AppResult<RemoteTextFile> {
        use tokio::io::AsyncReadExt;

        let sftp = self.open_sftp().await?;
        let attrs = sftp.metadata(path).await?;
        let size = attrs.size.unwrap_or(0);
        let mtime = u64::from(attrs.mtime.unwrap_or(0));
        let type_bits = attrs.permissions.unwrap_or(0) & SFTP_FILE_TYPE_MASK;
        if type_bits == 0o040000 {
            let _ = sftp.close().await;
            return Err(AppError::Config(
                "Directories cannot be opened as text".to_string(),
            ));
        }
        if size > max_bytes {
            let _ = sftp.close().await;
            return Err(AppError::Config(format!(
                "File is too large to open as text ({} bytes > {} bytes)",
                size, max_bytes
            )));
        }

        let mut file = sftp
            .open(path)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to open remote file: {error}")))?;
        let mut bytes = Vec::with_capacity(size as usize);
        file.read_to_end(&mut bytes)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to read remote file: {error}")))?;
        let _ = sftp.close().await;

        ensure_text_bytes(&bytes, max_bytes)?;
        let content = String::from_utf8(bytes)
            .map_err(|_| AppError::Config("Only UTF-8 text files are supported".to_string()))?;

        Ok(RemoteTextFile {
            path: path.to_string(),
            content,
            size,
            mtime,
        })
    }

    async fn read_file_bytes(&self, path: &str, max_bytes: u64) -> AppResult<RemoteBinaryFile> {
        use tokio::io::AsyncReadExt;

        let sftp = self.open_sftp().await?;
        let attrs = sftp.metadata(path).await?;
        let size = attrs.size.unwrap_or(0);
        let mtime = u64::from(attrs.mtime.unwrap_or(0));
        let type_bits = attrs.permissions.unwrap_or(0) & SFTP_FILE_TYPE_MASK;
        if type_bits == 0o040000 {
            let _ = sftp.close().await;
            return Err(AppError::Config(
                "Directories cannot be previewed".to_string(),
            ));
        }
        if size > max_bytes {
            let _ = sftp.close().await;
            return Err(AppError::Config(format!(
                "File is too large to preview ({} bytes > {} bytes)",
                size, max_bytes
            )));
        }

        let mut file = sftp
            .open(path)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to open remote file: {error}")))?;
        let mut bytes = Vec::with_capacity(size as usize);
        file.read_to_end(&mut bytes)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to read remote file: {error}")))?;
        let _ = sftp.close().await;

        Ok(RemoteBinaryFile {
            path: path.to_string(),
            content_bytes: bytes,
            size,
            mtime,
        })
    }

    async fn write_file_text(
        &self,
        path: &str,
        content: &str,
        expected_mtime: Option<u64>,
        expected_size: Option<u64>,
        force: bool,
    ) -> AppResult<WriteRemoteTextResult> {
        use tokio::io::AsyncWriteExt;

        let sftp = self.open_sftp().await?;
        if !force {
            let attrs = sftp.metadata(path).await?;
            let current_mtime = u64::from(attrs.mtime.unwrap_or(0));
            let current_size = attrs.size.unwrap_or(0);
            if expected_mtime.is_some_and(|mtime| mtime != current_mtime)
                || expected_size.is_some_and(|size| size != current_size)
            {
                let _ = sftp.close().await;
                return Ok(WriteRemoteTextResult::conflict(current_mtime, current_size));
            }
        }

        let mut file = sftp
            .create(path)
            .await
            .map_err(|error| AppError::Channel(format!("Failed to open remote file: {error}")))?;
        file.write_all(content.as_bytes())
            .await
            .map_err(|error| AppError::Channel(format!("Failed to write remote file: {error}")))?;
        file.flush()
            .await
            .map_err(|error| AppError::Channel(format!("Failed to flush remote file: {error}")))?;

        let attrs = sftp.metadata(path).await?;
        let _ = sftp.close().await;
        Ok(WriteRemoteTextResult::saved(
            u64::from(attrs.mtime.unwrap_or(0)),
            attrs.size.unwrap_or(content.len() as u64),
        ))
    }

    async fn download_file(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        let max_retries = transfer_settings.max_transfer_retries;
        let safe_local_path = sanitize_local_download_target(local_path, remote_path);
        let actual_local_path =
            match resolve_local_path(&safe_local_path, &transfer_settings.duplicate_strategy) {
                Some(path) => path,
                None => {
                    let file_name = remote_path.split('/').last().unwrap_or(remote_path);
                    let transfer_id = transfer_id
                        .clone()
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                    remember_transfer_target_external(
                        transfer_id.clone(),
                        safe_local_path.clone(),
                        "download".to_string(),
                        "file".to_string(),
                    );
                    let _ = app.emit(
                        "transfer-event",
                        &TransferEvent {
                            id: transfer_id,
                            session_id: session_id.to_string(),
                            file_name: file_name.to_string(),
                            remote_path: remote_path.to_string(),
                            local_path: safe_local_path,
                            direction: "download".to_string(),
                            kind: "file".to_string(),
                            status: "completed".to_string(),
                            size: 0,
                            bytes_transferred: 0,
                            total_size: 0,
                            parent_id: None,
                            item_count_total: None,
                            item_count_completed: None,
                            error_msg: None,
                        },
                    );
                    return Ok(());
                }
            };

        let mut last_err = None;
        for attempt in 0..=max_retries {
            if attempt > 0 {
                log_event(StructuredLog {
                    level: StructuredLogLevel::Info,
                    domain: "transfer.lifecycle".to_string(),
                    event: "transfer.retry".to_string(),
                    message: "Retrying download".to_string(),
                    ids: Some(serde_json::json!({ "session_id": session_id })),
                    data: Some(serde_json::json!({
                        "direction": "download",
                        "attempt": attempt,
                        "remote_path": remote_path,
                    })),
                    error: None,
                    client_timestamp: None,
                });
            }
            match download_remote_file_inner_with_controller(
                self,
                app,
                session_id,
                remote_path,
                &actual_local_path,
                transfer_settings,
                create_child_file_transfer_controller(
                    transfer_id.clone(),
                    session_id,
                    file_name_from_path(remote_path),
                    remote_path,
                    &actual_local_path,
                    "download",
                    None,
                ),
                None,
            )
            .await
            {
                Ok(()) => return Ok(()),
                Err(e) => {
                    if matches!(e, AppError::Cancelled(_)) {
                        return Err(e);
                    }
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap())
    }

    async fn upload_file(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        let max_retries = transfer_settings.max_transfer_retries;
        let session_manager = app.state::<Arc<crate::core::SessionManager>>();
        let sftp_for_resolve = self.open_sftp().await?;
        let actual_remote_path = match resolve_remote_path(
            app,
            session_manager.inner(),
            &sftp_for_resolve,
            session_id,
            remote_path,
            &transfer_settings.duplicate_strategy,
        )
        .await
        {
            Some(path) => path,
            None => {
                let _ = sftp_for_resolve.close().await;
                return Ok(());
            }
        };
        let _ = sftp_for_resolve.close().await;

        let mut last_err = None;
        for attempt in 0..=max_retries {
            if attempt > 0 {
                log_event(StructuredLog {
                    level: StructuredLogLevel::Info,
                    domain: "transfer.lifecycle".to_string(),
                    event: "transfer.retry".to_string(),
                    message: "Retrying upload".to_string(),
                    ids: Some(serde_json::json!({ "session_id": session_id })),
                    data: Some(serde_json::json!({
                        "direction": "upload",
                        "attempt": attempt,
                        "local_path": local_path,
                    })),
                    error: None,
                    client_timestamp: None,
                });
            }
            match upload_local_file_inner_with_controller(
                self,
                app,
                session_id,
                local_path,
                &actual_remote_path,
                transfer_settings,
                create_child_file_transfer_controller(
                    transfer_id.clone(),
                    session_id,
                    file_name_from_path(&actual_remote_path),
                    &actual_remote_path,
                    local_path,
                    "upload",
                    None,
                ),
                None,
            )
            .await
            {
                Ok(()) => return Ok(()),
                Err(e) => {
                    if matches!(e, AppError::Cancelled(_)) {
                        return Err(e);
                    }
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap())
    }

    async fn download_directory(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        let transfer_settings = crate::config::load_app_settings(app)
            .map(|s| s.transfer)
            .unwrap_or_default();
        let (request_kib, pipeline_depth, max_concurrent_writes) =
            sftp_pipeline_config(&transfer_settings);
        let transfer_started = Instant::now();
        let directory_controller = create_directory_transfer_controller(
            transfer_id,
            session_id,
            file_name_from_path(remote_path),
            remote_path,
            local_path,
            "download",
            0,
            0,
        );
        register_transfer(directory_controller.clone());
        let _ = app.emit(
            "transfer-event",
            &directory_controller.build_event("started", 0, None),
        );

        let result = async {
            let inventory = self
                .collect_remote_directory_inventory(remote_path, local_path, &directory_controller)
                .await?;
            self.download_remote_directory_files(
                app,
                inventory,
                directory_controller.clone(),
                &transfer_settings,
            )
            .await
        }
        .await;

        match result {
            Ok(summary) => {
                log_transfer_performance(
                    "download",
                    "directory",
                    summary.bytes,
                    transfer_started.elapsed(),
                    request_kib,
                    pipeline_depth,
                    max_concurrent_writes,
                    summary.small_file_concurrency,
                );
                directory_controller.update_progress(summary.bytes, summary.bytes);
                directory_controller.update_item_progress(summary.completed, summary.total_files);
                let _ = app.emit(
                    "transfer-event",
                    &directory_controller.build_event("completed", 0, None),
                );
                unregister_transfer(&directory_controller.id());
                Ok(())
            }
            Err(e) => {
                if matches!(e, AppError::Cancelled(_)) {
                    let _ = app.emit(
                        "transfer-event",
                        &directory_controller.build_event("cancelled", 0, None),
                    );
                    cleanup_cancelled_download(local_path).await;
                } else {
                    let _ = app.emit(
                        "transfer-event",
                        &directory_controller.build_event("error", 0, Some(e.to_string())),
                    );
                }
                unregister_transfer(&directory_controller.id());
                Err(e)
            }
        }
    }

    async fn upload_directory(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_settings: &crate::config::TransferSettings,
        transfer_id: Option<String>,
    ) -> AppResult<()> {
        let session_manager = app.state::<Arc<crate::core::SessionManager>>();
        let sftp_for_check = self.open_sftp().await?;
        if !ensure_remote_upload_target_allowed(
            app,
            session_manager.inner(),
            &sftp_for_check,
            session_id,
            remote_path,
            &transfer_settings.duplicate_strategy,
        )
        .await
        {
            let _ = sftp_for_check.close().await;
            return Ok(());
        }
        let _ = sftp_for_check.close().await;

        let (request_kib, pipeline_depth, max_concurrent_writes) =
            sftp_pipeline_config(transfer_settings);
        let transfer_started = Instant::now();
        let directory_controller = create_directory_transfer_controller(
            transfer_id,
            session_id,
            file_name_from_path(local_path),
            remote_path,
            local_path,
            "upload",
            0,
            0,
        );
        register_transfer(directory_controller.clone());
        let _ = app.emit(
            "transfer-event",
            &directory_controller.build_event("started", 0, None),
        );

        let result = async {
            let inventory = self
                .collect_local_directory_inventory(
                    local_path,
                    remote_path,
                    &directory_controller,
                    transfer_settings,
                )
                .await?;
            self.upload_local_directory_files(
                app,
                inventory,
                &directory_controller,
                transfer_settings,
            )
            .await
        }
        .await;

        match result {
            Ok(summary) => {
                log_transfer_performance(
                    "upload",
                    "directory",
                    summary.bytes,
                    transfer_started.elapsed(),
                    request_kib,
                    pipeline_depth,
                    max_concurrent_writes,
                    summary.small_file_concurrency,
                );
                directory_controller.update_progress(summary.bytes, summary.bytes);
                directory_controller.update_item_progress(summary.completed, summary.total_files);
                let _ = app.emit(
                    "transfer-event",
                    &directory_controller.build_event("completed", 0, None),
                );
                unregister_transfer(&directory_controller.id());
                Ok(())
            }
            Err(e) => {
                if matches!(e, AppError::Cancelled(_)) {
                    let _ = app.emit(
                        "transfer-event",
                        &directory_controller.build_event("cancelled", 0, None),
                    );
                    let _ = cleanup_cancelled_upload(self, remote_path).await;
                } else {
                    let _ = app.emit(
                        "transfer-event",
                        &directory_controller.build_event("error", 0, Some(e.to_string())),
                    );
                }
                unregister_transfer(&directory_controller.id());
                Err(e)
            }
        }
    }
}

#[derive(Clone, Debug)]
struct RemoteDirectoryFile {
    remote_path: String,
    local_path: String,
    size: u64,
    mtime: Option<u32>,
}

#[derive(Clone, Debug)]
struct LocalDirectoryFile {
    local_path: String,
    remote_path: String,
    size: u64,
    mtime: Option<std::time::SystemTime>,
    atime: Option<std::time::SystemTime>,
}

struct RemoteDirectoryInventory {
    files: Vec<RemoteDirectoryFile>,
    total_files: u64,
    total_size: u64,
    max_open_handles: Option<u64>,
}

struct LocalDirectoryInventory {
    files: Vec<LocalDirectoryFile>,
    total_files: u64,
    total_size: u64,
    max_open_handles: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
struct DirectoryTransferSummary {
    completed: u64,
    total_files: u64,
    bytes: u64,
    small_file_concurrency: usize,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct RemoteRemoveEntry {
    display_path: String,
    raw_path: Vec<u8>,
}

#[allow(dead_code)]
struct RemoveInventory {
    files: Vec<RemoteRemoveEntry>,
    dirs: Vec<RemoteRemoveEntry>,
}

#[allow(dead_code)]
async fn collect_remove_inventory(
    sftp: &SftpSession,
    display_path: &str,
    path_bytes: Vec<u8>,
) -> AppResult<RemoveInventory> {
    let display_path = normalize_remote_dir_path(display_path).to_string();
    let path_bytes = normalize_remote_dir_path_bytes(&path_bytes);
    let dir = match sftp.read_dir_bytes(path_bytes.clone()).await {
        Ok(dir) => dir,
        Err(error) if is_sftp_not_found(&error) => {
            return Ok(RemoveInventory {
                files: Vec::new(),
                dirs: Vec::new(),
            });
        }
        Err(error) => return Err(error.into()),
    };
    let mut files = Vec::new();
    let mut dirs = vec![RemoteRemoveEntry {
        display_path: display_path.clone(),
        raw_path: path_bytes.clone(),
    }];

    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let child_display = join_remote_child(&display_path, &name);
        let child_bytes = join_remote_child_bytes(&path_bytes, entry.file_name_bytes());
        if entry.file_type() == FileType::Dir {
            let child_inventory =
                Box::pin(collect_remove_inventory(sftp, &child_display, child_bytes)).await?;
            files.extend(child_inventory.files);
            dirs.extend(child_inventory.dirs);
        } else {
            files.push(RemoteRemoveEntry {
                display_path: child_display,
                raw_path: child_bytes,
            });
        }
    }

    Ok(RemoveInventory { files, dirs })
}

#[allow(dead_code)]
async fn remove_inventory_concurrent(
    pool: SftpSessionPool,
    mut inventory: RemoveInventory,
    concurrency: SftpDirectoryConcurrency,
) -> AppResult<()> {
    let worker_count = sftp_directory_file_concurrency(inventory.files.len(), concurrency);
    let queue = Arc::new(StdMutex::new(VecDeque::from(std::mem::take(
        &mut inventory.files,
    ))));
    let mut join_set: tokio::task::JoinSet<AppResult<()>> = tokio::task::JoinSet::new();

    for worker_index in 0..worker_count {
        let pool = pool.clone();
        let queue = queue.clone();
        join_set.spawn(async move {
            loop {
                let file = {
                    let mut queue = queue.lock().unwrap();
                    queue.pop_front()
                };
                let Some(file) = file else {
                    return Ok(());
                };
                let session = pool.session_for(worker_index);
                if let Err(error) = session.remove_file_bytes(file.raw_path.clone()).await {
                    if let Some(message) = sftp_remove_error(&file.display_path, "file", error) {
                        return Err(AppError::Channel(message));
                    }
                }
            }
        });
    }

    let mut errors = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => errors.push(error.to_string()),
            Err(error) => errors.push(format!("Directory delete worker panicked: {error}")),
        }
    }

    inventory
        .dirs
        .sort_by_key(|dir| std::cmp::Reverse(dir.raw_path.iter().filter(|b| **b == b'/').count()));
    for dir in inventory.dirs {
        let session = pool.session_for(0);
        if let Err(error) = session.remove_dir_bytes(dir.raw_path).await {
            if let Some(message) = sftp_remove_error(&dir.display_path, "directory", error) {
                errors.push(message);
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Channel(format!(
            "{} item(s) could not be deleted:\n{}",
            errors.len(),
            errors.join("\n")
        )))
    }
}

impl SftpBackend {
    #[allow(dead_code)]
    async fn remove_dir_fast(&self, path: &str) -> AppResult<()> {
        let path_ref = RemotePathRef::new(path, None)?;
        self.remove_dir_fast_ref(&path_ref).await
    }

    async fn remove_dir_fast_ref(&self, path: &RemotePathRef) -> AppResult<()> {
        let is_utf8_sftp_encoding =
            Encoding::for_label(self.encoding.trim().as_bytes()).unwrap_or(UTF_8) == UTF_8;
        if is_utf8_sftp_encoding
            && path.raw_path().is_none()
            && is_safe_recursive_remove_target(path.display_path())
        {
            let command = format!(
                "rm -rf -- {}",
                sh_quote(normalize_remote_dir_path(path.display_path()))
            );
            match self.exec_ok(&command).await {
                Ok(_) => return Ok(()),
                Err(error) => {
                    tracing::warn!(
                        remote_path = path.display_path(),
                        error = %error,
                        "Remote rm -rf fast path failed, falling back to SFTP recursive delete"
                    );
                }
            }
        }

        let raw_path = self.remote_path_bytes(path);
        if !is_safe_recursive_remove_target_bytes(&raw_path) {
            return Err(AppError::Channel(format!(
                "Refusing to recursively delete unsafe remote path '{}'",
                path.display_path()
            )));
        }

        self.remove_dir_concurrent_sftp(path.display_path(), raw_path)
            .await
    }

    #[allow(dead_code)]
    async fn remove_dir_concurrent_sftp(&self, path: &str, path_bytes: Vec<u8>) -> AppResult<()> {
        let sftp = self.open_sftp().await?;
        let max_open_handles = sftp.max_open_handles();
        let result = collect_remove_inventory(&sftp, path, path_bytes.clone()).await;
        let _ = sftp.close().await;
        let inventory = result?;

        if inventory.files.is_empty() && inventory.dirs.is_empty() {
            return Ok(());
        }

        if inventory.files.is_empty() && inventory.dirs.len() <= 1 {
            let sftp = self.open_sftp().await?;
            let result = sftp
                .remove_dir_bytes(normalize_remote_dir_path_bytes(&path_bytes))
                .await;
            let _ = sftp.close().await;
            return match result {
                Ok(()) => Ok(()),
                Err(error) if is_sftp_not_found(&error) => Ok(()),
                Err(error) => Err(AppError::Channel(format!(
                    "Failed to remove directory '{}': {}",
                    normalize_remote_dir_path(path),
                    error
                ))),
            };
        }

        let concurrency = sftp_directory_concurrency(max_open_handles);
        let pool = SftpSessionPool::new(
            self,
            concurrency.session_pool_size,
            SftpClientConfig::default(),
        )
        .await?;
        let result = remove_inventory_concurrent(pool.clone(), inventory, concurrency).await;
        pool.close_all().await;
        result
    }

    async fn collect_remote_directory_inventory(
        &self,
        remote_path: &str,
        local_path: &str,
        directory_controller: &Arc<TransferController>,
    ) -> AppResult<RemoteDirectoryInventory> {
        let sftp = self.open_sftp().await?;
        let max_open_handles = sftp.max_open_handles();
        let result = self
            .collect_remote_directory_inventory_inner(
                &sftp,
                remote_path,
                local_path,
                directory_controller,
            )
            .await;
        let _ = sftp.close().await;
        result.map(|(files, total_size)| {
            let total_files = files.len() as u64;
            directory_controller.update_totals(total_size, total_files);
            RemoteDirectoryInventory {
                files,
                total_files,
                total_size,
                max_open_handles,
            }
        })
    }

    async fn collect_remote_directory_inventory_inner(
        &self,
        sftp: &SftpSession,
        remote_path: &str,
        local_path: &str,
        directory_controller: &Arc<TransferController>,
    ) -> AppResult<(Vec<RemoteDirectoryFile>, u64)> {
        wait_for_transfer_ready(directory_controller).await?;

        tokio::fs::create_dir_all(local_path)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to create local dir: {}", e)))?;

        let dir = sftp.read_dir(remote_path).await?;
        let mut files = Vec::new();
        let mut total_size = 0u64;

        for entry in dir {
            wait_for_transfer_ready(directory_controller).await?;

            let name = entry.file_name();
            let child_remote = join_remote_child(normalize_remote_dir_path(remote_path), &name);
            let child_local = append_safe_local_child_path(local_path, &name);
            let attrs = entry.metadata();
            let file_type = entry.file_type();
            let is_symlink = file_type == FileType::Symlink;
            let is_symlink_to_dir = is_symlink
                && sftp
                    .metadata(&child_remote)
                    .await
                    .ok()
                    .as_ref()
                    .map_or(false, sftp_attrs_is_dir);

            if file_type == FileType::Dir || is_symlink_to_dir {
                let (child_files, child_size) =
                    Box::pin(self.collect_remote_directory_inventory_inner(
                        sftp,
                        &child_remote,
                        &child_local,
                        directory_controller,
                    ))
                    .await?;
                total_size = total_size.saturating_add(child_size);
                files.extend(child_files);
            } else if !is_symlink {
                let size = attrs.size.unwrap_or(0);
                total_size = total_size.saturating_add(size);
                files.push(RemoteDirectoryFile {
                    remote_path: child_remote,
                    local_path: child_local,
                    size,
                    mtime: attrs.mtime,
                });
                directory_controller.update_totals(total_size, files.len() as u64);
            }
        }

        Ok((files, total_size))
    }

    async fn collect_local_directory_inventory(
        &self,
        local_path: &str,
        remote_path: &str,
        directory_controller: &Arc<TransferController>,
        transfer_settings: &crate::config::TransferSettings,
    ) -> AppResult<LocalDirectoryInventory> {
        let (request_kib, _, max_concurrent_writes) = sftp_pipeline_config(transfer_settings);
        let sftp = self
            .open_sftp_with_client_config(sftp_client_config(request_kib, max_concurrent_writes))
            .await?;
        let max_open_handles = sftp.max_open_handles();
        let result = self
            .collect_local_directory_inventory_inner(
                &sftp,
                local_path,
                remote_path,
                directory_controller,
            )
            .await;
        let _ = sftp.close().await;
        result.map(|(files, total_size)| {
            let total_files = files.len() as u64;
            directory_controller.update_totals(total_size, total_files);
            LocalDirectoryInventory {
                files,
                total_files,
                total_size,
                max_open_handles,
            }
        })
    }

    async fn collect_local_directory_inventory_inner(
        &self,
        sftp: &SftpSession,
        local_path: &str,
        remote_path: &str,
        directory_controller: &Arc<TransferController>,
    ) -> AppResult<(Vec<LocalDirectoryFile>, u64)> {
        wait_for_transfer_ready(directory_controller).await?;

        let _ = sftp.create_dir(remote_path).await;
        let mut files = Vec::new();
        let mut total_size = 0u64;
        let mut read_dir = tokio::fs::read_dir(local_path)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to read local dir: {}", e)))?;

        while let Some(entry) = read_dir
            .next_entry()
            .await
            .map_err(|e| AppError::Channel(format!("Failed to read dir entry: {}", e)))?
        {
            wait_for_transfer_ready(directory_controller).await?;

            let file_type = entry
                .file_type()
                .await
                .map_err(|e| AppError::Channel(format!("Failed to get file type: {}", e)))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let child_local = std::path::Path::new(local_path)
                .join(&name)
                .to_string_lossy()
                .to_string();
            let child_remote = join_remote_child(normalize_remote_dir_path(remote_path), &name);

            if file_type.is_dir() {
                let (child_files, child_size) =
                    Box::pin(self.collect_local_directory_inventory_inner(
                        sftp,
                        &child_local,
                        &child_remote,
                        directory_controller,
                    ))
                    .await?;
                total_size = total_size.saturating_add(child_size);
                files.extend(child_files);
            } else if file_type.is_file() {
                let metadata = entry.metadata().await.map_err(|e| {
                    AppError::Channel(format!("Failed to read file metadata: {}", e))
                })?;
                let size = metadata.len();
                total_size = total_size.saturating_add(size);
                files.push(LocalDirectoryFile {
                    local_path: child_local,
                    remote_path: child_remote,
                    size,
                    mtime: metadata.modified().ok(),
                    atime: metadata.accessed().ok(),
                });
                directory_controller.update_totals(total_size, files.len() as u64);
            }
        }

        Ok((files, total_size))
    }

    async fn download_remote_directory_files(
        &self,
        app: &tauri::AppHandle,
        inventory: RemoteDirectoryInventory,
        directory_controller: Arc<TransferController>,
        transfer_settings: &crate::config::TransferSettings,
    ) -> AppResult<DirectoryTransferSummary> {
        let concurrency = sftp_directory_concurrency(inventory.max_open_handles);
        if inventory.files.is_empty() {
            return Ok(DirectoryTransferSummary {
                completed: 0,
                total_files: 0,
                bytes: 0,
                small_file_concurrency: concurrency.small_file_concurrency,
            });
        }

        let (request_kib, _, max_concurrent_writes) = sftp_pipeline_config(transfer_settings);
        let pool = SftpSessionPool::new(
            self,
            concurrency.session_pool_size,
            sftp_client_config(request_kib, max_concurrent_writes),
        )
        .await?;
        let result = run_download_directory_workers(
            app,
            pool.clone(),
            inventory,
            directory_controller,
            transfer_settings,
            concurrency,
            self.path_cache.clone(),
        )
        .await;
        pool.close_all().await;
        result
    }

    async fn upload_local_directory_files(
        &self,
        app: &tauri::AppHandle,
        inventory: LocalDirectoryInventory,
        directory_controller: &Arc<TransferController>,
        transfer_settings: &crate::config::TransferSettings,
    ) -> AppResult<DirectoryTransferSummary> {
        let concurrency = sftp_directory_concurrency(inventory.max_open_handles);
        if inventory.files.is_empty() {
            return Ok(DirectoryTransferSummary {
                completed: 0,
                total_files: 0,
                bytes: 0,
                small_file_concurrency: concurrency.small_file_concurrency,
            });
        }

        let (request_kib, _, max_concurrent_writes) = sftp_pipeline_config(transfer_settings);
        let pool = SftpSessionPool::new(
            self,
            concurrency.session_pool_size,
            sftp_client_config(request_kib, max_concurrent_writes),
        )
        .await?;
        let result = run_upload_directory_workers(
            app,
            pool.clone(),
            inventory,
            directory_controller.clone(),
            transfer_settings,
            concurrency,
        )
        .await;
        pool.close_all().await;
        result
    }
}

fn sftp_directory_file_concurrency(
    files_len: usize,
    concurrency: SftpDirectoryConcurrency,
) -> usize {
    files_len.min(concurrency.small_file_concurrency).max(1)
}

fn add_directory_transferred_bytes(
    directory_controller: &Arc<TransferController>,
    completed_bytes: &AtomicU64,
    delta: u64,
    total_size: u64,
) -> u64 {
    let bytes_done = completed_bytes.fetch_add(delta, Ordering::SeqCst) + delta;
    directory_controller.update_progress(bytes_done, total_size);
    bytes_done
}

async fn run_download_directory_workers(
    app: &tauri::AppHandle,
    pool: SftpSessionPool,
    inventory: RemoteDirectoryInventory,
    directory_controller: Arc<TransferController>,
    transfer_settings: &crate::config::TransferSettings,
    concurrency: SftpDirectoryConcurrency,
    path_cache: Arc<RwLock<HashMap<String, Vec<u8>>>>,
) -> AppResult<DirectoryTransferSummary> {
    let worker_count = sftp_directory_file_concurrency(inventory.files.len(), concurrency);
    let total_files = inventory.total_files;
    let total_size = inventory.total_size;
    let queue = Arc::new(StdMutex::new(VecDeque::from(inventory.files)));
    let completed_count = Arc::new(AtomicU64::new(0));
    let completed_bytes = Arc::new(AtomicU64::new(0));
    let large_lane = Arc::new(Semaphore::new(concurrency.large_file_concurrency));
    let mut join_set = tokio::task::JoinSet::new();

    for worker_index in 0..worker_count {
        let app = app.clone();
        let pool = pool.clone();
        let queue = queue.clone();
        let directory_controller = directory_controller.clone();
        let completed_count = completed_count.clone();
        let completed_bytes = completed_bytes.clone();
        let large_lane = large_lane.clone();
        let transfer_settings = transfer_settings.clone();
        let path_cache = path_cache.clone();
        join_set.spawn(async move {
            loop {
                wait_for_transfer_ready(&directory_controller).await?;
                let file = {
                    let mut queue = queue.lock().unwrap();
                    queue.pop_front()
                };
                let Some(file) = file else {
                    return Ok(());
                };
                let _large_permit = if file.size > SFTP_SMALL_FILE_THRESHOLD {
                    Some(large_lane.acquire().await.map_err(|e| {
                        AppError::Channel(format!("SFTP large-file lane closed: {}", e))
                    })?)
                } else {
                    None
                };
                let session = pool.session_for(worker_index);
                let _bytes = download_directory_file_with_session(
                    &app,
                    session,
                    file,
                    &directory_controller,
                    &transfer_settings,
                    &completed_bytes,
                    total_size,
                    concurrency.small_file_concurrency,
                    &path_cache,
                )
                .await?;
                let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
                directory_controller.update_item_progress(completed, total_files);
                let bytes_done = completed_bytes.load(Ordering::SeqCst);
                directory_controller.update_progress(bytes_done, total_size);
                let _ = app.emit(
                    "transfer-event",
                    &directory_controller.build_event("progress", 0, None),
                );
            }
        });
    }

    let mut first_err = None;
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                if first_err.is_none() {
                    first_err = Some(error);
                }
            }
            Err(error) => {
                if first_err.is_none() {
                    first_err = Some(AppError::Channel(format!(
                        "Directory download worker panicked: {}",
                        error
                    )));
                }
            }
        }
    }

    if let Some(error) = first_err {
        Err(error)
    } else {
        Ok(DirectoryTransferSummary {
            completed: completed_count.load(Ordering::SeqCst),
            total_files,
            bytes: completed_bytes.load(Ordering::SeqCst),
            small_file_concurrency: concurrency.small_file_concurrency,
        })
    }
}

async fn run_upload_directory_workers(
    app: &tauri::AppHandle,
    pool: SftpSessionPool,
    inventory: LocalDirectoryInventory,
    directory_controller: Arc<TransferController>,
    transfer_settings: &crate::config::TransferSettings,
    concurrency: SftpDirectoryConcurrency,
) -> AppResult<DirectoryTransferSummary> {
    let worker_count = sftp_directory_file_concurrency(inventory.files.len(), concurrency);
    let total_files = inventory.total_files;
    let total_size = inventory.total_size;
    let queue = Arc::new(StdMutex::new(VecDeque::from(inventory.files)));
    let completed_count = Arc::new(AtomicU64::new(0));
    let completed_bytes = Arc::new(AtomicU64::new(0));
    let large_lane = Arc::new(Semaphore::new(concurrency.large_file_concurrency));
    let mut join_set = tokio::task::JoinSet::new();

    for worker_index in 0..worker_count {
        let app = app.clone();
        let pool = pool.clone();
        let queue = queue.clone();
        let directory_controller = directory_controller.clone();
        let completed_count = completed_count.clone();
        let completed_bytes = completed_bytes.clone();
        let large_lane = large_lane.clone();
        let transfer_settings = transfer_settings.clone();
        join_set.spawn(async move {
            loop {
                wait_for_transfer_ready(&directory_controller).await?;
                let file = {
                    let mut queue = queue.lock().unwrap();
                    queue.pop_front()
                };
                let Some(file) = file else {
                    return Ok(());
                };
                let _large_permit = if file.size > SFTP_SMALL_FILE_THRESHOLD {
                    Some(large_lane.acquire().await.map_err(|e| {
                        AppError::Channel(format!("SFTP large-file lane closed: {}", e))
                    })?)
                } else {
                    None
                };
                let session = pool.session_for(worker_index);
                let _bytes = upload_directory_file_with_session(
                    &app,
                    session,
                    file,
                    &directory_controller,
                    &transfer_settings,
                    &completed_bytes,
                    total_size,
                )
                .await?;
                let completed = completed_count.fetch_add(1, Ordering::SeqCst) + 1;
                directory_controller.update_item_progress(completed, total_files);
                let bytes_done = completed_bytes.load(Ordering::SeqCst);
                directory_controller.update_progress(bytes_done, total_size);
                let _ = app.emit(
                    "transfer-event",
                    &directory_controller.build_event("progress", 0, None),
                );
            }
        });
    }

    let mut first_err = None;
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                if first_err.is_none() {
                    first_err = Some(error);
                }
            }
            Err(error) => {
                if first_err.is_none() {
                    first_err = Some(AppError::Channel(format!(
                        "Directory upload worker panicked: {}",
                        error
                    )));
                }
            }
        }
    }

    if let Some(error) = first_err {
        Err(error)
    } else {
        Ok(DirectoryTransferSummary {
            completed: completed_count.load(Ordering::SeqCst),
            total_files,
            bytes: completed_bytes.load(Ordering::SeqCst),
            small_file_concurrency: concurrency.small_file_concurrency,
        })
    }
}

async fn download_directory_file_with_session(
    app: &tauri::AppHandle,
    sftp: Arc<ManagedSftpSession>,
    file: RemoteDirectoryFile,
    directory_controller: &Arc<TransferController>,
    transfer_settings: &crate::config::TransferSettings,
    completed_bytes: &Arc<AtomicU64>,
    total_size: u64,
    max_pipeline_depth: usize,
    path_cache: &RwLock<HashMap<String, Vec<u8>>>,
) -> AppResult<u64> {
    use tokio::io::AsyncWriteExt;

    wait_for_transfer_ready(directory_controller).await?;
    if let Some(parent) = std::path::Path::new(&file.local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Channel(format!("Failed to create local dir: {}", e)))?;
    }

    let mut local_file = tokio::fs::File::create(&file.local_path)
        .await
        .map_err(|e| {
            AppError::Channel(format!(
                "Failed to create local file {}: {}",
                file.local_path, e
            ))
        })?;
    if file.size > 0 {
        let _ = local_file.set_len(file.size).await;
    }

    let mut bytes_transferred = 0u64;
    let (request_kib, pipeline_depth, _) = sftp_pipeline_config(transfer_settings);
    let payload_bytes = sftp_payload_size(request_kib);
    if file.size > 0 {
        let app_for_progress = app.clone();
        bytes_transferred = download_known_size_to_local_file(
            &sftp,
            &file.remote_path,
            &file.local_path,
            &mut local_file,
            file.size,
            request_kib,
            pipeline_depth,
            max_pipeline_depth,
            directory_controller,
            None,
            path_cache,
            |_current, delta| {
                add_directory_transferred_bytes(
                    directory_controller,
                    completed_bytes,
                    delta,
                    total_size,
                );
            },
            |_current| {
                let _ = app_for_progress.emit(
                    "transfer-event",
                    &directory_controller.build_event("progress", 0, None),
                );
            },
        )
        .await?;
    }

    local_file
        .flush()
        .await
        .map_err(|e| AppError::Channel(format!("Flush failed for {}: {}", file.local_path, e)))?;

    ensure_download_complete(
        &file.remote_path,
        &file.local_path,
        file.size,
        bytes_transferred,
        request_kib,
        payload_bytes,
    )?;

    if transfer_settings.preserve_timestamps {
        if let Some(mtime) = file.mtime.filter(|mtime| *mtime > 0) {
            let set_mtime =
                std::time::UNIX_EPOCH + std::time::Duration::from_secs(u64::from(mtime));
            if let Ok(f) = std::fs::File::open(&file.local_path) {
                let _ = f.set_modified(set_mtime);
            }
        }
    }

    emit_parent_progress(app, Some(directory_controller));
    Ok(bytes_transferred)
}

async fn upload_directory_file_with_session(
    app: &tauri::AppHandle,
    sftp: Arc<ManagedSftpSession>,
    file: LocalDirectoryFile,
    directory_controller: &Arc<TransferController>,
    transfer_settings: &crate::config::TransferSettings,
    completed_bytes: &Arc<AtomicU64>,
    total_size: u64,
) -> AppResult<u64> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    wait_for_transfer_ready(directory_controller).await?;
    let mut local_file = tokio::fs::File::open(&file.local_path).await.map_err(|e| {
        AppError::Channel(format!(
            "Failed to open local file {}: {}",
            file.local_path, e
        ))
    })?;
    let mut remote_file = sftp.create(&file.remote_path).await.map_err(|e| {
        AppError::Channel(format!(
            "Failed to create remote file {}: {}",
            file.remote_path, e
        ))
    })?;

    let (request_kib, _, _) = sftp_pipeline_config(transfer_settings);
    let mut buf = vec![0u8; sftp_payload_size(request_kib)];
    let mut bytes_transferred = 0u64;
    let mut last_progress = Instant::now();
    loop {
        wait_for_transfer_ready(directory_controller).await?;
        let read = local_file.read(&mut buf).await.map_err(|e| {
            AppError::Channel(format!(
                "Failed to read local file {}: {}",
                file.local_path, e
            ))
        })?;
        if read == 0 {
            break;
        }
        remote_file.write_all(&buf[..read]).await.map_err(|e| {
            AppError::Channel(format!("SFTP write failed for {}: {}", file.remote_path, e))
        })?;
        bytes_transferred = bytes_transferred.saturating_add(read as u64);
        add_directory_transferred_bytes(
            directory_controller,
            completed_bytes,
            read as u64,
            total_size,
        );

        if last_progress.elapsed() >= TRANSFER_PROGRESS_INTERVAL {
            last_progress = Instant::now();
            let _ = app.emit(
                "transfer-event",
                &directory_controller.build_event("progress", 0, None),
            );
        }
    }
    remote_file.shutdown().await.map_err(|e| {
        AppError::Channel(format!("SFTP flush failed for {}: {}", file.remote_path, e))
    })?;

    if transfer_settings.preserve_timestamps {
        if let Some(mtime) = file.mtime {
            if let Ok(dur) = mtime.duration_since(std::time::UNIX_EPOCH) {
                let atime_secs = file
                    .atime
                    .and_then(|a| a.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as u32)
                    .unwrap_or(dur.as_secs() as u32);
                if let Ok(mut attrs) = sftp.metadata(&file.remote_path).await {
                    attrs.mtime = Some(dur.as_secs() as u32);
                    attrs.atime = Some(atime_secs);
                    let _ = sftp.set_metadata(&file.remote_path, attrs).await;
                }
            }
        }
    }

    emit_parent_progress(app, Some(directory_controller));
    Ok(bytes_transferred)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_same_endpoint_file_copy_command_quotes_paths() {
        let command = remote_same_endpoint_copy_command(
            "/tmp/source dir/it's $(safe).txt",
            "/tmp/target dir/out's file.txt",
            false,
        );

        assert!(command.contains("cp -a --"));
        assert!(command.contains("'/tmp/source dir/it'\\''s $(safe).txt'"));
        assert!(command.contains("'/tmp/target dir/out'\\''s file.txt'"));
    }

    #[test]
    fn remote_same_endpoint_directory_copy_command_merges_existing_target() {
        let command = remote_same_endpoint_copy_command("/tmp/source dir", "/tmp/target dir", true);

        assert!(command.contains("if [ -d '/tmp/target dir' ]; then"));
        assert!(command.contains("cp -a -- '/tmp/source dir'/. '/tmp/target dir'/"));
        assert!(command.contains("else cp -a -- '/tmp/source dir' '/tmp/target dir'"));
    }

    #[test]
    fn download_progress_allows_short_non_empty_reads_until_complete() {
        let remote_size = 256 * 1024;
        let request_kib = 256;
        let payload_bytes = 256 * 1024;
        let read_bytes = 64 * 1024;
        let mut offset = 0;
        let mut bytes_written = 0;

        for _ in 0..3 {
            let progress = classify_download_read_progress(
                "/remote/file.bin",
                "C:/local/file.bin",
                remote_size,
                offset,
                bytes_written,
                read_bytes as usize,
                request_kib,
                payload_bytes,
            )
            .expect("short non-empty read should continue");

            offset = match progress {
                DownloadReadProgress::Continue(next_offset) => next_offset,
                DownloadReadProgress::Complete => panic!("download completed too early"),
            };
            bytes_written += read_bytes;
        }

        let progress = classify_download_read_progress(
            "/remote/file.bin",
            "C:/local/file.bin",
            remote_size,
            offset,
            bytes_written,
            read_bytes as usize,
            request_kib,
            payload_bytes,
        )
        .expect("final short read should complete");
        assert_eq!(progress, DownloadReadProgress::Complete);
        bytes_written += read_bytes;
        assert!(
            ensure_download_complete(
                "/remote/file.bin",
                "C:/local/file.bin",
                remote_size,
                bytes_written,
                request_kib,
                payload_bytes,
            )
            .is_ok()
        );
    }

    #[test]
    fn download_progress_rejects_empty_read_before_remote_size() {
        let error = classify_download_read_progress(
            "/remote/file.bin",
            "C:/local/file.bin",
            256 * 1024,
            64 * 1024,
            64 * 1024,
            0,
            256,
            256 * 1024,
        )
        .expect_err("empty read before remote size should fail");

        assert!(error.to_string().contains("Unexpected EOF"));
        assert!(
            error
                .to_string()
                .contains("expected 262144 bytes, got 65536 bytes")
        );
    }

    #[test]
    fn download_completion_rejects_short_written_count() {
        let error = ensure_download_complete(
            "/remote/file.bin",
            "C:/local/file.bin",
            256 * 1024,
            192 * 1024,
            256,
            256 * 1024,
        )
        .expect_err("short written count should fail");

        assert!(error.to_string().contains("Unexpected EOF"));
        assert!(
            error
                .to_string()
                .contains("expected 262144 bytes, got 196608 bytes")
        );
    }

    #[test]
    fn download_completion_accepts_empty_remote_file() {
        assert!(
            ensure_download_complete(
                "/remote/empty.txt",
                "C:/local/empty.txt",
                0,
                0,
                256,
                256 * 1024,
            )
            .is_ok()
        );
    }

    #[test]
    fn directory_concurrency_uses_fast_default_without_server_limits() {
        let concurrency = sftp_directory_concurrency(None);

        assert_eq!(concurrency.session_pool_size, 2);
        assert_eq!(concurrency.small_file_concurrency, 64);
        assert_eq!(concurrency.large_file_concurrency, 2);
    }

    #[test]
    fn directory_concurrency_respects_low_server_handle_limits() {
        let concurrency = sftp_directory_concurrency(Some(12));

        assert_eq!(concurrency.session_pool_size, 2);
        assert_eq!(concurrency.small_file_concurrency, 4);
        assert_eq!(concurrency.large_file_concurrency, 2);
    }

    #[test]
    fn sftp_channel_open_retry_classifies_temporary_capacity_failures() {
        assert!(is_retryable_sftp_channel_open_error(
            &russh::Error::ChannelOpenFailure(ChannelOpenFailure::ConnectFailed)
        ));
        assert!(is_retryable_sftp_channel_open_error(
            &russh::Error::ChannelOpenFailure(ChannelOpenFailure::ResourceShortage)
        ));
    }

    #[test]
    fn sftp_channel_open_retry_rejects_policy_and_type_failures() {
        assert!(!is_retryable_sftp_channel_open_error(
            &russh::Error::ChannelOpenFailure(ChannelOpenFailure::AdministrativelyProhibited)
        ));
        assert!(!is_retryable_sftp_channel_open_error(
            &russh::Error::ChannelOpenFailure(ChannelOpenFailure::UnknownChannelType)
        ));
    }

    #[test]
    fn directory_concurrency_keeps_at_least_one_worker() {
        let concurrency = sftp_directory_concurrency(Some(2));

        assert_eq!(concurrency.session_pool_size, 1);
        assert_eq!(concurrency.small_file_concurrency, 1);
        assert_eq!(concurrency.large_file_concurrency, 1);
    }

    #[test]
    fn directory_progress_accumulates_chunk_deltas_without_completion_double_count() {
        let controller = create_directory_transfer_controller(
            Some("directory-progress-test".to_string()),
            "session-1",
            "folder".to_string(),
            "/remote/folder",
            "C:/local/folder",
            "download",
            2,
            1_000,
        );
        let completed_bytes = AtomicU64::new(0);

        assert_eq!(
            add_directory_transferred_bytes(&controller, &completed_bytes, 128, 1_000),
            128
        );
        assert_eq!(
            add_directory_transferred_bytes(&controller, &completed_bytes, 256, 1_000),
            384
        );

        controller.update_item_progress(1, 2);
        controller.update_progress(completed_bytes.load(Ordering::SeqCst), 1_000);

        let event = controller.build_event("progress", 0, None);
        assert_eq!(event.bytes_transferred, 384);
        assert_eq!(event.item_count_completed, Some(1));
        assert_eq!(event.item_count_total, Some(2));
    }

    #[test]
    fn directory_worker_count_is_bounded_by_file_count() {
        let concurrency = sftp_directory_concurrency(None);

        assert_eq!(sftp_directory_file_concurrency(0, concurrency), 1);
        assert_eq!(sftp_directory_file_concurrency(3, concurrency), 3);
        assert_eq!(
            sftp_directory_file_concurrency(10_000, concurrency),
            concurrency.small_file_concurrency
        );
    }

    #[test]
    fn recursive_remove_rejects_dangerous_targets() {
        assert!(!is_safe_recursive_remove_target(""));
        assert!(!is_safe_recursive_remove_target("/"));
        assert!(!is_safe_recursive_remove_target("."));
        assert!(!is_safe_recursive_remove_target(".."));
        assert!(!is_safe_recursive_remove_target("/tmp/../home"));
    }

    #[test]
    fn recursive_remove_accepts_normal_remote_targets() {
        assert!(is_safe_recursive_remove_target("/tmp/uploads"));
        assert!(is_safe_recursive_remove_target("relative/uploads"));
        assert!(is_safe_recursive_remove_target("/home/user/data/"));
    }

    #[test]
    fn raw_child_path_is_joined_from_parent_bytes() {
        let parent = b"/remote/\x80parent".to_vec();
        let child = b"\x81child".to_vec();

        assert_eq!(
            join_remote_child_bytes(&parent, &child),
            b"/remote/\x80parent/\x81child"
        );
    }
}

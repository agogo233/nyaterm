//! Unified `RemoteFs` trait that all remote file system backends implement.

use super::util::{FileEntry, FileProperties, RemoteTextFile};
use crate::error::AppResult;

/// Common interface for remote file system operations.
///
/// Each backend (SFTP, SCP Enhanced, SCP Normal) implements this trait so the
/// upper-level orchestrator can switch between them transparently.
#[async_trait::async_trait]
pub(crate) trait RemoteFs: Send + Sync {
    fn backend_name(&self) -> &'static str;

    async fn home_dir(&self) -> AppResult<String>;
    async fn list_dir(&self, path: &str) -> AppResult<Vec<FileEntry>>;
    async fn stat(&self, path: &str) -> AppResult<FileProperties>;
    async fn mkdir(&self, path: &str, mode: Option<String>) -> AppResult<()>;
    async fn remove_file(&self, path: &str) -> AppResult<()>;
    async fn rename(&self, old_path: &str, new_path: &str) -> AppResult<()>;
    async fn create_file(&self, path: &str, mode: Option<String>) -> AppResult<()>;
    async fn create_symlink(&self, link_path: &str, target_path: &str) -> AppResult<()>;
    async fn chmod(&self, path: &str, mode: &str) -> AppResult<()>;
    async fn read_file_text(&self, path: &str, max_bytes: u64) -> AppResult<RemoteTextFile>;

    async fn download_file(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_settings: &crate::config::TransferSettings,
    ) -> AppResult<()>;

    async fn upload_file(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        transfer_settings: &crate::config::TransferSettings,
    ) -> AppResult<()>;

    async fn download_directory(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> AppResult<()>;

    async fn upload_directory(
        &self,
        app: &tauri::AppHandle,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> AppResult<()>;
}

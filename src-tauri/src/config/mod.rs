//! Config persistence for sessions, UI, and quick commands.
//!
//! Stores typed entities and small singleton documents in `~/.nyaterm/nyaterm.redb`.
//! Credentials are AES-256-GCM encrypted in-place.

mod cloud_sync;
mod connection;
mod credential;
mod key;
mod otp;
mod password;
mod proxy;
mod quick_command;
mod settings;
mod tunnel;
mod ui;

#[allow(unused_imports)]
pub use cloud_sync::{
    decrypt_cloud_sync_settings, encrypt_cloud_sync_settings, load_cloud_sync_settings,
    load_cloud_sync_state, mask_cloud_sync_settings, merge_masked_cloud_sync_settings,
    save_cloud_sync_state, CloudConflictPreview, CloudSyncHistoryEntry, CloudSyncSettings,
    CloudSyncState, CloudSyncStatus, GiteeSnippetSyncSettings, RemoteBackupEntry,
    RemoteBackupIndex, S3SyncSettings, WebdavSyncSettings, CLOUD_SYNC_HISTORY_VERSION,
    MASKED_SECRET_VALUE,
};
#[allow(unused_imports)]
pub use connection::{
    load_config, load_connection_by_id, load_sessions, save_config, save_sessions,
    AiExecutionProfile, AppConfig, ConnectionAuth, ConnectionNetwork, ConnectionType, Group,
    SavedConnection, SessionsConfig,
};
#[allow(unused_imports)]
pub use credential::{
    load_credential_by_id, load_credentials, save_credentials, upsert_credential,
    CredentialsConfig, SavedCredential,
};
#[allow(unused_imports)]
pub use key::{
    decrypt_key_cert, decrypt_key_pem, load_key_by_id, load_keys, save_keys, KeysConfig, SshKey,
};
#[allow(unused_imports)]
pub use otp::{load_otp_entries, load_otp_entry_by_id, save_otp_entries, OtpConfig, OtpEntry};
#[allow(unused_imports)]
pub use password::{
    load_password_by_id, load_passwords, save_passwords, PasswordsConfig, SavedPassword,
};
#[allow(unused_imports)]
pub use proxy::{load_proxies, load_proxy_by_id, save_proxies, ProxyConfig};
#[allow(unused_imports)]
pub use quick_command::{
    load_quick_commands, save_quick_commands, QuickCommand, QuickCommandCategory,
    QuickCommandsConfig,
};
#[allow(unused_imports)]
pub use settings::{
    ai_model_id_for_credential, ai_model_id_for_provider, decrypt_ai_settings, encrypt_ai_settings,
    load_app_settings, mask_ai_settings, merge_masked_ai_settings, normalize_ai_settings,
    save_app_settings, ActionLinksMatcherSettings, AgentCommandExecutionMode,
    AiCustomActionConfig, AiMode, AiModelConfigItem, AiModelSource, AiProviderCredential,
    AiProviderKind, AiProviderProfile, AiSettings, AppSettings, AppearanceSettings,
    DiagnosticsLogLevel, DiagnosticsSettings, GeneralSettings, InteractionSettings,
    KeywordHighlightRule, ProxySettings, RiskLevel, SearchEngine, SearchSettings,
    SecuritySettings, TerminalSettings, TransferSettings, TranslationSettings,
    AI_REQUEST_USER_AGENT_DEFAULT,
};
#[allow(unused_imports)]
pub use tunnel::{load_tunnels, save_tunnels, TunnelConfig, TunnelsConfig};
#[allow(unused_imports)]
pub use ui::{ActivityBarLayout, RestorablePaneNode, RestorableTab, UiConfig};

pub(crate) fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn default_true() -> bool {
    true
}

pub(crate) fn default_false() -> bool {
    false
}

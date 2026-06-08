use crate::config::{
    self, ActivityBarLayout, AppSettings, DiagnosticsSettings, InteractionSettings, SearchSettings,
    TerminalSettings, TransferSettings, TranslationSettings,
};
use crate::error::{AppError, AppResult};
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use zip::write::SimpleFileOptions;

use super::{QuickCommandsStore, SessionManager};

const PORTABLE_SNAPSHOT_SCHEMA_VERSION: u32 = 3;
const SNAPSHOT_META_KEY: &str = "meta";
const SNAPSHOT_JSON_PORTABLE_SETTINGS: &str = "portable-settings";
const SNAPSHOT_ZIP_MANIFEST_NAME: &str = "manifest.json";
const SNAPSHOT_ZIP_PAYLOAD_NAME: &str = "snapshot.redb";
const MAX_COMPRESSED_SNAPSHOT_PAYLOAD_BYTES: u64 = 50 * 1024 * 1024;

const SNAPSHOT_META_TABLE: TableDefinition<&str, &str> = TableDefinition::new("snapshot_meta");
const SNAPSHOT_ENTITIES_TABLE: TableDefinition<&str, &str> = TableDefinition::new("entity_docs");
const SNAPSHOT_V2_JSON_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("json_docs");
const SNAPSHOT_V2_TEXT_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("text_docs");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortableSnapshotKind {
    Sync,
    Backup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableSnapshot {
    pub schema_version: u32,
    pub snapshot_kind: PortableSnapshotKind,
    pub revision_id: String,
    pub device_id: String,
    pub created_at_ms: u64,
    pub payload_hash: String,
    pub app_version: String,
    pub settings: PortableAppSettings,
    #[serde(default)]
    pub sessions: config::SessionsConfig,
    #[serde(default)]
    pub keys: config::KeysConfig,
    #[serde(default)]
    pub passwords: config::PasswordsConfig,
    #[serde(default)]
    pub credentials: config::CredentialsConfig,
    #[serde(default)]
    pub otp: config::OtpConfig,
    #[serde(default)]
    pub proxies: Vec<config::ProxyConfig>,
    #[serde(default)]
    pub tunnels: Vec<config::TunnelConfig>,
    #[serde(default)]
    pub quick_commands: config::QuickCommandsConfig,
    #[serde(default)]
    pub history: Vec<crate::core::history::HistoryEntry>,
    #[serde(default)]
    pub master_key_token: Option<String>,
    #[serde(default)]
    pub known_hosts: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PortableSnapshotMeta {
    schema_version: u32,
    snapshot_kind: PortableSnapshotKind,
    revision_id: String,
    device_id: String,
    created_at_ms: u64,
    payload_hash: String,
    app_version: String,
}

impl From<&PortableSnapshot> for PortableSnapshotMeta {
    fn from(snapshot: &PortableSnapshot) -> Self {
        Self {
            schema_version: snapshot.schema_version,
            snapshot_kind: snapshot.snapshot_kind.clone(),
            revision_id: snapshot.revision_id.clone(),
            device_id: snapshot.device_id.clone(),
            created_at_ms: snapshot.created_at_ms,
            payload_hash: snapshot.payload_hash.clone(),
            app_version: snapshot.app_version.clone(),
        }
    }
}

#[derive(Serialize)]
struct SnapshotHashInput<'a> {
    settings: &'a PortableAppSettings,
    sessions: &'a config::SessionsConfig,
    keys: &'a config::KeysConfig,
    passwords: &'a config::PasswordsConfig,
    credentials: &'a config::CredentialsConfig,
    otp: &'a config::OtpConfig,
    proxies: &'a [config::ProxyConfig],
    tunnels: &'a [config::TunnelConfig],
    quick_commands: &'a config::QuickCommandsConfig,
    history: &'a [crate::core::history::HistoryEntry],
    master_key_token: &'a Option<String>,
    known_hosts: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableUiSettings {
    pub language: Option<String>,
    pub show_remote_stats: bool,
    pub remote_stats_interval: u32,
    pub saved_connections_sort_mode: String,
    pub activity_bar_layout: ActivityBarLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableAppSettings {
    pub general: config::GeneralSettings,
    pub appearance: config::AppearanceSettings,
    pub proxy: config::ProxySettings,
    pub search: SearchSettings,
    pub translation: TranslationSettings,
    pub security: config::SecuritySettings,
    pub terminal: TerminalSettings,
    pub interaction: InteractionSettings,
    pub transfer: TransferSettings,
    pub diagnostics: DiagnosticsSettings,
    pub ui: PortableUiSettings,
}

impl PortableAppSettings {
    pub fn from_app_settings(settings: &AppSettings) -> Self {
        let mut security = settings.security.clone();
        security.master_password = None;
        Self {
            general: settings.general.clone(),
            appearance: settings.appearance.clone(),
            proxy: settings.proxy.clone(),
            search: settings.search.clone(),
            translation: settings.translation.clone(),
            security,
            terminal: settings.terminal.clone(),
            interaction: settings.interaction.clone(),
            transfer: settings.transfer.clone(),
            diagnostics: settings.diagnostics.clone(),
            ui: PortableUiSettings {
                language: settings.ui.language.clone(),
                show_remote_stats: settings.ui.show_remote_stats,
                remote_stats_interval: settings.ui.remote_stats_interval,
                saved_connections_sort_mode: settings.ui.saved_connections_sort_mode.clone(),
                activity_bar_layout: settings.ui.activity_bar_layout.clone(),
            },
        }
    }

    pub fn apply_to(self, mut current: AppSettings) -> AppSettings {
        let master_password = current.security.master_password.clone();
        let ui_state = current.ui.clone();

        current.general = self.general;
        current.appearance = self.appearance;
        current.proxy = self.proxy;
        current.search = self.search;
        current.translation = self.translation;
        current.security = self.security;
        current.security.master_password = master_password;
        current.terminal = self.terminal;
        current.interaction = self.interaction;
        current.transfer = self.transfer;
        current.diagnostics = self.diagnostics;
        current.ui.language = self.ui.language;
        current.ui.show_remote_stats = self.ui.show_remote_stats;
        current.ui.remote_stats_interval = self.ui.remote_stats_interval;
        current.ui.saved_connections_sort_mode = self.ui.saved_connections_sort_mode;
        current.ui.activity_bar_layout = self.ui.activity_bar_layout;

        // Preserve device-local UI state.
        current.ui.open_tabs = ui_state.open_tabs;
        current.ui.left_width = ui_state.left_width;
        current.ui.right_width = ui_state.right_width;
        current.ui.quick_cmd_height = ui_state.quick_cmd_height;
        current.ui.active_left_panel = ui_state.active_left_panel;
        current.ui.active_right_panel = ui_state.active_right_panel;
        current.ui.show_quick_cmd_bar = ui_state.show_quick_cmd_bar;
        current.ui.show_serial_send_panel = ui_state.show_serial_send_panel;
        current.ui.serial_send_height = ui_state.serial_send_height;
        current.ui.zoom_level = ui_state.zoom_level;
        current.ui.transfer_height = ui_state.transfer_height;
        current
    }
}

pub fn build_portable_snapshot(
    app: &AppHandle,
    snapshot_kind: PortableSnapshotKind,
    device_id: &str,
) -> AppResult<PortableSnapshot> {
    let _ = config::load_config(app)?;
    let settings = config::load_app_settings(app)?;
    let history = if snapshot_kind == PortableSnapshotKind::Backup {
        crate::storage::list_command_history_entries(usize::MAX)?
    } else {
        Vec::new()
    };

    let mut snapshot = PortableSnapshot {
        schema_version: PORTABLE_SNAPSHOT_SCHEMA_VERSION,
        snapshot_kind,
        revision_id: uuid::Uuid::new_v4().to_string(),
        device_id: device_id.to_string(),
        created_at_ms: current_time_ms(),
        payload_hash: String::new(),
        app_version: app.package_info().version.to_string(),
        settings: PortableAppSettings::from_app_settings(&settings),
        sessions: config::load_sessions(app)?,
        keys: config::load_keys(app)?,
        passwords: config::load_passwords(app)?,
        credentials: config::load_credentials(app)?,
        otp: config::load_otp_entries(app)?,
        proxies: config::load_proxies(app)?,
        tunnels: config::load_tunnels(app)?,
        quick_commands: config::load_quick_commands(app)?,
        history,
        master_key_token: crate::storage::load_master_key_token()?,
        known_hosts: crate::storage::render_known_hosts_export()?,
    };
    snapshot.payload_hash = calculate_payload_hash(&snapshot)?;
    Ok(snapshot)
}

pub fn decode_portable_snapshot(bytes: &[u8]) -> AppResult<PortableSnapshot> {
    let payload = if is_zip_snapshot_payload(bytes) {
        decode_compressed_snapshot_payload(bytes)?
    } else {
        bytes.to_vec()
    };
    decode_portable_snapshot_redb(&payload)
}

fn decode_portable_snapshot_redb(bytes: &[u8]) -> AppResult<PortableSnapshot> {
    let temp = TempRedbFile::new("portable-snapshot-decode");
    fs::write(temp.path(), bytes)?;

    let snapshot = {
        let db = Database::open(temp.path()).map_err(storage_error)?;
        let read = db.begin_read().map_err(storage_error)?;
        let meta_table = read
            .open_table(SNAPSHOT_META_TABLE)
            .map_err(storage_error)?;
        let meta_raw = meta_table
            .get(SNAPSHOT_META_KEY)
            .map_err(storage_error)?
            .ok_or_else(|| AppError::Config("portable snapshot is missing metadata".to_string()))?
            .value()
            .to_string();
        let meta: PortableSnapshotMeta = serde_json::from_str(&meta_raw)?;

        if meta.schema_version == 2 {
            decode_v2_snapshot(&read, meta)?
        } else {
            let entities = read_string_table(&read, SNAPSHOT_ENTITIES_TABLE)?;
            PortableSnapshot {
                schema_version: meta.schema_version,
                snapshot_kind: meta.snapshot_kind,
                revision_id: meta.revision_id,
                device_id: meta.device_id,
                created_at_ms: meta.created_at_ms,
                payload_hash: meta.payload_hash,
                app_version: meta.app_version,
                settings: read_entity(&entities, "settings")?,
                sessions: read_entity_or_default(&entities, "sessions")?,
                keys: read_entity_or_default(&entities, "keys")?,
                passwords: read_entity_or_default(&entities, "passwords")?,
                credentials: read_entity_or_default(&entities, "credentials")?,
                otp: read_entity_or_default(&entities, "otp")?,
                proxies: read_entity_or_default(&entities, "proxies")?,
                tunnels: read_entity_or_default(&entities, "tunnels")?,
                quick_commands: read_entity_or_default(&entities, "quick_commands")?,
                history: read_entity_or_default(&entities, "history")?,
                master_key_token: read_entity_or_default(&entities, "master_key_token")?,
                known_hosts: read_entity_or_default(&entities, "known_hosts")?,
            }
        }
    };

    validate_portable_snapshot(&snapshot)?;
    Ok(snapshot)
}

pub fn encode_portable_snapshot(snapshot: &PortableSnapshot) -> AppResult<Vec<u8>> {
    validate_portable_snapshot(snapshot)?;

    let redb_payload = encode_portable_snapshot_redb(snapshot)?;
    let compressed_payload = encode_compressed_snapshot_payload(&redb_payload)?;
    log_snapshot_compression(snapshot, redb_payload.len(), compressed_payload.len());
    Ok(compressed_payload)
}

fn encode_portable_snapshot_redb(snapshot: &PortableSnapshot) -> AppResult<Vec<u8>> {
    let temp = TempRedbFile::new("portable-snapshot-encode");
    {
        let db = Database::create(temp.path()).map_err(storage_error)?;
        let txn = db.begin_write().map_err(storage_error)?;
        {
            let mut meta = txn.open_table(SNAPSHOT_META_TABLE).map_err(storage_error)?;
            let meta_content = serde_json::to_string(&PortableSnapshotMeta::from(snapshot))?;
            meta.insert(SNAPSHOT_META_KEY, meta_content.as_str())
                .map_err(storage_error)?;
        }
        let mut entities = txn
            .open_table(SNAPSHOT_ENTITIES_TABLE)
            .map_err(storage_error)?;
        insert_entity(&mut entities, "settings", &snapshot.settings)?;
        insert_entity(&mut entities, "sessions", &snapshot.sessions)?;
        insert_entity(&mut entities, "keys", &snapshot.keys)?;
        insert_entity(&mut entities, "passwords", &snapshot.passwords)?;
        insert_entity(&mut entities, "credentials", &snapshot.credentials)?;
        insert_entity(&mut entities, "otp", &snapshot.otp)?;
        insert_entity(&mut entities, "proxies", &snapshot.proxies)?;
        insert_entity(&mut entities, "tunnels", &snapshot.tunnels)?;
        insert_entity(&mut entities, "quick_commands", &snapshot.quick_commands)?;
        insert_entity(&mut entities, "history", &snapshot.history)?;
        insert_entity(
            &mut entities,
            "master_key_token",
            &snapshot.master_key_token,
        )?;
        insert_entity(&mut entities, "known_hosts", &snapshot.known_hosts)?;
        drop(entities);
        txn.commit().map_err(storage_error)?;
    }

    fs::read(temp.path()).map_err(Into::into)
}

fn encode_compressed_snapshot_payload(redb_payload: &[u8]) -> AppResult<Vec<u8>> {
    let cursor = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(SNAPSHOT_ZIP_MANIFEST_NAME, options)
        .map_err(zip_error)?;
    zip.write_all(
        br#"{"format":"nyaterm-portable-snapshot-zip","version":1,"payload":"snapshot.redb"}"#,
    )?;
    zip.start_file(SNAPSHOT_ZIP_PAYLOAD_NAME, options)
        .map_err(zip_error)?;
    zip.write_all(redb_payload)?;

    let cursor = zip.finish().map_err(zip_error)?;
    Ok(cursor.into_inner())
}

fn decode_compressed_snapshot_payload(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(zip_error)?;
    let mut entry = archive
        .by_name(SNAPSHOT_ZIP_PAYLOAD_NAME)
        .map_err(zip_error)?;
    if entry.size() > MAX_COMPRESSED_SNAPSHOT_PAYLOAD_BYTES {
        return Err(zip_error(format!(
            "decompressed snapshot payload exceeds maximum allowed size of {} bytes",
            MAX_COMPRESSED_SNAPSHOT_PAYLOAD_BYTES
        )));
    }
    let mut payload = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = entry.read(&mut buf).map_err(zip_error)?;
        if n == 0 {
            break;
        }
        payload.extend_from_slice(&buf[..n]);
        if u64::try_from(payload.len()).unwrap_or(u64::MAX) > MAX_COMPRESSED_SNAPSHOT_PAYLOAD_BYTES
        {
            return Err(zip_error(format!(
                "decompressed snapshot payload exceeds maximum allowed size of {} bytes",
                MAX_COMPRESSED_SNAPSHOT_PAYLOAD_BYTES
            )));
        }
    }
    Ok(payload)
}

fn is_zip_snapshot_payload(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
}

fn log_snapshot_compression(
    snapshot: &PortableSnapshot,
    original_bytes: usize,
    compressed_bytes: usize,
) {
    let saved_bytes = original_bytes as i128 - compressed_bytes as i128;
    let reduction_percent = if original_bytes == 0 {
        0.0
    } else {
        (saved_bytes as f64 / original_bytes as f64) * 100.0
    };
    tracing::info!(
        snapshot_kind = ?snapshot.snapshot_kind,
        original_bytes,
        compressed_bytes,
        saved_bytes,
        reduction_percent,
        "Portable snapshot compressed before encryption"
    );
}

pub async fn apply_portable_snapshot(
    app: &AppHandle,
    snapshot: &PortableSnapshot,
) -> AppResult<()> {
    validate_portable_snapshot(snapshot)?;

    config::save_sessions(app, &snapshot.sessions)?;
    config::save_keys(app, &snapshot.keys)?;
    config::save_passwords(app, &snapshot.passwords)?;
    config::save_credentials(app, &snapshot.credentials)?;
    config::save_otp_entries(app, &snapshot.otp)?;
    config::save_proxies(app, &snapshot.proxies)?;
    config::save_tunnels(app, &snapshot.tunnels)?;
    config::save_quick_commands(app, &snapshot.quick_commands)?;
    crate::storage::replace_command_history_entries(&snapshot.history)?;

    let merged = snapshot
        .settings
        .clone()
        .apply_to(config::load_app_settings(app).unwrap_or_default());
    let mut persisted = merged.clone();
    persisted.cloud_sync = config::encrypt_cloud_sync_settings(merged.cloud_sync.clone())?;
    persisted.ai = config::encrypt_ai_settings(merged.ai.clone())?;
    config::save_app_settings(app, &persisted)?;

    if let Some(master_key) = &snapshot.master_key_token {
        crate::storage::save_master_key_token(master_key)?;
    }
    if !snapshot.known_hosts.is_empty() {
        crate::storage::replace_known_hosts_export(&snapshot.known_hosts)?;
    }

    let quick_commands_store = app.state::<Arc<QuickCommandsStore>>();
    quick_commands_store.load_from_disk(app)?;

    let session_manager = app.state::<Arc<SessionManager>>();
    session_manager
        .inner()
        .as_ref()
        .reload_history_from_storage()
        .await?;

    let _ = app.emit("connections-changed", ());
    let _ = app.emit("quick-commands-changed", ());
    let _ = app.emit("settings-changed", ());
    let _ = app.emit("command-history-changed", ());

    Ok(())
}

fn validate_portable_snapshot(snapshot: &PortableSnapshot) -> AppResult<()> {
    if snapshot.schema_version != PORTABLE_SNAPSHOT_SCHEMA_VERSION {
        return Err(AppError::Config(format!(
            "Unsupported portable snapshot version {}",
            snapshot.schema_version
        )));
    }
    let actual = calculate_payload_hash(snapshot)?;
    if actual != snapshot.payload_hash {
        return Err(AppError::Crypto(
            "Portable snapshot payload hash mismatch".to_string(),
        ));
    }
    Ok(())
}

fn calculate_payload_hash(snapshot: &PortableSnapshot) -> AppResult<String> {
    let payload_bytes = serde_json::to_vec(&SnapshotHashInput {
        settings: &snapshot.settings,
        sessions: &snapshot.sessions,
        keys: &snapshot.keys,
        passwords: &snapshot.passwords,
        credentials: &snapshot.credentials,
        otp: &snapshot.otp,
        proxies: &snapshot.proxies,
        tunnels: &snapshot.tunnels,
        quick_commands: &snapshot.quick_commands,
        history: &snapshot.history,
        master_key_token: &snapshot.master_key_token,
        known_hosts: &snapshot.known_hosts,
    })?;
    Ok(hex::encode(Sha256::digest(&payload_bytes)))
}

#[derive(Deserialize, Default)]
struct V2ProxiesConfig {
    #[serde(default)]
    proxies: Vec<config::ProxyConfig>,
}

#[derive(Deserialize, Default)]
struct V2HistoryStore {
    #[serde(default)]
    entries: Vec<crate::core::history::HistoryEntry>,
}

#[derive(Serialize)]
struct V2SnapshotHashInput<'a> {
    json_docs: &'a BTreeMap<String, String>,
    text_docs: &'a BTreeMap<String, String>,
}

fn decode_v2_snapshot(
    read: &redb::ReadTransaction,
    meta: PortableSnapshotMeta,
) -> AppResult<PortableSnapshot> {
    let json_docs = read_string_table(read, SNAPSHOT_V2_JSON_DOCS_TABLE)?;
    let text_docs = read_string_table(read, SNAPSHOT_V2_TEXT_DOCS_TABLE)?;
    let expected = calculate_v2_payload_hash(&json_docs, &text_docs)?;
    if expected != meta.payload_hash {
        return Err(AppError::Crypto(
            "Portable snapshot payload hash mismatch".to_string(),
        ));
    }

    let settings = if let Some(raw) = json_docs.get(SNAPSHOT_JSON_PORTABLE_SETTINGS) {
        serde_json::from_str(raw)?
    } else if let Some(raw) = json_docs.get("settings") {
        PortableAppSettings::from_app_settings(&serde_json::from_str::<AppSettings>(raw)?)
    } else {
        PortableAppSettings::from_app_settings(&AppSettings::default())
    };

    let history = json_docs
        .get("history")
        .map(|raw| serde_json::from_str::<V2HistoryStore>(raw).map(|store| store.entries))
        .transpose()?
        .unwrap_or_default();
    let proxies = json_docs
        .get("proxies")
        .map(|raw| serde_json::from_str::<V2ProxiesConfig>(raw).map(|cfg| cfg.proxies))
        .transpose()?
        .unwrap_or_default();
    let tunnels = json_docs
        .get("tunnels")
        .map(|raw| serde_json::from_str::<config::TunnelsConfig>(raw).map(|cfg| cfg.tunnels))
        .transpose()?
        .unwrap_or_default();

    let mut snapshot = PortableSnapshot {
        schema_version: PORTABLE_SNAPSHOT_SCHEMA_VERSION,
        snapshot_kind: meta.snapshot_kind,
        revision_id: meta.revision_id,
        device_id: meta.device_id,
        created_at_ms: meta.created_at_ms,
        payload_hash: String::new(),
        app_version: meta.app_version,
        settings,
        sessions: parse_v2_json_doc(&json_docs, "sessions")?,
        keys: parse_v2_json_doc(&json_docs, "keys")?,
        passwords: parse_v2_json_doc(&json_docs, "passwords")?,
        credentials: parse_v2_json_doc(&json_docs, "credentials")?,
        otp: parse_v2_json_doc(&json_docs, "otp")?,
        proxies,
        tunnels,
        quick_commands: parse_v2_json_doc(&json_docs, "quick-command")?,
        history,
        master_key_token: text_docs.get("master.key").cloned(),
        known_hosts: text_docs.get("known_hosts").cloned().unwrap_or_default(),
    };
    snapshot.payload_hash = calculate_payload_hash(&snapshot)?;
    Ok(snapshot)
}

fn parse_v2_json_doc<T>(docs: &BTreeMap<String, String>, key: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    docs.get(key)
        .map(|raw| serde_json::from_str(raw).map_err(Into::into))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn calculate_v2_payload_hash(
    json_docs: &BTreeMap<String, String>,
    text_docs: &BTreeMap<String, String>,
) -> AppResult<String> {
    let payload_bytes = serde_json::to_vec(&V2SnapshotHashInput {
        json_docs,
        text_docs,
    })?;
    Ok(hex::encode(Sha256::digest(&payload_bytes)))
}

fn insert_entity<T>(table: &mut redb::Table<'_, &str, &str>, key: &str, value: &T) -> AppResult<()>
where
    T: Serialize,
{
    let raw = serde_json::to_string(value)?;
    table.insert(key, raw.as_str()).map_err(storage_error)?;
    Ok(())
}

fn read_entity<T>(entities: &BTreeMap<String, String>, key: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned,
{
    let raw = entities
        .get(key)
        .ok_or_else(|| AppError::Config(format!("portable snapshot missing entity '{key}'")))?;
    serde_json::from_str(raw).map_err(Into::into)
}

fn read_entity_or_default<T>(entities: &BTreeMap<String, String>, key: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    entities
        .get(key)
        .map(|raw| serde_json::from_str(raw).map_err(Into::into))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

fn read_string_table(
    txn: &redb::ReadTransaction,
    definition: TableDefinition<&str, &str>,
) -> AppResult<BTreeMap<String, String>> {
    let table = match txn.open_table(definition) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(BTreeMap::new()),
        Err(error) => return Err(storage_error(error)),
    };

    let mut values = BTreeMap::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        values.insert(key.value().to_string(), value.value().to_string());
    }
    Ok(values)
}

fn current_time_ms() -> u64 {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("Storage error: {error}"))
}

fn zip_error(error: impl std::fmt::Display) -> AppError {
    AppError::Config(format!("portable snapshot zip error: {error}"))
}

struct TempRedbFile {
    path: PathBuf,
}

impl TempRedbFile {
    fn new(prefix: &str) -> Self {
        Self {
            path: std::env::temp_dir()
                .join(format!("nyaterm-{prefix}-{}.redb", uuid::Uuid::new_v4())),
        }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRedbFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PORTABLE_SNAPSHOT_SCHEMA_VERSION, PortableAppSettings, PortableSnapshot,
        PortableSnapshotKind, PortableUiSettings, SNAPSHOT_ZIP_PAYLOAD_NAME,
        calculate_payload_hash, encode_portable_snapshot, encode_portable_snapshot_redb,
    };
    use crate::config::{self, ActivityBarLayout, AppSettings};
    use std::io::Write;

    #[test]
    fn portable_settings_strip_master_password_and_preserve_device_ui_state_on_apply() {
        let mut current = AppSettings::default();
        current.security.master_password = Some("encrypted-master".to_string());
        current.ui.left_width = 444.0;
        current.ui.active_left_panel = Some("fileExplorer".to_string());

        let mut updated = PortableAppSettings::from_app_settings(&current);
        updated.general.startup_restore = false;
        updated.ui.language = Some("zh-CN".to_string());
        updated.ui.saved_connections_sort_mode = "name-asc".to_string();

        let merged = updated.apply_to(current.clone());
        assert_eq!(
            merged.security.master_password,
            current.security.master_password
        );
        assert_eq!(merged.ui.left_width, current.ui.left_width);
        assert_eq!(merged.ui.active_left_panel, current.ui.active_left_panel);
        assert_eq!(merged.ui.language.as_deref(), Some("zh-CN"));
        assert_eq!(merged.ui.saved_connections_sort_mode, "name-asc");
    }

    fn sample_portable_settings() -> PortableAppSettings {
        PortableAppSettings {
            general: config::GeneralSettings::default(),
            appearance: config::AppearanceSettings::default(),
            proxy: config::ProxySettings::default(),
            search: config::SearchSettings::default(),
            translation: config::TranslationSettings::default(),
            security: config::SecuritySettings::default(),
            terminal: config::TerminalSettings::default(),
            interaction: config::InteractionSettings::default(),
            transfer: config::TransferSettings::default(),
            diagnostics: config::DiagnosticsSettings::default(),
            ui: PortableUiSettings {
                language: Some("en".to_string()),
                show_remote_stats: false,
                remote_stats_interval: 3,
                saved_connections_sort_mode: "default".to_string(),
                activity_bar_layout: ActivityBarLayout::default(),
            },
        }
    }

    fn sample_snapshot() -> PortableSnapshot {
        let mut snapshot = PortableSnapshot {
            schema_version: PORTABLE_SNAPSHOT_SCHEMA_VERSION,
            snapshot_kind: PortableSnapshotKind::Sync,
            revision_id: "rev".to_string(),
            device_id: "dev".to_string(),
            created_at_ms: 1,
            payload_hash: String::new(),
            app_version: "1.0.0".to_string(),
            settings: sample_portable_settings(),
            sessions: config::SessionsConfig::default(),
            keys: config::KeysConfig::default(),
            passwords: config::PasswordsConfig::default(),
            credentials: config::CredentialsConfig::default(),
            otp: config::OtpConfig::default(),
            proxies: Vec::new(),
            tunnels: Vec::new(),
            quick_commands: config::QuickCommandsConfig::default(),
            history: Vec::new(),
            master_key_token: Some("wrapped".to_string()),
            known_hosts: "example.com ssh-ed25519 AAAA\n".to_string(),
        };
        snapshot.payload_hash = calculate_payload_hash(&snapshot).expect("hash snapshot");
        snapshot
    }

    #[test]
    fn portable_snapshot_hash_changes_when_entity_changes() {
        let left = sample_snapshot();
        let mut right = sample_snapshot();
        right.master_key_token = Some("different".to_string());
        right.payload_hash = calculate_payload_hash(&right).expect("right hash");

        assert_ne!(left.payload_hash, right.payload_hash);
    }

    #[test]
    fn portable_snapshot_zip_roundtrip() {
        let snapshot = sample_snapshot();

        let encoded = encode_portable_snapshot(&snapshot).expect("encode snapshot");
        let decoded = super::decode_portable_snapshot(&encoded).expect("decode snapshot");

        assert_eq!(decoded.revision_id, snapshot.revision_id);
        assert_eq!(decoded.payload_hash, snapshot.payload_hash);
        assert_eq!(decoded.master_key_token, snapshot.master_key_token);
        assert_eq!(decoded.known_hosts, snapshot.known_hosts);
    }

    #[test]
    fn portable_snapshot_legacy_redb_roundtrip() {
        let snapshot = sample_snapshot();

        let encoded = encode_portable_snapshot_redb(&snapshot).expect("encode legacy snapshot");
        let decoded = super::decode_portable_snapshot(&encoded).expect("decode legacy snapshot");

        assert_eq!(decoded.revision_id, snapshot.revision_id);
        assert_eq!(decoded.payload_hash, snapshot.payload_hash);
        assert_eq!(decoded.master_key_token, snapshot.master_key_token);
        assert_eq!(decoded.known_hosts, snapshot.known_hosts);
    }

    #[test]
    fn portable_snapshot_zip_rejects_oversized_payload() {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file(SNAPSHOT_ZIP_PAYLOAD_NAME, options)
            .expect("start payload");

        let chunk = vec![0u8; 1024 * 1024];
        for _ in 0..=50 {
            zip.write_all(&chunk).expect("write payload");
        }
        let bytes = zip.finish().expect("finish zip").into_inner();

        let error =
            super::decode_compressed_snapshot_payload(&bytes).expect_err("oversized payload");
        assert!(
            error
                .to_string()
                .contains("decompressed snapshot payload exceeds maximum allowed size"),
            "{error}"
        );
    }

    #[test]
    fn portable_snapshot_zip_reduces_history_heavy_payload_size() {
        let mut snapshot = sample_snapshot();
        snapshot.snapshot_kind = PortableSnapshotKind::Backup;
        snapshot.history = (0..5_000)
            .map(|index| crate::core::history::HistoryEntry {
                command: format!("kubectl get pods --namespace production-{index:04} --watch"),
                last_used_at_ms: 1_700_000_000_000 + index,
                use_count: 1,
            })
            .collect();
        snapshot.payload_hash = calculate_payload_hash(&snapshot).expect("hash snapshot");

        let legacy = encode_portable_snapshot_redb(&snapshot).expect("encode legacy snapshot");
        let compressed = encode_portable_snapshot(&snapshot).expect("encode compressed snapshot");
        let reduction = 100.0 - ((compressed.len() as f64 / legacy.len() as f64) * 100.0);

        println!(
            "portable snapshot size: legacy_redb={} compressed_zip={} reduction={reduction:.1}%",
            legacy.len(),
            compressed.len(),
        );
        assert!(
            compressed.len() < legacy.len(),
            "compressed snapshot should be smaller than legacy redb"
        );
    }
}

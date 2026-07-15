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
    pub proxy_groups: Vec<config::ProxyGroup>,
    #[serde(default)]
    pub tunnels: Vec<config::TunnelConfig>,
    #[serde(default)]
    pub tunnel_groups: Vec<config::TunnelGroup>,
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
    proxy_groups: &'a [config::ProxyGroup],
    tunnels: &'a [config::TunnelConfig],
    tunnel_groups: &'a [config::TunnelGroup],
    quick_commands: &'a config::QuickCommandsConfig,
    history: &'a [crate::core::history::HistoryEntry],
    master_key_token: &'a Option<String>,
    known_hosts: &'a str,
}

#[derive(Serialize)]
struct SnapshotRawHashInput<'a> {
    settings: &'a RawValue,
    sessions: &'a RawValue,
    keys: &'a RawValue,
    passwords: &'a RawValue,
    credentials: &'a RawValue,
    otp: &'a RawValue,
    proxies: &'a RawValue,
    proxy_groups: &'a RawValue,
    tunnels: &'a RawValue,
    tunnel_groups: &'a RawValue,
    quick_commands: &'a RawValue,
    history: &'a RawValue,
    master_key_token: &'a RawValue,
    known_hosts: &'a RawValue,
}

#[derive(Serialize)]
struct LegacySnapshotRawHashInput<'a> {
    settings: &'a RawValue,
    sessions: &'a RawValue,
    keys: &'a RawValue,
    passwords: &'a RawValue,
    credentials: &'a RawValue,
    otp: &'a RawValue,
    proxies: &'a RawValue,
    tunnels: &'a RawValue,
    quick_commands: &'a RawValue,
    history: &'a RawValue,
    master_key_token: &'a RawValue,
    known_hosts: &'a RawValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableUiSettings {
    pub language: Option<String>,
    pub show_remote_stats: bool,
    pub remote_stats_interval: u32,
    #[serde(default)]
    pub show_gpu_monitor: bool,
    #[serde(default = "default_portable_gpu_monitor_interval")]
    pub gpu_monitor_interval: u32,
    #[serde(default)]
    pub show_ascend_npu_monitor: bool,
    #[serde(default = "default_portable_ascend_npu_monitor_interval")]
    pub ascend_npu_monitor_interval: u32,
    #[serde(default)]
    pub show_process_manager: bool,
    #[serde(default = "default_portable_process_manager_interval")]
    pub process_manager_interval: u32,
    #[serde(default)]
    pub show_docker_manager: bool,
    #[serde(default = "default_portable_docker_manager_interval")]
    pub docker_manager_interval: u32,
    pub saved_connections_sort_mode: String,
    pub activity_bar_layout: ActivityBarLayout,
}

fn default_portable_gpu_monitor_interval() -> u32 {
    3
}

fn default_portable_ascend_npu_monitor_interval() -> u32 {
    3
}

fn default_portable_process_manager_interval() -> u32 {
    5
}

fn default_portable_docker_manager_interval() -> u32 {
    10
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
    #[serde(default)]
    pub ai: config::AiSettings,
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
            ai: settings.ai.clone(),
            ui: PortableUiSettings {
                language: settings.ui.language.clone(),
                show_remote_stats: settings.ui.show_remote_stats,
                remote_stats_interval: settings.ui.remote_stats_interval,
                show_gpu_monitor: settings.ui.show_gpu_monitor,
                gpu_monitor_interval: settings.ui.gpu_monitor_interval,
                show_ascend_npu_monitor: settings.ui.show_ascend_npu_monitor,
                ascend_npu_monitor_interval: settings.ui.ascend_npu_monitor_interval,
                show_process_manager: settings.ui.show_process_manager,
                process_manager_interval: settings.ui.process_manager_interval,
                show_docker_manager: settings.ui.show_docker_manager,
                docker_manager_interval: settings.ui.docker_manager_interval,
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
        current.ai = self.ai;
        config::normalize_ai_settings(&mut current.ai);
        current.ui.language = self.ui.language;
        current.ui.show_remote_stats = self.ui.show_remote_stats;
        current.ui.remote_stats_interval = self.ui.remote_stats_interval;
        current.ui.show_gpu_monitor = self.ui.show_gpu_monitor;
        current.ui.gpu_monitor_interval = self.ui.gpu_monitor_interval;
        current.ui.show_ascend_npu_monitor = self.ui.show_ascend_npu_monitor;
        current.ui.ascend_npu_monitor_interval = self.ui.ascend_npu_monitor_interval;
        current.ui.show_process_manager = self.ui.show_process_manager;
        current.ui.process_manager_interval = self.ui.process_manager_interval;
        current.ui.show_docker_manager = self.ui.show_docker_manager;
        current.ui.docker_manager_interval = self.ui.docker_manager_interval;
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

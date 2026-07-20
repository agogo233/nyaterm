#[cfg(test)]
mod tests {
    use super::{
        PORTABLE_SNAPSHOT_SCHEMA_VERSION, PortableAppSettings, PortableSnapshot,
        PortableSnapshotKind, PortableSnapshotMeta, PortableUiSettings, SNAPSHOT_ENTITIES_TABLE,
        SNAPSHOT_META_KEY, SNAPSHOT_META_TABLE, SNAPSHOT_ZIP_PAYLOAD_NAME, calculate_payload_hash,
        calculate_v3_raw_payload_hash, encode_portable_snapshot, encode_portable_snapshot_redb,
        preserve_device_local_sessions, strip_device_local_sessions,
    };
    use crate::config::{self, ActivityBarLayout, AppSettings};
    use crate::error::AppError;
    use redb::Database;
    use std::collections::BTreeMap;
    use std::io::Write;

    #[test]
    fn portable_settings_strip_master_password_and_preserve_device_ui_state_on_apply() {
        let mut current = AppSettings::default();
        current.security.master_password = Some("encrypted-master".to_string());
        current.ui.left_width = 444.0;
        current.ui.active_left_panel = Some("fileExplorer".to_string());
        current.ai.active_profile_id = "local-profile".to_string();
        current.ai.provider_profiles[0].api_key = Some("local-key".to_string());

        let mut updated =
            PortableAppSettings::from_app_settings(&current, &PortableSnapshotKind::Backup);
        updated.general.startup_restore = false;
        updated.ui.language = Some("zh-CN".to_string());
        updated.ui.saved_connections_sort_mode = "name-asc".to_string();
        updated.ai.active_profile_id = "synced-profile".to_string();
        updated.ai.provider_profiles[0].api_key = Some("synced-key".to_string());

        let merged = updated.apply_to(current.clone(), &PortableSnapshotKind::Backup);
        assert_eq!(
            merged.security.master_password,
            current.security.master_password
        );
        assert_eq!(merged.ui.left_width, current.ui.left_width);
        assert_eq!(merged.ui.active_left_panel, current.ui.active_left_panel);
        assert_eq!(merged.ui.language.as_deref(), Some("zh-CN"));
        assert_eq!(merged.ui.saved_connections_sort_mode, "name-asc");
        assert_eq!(merged.ai.active_profile_id, "synced-profile");
        assert_eq!(
            merged.ai.provider_profiles[0].api_key.as_deref(),
            Some("synced-key")
        );
    }

    #[test]
    fn sync_portable_settings_strip_device_local_paths() {
        let mut current = AppSettings::default();
        current.appearance.background_image_path = Some("D:\\background.png".to_string());
        current.appearance.background_image_fit = "tile".to_string();
        current.appearance.background_image_opacity = 0.8;
        current.transfer.download_path = "D:\\downloads".to_string();
        current.transfer.default_editor = "D:\\tools\\editor.exe".to_string();
        current.transfer.recording_path = "D:\\recordings".to_string();

        let portable =
            PortableAppSettings::from_app_settings(&current, &PortableSnapshotKind::Sync);

        assert!(portable.appearance.background_image_path.is_none());
        assert_eq!(
            portable.appearance.background_image_fit,
            config::AppearanceSettings::default().background_image_fit
        );
        assert_eq!(
            portable.appearance.background_image_opacity,
            config::AppearanceSettings::default().background_image_opacity
        );
        assert!(portable.transfer.download_path.is_empty());
        assert!(portable.transfer.default_editor.is_empty());
        assert!(portable.transfer.recording_path.is_empty());
    }

    #[test]
    fn backup_portable_settings_preserve_device_local_paths() {
        let mut current = AppSettings::default();
        current.appearance.background_image_path = Some("D:\\background.png".to_string());
        current.appearance.background_image_fit = "tile".to_string();
        current.appearance.background_image_opacity = 0.8;
        current.transfer.download_path = "D:\\downloads".to_string();
        current.transfer.default_editor = "D:\\tools\\editor.exe".to_string();
        current.transfer.recording_path = "D:\\recordings".to_string();

        let portable =
            PortableAppSettings::from_app_settings(&current, &PortableSnapshotKind::Backup);

        assert_eq!(
            portable.appearance.background_image_path.as_deref(),
            Some("D:\\background.png")
        );
        assert_eq!(portable.appearance.background_image_fit, "tile");
        assert_eq!(portable.appearance.background_image_opacity, 0.8);
        assert_eq!(portable.transfer.download_path, "D:\\downloads");
        assert_eq!(portable.transfer.default_editor, "D:\\tools\\editor.exe");
        assert_eq!(portable.transfer.recording_path, "D:\\recordings");
    }

    #[test]
    fn applying_sync_portable_settings_preserves_current_device_paths() {
        let mut current = AppSettings::default();
        current.appearance.background_image_path = Some("/Users/me/local.png".to_string());
        current.appearance.background_image_fit = "contain".to_string();
        current.appearance.background_image_opacity = 0.4;
        current.transfer.download_path = "/Users/me/Downloads".to_string();
        current.transfer.default_editor = "/Applications/Editor.app".to_string();
        current.transfer.recording_path = "/Users/me/Recordings".to_string();

        let mut incoming = AppSettings::default();
        incoming.appearance.background_image_path = Some("D:\\background.png".to_string());
        incoming.appearance.background_image_fit = "tile".to_string();
        incoming.appearance.background_image_opacity = 0.9;
        incoming.transfer.download_path = "D:\\downloads".to_string();
        incoming.transfer.default_editor = "D:\\tools\\editor.exe".to_string();
        incoming.transfer.recording_path = "D:\\recordings".to_string();

        let portable =
            PortableAppSettings::from_app_settings(&incoming, &PortableSnapshotKind::Backup);
        let merged = portable.apply_to(current, &PortableSnapshotKind::Sync);

        assert_eq!(
            merged.appearance.background_image_path.as_deref(),
            Some("/Users/me/local.png")
        );
        assert_eq!(merged.appearance.background_image_fit, "contain");
        assert_eq!(merged.appearance.background_image_opacity, 0.4);
        assert_eq!(merged.transfer.download_path, "/Users/me/Downloads");
        assert_eq!(merged.transfer.default_editor, "/Applications/Editor.app");
        assert_eq!(merged.transfer.recording_path, "/Users/me/Recordings");
    }

    #[test]
    fn sync_sessions_strip_local_terminal_and_serial_device_fields() {
        let mut sessions = sample_sessions_with_device_local_connections();

        strip_device_local_sessions(&mut sessions);

        let local = sessions
            .connections
            .iter()
            .find(|connection| connection.id == "local-1")
            .expect("local connection");
        let config::ConnectionType::LocalTerminal {
            shell_path,
            shell_args,
            working_dir,
            ..
        } = &local.config
        else {
            panic!("expected local terminal");
        };
        assert!(shell_path.is_empty());
        assert!(shell_args.is_empty());
        assert!(working_dir.is_none());

        let serial = sessions
            .connections
            .iter()
            .find(|connection| connection.id == "serial-1")
            .expect("serial connection");
        let config::ConnectionType::Serial { port_name, .. } = &serial.config else {
            panic!("expected serial");
        };
        assert!(port_name.is_empty());
    }

    #[test]
    fn applying_sync_sessions_preserves_matching_device_fields() {
        let current = sample_sessions_with_device_local_connections();
        let mut incoming = sample_sessions_with_device_local_connections();
        strip_device_local_sessions(&mut incoming);

        preserve_device_local_sessions(&mut incoming, &current);

        let local = incoming
            .connections
            .iter()
            .find(|connection| connection.id == "local-1")
            .expect("local connection");
        let config::ConnectionType::LocalTerminal {
            shell_path,
            shell_args,
            working_dir,
            ..
        } = &local.config
        else {
            panic!("expected local terminal");
        };
        assert_eq!(
            shell_path,
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
        );
        assert_eq!(shell_args, "-NoLogo");
        assert_eq!(working_dir.as_deref(), Some("C:\\Users\\me"));

        let serial = incoming
            .connections
            .iter()
            .find(|connection| connection.id == "serial-1")
            .expect("serial connection");
        let config::ConnectionType::Serial { port_name, .. } = &serial.config else {
            panic!("expected serial");
        };
        assert_eq!(port_name, "COM3");
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
            ai: config::AiSettings::default(),
            ui: PortableUiSettings {
                language: Some("en".to_string()),
                show_remote_stats: false,
                remote_stats_interval: 3,
                show_gpu_monitor: false,
                gpu_monitor_interval: 3,
                show_ascend_npu_monitor: false,
                ascend_npu_monitor_interval: 3,
                show_process_manager: false,
                process_manager_interval: 5,
                show_docker_manager: false,
                docker_manager_interval: 10,
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
            proxy_groups: Vec::new(),
            tunnels: Vec::new(),
            tunnel_groups: Vec::new(),
            quick_commands: config::QuickCommandsConfig::default(),
            history: Vec::new(),
            master_key_token: Some("wrapped".to_string()),
            known_hosts: "example.com ssh-ed25519 AAAA\n".to_string(),
        };
        snapshot.payload_hash = calculate_payload_hash(&snapshot).expect("hash snapshot");
        snapshot
    }

    fn sample_sessions_with_device_local_connections() -> config::SessionsConfig {
        config::SessionsConfig {
            groups: Vec::new(),
            connections: vec![
                config::SavedConnection {
                    id: "local-1".to_string(),
                    name: "Local PowerShell".to_string(),
                    config: config::ConnectionType::LocalTerminal {
                        shell_path:
                            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
                                .to_string(),
                        shell_args: "-NoLogo".to_string(),
                        working_dir: Some("C:\\Users\\me".to_string()),
                        ai_execution_profile: config::AiExecutionProfile::Auto,
                        encoding: String::new(),
                    },
                    group_id: None,
                    description: None,
                    sort_order: 0,
                    icon: None,
                    icon_auto_detect: None,
                    auth: None,
                    network: None,
                    post_login: None,
                    ssh_algorithms: None,
                    sftp: config::SftpSettings::default(),
                    created_at_ms: None,
                    updated_at_ms: None,
                    last_used_at_ms: None,
                },
                config::SavedConnection {
                    id: "serial-1".to_string(),
                    name: "Serial Console".to_string(),
                    config: config::ConnectionType::Serial {
                        port_name: "COM3".to_string(),
                        baud_rate: 115_200,
                        data_bits: 8,
                        parity: "none".to_string(),
                        stop_bits: "1".to_string(),
                        ai_execution_profile: config::AiExecutionProfile::Auto,
                        backspace_mode: "del".to_string(),
                        encoding: String::new(),
                    },
                    group_id: None,
                    description: None,
                    sort_order: 1,
                    icon: None,
                    icon_auto_detect: None,
                    auth: None,
                    network: None,
                    post_login: None,
                    ssh_algorithms: None,
                    sftp: config::SftpSettings::default(),
                    created_at_ms: None,
                    updated_at_ms: None,
                    last_used_at_ms: None,
                },
            ],
        }
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
    fn portable_settings_deserializes_legacy_shape_without_ai() {
        let settings = sample_portable_settings();
        let mut raw = serde_json::to_value(&settings).expect("settings json");
        raw.as_object_mut().expect("settings object").remove("ai");

        let decoded: PortableAppSettings =
            serde_json::from_value(raw).expect("legacy settings decode");

        assert_eq!(
            decoded.ai.schema_version,
            config::AiSettings::default().schema_version
        );
        assert_eq!(
            decoded.ai.active_profile_id,
            config::AiSettings::default().active_profile_id
        );
    }

    #[test]
    fn corrupt_portable_snapshot_redb_returns_error() {
        let error = super::decode_portable_snapshot(b"not a redb file")
            .expect_err("corrupt snapshot should fail");

        assert!(matches!(error, AppError::Storage(_)));
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
    fn portable_snapshot_v3_accepts_older_entity_shape_before_normalizing_hash() {
        let snapshot = sample_snapshot();
        let mut settings = serde_json::to_value(&snapshot.settings).expect("settings json");
        settings["appearance"]
            .as_object_mut()
            .expect("appearance object")
            .remove("panel_multi_open");

        let mut entities = BTreeMap::new();
        entities.insert(
            "settings".to_string(),
            serde_json::to_string(&settings).expect("settings raw"),
        );
        entities.insert(
            "sessions".to_string(),
            serde_json::to_string(&snapshot.sessions).expect("sessions raw"),
        );
        entities.insert(
            "keys".to_string(),
            serde_json::to_string(&snapshot.keys).expect("keys raw"),
        );
        entities.insert(
            "passwords".to_string(),
            serde_json::to_string(&snapshot.passwords).expect("passwords raw"),
        );
        entities.insert(
            "credentials".to_string(),
            serde_json::to_string(&snapshot.credentials).expect("credentials raw"),
        );
        entities.insert(
            "otp".to_string(),
            serde_json::to_string(&snapshot.otp).expect("otp raw"),
        );
        entities.insert(
            "proxies".to_string(),
            serde_json::to_string(&snapshot.proxies).expect("proxies raw"),
        );
        entities.insert(
            "tunnels".to_string(),
            serde_json::to_string(&snapshot.tunnels).expect("tunnels raw"),
        );
        entities.insert(
            "quick_commands".to_string(),
            serde_json::to_string(&snapshot.quick_commands).expect("quick commands raw"),
        );
        entities.insert(
            "history".to_string(),
            serde_json::to_string(&snapshot.history).expect("history raw"),
        );
        entities.insert(
            "master_key_token".to_string(),
            serde_json::to_string(&snapshot.master_key_token).expect("master key raw"),
        );
        entities.insert(
            "known_hosts".to_string(),
            serde_json::to_string(&snapshot.known_hosts).expect("known hosts raw"),
        );

        let legacy_hash = calculate_v3_raw_payload_hash(&entities).expect("legacy hash");
        assert_ne!(legacy_hash, snapshot.payload_hash);

        let encoded = encode_v3_raw_snapshot_redb(&snapshot, &entities, legacy_hash.clone());
        let decoded = super::decode_portable_snapshot(&encoded).expect("decode legacy v3 shape");

        assert_eq!(decoded.revision_id, snapshot.revision_id);
        assert!(!decoded.settings.appearance.panel_multi_open);
        assert_eq!(decoded.payload_hash, snapshot.payload_hash);
        assert_ne!(decoded.payload_hash, legacy_hash);
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

    fn encode_v3_raw_snapshot_redb(
        snapshot: &PortableSnapshot,
        entities: &BTreeMap<String, String>,
        payload_hash: String,
    ) -> Vec<u8> {
        let temp = super::TempRedbFile::new("portable-snapshot-legacy-test");
        {
            let db = Database::create(temp.path()).expect("create db");
            let txn = db.begin_write().expect("begin write");
            {
                let mut meta = txn.open_table(SNAPSHOT_META_TABLE).expect("open meta");
                let mut meta_value = PortableSnapshotMeta::from(snapshot);
                meta_value.payload_hash = payload_hash;
                let meta_content = serde_json::to_string(&meta_value).expect("meta json");
                meta.insert(SNAPSHOT_META_KEY, meta_content.as_str())
                    .expect("insert meta");
            }
            let mut table = txn
                .open_table(SNAPSHOT_ENTITIES_TABLE)
                .expect("open entities");
            for (key, value) in entities {
                table
                    .insert(key.as_str(), value.as_str())
                    .expect("insert entity");
            }
            drop(table);
            txn.commit().expect("commit");
        }
        std::fs::read(temp.path()).expect("read redb")
    }
}

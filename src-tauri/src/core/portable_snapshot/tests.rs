#[cfg(test)]
mod tests {
    use super::{
        PORTABLE_SNAPSHOT_SCHEMA_VERSION, PortableAppSettings, PortableSnapshot,
        PortableSnapshotKind, PortableSnapshotMeta, PortableUiSettings, SNAPSHOT_ENTITIES_TABLE,
        SNAPSHOT_META_KEY, SNAPSHOT_META_TABLE, SNAPSHOT_ZIP_PAYLOAD_NAME, calculate_payload_hash,
        calculate_v3_raw_payload_hash, encode_portable_snapshot, encode_portable_snapshot_redb,
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

        let mut updated = PortableAppSettings::from_app_settings(&current);
        updated.general.startup_restore = false;
        updated.ui.language = Some("zh-CN".to_string());
        updated.ui.saved_connections_sort_mode = "name-asc".to_string();
        updated.ai.active_profile_id = "synced-profile".to_string();
        updated.ai.provider_profiles[0].api_key = Some("synced-key".to_string());

        let merged = updated.apply_to(current.clone());
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

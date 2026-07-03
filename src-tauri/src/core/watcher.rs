use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher, event::ModifyKind};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::observability::{StructuredLog, StructuredLogLevel, log_event, log_rate_limited};

#[derive(Clone, Serialize)]
pub struct FileModifiedPayload {
    pub session_id: String,
    pub local_path: String,
    pub remote_path: String,
}

struct WatchState {
    _watcher: Option<RecommendedWatcher>,
}

static ACTIVE_WATCHERS: LazyLock<Arc<Mutex<HashMap<String, WatchState>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(HashMap::new())));

const CONTENT_HASH_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
const STARTUP_SUPPRESSION_WINDOW: Duration = Duration::from_secs(2);
const WATCH_DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, PartialEq, Eq)]
struct FileFingerprint {
    len: u64,
    modified: Option<SystemTime>,
    content_hash: Option<[u8; 32]>,
}

#[derive(Debug, PartialEq, Eq)]
enum FingerprintChange {
    Unchanged,
    BaselineOnly,
    ContentChanged,
}

impl FileFingerprint {
    fn from_path(path: &Path) -> io::Result<Self> {
        Self::from_path_with_hash_limit(path, CONTENT_HASH_LIMIT_BYTES)
    }

    fn from_path_with_hash_limit(path: &Path, hash_limit_bytes: u64) -> io::Result<Self> {
        let metadata = fs::metadata(path)?;
        let len = metadata.len();
        let modified = metadata.modified().ok();
        let content_hash = if metadata.is_file() && len <= hash_limit_bytes {
            Some(hash_file(path)?)
        } else {
            None
        };

        Ok(Self {
            len,
            modified,
            content_hash,
        })
    }
}

fn hash_file(path: &Path) -> io::Result<[u8; 32]> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];

    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    let digest = hasher.finalize();
    let mut hash = [0_u8; 32];
    hash.copy_from_slice(&digest);
    Ok(hash)
}

fn is_content_change_candidate(kind: EventKind) -> bool {
    matches!(
        kind,
        EventKind::Modify(
            ModifyKind::Data(_) | ModifyKind::Any | ModifyKind::Name(_) | ModifyKind::Other,
        )
    )
}

fn classify_fingerprint_change(
    previous: &FileFingerprint,
    current: &FileFingerprint,
    within_startup_window: bool,
) -> FingerprintChange {
    if let (Some(previous_hash), Some(current_hash)) =
        (&previous.content_hash, &current.content_hash)
    {
        return if previous_hash != current_hash {
            FingerprintChange::ContentChanged
        } else if previous != current {
            FingerprintChange::BaselineOnly
        } else {
            FingerprintChange::Unchanged
        };
    }

    if previous.len != current.len {
        return FingerprintChange::ContentChanged;
    }

    if previous.modified != current.modified {
        return if within_startup_window {
            FingerprintChange::BaselineOnly
        } else {
            FingerprintChange::ContentChanged
        };
    }

    FingerprintChange::Unchanged
}

fn should_emit_for_fingerprint(
    baseline: &mut Option<FileFingerprint>,
    current: FileFingerprint,
    within_startup_window: bool,
) -> bool {
    let Some(previous) = baseline.as_ref() else {
        *baseline = Some(current);
        return false;
    };

    match classify_fingerprint_change(previous, &current, within_startup_window) {
        FingerprintChange::ContentChanged => {
            *baseline = Some(current);
            true
        }
        FingerprintChange::BaselineOnly => {
            *baseline = Some(current);
            false
        }
        FingerprintChange::Unchanged => false,
    }
}

#[allow(clippy::unused_async)]
pub async fn start_file_watch(
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> AppResult<()> {
    // Generate a unique key for this watch instance
    let watch_key = format!("{session_id}:{local_path}");
    let mut watchers = ACTIVE_WATCHERS.lock().unwrap();

    // If we are already watching this file, don't start another watcher
    if watchers.contains_key(&watch_key) {
        return Ok(());
    }

    let (tx, rx) = channel();

    // Create the watcher (this has to happen synchronously or via std thread)
    let mut watcher = notify::recommended_watcher(tx)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

    watcher
        .watch(Path::new(&local_path), RecursiveMode::NonRecursive)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;

    // Store the watcher to keep it alive
    watchers.insert(
        watch_key.clone(),
        WatchState {
            _watcher: Some(watcher),
        },
    );

    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    let local_path_clone = local_path.clone();
    let remote_path_clone = remote_path.clone();
    let watched_path = PathBuf::from(local_path_clone.clone());

    log_event(StructuredLog {
        level: StructuredLogLevel::Info,
        domain: "watcher.sync".to_string(),
        event: "watch.start".to_string(),
        message: "Starting file watch".to_string(),
        ids: Some(serde_json::json!({ "session_id": session_id })),
        data: Some(serde_json::json!({
            "local_path": local_path,
            "remote_path": remote_path,
        })),
        error: None,
        client_timestamp: None,
    });

    // Spawn a blocking thread to listen for notify events
    std::thread::spawn(move || {
        let watch_started = Instant::now();
        let mut baseline = match FileFingerprint::from_path(&watched_path) {
            Ok(fingerprint) => Some(fingerprint),
            Err(e) => {
                log_rate_limited(StructuredLog {
                    level: StructuredLogLevel::Error,
                    domain: "watcher.sync".to_string(),
                    event: "watch.baseline_failed".to_string(),
                    message: "Failed to read file watch baseline".to_string(),
                    ids: Some(serde_json::json!({ "session_id": session_id_clone.clone() })),
                    data: Some(serde_json::json!({
                        "local_path": local_path_clone.clone(),
                        "remote_path": remote_path_clone.clone(),
                    })),
                    error: Some(serde_json::json!({ "message": e.to_string() })),
                    client_timestamp: None,
                });
                None
            }
        };
        let now = Instant::now();
        let mut last_check = now.checked_sub(WATCH_DEBOUNCE).unwrap_or(now);
        for res in rx {
            match res {
                Ok(event) => {
                    tracing::debug!(kind = ?event.kind, "Notify event received");

                    // Most text editors do atomic saves (save to temp file, then rename/move)
                    // We only emit when the watched file's content fingerprint actually changes.
                    if is_content_change_candidate(event.kind) {
                        tracing::debug!(paths = ?event.paths, "Detected candidate content event");
                        // Debounce: prevent checking multiple times for a single save operation (common in editors)
                        if last_check.elapsed() > WATCH_DEBOUNCE {
                            last_check = Instant::now();
                            match FileFingerprint::from_path(&watched_path) {
                                Ok(current) => {
                                    let should_emit = should_emit_for_fingerprint(
                                        &mut baseline,
                                        current,
                                        watch_started.elapsed() <= STARTUP_SUPPRESSION_WINDOW,
                                    );
                                    if !should_emit {
                                        tracing::debug!(
                                            "File fingerprint unchanged, skipping file-modified emit"
                                        );
                                        continue;
                                    }
                                }
                                Err(e) => {
                                    log_rate_limited(StructuredLog {
                                        level: StructuredLogLevel::Error,
                                        domain: "watcher.sync".to_string(),
                                        event: "watch.fingerprint_failed".to_string(),
                                        message: "Failed to read file watch fingerprint"
                                            .to_string(),
                                        ids: Some(serde_json::json!({
                                            "session_id": session_id_clone.clone()
                                        })),
                                        data: Some(serde_json::json!({
                                            "local_path": local_path_clone.clone(),
                                            "remote_path": remote_path_clone.clone(),
                                        })),
                                        error: Some(serde_json::json!({
                                            "message": e.to_string()
                                        })),
                                        client_timestamp: None,
                                    });
                                    continue;
                                }
                            }

                            tracing::debug!("File content changed, emitting file-modified payload");
                            let payload = FileModifiedPayload {
                                session_id: session_id_clone.clone(),
                                local_path: local_path_clone.clone(),
                                remote_path: remote_path_clone.clone(),
                            };
                            if let Err(e) = app_clone.emit("file-modified", payload) {
                                log_rate_limited(StructuredLog {
                                    level: StructuredLogLevel::Error,
                                    domain: "watcher.sync".to_string(),
                                    event: "watch.emit_failed".to_string(),
                                    message: "Failed to emit file-modified event".to_string(),
                                    ids: Some(
                                        serde_json::json!({ "session_id": session_id_clone.clone() }),
                                    ),
                                    data: Some(serde_json::json!({
                                        "local_path": local_path_clone.clone(),
                                        "remote_path": remote_path_clone.clone(),
                                    })),
                                    error: Some(serde_json::json!({ "message": e.to_string() })),
                                    client_timestamp: None,
                                });
                            }
                        } else {
                            tracing::debug!("Watcher event debounced");
                        }
                    }
                }
                Err(e) => {
                    log_rate_limited(StructuredLog {
                        level: StructuredLogLevel::Error,
                        domain: "watcher.sync".to_string(),
                        event: "watch.backend_error".to_string(),
                        message: "File watcher backend error".to_string(),
                        ids: Some(serde_json::json!({ "session_id": session_id_clone.clone() })),
                        data: Some(serde_json::json!({
                            "local_path": local_path_clone.clone(),
                            "remote_path": remote_path_clone.clone(),
                        })),
                        error: Some(serde_json::json!({ "message": e.to_string() })),
                        client_timestamp: None,
                    });
                    break;
                }
            }
        }
    });

    Ok(())
}

#[allow(clippy::unused_async)]
pub async fn stop_file_watch(session_id: String, local_path: String) -> AppResult<()> {
    let watch_key = format!("{session_id}:{local_path}");
    let mut watchers = ACTIVE_WATCHERS.lock().unwrap();
    watchers.remove(&watch_key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{DataChange, MetadataKind};
    use std::time::UNIX_EPOCH;

    fn fingerprint(
        len: u64,
        modified_secs: u64,
        content_hash: Option<[u8; 32]>,
    ) -> FileFingerprint {
        FileFingerprint {
            len,
            modified: Some(UNIX_EPOCH + Duration::from_secs(modified_secs)),
            content_hash,
        }
    }

    #[test]
    fn metadata_only_event_is_not_content_change_candidate() {
        assert!(!is_content_change_candidate(EventKind::Modify(
            ModifyKind::Metadata(MetadataKind::Any),
        )));
    }

    #[test]
    fn data_event_is_content_change_candidate() {
        assert!(is_content_change_candidate(EventKind::Modify(
            ModifyKind::Data(DataChange::Content),
        )));
    }

    #[test]
    fn same_content_hash_with_changed_mtime_updates_baseline_without_emit() {
        let hash = [7_u8; 32];
        let mut baseline = Some(fingerprint(10, 1, Some(hash)));
        let current = fingerprint(10, 2, Some(hash));

        assert!(!should_emit_for_fingerprint(
            &mut baseline,
            current.clone(),
            false
        ));
        assert_eq!(baseline, Some(current));
    }

    #[test]
    fn changed_content_hash_with_same_size_emits() {
        let mut baseline = Some(fingerprint(10, 1, Some([1_u8; 32])));
        let current = fingerprint(10, 1, Some([2_u8; 32]));

        assert!(should_emit_for_fingerprint(
            &mut baseline,
            current.clone(),
            false
        ));
        assert_eq!(baseline, Some(current));
    }

    #[test]
    fn changed_size_emits_even_without_hash() {
        let mut baseline = Some(fingerprint(10, 1, None));
        let current = fingerprint(11, 1, None);

        assert!(should_emit_for_fingerprint(
            &mut baseline,
            current.clone(),
            true
        ));
        assert_eq!(baseline, Some(current));
    }

    #[test]
    fn oversized_fingerprint_uses_metadata_fallback_after_startup() {
        let mut baseline = Some(fingerprint(10, 1, None));
        let current = fingerprint(10, 2, None);

        assert!(should_emit_for_fingerprint(
            &mut baseline,
            current.clone(),
            false
        ));
        assert_eq!(baseline, Some(current));
    }

    #[test]
    fn oversized_fingerprint_suppresses_same_size_startup_residue() {
        let mut baseline = Some(fingerprint(10, 1, None));
        let current = fingerprint(10, 2, None);

        assert!(!should_emit_for_fingerprint(
            &mut baseline,
            current.clone(),
            true
        ));
        assert_eq!(baseline, Some(current));
    }

    #[test]
    fn repeated_same_fingerprint_does_not_emit_after_baseline_update() {
        let mut baseline = Some(fingerprint(10, 1, Some([1_u8; 32])));
        let current = fingerprint(10, 1, Some([2_u8; 32]));

        assert!(should_emit_for_fingerprint(
            &mut baseline,
            current.clone(),
            false
        ));
        assert!(!should_emit_for_fingerprint(&mut baseline, current, false));
    }

    #[test]
    fn file_hash_is_skipped_above_limit() {
        let path = std::env::temp_dir().join(format!(
            "nyaterm-watcher-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::write(&path, b"ab").unwrap();

        let fingerprint = FileFingerprint::from_path_with_hash_limit(&path, 1).unwrap();

        assert_eq!(fingerprint.len, 2);
        assert_eq!(fingerprint.content_hash, None);

        fs::remove_file(path).unwrap();
    }
}

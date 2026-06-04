//! ZMODEM (lrzsz) file transfer detection and protocol handling.
//!
//! Intercepts ZMODEM init headers in the raw terminal byte stream and drives
//! file transfers using the `zmodem2` state-machine crate. Each session's
//! I/O loop creates a [`ZmodemDetector`] that scans bytes **before** they are
//! converted to lossy UTF-8. When a ZMODEM session is confirmed the detector
//! transitions to an active [`ZmodemTransfer`] that owns the protocol state.

use serde::Serialize;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

// ZMODEM protocol constants for header detection.
const ZPAD: u8 = 0x2A; // '*'
const ZDLE: u8 = 0x18; // CAN / Ctrl-X
const ZHEX: u8 = 0x42; // 'B'
const ZBIN: u8 = 0x41; // 'A'
const ZBIN32: u8 = 0x43; // 'C'

/// Minimum header bytes: ZPAD ZPAD ZDLE (ZHEX|ZBIN|ZBIN32)
const ZMODEM_HEADER_LEN: usize = 4;

/// Five consecutive CAN (0x18) bytes abort a ZMODEM session.
const CANCEL_SEQ_LEN: usize = 5;

const ZMODEM_PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const ZMODEM_PROGRESS_BYTES: u64 = 256 * 1024;

/// Direction of the ZMODEM transfer from the **local** perspective.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ZmodemDirection {
    /// Remote `sz` → we **download** (receive) files.
    Download,
    /// Remote `rz` → we **upload** (send) files.
    Upload,
}

/// Events emitted to the frontend via Tauri events.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ZmodemEvent {
    /// A ZMODEM session was detected — frontend should show a file dialog.
    Detected { direction: ZmodemDirection },
    /// Progress update for an active transfer.
    Progress {
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "bytesTransferred")]
        bytes_transferred: u64,
        #[serde(rename = "totalSize")]
        total_size: u64,
        direction: ZmodemDirection,
    },
    /// The ZMODEM session completed successfully.
    Complete {
        direction: ZmodemDirection,
        #[serde(rename = "fileCount")]
        file_count: u32,
    },
    /// The ZMODEM session failed.
    Failed { reason: String },
}

/// Actions returned to the I/O loop after feeding bytes.
pub enum ZmodemAction {
    /// Send these bytes back to the remote (protocol responses).
    SendToRemote(Vec<u8>),
    /// Emit a Tauri event to the frontend.
    EmitEvent(ZmodemEvent),
}

/// Result of scanning a raw byte chunk for ZMODEM startup.
pub enum ZmodemDetectResult {
    /// No complete header was detected. `passthrough` is known-safe terminal text.
    NoMatch { passthrough: Vec<u8> },
    /// A ZMODEM header was detected.
    Detected {
        direction: ZmodemDirection,
        passthrough: Vec<u8>,
        initial_bytes: Vec<u8>,
    },
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// Scans the raw byte stream for a ZMODEM init header.
///
/// Handles the pattern being split across multiple reads by keeping
/// a small state machine.
pub struct ZmodemDetector {
    /// Bytes withheld until they are known not to be a split ZMODEM header.
    pending: Vec<u8>,
    /// Whether `pending[0]` is at the beginning of the stream or directly after a newline.
    pending_starts_at_line_start: bool,
}

impl ZmodemDetector {
    pub fn new() -> Self {
        Self {
            pending: Vec::new(),
            pending_starts_at_line_start: true,
        }
    }

    /// Feed raw bytes and return whether a ZMODEM header was found.
    ///
    /// The direction is inferred from the frame type byte that follows the
    /// header prefix:
    /// - ZRQINIT (0x00) → remote wants to **send** → we **download**
    /// - ZRINIT  (0x01) → remote wants to **receive** → we **upload**
    ///
    /// `passthrough` contains bytes that can be shown in the terminal. Split
    /// header prefixes are retained internally until enough bytes arrive.
    pub fn feed(&mut self, data: &[u8]) -> ZmodemDetectResult {
        self.pending.extend_from_slice(data);

        if let Some((direction, header_start)) = detect_zmodem_start(&self.pending) {
            let passthrough = self.pending[..header_start].to_vec();
            let initial_bytes = self.pending[header_start..].to_vec();
            self.reset();
            return ZmodemDetectResult::Detected {
                direction,
                passthrough,
                initial_bytes,
            };
        }

        let keep_from = retained_prefix_start(&self.pending, self.pending_starts_at_line_start);
        let passthrough = self.pending[..keep_from].to_vec();
        if keep_from > 0 {
            self.pending.drain(..keep_from);
            self.pending_starts_at_line_start = ends_at_line_start(&passthrough);
        }

        ZmodemDetectResult::NoMatch { passthrough }
    }

    pub fn reset(&mut self) {
        self.pending.clear();
        self.pending_starts_at_line_start = true;
    }
}

fn detect_zmodem_start(data: &[u8]) -> Option<(ZmodemDirection, usize)> {
    for start in 0..data.len() {
        if data.len().saturating_sub(start) < ZMODEM_HEADER_LEN {
            break;
        }

        let header = &data[start..start + ZMODEM_HEADER_LEN];
        if header[0] != ZPAD
            || header[1] != ZPAD
            || header[2] != ZDLE
            || !matches!(header[3], ZHEX | ZBIN | ZBIN32)
        {
            continue;
        }

        let remaining = &data[start + ZMODEM_HEADER_LEN..];
        let frame_type = if header[3] == ZHEX {
            parse_hex_frame_type(remaining)
        } else {
            remaining.first().copied()
        };

        let direction = match frame_type {
            Some(0x00) => Some(ZmodemDirection::Download),
            Some(0x01) => Some(ZmodemDirection::Upload),
            _ => None,
        };

        if let Some(direction) = direction {
            return Some((direction, start));
        }
    }

    None
}

fn retained_prefix_start(data: &[u8], data_starts_at_line_start: bool) -> usize {
    let max_suffix = data.len().min(ZMODEM_HEADER_LEN + 1);
    for len in (1..=max_suffix).rev() {
        let start = data.len() - len;
        let suffix = &data[start..];
        if !is_possible_zmodem_prefix(suffix) {
            continue;
        }
        if suffix_contains_zdle(suffix)
            || is_line_start(data, start, data_starts_at_line_start)
            || has_rz_receive_prompt_before(data, start)
        {
            return start;
        }
    }
    data.len()
}

fn is_line_start(data: &[u8], start: usize, data_starts_at_line_start: bool) -> bool {
    if start == 0 {
        return data_starts_at_line_start;
    }
    matches!(data.get(start - 1), Some(b'\n' | b'\r'))
}

fn ends_at_line_start(data: &[u8]) -> bool {
    matches!(data.last(), Some(b'\n' | b'\r'))
}

fn suffix_contains_zdle(data: &[u8]) -> bool {
    data.contains(&ZDLE)
}

fn has_rz_receive_prompt_before(data: &[u8], start: usize) -> bool {
    const RZ_RECEIVE_PROMPT: &[u8] = b"z waiting to receive.";
    data[..start]
        .windows(RZ_RECEIVE_PROMPT.len())
        .any(|window| window == RZ_RECEIVE_PROMPT)
}

fn is_possible_zmodem_prefix(data: &[u8]) -> bool {
    match data {
        [] => true,
        [ZPAD] => true,
        [ZPAD, ZPAD] => true,
        [ZPAD, ZPAD, ZDLE] => true,
        [ZPAD, ZPAD, ZDLE, kind] => matches!(*kind, ZHEX | ZBIN | ZBIN32),
        [ZPAD, ZPAD, ZDLE, ZHEX, first_hex] => hex_digit(*first_hex).is_some(),
        _ => false,
    }
}

/// Parse a hex-encoded frame type byte from two ASCII hex chars.
fn parse_hex_frame_type(data: &[u8]) -> Option<u8> {
    if data.len() < 2 {
        return None;
    }
    let hi = hex_digit(data[0])?;
    let lo = hex_digit(data[1])?;
    Some((hi << 4) | lo)
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Transfer state machine
// ---------------------------------------------------------------------------

/// Active ZMODEM transfer state, created when a ZMODEM header is detected
/// and the user accepts the transfer via the frontend dialog.
pub struct ZmodemTransfer {
    #[allow(dead_code)]
    direction: ZmodemDirection,
    state: TransferState,
    /// Count of consecutive CAN bytes seen — 5 in a row means abort.
    cancel_count: usize,
    file_count: u32,
    progress_throttle: ProgressThrottle,
    send_buf: Vec<u8>,
}

enum TransferState {
    /// Waiting for the frontend to provide save path / file paths.
    WaitingForUser {
        /// Raw bytes buffered while waiting for the user to pick files.
        buffered: Vec<u8>,
    },
    /// Actively receiving files (download / remote `sz`).
    Receiving {
        receiver: zmodem2::Receiver,
        save_dir: PathBuf,
        current_file: Option<ReceiveFile>,
    },
    /// Actively sending files (upload / remote `rz`).
    Sending {
        sender: zmodem2::Sender,
        files: Vec<PathBuf>,
        file_index: usize,
        current_file: Option<SendFile>,
    },
    /// Transfer finished or aborted.
    Done,
}

struct ReceiveFile {
    name: String,
    size: u64,
    file: std::fs::File,
    written: u64,
}

struct SendFile {
    name: String,
    size: u64,
    file: std::fs::File,
    sent: u64,
    position: u64,
}

struct ProgressThrottle {
    last_emit_at: Option<Instant>,
    last_emit_bytes: u64,
}

impl ProgressThrottle {
    fn new() -> Self {
        Self {
            last_emit_at: None,
            last_emit_bytes: 0,
        }
    }

    fn reset(&mut self) {
        self.last_emit_at = None;
        self.last_emit_bytes = 0;
    }

    fn should_emit(&mut self, bytes_transferred: u64, force: bool) -> bool {
        self.should_emit_at(bytes_transferred, force, Instant::now())
    }

    fn should_emit_at(&mut self, bytes_transferred: u64, force: bool, now: Instant) -> bool {
        if force
            || self.last_emit_at.is_none()
            || bytes_transferred.saturating_sub(self.last_emit_bytes) >= ZMODEM_PROGRESS_BYTES
            || self
                .last_emit_at
                .is_some_and(|last| now.duration_since(last) >= ZMODEM_PROGRESS_INTERVAL)
        {
            self.last_emit_at = Some(now);
            self.last_emit_bytes = bytes_transferred;
            return true;
        }

        false
    }
}

impl ZmodemTransfer {
    pub fn new(direction: ZmodemDirection, initial_bytes: &[u8]) -> Self {
        Self {
            direction,
            state: TransferState::WaitingForUser {
                buffered: initial_bytes.to_vec(),
            },
            cancel_count: 0,
            file_count: 0,
            progress_throttle: ProgressThrottle::new(),
            send_buf: Vec::new(),
        }
    }

    #[allow(dead_code)]
    pub fn direction(&self) -> ZmodemDirection {
        self.direction
    }

    pub fn is_done(&self) -> bool {
        matches!(self.state, TransferState::Done)
    }

    /// Called when the user cancels the transfer from the frontend.
    pub fn cancel(&mut self) -> Vec<ZmodemAction> {
        self.state = TransferState::Done;
        vec![
            ZmodemAction::SendToRemote(cancel_sequence()),
            ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                reason: "cancelled".to_string(),
            }),
        ]
    }

    /// Called when the user accepts a **download** and provides a save directory.
    pub fn accept_download(&mut self, save_dir: PathBuf) -> Vec<ZmodemAction> {
        let buffered = match &mut self.state {
            TransferState::WaitingForUser { buffered } => std::mem::take(buffered),
            _ => return vec![],
        };

        let receiver = match zmodem2::Receiver::new() {
            Ok(r) => r,
            Err(e) => {
                self.state = TransferState::Done;
                return vec![ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                    reason: format!("Failed to create ZMODEM receiver: {e}"),
                })];
            }
        };

        self.state = TransferState::Receiving {
            receiver,
            save_dir,
            current_file: None,
        };

        let mut actions = self.drain_outgoing();
        // Process the buffered bytes that arrived before the user accepted.
        actions.extend(self.feed_incoming(&buffered));
        actions
    }

    /// Called when the user accepts an **upload** and provides file paths.
    pub fn accept_upload(&mut self, files: Vec<PathBuf>) -> Vec<ZmodemAction> {
        let buffered = match &mut self.state {
            TransferState::WaitingForUser { buffered } => std::mem::take(buffered),
            _ => return vec![],
        };

        let sender = match zmodem2::Sender::new() {
            Ok(s) => s,
            Err(e) => {
                self.state = TransferState::Done;
                return vec![ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                    reason: format!("Failed to create ZMODEM sender: {e}"),
                })];
            }
        };

        self.state = TransferState::Sending {
            sender,
            files,
            file_index: 0,
            current_file: None,
        };

        let mut actions = Vec::new();
        // 1. Drain the Sender's initial outgoing bytes (ZRQINIT).
        actions.extend(self.drain_outgoing());
        // 2. Feed the buffered remote ZRINIT so the Sender knows the
        //    receiver's capabilities.
        actions.extend(self.feed_incoming(&buffered));
        // 3. Start the first file (prepares ZFILE frame).
        actions.extend(self.start_next_send_file());
        // 4. Drain the ZFILE frame.
        actions.extend(self.drain_outgoing());
        actions
    }

    /// Feed raw bytes from the remote into the transfer state machine.
    pub fn feed_incoming(&mut self, data: &[u8]) -> Vec<ZmodemAction> {
        // Check for cancel sequence (5+ consecutive CAN/ZDLE bytes).
        for &b in data {
            if b == ZDLE {
                self.cancel_count += 1;
                if self.cancel_count >= CANCEL_SEQ_LEN {
                    self.state = TransferState::Done;
                    return vec![ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                        reason: "Remote cancelled transfer".to_string(),
                    })];
                }
            } else {
                self.cancel_count = 0;
            }
        }

        match &mut self.state {
            TransferState::WaitingForUser { buffered } => {
                buffered.extend_from_slice(data);
                vec![]
            }
            TransferState::Receiving { .. } => self.feed_receiver(data),
            TransferState::Sending { .. } => self.feed_sender(data),
            TransferState::Done => vec![],
        }
    }

    fn feed_receiver(&mut self, data: &[u8]) -> Vec<ZmodemAction> {
        let mut actions = Vec::new();

        let TransferState::Receiving {
            receiver,
            save_dir,
            current_file,
        } = &mut self.state
        else {
            return actions;
        };

        let mut offset = 0;
        while offset < data.len() {
            match receiver.feed_incoming(&data[offset..]) {
                Ok(consumed) => {
                    if consumed == 0 {
                        break;
                    }
                    offset += consumed;
                }
                Err(e) => {
                    tracing::warn!("ZMODEM receive error: {e}");
                    if matches!(
                        e,
                        zmodem2::Error::UnexpectedCrc16 | zmodem2::Error::UnexpectedCrc32
                    ) {
                        offset += 1;
                        continue;
                    }
                    self.state = TransferState::Done;
                    actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                        reason: format!("ZMODEM protocol error: {e}"),
                    }));
                    return actions;
                }
            }

            // Drain outgoing protocol bytes first.
            let out = receiver.drain_outgoing();
            if !out.is_empty() {
                let out = out.to_vec();
                let n = out.len();
                actions.push(ZmodemAction::SendToRemote(out));
                receiver.advance_outgoing(n);
            }

            // Poll events — handle FileStart to create the output file.
            while let Some(event) = receiver.poll_event() {
                match event {
                    zmodem2::ReceiverEvent::FileStart => {
                        let name_raw = receiver.file_name();
                        let name = String::from_utf8_lossy(name_raw).to_string();
                        let name = sanitize_filename(&name);
                        let size = u64::from(receiver.file_size());

                        let file_path = save_dir.join(&name);
                        tracing::info!(
                            file = %file_path.display(),
                            size,
                            "ZMODEM receiving file"
                        );
                        match std::fs::File::create(&file_path) {
                            Ok(file) => {
                                self.progress_throttle.reset();
                                *current_file = Some(ReceiveFile {
                                    name: name.clone(),
                                    size,
                                    file,
                                    written: 0,
                                });
                                if self.progress_throttle.should_emit(0, true) {
                                    actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                                        file_name: name,
                                        bytes_transferred: 0,
                                        total_size: size,
                                        direction: ZmodemDirection::Download,
                                    }));
                                }
                            }
                            Err(e) => {
                                tracing::error!(
                                    "Failed to create file {}: {e}",
                                    file_path.display()
                                );
                                self.state = TransferState::Done;
                                actions.push(ZmodemAction::SendToRemote(cancel_sequence()));
                                actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                                    reason: format!("Failed to create file: {e}"),
                                }));
                                return actions;
                            }
                        }
                    }
                    zmodem2::ReceiverEvent::FileComplete => {
                        if let Some(rf) = current_file {
                            if self.progress_throttle.should_emit(rf.written, true) {
                                actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                                    file_name: rf.name.clone(),
                                    bytes_transferred: rf.written,
                                    total_size: rf.size,
                                    direction: ZmodemDirection::Download,
                                }));
                            }
                            let _ = rf.file.flush();
                        }
                        self.file_count += 1;
                        *current_file = None;
                    }
                    zmodem2::ReceiverEvent::SessionComplete => {
                        self.state = TransferState::Done;
                        actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Complete {
                            direction: ZmodemDirection::Download,
                            file_count: self.file_count,
                        }));
                        return actions;
                    }
                }
            }

            // Drain file data and write to the output file.
            let file_data = receiver.drain_file();
            if !file_data.is_empty() {
                let len = file_data.len();

                if let Some(rf) = current_file {
                    if let Err(e) = rf.file.write_all(file_data) {
                        tracing::error!("Failed to write file data: {e}");
                        self.state = TransferState::Done;
                        actions.push(ZmodemAction::SendToRemote(cancel_sequence()));
                        actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                            reason: format!("File write error: {e}"),
                        }));
                        return actions;
                    }
                    rf.written += len as u64;
                    if self.progress_throttle.should_emit(rf.written, false) {
                        actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                            file_name: rf.name.clone(),
                            bytes_transferred: rf.written,
                            total_size: rf.size,
                            direction: ZmodemDirection::Download,
                        }));
                    }
                }

                if let Err(e) = receiver.advance_file(len) {
                    tracing::warn!("advance_file error: {e}");
                }
            }
        }

        actions
    }

    fn feed_sender(&mut self, data: &[u8]) -> Vec<ZmodemAction> {
        let mut actions = Vec::new();

        let TransferState::Sending {
            sender,
            files,
            file_index,
            current_file,
        } = &mut self.state
        else {
            return actions;
        };

        let mut offset = 0;
        while offset < data.len() {
            match sender.feed_incoming(&data[offset..]) {
                Ok(consumed) => {
                    if consumed == 0 {
                        break;
                    }
                    offset += consumed;
                }
                Err(e) => {
                    tracing::warn!("ZMODEM send error: {e}");
                    if matches!(
                        e,
                        zmodem2::Error::UnexpectedCrc16 | zmodem2::Error::UnexpectedCrc32
                    ) {
                        offset += 1;
                        continue;
                    }
                    self.state = TransferState::Done;
                    actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                        reason: format!("ZMODEM send error: {e}"),
                    }));
                    return actions;
                }
            }
        }

        // Drain any outgoing protocol responses before fulfilling file requests.
        drain_sender_outgoing(sender, &mut actions);

        // Fulfill file data requests from the sender state machine.
        // Drain outgoing after each feed_file() to prevent buffer overflow
        // in the no_std fixed-capacity internal buffer.
        while let Some(req) = sender.poll_file() {
            if let Some(sf) = current_file {
                let requested_offset = u64::from(req.offset);
                if sf.position != requested_offset {
                    if let Err(e) = sf.file.seek(SeekFrom::Start(requested_offset)) {
                        tracing::warn!("File seek error: {e}");
                        break;
                    }
                    sf.position = requested_offset;
                }
                if self.send_buf.len() < req.len {
                    self.send_buf.resize(req.len, 0);
                }
                match sf.file.read(&mut self.send_buf[..req.len]) {
                    Ok(n) => {
                        if let Err(e) = sender.feed_file(&self.send_buf[..n]) {
                            tracing::warn!("feed_file error: {e}");
                            break;
                        }
                        sf.sent = sf.sent.max(requested_offset + n as u64);
                        sf.position += n as u64;
                        if self.progress_throttle.should_emit(sf.sent, false) {
                            actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                                file_name: sf.name.clone(),
                                bytes_transferred: sf.sent,
                                total_size: sf.size,
                                direction: ZmodemDirection::Upload,
                            }));
                        }
                        drain_sender_outgoing(sender, &mut actions);
                    }
                    Err(e) => {
                        tracing::warn!("File read error: {e}");
                        break;
                    }
                }
            }
        }

        // Poll events.
        while let Some(event) = sender.poll_event() {
            match event {
                zmodem2::SenderEvent::FileComplete => {
                    if let Some(sf) = current_file {
                        if self.progress_throttle.should_emit(sf.sent, true) {
                            actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                                file_name: sf.name.clone(),
                                bytes_transferred: sf.sent,
                                total_size: sf.size,
                                direction: ZmodemDirection::Upload,
                            }));
                        }
                    }
                    self.file_count += 1;
                    *current_file = None;
                    *file_index += 1;
                    if *file_index < files.len() {
                        self.progress_throttle.reset();
                        actions.extend(Self::start_file_for_sender(
                            sender,
                            files,
                            *file_index,
                            current_file,
                        ));
                        if let Some(sf) = current_file {
                            if self.progress_throttle.should_emit(0, true) {
                                actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                                    file_name: sf.name.clone(),
                                    bytes_transferred: 0,
                                    total_size: sf.size,
                                    direction: ZmodemDirection::Upload,
                                }));
                            }
                        }
                    } else if let Err(e) = sender.finish_session() {
                        tracing::warn!("finish_session error: {e}");
                    }
                }
                zmodem2::SenderEvent::SessionComplete => {
                    self.state = TransferState::Done;
                    actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Complete {
                        direction: ZmodemDirection::Upload,
                        file_count: self.file_count,
                    }));
                    return actions;
                }
            }
        }

        // Final drain.
        drain_sender_outgoing(sender, &mut actions);

        actions
    }

    fn start_next_send_file(&mut self) -> Vec<ZmodemAction> {
        let TransferState::Sending {
            sender,
            files,
            file_index,
            current_file,
        } = &mut self.state
        else {
            return vec![];
        };

        if *file_index >= files.len() {
            return vec![];
        }

        self.progress_throttle.reset();
        let mut actions = Self::start_file_for_sender(sender, files, *file_index, current_file);
        if let Some(sf) = current_file {
            if self.progress_throttle.should_emit(0, true) {
                actions.push(ZmodemAction::EmitEvent(ZmodemEvent::Progress {
                    file_name: sf.name.clone(),
                    bytes_transferred: 0,
                    total_size: sf.size,
                    direction: ZmodemDirection::Upload,
                }));
            }
        }
        actions
    }

    fn start_file_for_sender(
        sender: &mut zmodem2::Sender,
        files: &[PathBuf],
        index: usize,
        current_file: &mut Option<SendFile>,
    ) -> Vec<ZmodemAction> {
        let path = &files[index];
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();

        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(e) => {
                return vec![ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                    reason: format!("Failed to open {file_name}: {e}"),
                })];
            }
        };

        let metadata = match file.metadata() {
            Ok(m) => m,
            Err(e) => {
                return vec![ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                    reason: format!("Failed to read metadata for {file_name}: {e}"),
                })];
            }
        };

        let size = metadata.len();
        // zmodem2 uses u32 for file size
        let size_u32 = u32::try_from(size).unwrap_or(u32::MAX);

        if let Err(e) = sender.start_file(file_name.as_bytes(), size_u32) {
            return vec![ZmodemAction::EmitEvent(ZmodemEvent::Failed {
                reason: format!("start_file error: {e}"),
            })];
        }

        *current_file = Some(SendFile {
            name: file_name,
            size,
            file,
            sent: 0,
            position: 0,
        });

        vec![]
    }

    fn drain_outgoing(&mut self) -> Vec<ZmodemAction> {
        let mut actions = Vec::new();
        match &mut self.state {
            TransferState::Receiving { receiver, .. } => {
                let out = receiver.drain_outgoing();
                if !out.is_empty() {
                    let out = out.to_vec();
                    let n = out.len();
                    actions.push(ZmodemAction::SendToRemote(out));
                    receiver.advance_outgoing(n);
                }
            }
            TransferState::Sending { sender, .. } => {
                let out = sender.drain_outgoing();
                if !out.is_empty() {
                    let out = out.to_vec();
                    let n = out.len();
                    actions.push(ZmodemAction::SendToRemote(out));
                    sender.advance_outgoing(n);
                }
            }
            _ => {}
        }
        actions
    }
}

/// Drain the Sender's outgoing buffer into actions, advancing the cursor.
fn drain_sender_outgoing(sender: &mut zmodem2::Sender, actions: &mut Vec<ZmodemAction>) {
    let out = sender.drain_outgoing();
    if !out.is_empty() {
        let out = out.to_vec();
        let n = out.len();
        actions.push(ZmodemAction::SendToRemote(out));
        sender.advance_outgoing(n);
    }
}

/// Remove path separators and invalid characters from a filename.
fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let sanitized: String = base
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*') || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();

    if sanitized.is_empty() {
        "zmodem_file".to_string()
    } else {
        sanitized
    }
}

/// Build a 5×CAN + 5×BS abort/cancel sequence per ZMODEM spec.
fn cancel_sequence() -> Vec<u8> {
    let mut seq = vec![ZDLE; CANCEL_SEQ_LEN];
    seq.extend([0x08; CANCEL_SEQ_LEN]); // backspace to clean up display
    seq
}

#[cfg(test)]
mod tests {
    use super::{
        ProgressThrottle, ZMODEM_PROGRESS_BYTES, ZMODEM_PROGRESS_INTERVAL, ZmodemDetectResult,
        ZmodemDetector, ZmodemDirection,
    };
    use std::time::{Duration, Instant};

    fn detected_direction(result: ZmodemDetectResult) -> ZmodemDirection {
        match result {
            ZmodemDetectResult::Detected { direction, .. } => direction,
            ZmodemDetectResult::NoMatch { .. } => panic!("expected ZMODEM detection"),
        }
    }

    #[test]
    fn detects_complete_zhex_download_header() {
        let mut detector = ZmodemDetector::new();
        let result = detector.feed(b"ready\r\n**\x18B00");

        match result {
            ZmodemDetectResult::Detected {
                direction,
                passthrough,
                initial_bytes,
            } => {
                assert_eq!(direction, ZmodemDirection::Download);
                assert_eq!(passthrough, b"ready\r\n");
                assert_eq!(initial_bytes, b"**\x18B00");
            }
            ZmodemDetectResult::NoMatch { .. } => panic!("expected ZMODEM detection"),
        }
    }

    #[test]
    fn detects_zbin_upload_header_across_chunks() {
        let mut detector = ZmodemDetector::new();
        match detector.feed(b"prefix\r\n**\x18") {
            ZmodemDetectResult::NoMatch { passthrough } => {
                assert_eq!(passthrough, b"prefix\r\n")
            }
            ZmodemDetectResult::Detected { .. } => panic!("unexpected early detection"),
        }

        let result = detector.feed(b"A\x01payload");
        match result {
            ZmodemDetectResult::Detected {
                direction,
                passthrough,
                initial_bytes,
            } => {
                assert_eq!(direction, ZmodemDirection::Upload);
                assert!(passthrough.is_empty());
                assert_eq!(initial_bytes, b"**\x18A\x01payload");
            }
            ZmodemDetectResult::NoMatch { .. } => panic!("expected ZMODEM detection"),
        }
    }

    #[test]
    fn detects_rz_zhex_upload_header_after_prompt_text() {
        let mut detector = ZmodemDetector::new();
        let result = detector.feed(b"\x18z waiting to receive.**\x18B01");

        match result {
            ZmodemDetectResult::Detected {
                direction,
                passthrough,
                initial_bytes,
            } => {
                assert_eq!(direction, ZmodemDirection::Upload);
                assert_eq!(passthrough, b"\x18z waiting to receive.");
                assert_eq!(initial_bytes, b"**\x18B01");
            }
            ZmodemDetectResult::NoMatch { .. } => panic!("expected ZMODEM detection"),
        }
    }

    #[test]
    fn detects_rz_zhex_upload_header_split_after_prompt_text() {
        let mut detector = ZmodemDetector::new();
        match detector.feed(b"\x18z waiting to receive.**") {
            ZmodemDetectResult::NoMatch { passthrough } => {
                assert_eq!(passthrough, b"\x18z waiting to receive.")
            }
            ZmodemDetectResult::Detected { .. } => panic!("unexpected early detection"),
        }

        assert_eq!(
            detected_direction(detector.feed(b"\x18B01")),
            ZmodemDirection::Upload
        );
    }

    #[test]
    fn detects_zhex_frame_type_split_after_first_hex_digit() {
        let mut detector = ZmodemDetector::new();
        match detector.feed(b"**\x18B0") {
            ZmodemDetectResult::NoMatch { passthrough } => assert!(passthrough.is_empty()),
            ZmodemDetectResult::Detected { .. } => panic!("unexpected early detection"),
        }

        assert_eq!(
            detected_direction(detector.feed(b"1rest")),
            ZmodemDirection::Upload
        );
    }

    #[test]
    fn passthroughs_interactive_asterisks_immediately() {
        let mut detector = ZmodemDetector::new();
        let chunks: [&[u8]; 4] = [b"docker", b"*", b"*", b"*"];
        let mut visible = Vec::new();

        for chunk in chunks {
            match detector.feed(chunk) {
                ZmodemDetectResult::NoMatch { passthrough } => {
                    visible.extend_from_slice(&passthrough);
                }
                ZmodemDetectResult::Detected { .. } => panic!("unexpected ZMODEM detection"),
            }
        }

        assert_eq!(visible, b"docker***");
    }

    #[test]
    fn waits_for_zmodem_header_after_zdle_even_inside_text() {
        let mut detector = ZmodemDetector::new();
        match detector.feed(b"prefix**\x18") {
            ZmodemDetectResult::NoMatch { passthrough } => {
                assert_eq!(passthrough, b"prefix")
            }
            ZmodemDetectResult::Detected { .. } => panic!("unexpected ZMODEM detection"),
        }

        assert_eq!(
            detected_direction(detector.feed(b"A\x01payload")),
            ZmodemDirection::Upload
        );
    }

    #[test]
    fn progress_throttle_emits_first_time() {
        let mut throttle = ProgressThrottle::new();
        assert!(throttle.should_emit_at(0, false, Instant::now()));
    }

    #[test]
    fn progress_throttle_respects_time_and_byte_thresholds() {
        let mut throttle = ProgressThrottle::new();
        let start = Instant::now();
        assert!(throttle.should_emit_at(0, false, start));
        assert!(!throttle.should_emit_at(1, false, start + Duration::from_millis(10)));
        assert!(throttle.should_emit_at(
            ZMODEM_PROGRESS_BYTES,
            false,
            start + Duration::from_millis(20)
        ));
        assert!(throttle.should_emit_at(
            ZMODEM_PROGRESS_BYTES + 1,
            false,
            start + ZMODEM_PROGRESS_INTERVAL + Duration::from_millis(30)
        ));
    }

    #[test]
    fn progress_throttle_force_emits_completion() {
        let mut throttle = ProgressThrottle::new();
        let start = Instant::now();
        assert!(throttle.should_emit_at(128, false, start));
        assert!(throttle.should_emit_at(129, true, start + Duration::from_millis(1)));
    }
}

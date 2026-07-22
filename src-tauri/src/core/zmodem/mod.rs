//! ZMODEM (lrzsz) file transfer detection and protocol handling.
//!
//! Intercepts ZMODEM init headers in the raw terminal byte stream and drives
//! file transfers using the `zmodem2` state-machine crate. Each session's
//! I/O loop creates a [`ZmodemDetector`] that scans bytes **before** they are
//! converted to lossy UTF-8. When a ZMODEM session is confirmed the detector
//! transitions to an active [`ZmodemTransfer`] that owns the protocol state.

use serde::Serialize;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
const ZMODEM_FINISH_DRAIN_IDLE: Duration = Duration::from_millis(250);
const ZMODEM_FILE_WRITE_BUFFER_SIZE: usize = 1024 * 1024;

include!("types.rs");
include!("detector.rs");
include!("transfer.rs");
include!("filename.rs");
include!("tests.rs");

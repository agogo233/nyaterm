//! Backend services and shared domain logic.
//!
//! Groups runtime session management, SSH services, translations, importers,
//! and common error types under one backend-oriented namespace.

pub mod ai;
pub mod backup;
pub mod capture;
pub mod cloud_sync;
pub mod history;
pub mod importer;
pub(crate) mod input;
mod output;
pub mod portable_snapshot;
pub(crate) mod pty;
mod quick_commands;
mod recording;
pub mod serial;
mod session;
pub mod sftp;
pub mod ssh;
pub mod stats;
pub mod telnet;
pub mod translate;
pub mod watcher;
pub mod zmodem;

pub use cloud_sync::CloudSyncManager;
pub(crate) use output::SessionOutputCoalescer;
pub use pty::{LocalSessionConfig, create_local_session};
pub use quick_commands::{
    QuickCommandsImportResult, QuickCommandsImportSource, QuickCommandsStore,
};
pub use recording::RecordingManager;
pub use serial::{SerialConfig, create_serial_session, list_serial_ports};
pub(crate) use session::update_cwd_if_changed;
pub use session::{
    SessionCommand, SessionHandle, SessionInfo, SessionManager, SessionType, SharedCwd,
};
pub use telnet::{TelnetEnterMode, TelnetSessionConfig, create_telnet_session};

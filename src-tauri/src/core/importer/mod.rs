//! Import sessions from Xshell (.xts), MobaXterm (.mxtsessions), WindTerm (.sessions),
//! SecureCRT (.xml), FinalShell conn directories, NyaTerm JSON files, and Electerm bookmarks.

use crate::config::{
    self, AiExecutionProfile, ConnectionAuth, ConnectionType, Group, SavedConnection,
};
use crate::error::{AppError, AppResult};
#[cfg(not(test))]
use crate::utils::crypto;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use tauri::Emitter;

#[cfg(not(test))]
fn encrypt_import_secret(plaintext: &str) -> AppResult<String> {
    crypto::encrypt(plaintext)
}

#[cfg(test)]
fn encrypt_import_secret(plaintext: &str) -> AppResult<String> {
    Ok(format!("test-encrypted:{plaintext}"))
}

include!("types.rs");
include!("text.rs");
include!("common.rs");
include!("xshell.rs");
include!("mobaxterm.rs");
include!("windterm.rs");
include!("securecrt.rs");
include!("finalshell.rs");
include!("nyaterm_json.rs");
include!("electerm.rs");
include!("termius.rs");
include!("merge.rs");
include!("tests.rs");

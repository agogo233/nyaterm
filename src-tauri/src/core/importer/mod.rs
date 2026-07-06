//! Import sessions from Xshell (.xts), MobaXterm (.mxtsessions), WindTerm (.sessions),
//! SecureCRT (.xml), FinalShell conn directories, and NyaTerm JSON files.

use crate::config::{
    self, AiExecutionProfile, ConnectionAuth, ConnectionType, Group, SavedConnection,
};
use crate::error::{AppError, AppResult};
use crate::utils::crypto;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use tauri::Emitter;

include!("types.rs");
include!("text.rs");
include!("common.rs");
include!("xshell.rs");
include!("mobaxterm.rs");
include!("windterm.rs");
include!("securecrt.rs");
include!("finalshell.rs");
include!("nyaterm_json.rs");
include!("termius.rs");
include!("merge.rs");
include!("tests.rs");

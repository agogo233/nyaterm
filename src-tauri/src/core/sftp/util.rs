//! Shared helpers for remote file system backends: path quoting, permission
//! formatting, and common type definitions.

use serde::Serialize;

pub(crate) const SFTP_FILE_TYPE_MASK: u32 = 0o170000;
pub(crate) const POSIX_MODE_MASK: u32 = 0o7777;

/// Parsed entry from a remote directory listing for the file explorer.
#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub mtime: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileProperties {
    pub name: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub uid: String,
    pub gid: String,
    pub mtime: u64,
    pub atime: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoteTextFile {
    pub path: String,
    pub content: String,
    pub size: u64,
}

/// POSIX shell-safe quoting: wraps `input` in single quotes and escapes any
/// embedded single-quote characters.  An empty string returns `''`.
pub(crate) fn sh_quote(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }
    let escaped = input.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Convert a POSIX permission bitmask to the classic `ls -l` string like `-rwxr-xr-x`.
pub(crate) fn permissions_to_string(mode: u32, type_char: char) -> String {
    let mut s = String::with_capacity(10);

    s.push(type_char);

    s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    s.push(match (mode & 0o100 != 0, mode & 0o4000 != 0) {
        (true, true) => 's',
        (false, true) => 'S',
        (true, false) => 'x',
        (false, false) => '-',
    });

    s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    s.push(match (mode & 0o010 != 0, mode & 0o2000 != 0) {
        (true, true) => 's',
        (false, true) => 'S',
        (true, false) => 'x',
        (false, false) => '-',
    });

    s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    s.push(match (mode & 0o001 != 0, mode & 0o1000 != 0) {
        (true, true) => 't',
        (false, true) => 'T',
        (true, false) => 'x',
        (false, false) => '-',
    });

    s
}

pub(crate) fn type_char_from_mode(mode: u32) -> char {
    match mode & SFTP_FILE_TYPE_MASK {
        0o040000 => 'd',
        0o120000 => 'l',
        _ => '-',
    }
}

pub(crate) fn describe_permissions(mode: Option<u32>) -> String {
    match mode {
        Some(mode) => format!(
            "{mode:#06o} ({})",
            permissions_to_string(mode, type_char_from_mode(mode))
        ),
        None => "none".to_string(),
    }
}

pub(crate) fn owner_or_id(owner: &Option<String>, uid: Option<u32>) -> String {
    owner
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| uid.map(|value| value.to_string()))
        .unwrap_or_default()
}

pub(crate) fn group_or_id(group: &Option<String>, gid: Option<u32>) -> String {
    group
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| gid.map(|value| value.to_string()))
        .unwrap_or_default()
}

pub(crate) fn parse_octal_mode(mode: &str) -> crate::error::AppResult<u32> {
    u32::from_str_radix(mode, 8)
        .map_err(|_| crate::error::AppError::Channel(format!("Invalid octal mode: {}", mode)))
}

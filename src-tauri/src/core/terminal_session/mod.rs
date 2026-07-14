//! Terminal session implementations that bridge transports into the shared session model.

pub(crate) mod local;
pub(crate) mod serial;
pub(crate) mod telnet;

/// Decodes raw bytes to a UTF-8 string using the specified encoding.
/// Falls back to UTF-8 lossy conversion if encoding is not recognized.
pub(crate) fn decode_terminal_output(data: &[u8], encoding: &str) -> String {
    match encoding.to_uppercase().as_str() {
        "GBK" | "GB2312" | "GB18030" => {
            let (decoded, _, _) = encoding_rs::GBK.decode(data);
            decoded.into_owned()
        }
        _ => String::from_utf8_lossy(data).into_owned(),
    }
}

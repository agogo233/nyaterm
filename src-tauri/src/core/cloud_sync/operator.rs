use std::collections::HashMap;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use http::header::{AUTHORIZATION, WWW_AUTHENTICATE};
use http::{HeaderValue, Request, Response};
use md5::{Digest as Md5Digest, Md5};
use opendal::layers::{HttpClientLayer, RetryLayer, TimeoutLayer, TracingLayer};
use opendal::raw::{HttpBody, HttpClient, HttpFetch};
use opendal::services::{S3, Webdav};
use opendal::{Buffer, Error, ErrorKind, Operator};
use rand::RngCore;
use sha2::Sha256;

use crate::config::CloudSyncSettings;
use crate::error::{AppError, AppResult};
use crate::utils::url::normalize_storage_endpoint;

use super::remote::remote_path;

const GITEE_REMOTE_FILE_PREFIX: &str = "nyaterm-";
const GITEE_REMOTE_FILE_SUFFIX: &str = ".blob";
const GITEE_REMOTE_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) enum CloudRemote {
    OpenDal(Operator),
    GiteeSnippet(GiteeSnippetRemote),
}

impl CloudRemote {
    pub(super) async fn create_dir(&self, path: &str) -> AppResult<()> {
        match self {
            Self::OpenDal(operator) => operator.create_dir(path).await.map_err(map_storage_error),
            Self::GiteeSnippet(_) => Ok(()),
        }
    }

    pub(super) async fn exists(&self, path: &str) -> AppResult<bool> {
        match self {
            Self::OpenDal(operator) => operator.exists(path).await.map_err(map_storage_error),
            Self::GiteeSnippet(remote) => remote.exists(path).await,
        }
    }

    pub(super) async fn read(&self, path: &str) -> AppResult<Vec<u8>> {
        match self {
            Self::OpenDal(operator) => Ok(operator
                .read(path)
                .await
                .map_err(map_storage_error)?
                .to_vec()),
            Self::GiteeSnippet(remote) => remote.read(path).await,
        }
    }

    pub(super) async fn read_if_exists(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        match self {
            Self::OpenDal(operator) => {
                if !operator.exists(path).await.map_err(map_storage_error)? {
                    return Ok(None);
                }
                Ok(Some(
                    operator
                        .read(path)
                        .await
                        .map_err(map_storage_error)?
                        .to_vec(),
                ))
            }
            Self::GiteeSnippet(remote) => remote.read_if_exists(path).await,
        }
    }

    pub(super) async fn write(&self, path: &str, content: Vec<u8>) -> AppResult<()> {
        match self {
            Self::OpenDal(operator) => {
                operator
                    .write(path, content)
                    .await
                    .map_err(map_storage_error)?;
                Ok(())
            }
            Self::GiteeSnippet(remote) => remote.write(path, &content).await,
        }
    }

    pub(super) async fn delete(&self, path: &str) -> AppResult<()> {
        match self {
            Self::OpenDal(operator) => operator.delete(path).await.map_err(map_storage_error),
            Self::GiteeSnippet(remote) => remote.delete(path).await,
        }
    }
}

pub(super) fn build_remote(settings: &CloudSyncSettings) -> AppResult<CloudRemote> {
    match settings.provider.as_str() {
        "webdav" => build_webdav_operator(settings).map(CloudRemote::OpenDal),
        "s3" => build_s3_operator(settings).map(CloudRemote::OpenDal),
        "gitee_snippet" => GiteeSnippetRemote::new(settings).map(CloudRemote::GiteeSnippet),
        other => Err(AppError::Config(format!(
            "Unsupported cloud provider '{}'",
            other
        ))),
    }
}

fn build_webdav_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    let endpoint = normalize_storage_endpoint(&settings.webdav.endpoint);
    let mut builder = Webdav::default().endpoint(&endpoint);
    if !settings.webdav.root.trim().is_empty() {
        builder = builder.root(&settings.webdav.root);
    }
    if !settings.webdav.username.trim().is_empty() {
        builder = builder.username(&settings.webdav.username);
    }
    if let Some(password) = settings
        .webdav
        .password
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.password(password);
    }
    let digest_client = WebdavDigestHttpClient::new(
        settings.webdav.username.clone(),
        settings.webdav.password.clone().unwrap_or_default(),
    );
    Ok(Operator::new(builder)
        .map_err(map_storage_error)?
        .layer(
            TimeoutLayer::new()
                .with_timeout(Duration::from_secs(30))
                .with_io_timeout(Duration::from_secs(30)),
        )
        .layer(HttpClientLayer::new(HttpClient::with(digest_client)))
        .layer(RetryLayer::new().with_max_times(3))
        .layer(TracingLayer)
        .finish())
}

fn build_s3_operator(settings: &CloudSyncSettings) -> AppResult<Operator> {
    let mut builder = S3::default().bucket(&settings.s3.bucket);
    let endpoint = normalize_storage_endpoint(&settings.s3.endpoint);
    if !endpoint.is_empty() {
        builder = builder.endpoint(&endpoint);
    }
    if !settings.s3.region.trim().is_empty() {
        builder = builder.region(&settings.s3.region);
    }
    if !settings.s3.root.trim().is_empty() {
        builder = builder.root(&settings.s3.root);
    }
    if let Some(access_key_id) = settings
        .s3
        .access_key_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.access_key_id(access_key_id);
    }
    if let Some(secret_access_key) = settings
        .s3
        .secret_access_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.secret_access_key(secret_access_key);
    }
    if let Some(session_token) = settings
        .s3
        .session_token
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        builder = builder.session_token(session_token);
    }
    if settings.s3.virtual_host_style {
        builder = builder.enable_virtual_host_style();
    }
    Ok(Operator::new(builder)
        .map_err(map_storage_error)?
        .layer(
            TimeoutLayer::new()
                .with_timeout(Duration::from_secs(30))
                .with_io_timeout(Duration::from_secs(30)),
        )
        .layer(RetryLayer::new().with_max_times(3))
        .layer(TracingLayer)
        .finish())
}

pub(super) async fn ensure_remote_layout(remote: &CloudRemote, base_root: &str) -> AppResult<()> {
    remote
        .create_dir(&remote_path(base_root, super::remote::SYNC_SNAPSHOTS_DIR))
        .await?;
    remote
        .create_dir(&remote_path(
            base_root,
            super::remote::BACKUPS_SNAPSHOTS_DIR,
        ))
        .await?;
    Ok(())
}

pub(super) fn map_storage_error(error: opendal::Error) -> AppError {
    let raw = error.to_string();
    if let Some(message) = map_webdav_auth_error(&raw) {
        return AppError::Config(message);
    }

    if is_storage_timeout_error(&raw) {
        return AppError::Io(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("cloud storage operation timed out: {raw}"),
        ));
    }

    if error.is_temporary() {
        return AppError::Io(io::Error::new(
            io::ErrorKind::Other,
            format!("temporary cloud storage error: {raw}"),
        ));
    }

    let label = match error.kind() {
        ErrorKind::NotFound => "not found",
        ErrorKind::PermissionDenied => "permission denied",
        ErrorKind::ConfigInvalid => "invalid config",
        ErrorKind::Unsupported => "unsupported",
        ErrorKind::RateLimited => "rate limited",
        _ => "unexpected error",
    };
    AppError::Config(format!("cloud storage {label}: {raw}"))
}

fn is_storage_timeout_error(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("operation timeout")
        || lower.contains("io timeout")
        || lower.contains("timed out")
        || lower.contains("deadline has elapsed")
}

fn map_webdav_auth_error(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let is_webdav = lower.contains("service: webdav");
    let is_unauthorized = lower.contains("status: 401") || lower.contains("401 unauthorized");

    if is_webdav && is_unauthorized {
        return Some(
            "WebDAV authentication failed (401 Unauthorized). Verify the endpoint, username, password or app password, and the authentication methods enabled by your WebDAV provider."
                .to_string(),
        );
    }

    None
}

pub(super) struct GiteeSnippetRemote {
    client: reqwest::Client,
    api_endpoint: String,
    gist_id: String,
    access_token: String,
}

#[derive(Debug, serde::Deserialize)]
struct GiteeSnippet {
    #[serde(default)]
    files: HashMap<String, GiteeSnippetFile>,
}

#[derive(Debug, serde::Deserialize)]
struct GiteeSnippetFile {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    raw_url: Option<String>,
}

impl GiteeSnippetRemote {
    fn new(settings: &CloudSyncSettings) -> AppResult<Self> {
        let api_endpoint = normalize_storage_endpoint(&settings.gitee_snippet.api_endpoint);
        let gist_id = settings.gitee_snippet.gist_id.trim().to_string();
        let access_token = settings
            .gitee_snippet
            .access_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Config("Gitee access token is required".to_string()))?
            .to_string();

        if api_endpoint.is_empty() {
            return Err(AppError::Config(
                "Gitee API endpoint is required".to_string(),
            ));
        }
        if gist_id.is_empty() {
            return Err(AppError::Config("Gitee snippet ID is required".to_string()));
        }

        let client = reqwest::Client::builder()
            .timeout(GITEE_REMOTE_TIMEOUT)
            .build()
            .map_err(map_gitee_client_error)?;

        Ok(Self {
            client,
            api_endpoint,
            gist_id,
            access_token,
        })
    }

    async fn exists(&self, path: &str) -> AppResult<bool> {
        let snippet = self.fetch_snippet().await?;
        Ok(snippet.files.contains_key(&gitee_remote_filename(path)))
    }

    async fn read(&self, path: &str) -> AppResult<Vec<u8>> {
        self.read_if_exists(path)
            .await?
            .ok_or_else(|| AppError::Config(format!("Gitee snippet file '{}' not found", path)))
    }

    async fn read_if_exists(&self, path: &str) -> AppResult<Option<Vec<u8>>> {
        let filename = gitee_remote_filename(path);
        if let Ok(content) = self.fetch_raw_filename(&filename).await {
            return decode_gitee_file_content(&content).map(Some);
        }

        let snippet = self.fetch_snippet().await?;
        let Some(file) = snippet.files.get(&filename) else {
            return Ok(None);
        };
        let content = match file
            .content
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            Some(content) => content.to_string(),
            None => self.fetch_raw_file(&filename, file).await?,
        };
        decode_gitee_file_content(&content).map(Some)
    }

    async fn write(&self, path: &str, content: &[u8]) -> AppResult<()> {
        let encoded = BASE64_STANDARD.encode(content);
        self.patch_file(&gitee_remote_filename(path), encoded).await
    }

    async fn delete(&self, path: &str) -> AppResult<()> {
        let _ = path;
        Ok(())
    }

    async fn fetch_snippet(&self) -> AppResult<GiteeSnippet> {
        let url = format!("{}/gists/{}", self.api_endpoint, self.gist_id);
        let response = self
            .client
            .get(url)
            .query(&[("access_token", self.access_token.as_str())])
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        decode_gitee_response(response).await
    }

    async fn fetch_raw_file(&self, filename: &str, file: &GiteeSnippetFile) -> AppResult<String> {
        let raw_url = file.raw_url.as_deref().filter(|value| !value.is_empty());
        let url = raw_url.map(str::to_string).unwrap_or_else(|| {
            format!(
                "{}/gists/{}/raw/{}",
                self.api_endpoint, self.gist_id, filename
            )
        });
        let response = self
            .client
            .get(url)
            .query(&[("access_token", self.access_token.as_str())])
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        decode_gitee_text_response(response).await
    }

    async fn fetch_raw_filename(&self, filename: &str) -> AppResult<String> {
        let url = format!(
            "{}/gists/{}/raw/{}",
            self.api_endpoint, self.gist_id, filename
        );
        let response = self
            .client
            .get(url)
            .query(&[("access_token", self.access_token.as_str())])
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        decode_gitee_text_response(response).await
    }

    async fn patch_file(&self, filename: &str, content: String) -> AppResult<()> {
        let file_value = serde_json::json!({ "content": content });
        let mut files = serde_json::Map::new();
        files.insert(filename.to_string(), file_value);
        let body = serde_json::json!({
            "access_token": self.access_token.as_str(),
            "files": files,
        });
        let url = format!("{}/gists/{}", self.api_endpoint, self.gist_id);
        let response = self
            .client
            .patch(url)
            .json(&body)
            .send()
            .await
            .map_err(map_gitee_client_error)?;
        let _: serde_json::Value = decode_gitee_response(response).await?;
        Ok(())
    }
}

fn gitee_remote_filename(path: &str) -> String {
    format!(
        "{}{}{}",
        GITEE_REMOTE_FILE_PREFIX,
        URL_SAFE_NO_PAD.encode(path.as_bytes()),
        GITEE_REMOTE_FILE_SUFFIX
    )
}

fn decode_gitee_file_content(content: &str) -> AppResult<Vec<u8>> {
    BASE64_STANDARD
        .decode(content.trim())
        .map_err(|error| AppError::Config(format!("Invalid Gitee snippet content: {error}")))
}

async fn decode_gitee_response<T: serde::de::DeserializeOwned>(
    response: reqwest::Response,
) -> AppResult<T> {
    let text = decode_gitee_text_response(response).await?;
    serde_json::from_str(&text).map_err(Into::into)
}

async fn decode_gitee_text_response(response: reqwest::Response) -> AppResult<String> {
    let status = response.status();
    let text = response.text().await.map_err(map_gitee_client_error)?;
    if !status.is_success() {
        return Err(AppError::Config(format!(
            "Gitee snippet request failed ({status}): {}",
            text.trim()
        )));
    }
    Ok(text)
}

fn map_gitee_client_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Io(io::Error::new(
            io::ErrorKind::TimedOut,
            format!("Gitee snippet operation timed out: {error}"),
        ))
    } else {
        AppError::Config(format!("Gitee snippet request failed: {error}"))
    }
}

#[derive(Clone)]
struct WebdavDigestHttpClient {
    inner: HttpClient,
    username: Arc<str>,
    password: Arc<str>,
}

impl WebdavDigestHttpClient {
    fn new(username: String, password: String) -> Self {
        Self {
            inner: HttpClient::default(),
            username: Arc::from(username),
            password: Arc::from(password),
        }
    }
}

impl HttpFetch for WebdavDigestHttpClient {
    async fn fetch(&self, req: Request<Buffer>) -> opendal::Result<Response<HttpBody>> {
        let retry_req = clone_request(&req)?;
        let resp = self.inner.fetch(req).await?;
        if resp.status() != http::StatusCode::UNAUTHORIZED {
            return Ok(resp);
        }

        let Some(challenge) = digest_challenge(resp.headers()) else {
            return Ok(resp);
        };
        if self.username.is_empty() || self.password.is_empty() {
            return Ok(resp);
        }

        let auth = build_digest_authorization(
            &challenge,
            self.username.as_ref(),
            self.password.as_ref(),
            retry_req.method().as_str(),
            retry_req
                .uri()
                .path_and_query()
                .map_or("/", |path| path.as_str()),
            &random_cnonce(),
            "00000001",
        )?;
        let mut retry_req = retry_req;
        let header = HeaderValue::from_str(&auth).map_err(|err| {
            Error::new(
                ErrorKind::Unexpected,
                "build WebDAV Digest authorization header",
            )
            .set_source(err)
        })?;
        retry_req.headers_mut().insert(AUTHORIZATION, header);
        self.inner.fetch(retry_req).await
    }
}

fn clone_request(req: &Request<Buffer>) -> opendal::Result<Request<Buffer>> {
    let mut builder = Request::builder()
        .method(req.method().clone())
        .uri(req.uri().clone())
        .version(req.version());
    *builder.headers_mut().expect("request builder has headers") = req.headers().clone();
    builder.body(req.body().clone()).map_err(|err| {
        Error::new(ErrorKind::Unexpected, "clone WebDAV Digest retry request").set_source(err)
    })
}

fn digest_challenge(headers: &http::HeaderMap) -> Option<String> {
    headers
        .get_all(WWW_AUTHENTICATE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find_map(|value| {
            value
                .split_once("Digest")
                .map(|(_, challenge)| challenge.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}

fn build_digest_authorization(
    challenge: &str,
    username: &str,
    password: &str,
    method: &str,
    uri: &str,
    cnonce: &str,
    nc: &str,
) -> opendal::Result<String> {
    let params = parse_digest_challenge(challenge);
    let realm = required_digest_param(&params, "realm")?;
    let nonce = required_digest_param(&params, "nonce")?;
    let qop = choose_digest_qop(params.get("qop").map(String::as_str))?;
    let algorithm = params
        .get("algorithm")
        .map_or("MD5", String::as_str)
        .trim()
        .to_ascii_uppercase();

    let ha1 = digest_hash(&algorithm, &format!("{username}:{realm}:{password}"))?;
    let ha2 = digest_hash(&algorithm, &format!("{method}:{uri}"))?;
    let response = digest_hash(
        &algorithm,
        &format!("{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}"),
    )?;

    let opaque = params
        .get("opaque")
        .map(|value| format!(", opaque=\"{}\"", escape_digest_value(value)))
        .unwrap_or_default();

    Ok(format!(
        "Digest username=\"{}\", realm=\"{}\", nonce=\"{}\", uri=\"{}\", algorithm={}, response=\"{}\", qop={}, nc={}, cnonce=\"{}\"{}",
        escape_digest_value(username),
        escape_digest_value(realm),
        escape_digest_value(nonce),
        escape_digest_value(uri),
        algorithm,
        response,
        qop,
        nc,
        escape_digest_value(cnonce),
        opaque
    ))
}

fn parse_digest_challenge(challenge: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let mut rest = challenge.trim();
    while !rest.is_empty() {
        rest = rest.trim_start_matches(|ch: char| ch == ',' || ch.is_whitespace());
        let Some((key, after_key)) = rest.split_once('=') else {
            break;
        };
        let key = key.trim().to_ascii_lowercase();
        let after_key = after_key.trim_start();
        let (value, next) = if let Some(quoted) = after_key.strip_prefix('"') {
            parse_quoted_digest_value(quoted)
        } else {
            let split_at = after_key.find(',').unwrap_or(after_key.len());
            (
                after_key[..split_at].trim().to_string(),
                after_key[split_at..].trim_start_matches(','),
            )
        };
        if !key.is_empty() {
            values.insert(key, value);
        }
        rest = next;
    }
    values
}

fn parse_quoted_digest_value(input: &str) -> (String, &str) {
    let mut value = String::new();
    let mut escaped = false;
    for (index, ch) in input.char_indices() {
        if escaped {
            value.push(ch);
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            '"' => return (value, &input[index + ch.len_utf8()..]),
            _ => value.push(ch),
        }
    }
    (value, "")
}

fn required_digest_param<'a>(
    params: &'a HashMap<String, String>,
    key: &str,
) -> opendal::Result<&'a str> {
    params
        .get(key)
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Error::new(
                ErrorKind::ConfigInvalid,
                format!("WebDAV Digest authentication challenge is missing {key}"),
            )
        })
}

fn choose_digest_qop(qop: Option<&str>) -> opendal::Result<&'static str> {
    let Some(qop) = qop else {
        return Err(Error::new(
            ErrorKind::Unsupported,
            "WebDAV Digest authentication without qop=auth is not supported",
        ));
    };
    if qop
        .split(',')
        .map(|value| value.trim().trim_matches('"').to_ascii_lowercase())
        .any(|value| value == "auth")
    {
        Ok("auth")
    } else {
        Err(Error::new(
            ErrorKind::Unsupported,
            "WebDAV Digest authentication requires qop=auth",
        ))
    }
}

fn digest_hash(algorithm: &str, value: &str) -> opendal::Result<String> {
    match algorithm {
        "MD5" => {
            let mut hasher = Md5::new();
            hasher.update(value.as_bytes());
            Ok(hex::encode(hasher.finalize()))
        }
        "SHA-256" | "SHA256" => {
            let mut hasher = Sha256::new();
            hasher.update(value.as_bytes());
            Ok(hex::encode(hasher.finalize()))
        }
        other => Err(Error::new(
            ErrorKind::Unsupported,
            format!("WebDAV Digest algorithm {other} is not supported"),
        )),
    }
}

fn random_cnonce() -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn escape_digest_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webdav_401_error_reports_generic_auth_hint() {
        let message = map_webdav_auth_error(
            "Unexpected (persistent) at stat, context: { service: webdav, response: Parts { status: 401 } } => 401 Unauthorized",
        );

        assert!(message.is_some());
        let message = message.unwrap();
        assert!(message.contains("WebDAV authentication failed"));
        assert!(!message.contains("currently supports"));
    }

    #[test]
    fn cloud_storage_endpoint_accepts_trailing_slashes() {
        assert_eq!(
            normalize_storage_endpoint("https://dav.example.com/remote.php/webdav"),
            "https://dav.example.com/remote.php/webdav"
        );
        assert_eq!(
            normalize_storage_endpoint("https://dav.example.com/remote.php/webdav/"),
            "https://dav.example.com/remote.php/webdav"
        );
        assert_eq!(
            normalize_storage_endpoint(" https://s3.example.com// "),
            "https://s3.example.com"
        );
    }

    #[test]
    fn digest_challenge_parser_handles_quoted_commas() {
        let parsed = parse_digest_challenge(
            r#"realm="Nya,Term", nonce="abc", algorithm=MD5, qop="auth,auth-int", opaque="xyz""#,
        );

        assert_eq!(parsed.get("realm").map(String::as_str), Some("Nya,Term"));
        assert_eq!(parsed.get("nonce").map(String::as_str), Some("abc"));
        assert_eq!(parsed.get("qop").map(String::as_str), Some("auth,auth-int"));
    }

    #[test]
    fn digest_authorization_supports_md5_qop_auth() {
        let header = build_digest_authorization(
            r#"realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#,
            "Mufasa",
            "Circle Of Life",
            "GET",
            "/dir/index.html",
            "0a4f113b",
            "00000001",
        )
        .expect("digest auth header");

        assert!(header.contains("Digest username=\"Mufasa\""));
        assert!(header.contains("qop=auth"));
        assert!(header.contains("response=\"6629fae49393a05397450978507c4ef1\""));
    }

    #[test]
    fn digest_authorization_rejects_unsupported_qop() {
        let error = build_digest_authorization(
            r#"realm="test", qop="auth-int", nonce="abc""#,
            "user",
            "pass",
            "GET",
            "/",
            "cnonce",
            "00000001",
        )
        .expect_err("auth-int is unsupported");

        assert_eq!(error.kind(), ErrorKind::Unsupported);
    }

    #[test]
    fn non_webdav_error_does_not_report_digest_hint() {
        let message = map_webdav_auth_error(
            "Unexpected (persistent) at stat, context: { service: s3, response: Parts { status: 401 } } => 401 Unauthorized",
        );

        assert!(message.is_none());
    }

    #[test]
    fn gitee_remote_filename_is_path_safe() {
        let filename = gitee_remote_filename("nyaterm/sync/latest.redb");

        assert!(filename.starts_with(GITEE_REMOTE_FILE_PREFIX));
        assert!(filename.ends_with(GITEE_REMOTE_FILE_SUFFIX));
        assert!(!filename.contains('/'));
    }

    #[test]
    fn timeout_storage_error_maps_to_retryable_io() {
        let mapped = map_storage_error(
            Error::new(ErrorKind::Unexpected, "operation timeout reached").set_temporary(),
        );

        match mapped {
            AppError::Io(error) => assert_eq!(error.kind(), io::ErrorKind::TimedOut),
            other => panic!("expected timeout IO error, got {other:?}"),
        }
    }

    #[test]
    fn temporary_storage_error_maps_to_retryable_io() {
        let mapped = map_storage_error(
            Error::new(ErrorKind::Unexpected, "service temporarily unavailable").set_temporary(),
        );

        assert!(matches!(mapped, AppError::Io(_)));
    }

    #[test]
    fn webdav_401_storage_error_stays_config_error() {
        let mapped = map_storage_error(
            Error::new(
                ErrorKind::Unexpected,
                "Unexpected at stat, context: { service: webdav, response: Parts { status: 401 } } => 401 Unauthorized",
            )
            .set_temporary(),
        );

        match mapped {
            AppError::Config(message) => assert!(message.contains("WebDAV authentication failed")),
            other => panic!("expected config auth error, got {other:?}"),
        }
    }
}

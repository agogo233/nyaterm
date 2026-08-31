use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::TranslateResult;

#[derive(Serialize)]
struct TranslateRequest<'a> {
    from: &'a str,
    to: &'a str,
    text: &'a str,
}

#[derive(Deserialize)]
struct TranslateResponse {
    result: Option<String>,
}

pub async fn translate(
    text: &str,
    target_lang: &str,
    base_url: &str,
    api_key: &str,
) -> AppResult<TranslateResult> {
    if base_url.trim().is_empty() {
        return Err(AppError::Translation(
            "MTranServer URL not configured".into(),
        ));
    }

    let endpoint = format!("{}/translate", base_url.trim().trim_end_matches('/'));

    let body = TranslateRequest {
        from: "auto",
        to: target_lang,
        text,
    };

    let mut req = reqwest::Client::new().post(endpoint).json(&body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {api_key}"));
    }

    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Translation(format!("MTranServer request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Translation(format!(
            "MTranServer API error {status}: {body}"
        )));
    }

    let result: TranslateResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Translation(format!("MTranServer parse failed: {e}")))?;

    let translated = result
        .result
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Translation("MTranServer returned empty result".into()))?;

    Ok(TranslateResult {
        original: text.to_string(),
        translated,
        detected_language: "auto".to_string(),
        provider: "mtranserver".to_string(),
    })
}

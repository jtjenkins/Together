use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::GifResult,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct GiphySearchParams {
    pub q: String,
    #[serde(default = "default_limit")]
    pub limit: u8,
}

fn default_limit() -> u8 {
    15
}

pub async fn search_giphy(
    State(state): State<AppState>,
    _auth: AuthUser,
    Query(params): Query<GiphySearchParams>,
) -> AppResult<Json<Vec<GifResult>>> {
    let api_key = state
        .giphy_api_key
        .as_deref()
        .ok_or_else(|| {
            tracing::error!("GIPHY_API_KEY is not configured");
            AppError::Internal
        })?
        .to_string();

    let limit = params.limit.min(25);

    let url = format!(
        "https://api.giphy.com/v1/gifs/search?api_key={}&q={}&limit={}&rating=g",
        api_key,
        urlencoding::encode(&params.q),
        limit,
    );

    let resp = state.http_client.get(&url).send().await.map_err(|e| {
        tracing::error!(error = ?e, "Failed to contact Giphy API");
        AppError::Internal
    })?;

    if !resp.status().is_success() {
        tracing::error!("Giphy API returned error status: {}", resp.status());
        return Err(AppError::Internal);
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| {
        tracing::error!(error = ?e, "Failed to parse Giphy API response");
        AppError::Internal
    })?;

    let gifs: Vec<GifResult> = body["data"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|item| {
            let url = item["images"]["original"]["url"].as_str()?.to_string();
            let preview_url = item["images"]["fixed_height_downsampled"]["url"]
                .as_str()
                .unwrap_or(&url)
                .to_string();
            let title = item["title"].as_str().unwrap_or("").to_string();
            let width = item["images"]["original"]["width"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            let height = item["images"]["original"]["height"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            Some(GifResult {
                url,
                preview_url,
                title,
                width,
                height,
            })
        })
        .collect();

    Ok(Json(gifs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_limit_is_15() {
        assert_eq!(default_limit(), 15);
    }

    #[test]
    fn limit_capped_at_25() {
        let params = GiphySearchParams {
            q: "test".into(),
            limit: 50,
        };
        assert_eq!(params.limit.min(25), 25);
    }
}

use serde::{Deserialize, Serialize};

/// Open Graph metadata returned by `GET /link-preview`.
///
/// All fields except `url` are optional — a page may have no OG tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkPreviewDto {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
    pub site_name: Option<String>,
}

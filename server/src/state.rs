use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use reqwest::Client;
use sqlx::PgPool;
use tokio::sync::RwLock;

use crate::handlers::link_preview::LinkPreviewCacheEntry;
use crate::websocket::ConnectionManager;

/// Shared application state passed to all handlers and extractors.
///
/// `ConnectionManager` is cheaply cloneable (it wraps an `Arc` internally),
/// so cloning `AppState` for each request is inexpensive.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: Arc<str>,
    pub connections: ConnectionManager,
    /// Root directory where uploaded files are stored.
    pub upload_dir: PathBuf,
    /// In-memory cache for Open Graph link preview metadata.
    ///
    /// Keyed by canonical URL string. Entries older than 24 hours are re-fetched.
    /// Capped at 10,000 entries to bound memory usage.
    ///
    /// Uses `tokio::sync::RwLock` so async handlers can acquire the lock without
    /// blocking a Tokio worker thread.
    pub link_preview_cache: Arc<RwLock<HashMap<String, LinkPreviewCacheEntry>>>,
    /// Shared HTTP client for outbound requests (Giphy, etc.).
    /// Note: link_preview uses its own per-request client (DNS rebinding protection).
    pub http_client: Client,
    /// Optional Giphy API key. If None, /giphy/search returns 503.
    pub giphy_api_key: Option<Arc<str>>,
}

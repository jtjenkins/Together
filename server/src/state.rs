use std::collections::HashMap;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;

use governor::{DefaultKeyedRateLimiter, Quota};
use reqwest::Client;
use sqlx::PgPool;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::config::Config;
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
    /// Application configuration (includes TURN settings for WebRTC).
    pub config: Arc<Config>,
    /// Per-bot rate limiter: 50 requests/second per bot user_id.
    ///
    /// Uses a dashmap-backed keyed rate limiter so each bot gets an independent
    /// token bucket. Bots share a single `Arc` so cloning `AppState` is cheap.
    pub bot_rate_limiter: Arc<DefaultKeyedRateLimiter<Uuid>>,
}

impl AppState {
    /// Construct a fresh per-bot rate limiter capped at 50 requests/second.
    pub fn new_bot_rate_limiter() -> Arc<DefaultKeyedRateLimiter<Uuid>> {
        let quota = Quota::per_second(NonZeroU32::new(50).expect("50 is non-zero"));
        Arc::new(DefaultKeyedRateLimiter::dashmap(quota))
    }
}

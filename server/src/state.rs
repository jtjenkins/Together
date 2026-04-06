use std::collections::HashMap;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use governor::{DefaultKeyedRateLimiter, Quota};
use reqwest::Client;
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::RwLock;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::config::Config;
use crate::handlers::link_preview::LinkPreviewCacheEntry;
use crate::webhook_delivery::WebhookQueue;
use crate::websocket::ConnectionManager;

/// An active Go Live broadcast session within a voice channel.
///
/// At most one session exists per channel at a time — enforced by the
/// `start_go_live` handler under a write lock.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct GoLiveSession {
    /// The user currently broadcasting.
    pub broadcaster_id: Uuid,
    /// Requested quality tier: "480p", "720p", or "1080p".
    pub quality: String,
    /// Wall-clock time the broadcast started (UTC).
    pub started_at: DateTime<Utc>,
}

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
    /// Active Go Live broadcast sessions, keyed by voice channel ID.
    ///
    /// At most one session per channel. Protected by a `RwLock` so the common
    /// read path (viewer fetch) is non-exclusive while start/stop are exclusive.
    pub go_live_sessions: Arc<RwLock<HashMap<Uuid, GoLiveSession>>>,
    /// In-memory webhook delivery queue. Enqueue jobs via `webhook_queue.send()`.
    pub webhook_queue: WebhookQueue,
}

impl AppState {
    /// Construct a fresh per-bot rate limiter capped at 50 requests/second.
    pub fn new_bot_rate_limiter() -> Arc<DefaultKeyedRateLimiter<Uuid>> {
        let quota = Quota::per_second(NonZeroU32::new(50).expect("50 is non-zero"));
        Arc::new(DefaultKeyedRateLimiter::dashmap(quota))
    }
}

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use sqlx::PgPool;

use crate::models::LinkPreviewDto;
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
    /// Keyed by canonical URL string. Each entry holds the fetched DTO and the
    /// `Instant` at which it was cached; entries older than 24 hours are re-fetched.
    pub link_preview_cache: Arc<Mutex<HashMap<String, (LinkPreviewDto, Instant)>>>,
}

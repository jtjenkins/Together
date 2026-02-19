use std::sync::Arc;

use sqlx::PgPool;

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
}

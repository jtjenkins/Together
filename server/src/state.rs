use std::sync::Arc;

use sqlx::PgPool;

/// Shared application state passed to all handlers and extractors.
/// JWT secret is stored here (read once at startup) rather than re-reading
/// from the environment on every request.
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub jwt_secret: Arc<str>,
}

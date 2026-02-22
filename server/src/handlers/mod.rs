pub mod attachments;
pub mod auth;
pub mod channels;
pub mod messages;
pub mod servers;
pub mod shared;
pub mod users;
pub mod voice;

use axum::{extract::State, http::StatusCode, Json};
use serde_json::{json, Value};

use crate::state::AppState;

pub async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<Value>) {
    let db_ok = sqlx::query("SELECT 1").execute(&state.pool).await.is_ok();

    let http_status = if db_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        http_status,
        Json(json!({
            "status": if db_ok { "ok" } else { "degraded" },
            "service": "together-server",
            "version": env!("CARGO_PKG_VERSION"),
            "database": if db_ok { "ok" } else { "unavailable" },
        })),
    )
}

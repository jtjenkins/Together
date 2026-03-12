//! Health check endpoints for monitoring and orchestration.
//!
//! Provides three endpoints following Kubernetes patterns:
//! - `GET /health` - Detailed health status (for monitoring)
//! - `GET /health/ready` - Readiness probe (can serve traffic)
//! - `GET /health/live` - Liveness probe (process is alive)

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use std::time::Instant;

use crate::state::AppState;

/// Server start time for uptime calculation.
/// Set once at server startup.
static mut START_TIME: Option<Instant> = None;

/// Initialize the start time for uptime tracking.
/// Call this once at server startup.
pub fn init_uptime() {
    // SAFETY: Called once at startup before any requests
    unsafe {
        START_TIME = Some(Instant::now());
    }
}

/// Get server uptime in seconds.
fn uptime_secs() -> u64 {
    // SAFETY: START_TIME is set at startup and only read afterwards
    unsafe { START_TIME.map(|t| t.elapsed().as_secs()).unwrap_or(0) }
}

// ============================================================================
// Response types
// ============================================================================

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
    pub uptime_secs: u64,
    pub database: DatabaseHealth,
    pub connections: ConnectionsHealth,
}

#[derive(Serialize)]
pub struct DatabaseHealth {
    pub status: &'static str,
    pub latency_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct ConnectionsHealth {
    pub websocket: usize,
}

#[derive(Serialize)]
pub struct ReadinessResponse {
    pub ready: bool,
    pub checks: std::collections::HashMap<&'static str, bool>,
}

#[derive(Serialize)]
pub struct LivenessResponse {
    pub alive: bool,
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /health — Detailed health status for monitoring systems.
///
/// Returns comprehensive health information including:
/// - Database connectivity and latency
/// - WebSocket connection count
/// - Server uptime
/// - Service version
pub async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    // Check database with timing
    let db_start = std::time::Instant::now();
    let db_result = sqlx::query("SELECT 1").execute(&state.pool).await;
    let db_latency = db_start.elapsed().as_millis() as u64;

    let (db_status, db_latency) = match db_result {
        Ok(_) => ("ok", Some(db_latency)),
        Err(e) => {
            tracing::warn!(error = ?e, "Health check: database query failed");
            ("unavailable", None)
        }
    };

    let all_ok = db_status == "ok";
    let status = if all_ok { "ok" } else { "degraded" };
    let http_status = if all_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    let response = HealthResponse {
        status,
        service: "together-server",
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs: uptime_secs(),
        database: DatabaseHealth {
            status: db_status,
            latency_ms: db_latency,
        },
        connections: ConnectionsHealth {
            websocket: state.connections.connection_count().await,
        },
    };

    (http_status, Json(response))
}

/// GET /health/ready — Kubernetes readiness probe.
///
/// Returns 200 if the service is ready to accept traffic.
/// Returns 503 if any critical dependency is unavailable.
///
/// Checks:
/// - Database connectivity
pub async fn readiness_check(
    State(state): State<AppState>,
) -> (StatusCode, Json<ReadinessResponse>) {
    let mut checks = std::collections::HashMap::new();

    // Check database
    let db_ok = match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!(error = ?e, "Readiness check: database unavailable");
            false
        }
    };
    checks.insert("database", db_ok);

    let ready = checks.values().all(|&v| v);
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (status, Json(ReadinessResponse { ready, checks }))
}

/// GET /health/live — Kubernetes liveness probe.
///
/// Returns 200 if the process is alive and not deadlocked.
/// This is a lightweight check that doesn't query external dependencies.
pub async fn liveness_check() -> (StatusCode, Json<LivenessResponse>) {
    // If we can respond, we're alive
    (StatusCode::OK, Json(LivenessResponse { alive: true }))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_liveness_always_alive() {
        // Liveness should always return alive=true
        let (status, response) = liveness_check().await;
        assert_eq!(status, StatusCode::OK);
        assert!(response.0.alive);
    }

    #[test]
    fn test_uptime_initialized() {
        init_uptime();
        let uptime = uptime_secs();
        // Uptime should be very small right after init
        assert!(
            uptime < 5,
            "Uptime should be less than 5 seconds after init"
        );
    }
}

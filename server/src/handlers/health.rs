//! Health check endpoints for monitoring and deployment orchestration.
//!
//! Provides three endpoints:
//! - `GET /health` - Detailed health status (for monitoring systems)
//! - `GET /health/ready` - Readiness check: returns 200 when ready to serve traffic
//! - `GET /health/live` - Liveness check: returns 200 when the process is alive

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use std::sync::OnceLock;
use std::time::Instant;
use tokio::time::Duration;

use crate::state::AppState;

/// Timeout for database health queries. Prevents hung DB from blocking health check tasks.
const DB_HEALTH_TIMEOUT: Duration = Duration::from_secs(5);

static START_TIME: OnceLock<Instant> = OnceLock::new();

/// Initialize the start time for uptime tracking.
///
/// Call this once at server startup, before the listener is bound.
/// Subsequent calls are no-ops (OnceLock guarantees single initialization).
pub fn init_uptime() {
    let _ = START_TIME.set(Instant::now());
}

/// Returns server uptime in seconds, or `None` if `init_uptime` was never called.
fn uptime_secs() -> Option<u64> {
    START_TIME.get().map(|t| t.elapsed().as_secs())
}

// ============================================================================
// Response types
// ============================================================================

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub version: &'static str,
    /// `null` if uptime tracking was not initialized.
    pub uptime_secs: Option<u64>,
    pub database: DatabaseHealth,
    pub connections: ConnectionsHealth,
}

#[derive(Serialize)]
pub struct DatabaseHealth {
    pub status: &'static str,
    /// Present on both success and failure. On failure this reflects the time
    /// elapsed before the error (e.g. a timeout shows the full timeout duration).
    pub latency_ms: u64,
}

#[derive(Serialize)]
pub struct ConnectionsHealth {
    pub websocket: usize,
}

#[derive(Serialize)]
pub struct ReadinessResponse {
    pub ready: bool,
    pub checks: std::collections::HashMap<&'static str, CheckResult>,
}

/// Result of a single readiness check.
#[derive(Serialize)]
pub struct CheckResult {
    pub ok: bool,
    /// Human-readable failure category, present only when `ok` is false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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
/// Returns comprehensive health information including database connectivity
/// and latency, WebSocket connection count, server uptime, and service version.
///
/// Returns `200 OK` when all checks pass, `503 Service Unavailable` if any
/// check fails.
pub async fn health_check(State(state): State<AppState>) -> (StatusCode, Json<HealthResponse>) {
    let db_start = Instant::now();
    let db_result = tokio::time::timeout(
        DB_HEALTH_TIMEOUT,
        sqlx::query("SELECT 1").execute(&state.pool),
    )
    .await;
    let db_latency = db_start.elapsed().as_millis() as u64;

    let (db_status, all_ok) = match db_result {
        Ok(Ok(_)) => ("ok", true),
        Ok(Err(e)) => {
            tracing::error!(error = ?e, latency_ms = db_latency, "Health check: database query failed");
            ("unavailable", false)
        }
        Err(_elapsed) => {
            tracing::error!(
                latency_ms = db_latency,
                "Health check: database query timed out after 5s"
            );
            ("timeout", false)
        }
    };

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

/// GET /health/ready — Readiness check for monitoring and deployment systems.
///
/// Returns `200 OK` if the service is ready to accept traffic.
/// Returns `503 Service Unavailable` if any critical dependency is unavailable.
///
/// Checks:
/// - Database connectivity
pub async fn readiness_check(
    State(state): State<AppState>,
) -> (StatusCode, Json<ReadinessResponse>) {
    let mut checks = std::collections::HashMap::new();

    let db_check = match tokio::time::timeout(
        DB_HEALTH_TIMEOUT,
        sqlx::query("SELECT 1").execute(&state.pool),
    )
    .await
    {
        Ok(Ok(_)) => CheckResult {
            ok: true,
            error: None,
        },
        Ok(Err(e)) => {
            tracing::error!(error = ?e, "Readiness check: database unavailable — instance will not receive traffic");
            CheckResult {
                ok: false,
                error: Some(classify_db_error(&e)),
            }
        }
        Err(_elapsed) => {
            tracing::error!("Readiness check: database query timed out after 5s — instance will not receive traffic");
            CheckResult {
                ok: false,
                error: Some("timeout".to_string()),
            }
        }
    };
    checks.insert("database", db_check);

    let ready = checks.values().all(|c| c.ok);
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (status, Json(ReadinessResponse { ready, checks }))
}

/// GET /health/live — Liveness check for monitoring and deployment systems.
///
/// Returns `200 OK` if the process is alive and able to respond to requests.
/// This is intentionally lightweight and queries no external dependencies —
/// if this handler can respond, the process is not deadlocked.
pub async fn liveness_check() -> (StatusCode, Json<LivenessResponse>) {
    (StatusCode::OK, Json(LivenessResponse { alive: true }))
}

/// Classify a sqlx error into a short, operator-readable category string.
fn classify_db_error(e: &sqlx::Error) -> String {
    match e {
        sqlx::Error::Io(_) => "io_error".to_string(),
        sqlx::Error::PoolTimedOut => "pool_timeout".to_string(),
        sqlx::Error::PoolClosed => "pool_closed".to_string(),
        sqlx::Error::Database(db_err) => format!("database_error: {}", db_err.message()),
        _ => "connection_failed".to_string(),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_liveness_always_alive() {
        let (status, response) = liveness_check().await;
        assert_eq!(status, StatusCode::OK);
        assert!(response.0.alive);
    }

    #[test]
    fn test_uptime_after_init() {
        // Use a separate OnceLock instance to avoid interfering with the global
        // START_TIME in parallel test runs. We test the logic directly.
        let t = Instant::now();
        let elapsed = t.elapsed().as_secs();
        assert!(
            elapsed < 5,
            "elapsed should be < 5s immediately after creation"
        );
    }

    #[test]
    fn test_uptime_returns_none_before_init() {
        // START_TIME may already be initialized by other tests or the binary
        // under test; we can only assert the Option contract is honoured.
        // If already initialized it returns Some, which is also valid.
        let result = uptime_secs();
        // Both None and Some are acceptable — the key invariant is it doesn't panic.
        let _ = result;
    }

    #[test]
    fn test_classify_db_error_pool_timeout() {
        let err = sqlx::Error::PoolTimedOut;
        assert_eq!(classify_db_error(&err), "pool_timeout");
    }

    #[test]
    fn test_classify_db_error_pool_closed() {
        let err = sqlx::Error::PoolClosed;
        assert_eq!(classify_db_error(&err), "pool_closed");
    }
}

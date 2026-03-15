mod common;

use axum::http::StatusCode;

// ============================================================================
// GET /health
// ============================================================================

#[tokio::test]
async fn health_check_returns_200_with_healthy_db() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::get_no_auth(app, "/health").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["service"], "together-server");
    assert!(body["version"].is_string(), "version should be a string");
    assert_eq!(body["database"]["status"], "ok");
    assert!(
        body["database"]["latency_ms"].is_number(),
        "latency_ms should be a number"
    );
    assert!(
        body["connections"]["websocket"].is_number(),
        "connections.websocket should be a number"
    );
    // uptime_secs is Option<u64>: either null (init not called in test) or a number
    assert!(
        body["uptime_secs"].is_null() || body["uptime_secs"].is_number(),
        "uptime_secs should be null or a number"
    );
}

// ============================================================================
// GET /health/ready
// ============================================================================

#[tokio::test]
async fn readiness_check_returns_200_with_healthy_db() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::get_no_auth(app, "/health/ready").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ready"], true);
    assert_eq!(
        body["checks"]["database"]["ok"], true,
        "database check should be ok"
    );
    assert!(
        body["checks"]["database"]["error"].is_null(),
        "error field should be absent when check passes"
    );
}

// ============================================================================
// GET /health/live
// ============================================================================

#[tokio::test]
async fn liveness_check_returns_200() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::get_no_auth(app, "/health/live").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["alive"], true);
}

// ============================================================================
// Response shape
// ============================================================================

#[tokio::test]
async fn health_response_contains_expected_fields() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (_status, body) = common::get_no_auth(app, "/health").await;

    // All top-level fields must be present
    assert!(body.get("status").is_some(), "missing: status");
    assert!(body.get("service").is_some(), "missing: service");
    assert!(body.get("version").is_some(), "missing: version");
    assert!(body.get("uptime_secs").is_some(), "missing: uptime_secs");
    assert!(body.get("database").is_some(), "missing: database");
    assert!(body.get("connections").is_some(), "missing: connections");

    // Nested fields
    assert!(
        body["database"].get("status").is_some(),
        "missing: database.status"
    );
    assert!(
        body["database"].get("latency_ms").is_some(),
        "missing: database.latency_ms"
    );
    assert!(
        body["connections"].get("websocket").is_some(),
        "missing: connections.websocket"
    );
}

#[tokio::test]
async fn readiness_response_contains_expected_fields() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (_status, body) = common::get_no_auth(app, "/health/ready").await;

    assert!(body.get("ready").is_some(), "missing: ready");
    assert!(body.get("checks").is_some(), "missing: checks");
    assert!(
        body["checks"].get("database").is_some(),
        "missing: checks.database"
    );
    assert!(
        body["checks"]["database"].get("ok").is_some(),
        "missing: checks.database.ok"
    );
}

#[tokio::test]
async fn liveness_response_contains_alive_field() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (_status, body) = common::get_no_auth(app, "/health/live").await;

    assert!(body.get("alive").is_some(), "missing: alive");
}

mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

async fn get_audit_logs(
    app: axum::Router,
    token: &str,
    server_id: &str,
) -> (StatusCode, serde_json::Value) {
    common::get_authed(app, &format!("/servers/{server_id}/audit-logs"), token).await
}

async fn get_audit_logs_filtered(
    app: axum::Router,
    token: &str,
    server_id: &str,
    action: &str,
) -> (StatusCode, serde_json::Value) {
    common::get_authed(
        app,
        &format!("/servers/{server_id}/audit-logs?action={action}"),
        token,
    )
    .await
}

// ============================================================================
// GET /servers/:id/audit-logs — access control
// ============================================================================

#[tokio::test]
async fn audit_logs_require_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(
        app,
        "/servers/00000000-0000-0000-0000-000000000000/audit-logs",
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn audit_logs_require_owner() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let other_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &owner_token, "Audit Test").await;
    let server_id = server["id"].as_str().unwrap();

    // Non-owner gets forbidden
    let (status, _) = get_audit_logs(app.clone(), &other_token, server_id).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Owner succeeds
    let (status, body) = get_audit_logs(app, &owner_token, server_id).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.is_array());
}

// ============================================================================
// server_create audit event
// ============================================================================

#[tokio::test]
async fn server_create_produces_audit_log() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Audited Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, logs) = get_audit_logs_filtered(app, &token, server_id, "server_create").await;
    assert_eq!(status, StatusCode::OK);

    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a server_create audit log");

    let entry = &logs[0];
    assert_eq!(entry["action"], "server_create");
    assert_eq!(entry["target_type"], "server");
    assert_eq!(entry["details"]["name"], "Audited Server");
}

// ============================================================================
// server_update audit event
// ============================================================================

#[tokio::test]
async fn server_update_produces_audit_log() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Before Update").await;
    let server_id = server["id"].as_str().unwrap();

    // Update the server
    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}"),
        &token,
        json!({ "name": "After Update", "is_public": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, logs) = get_audit_logs_filtered(app, &token, server_id, "server_update").await;
    assert_eq!(status, StatusCode::OK);

    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a server_update audit log");

    let entry = &logs[0];
    assert_eq!(entry["action"], "server_update");
    assert_eq!(entry["details"]["name"], "After Update");
    assert_eq!(entry["details"]["is_public"], true);
}

// ============================================================================
// server_delete audit event
// ============================================================================

#[tokio::test]
async fn server_delete_produces_audit_log() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "To Delete").await;
    let server_id = server["id"].as_str().unwrap();

    // Delete the server
    let (status, _) = common::delete_authed(app, &format!("/servers/{server_id}"), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // The server is gone, so we can't query audit logs via the API (server not found).
    // Instead verify the audit row survived via direct DB query (ON DELETE SET NULL).
    let row = sqlx::query_as::<_, (String, Option<uuid::Uuid>)>(
        "SELECT action, server_id FROM audit_logs WHERE target_id = $1 AND action = 'server_delete'",
    )
    .bind(uuid::Uuid::parse_str(server_id).unwrap())
    .fetch_optional(&pool)
    .await
    .unwrap();

    assert!(
        row.is_some(),
        "server_delete audit log should survive CASCADE"
    );
    let (action, srv_id) = row.unwrap();
    assert_eq!(action, "server_delete");
    assert!(
        srv_id.is_none(),
        "server_id should be SET NULL after server deletion"
    );
}

// ============================================================================
// channel_create audit event
// ============================================================================

#[tokio::test]
async fn channel_create_produces_audit_log() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Channel Test").await;
    let server_id = server["id"].as_str().unwrap();

    common::create_channel(app.clone(), &token, server_id, "general").await;

    let (status, logs) = get_audit_logs_filtered(app, &token, server_id, "channel_create").await;
    assert_eq!(status, StatusCode::OK);

    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a channel_create audit log");

    let entry = &logs[0];
    assert_eq!(entry["action"], "channel_create");
    assert_eq!(entry["target_type"], "channel");
    assert_eq!(entry["details"]["name"], "general");
}

// ============================================================================
// channel_update audit event
// ============================================================================

#[tokio::test]
async fn channel_update_produces_audit_log() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Chan Update Test").await;
    let server_id = server["id"].as_str().unwrap();

    let channel = common::create_channel(app.clone(), &token, server_id, "old-name").await;
    let channel_id = channel["id"].as_str().unwrap();

    // Update the channel
    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/channels/{channel_id}"),
        &token,
        json!({ "name": "new-name", "topic": "Updated topic" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, logs) = get_audit_logs_filtered(app, &token, server_id, "channel_update").await;
    assert_eq!(status, StatusCode::OK);

    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a channel_update audit log");

    let entry = &logs[0];
    assert_eq!(entry["action"], "channel_update");
    assert_eq!(entry["details"]["name"], "new-name");
    assert_eq!(entry["details"]["topic"], "Updated topic");
}

// ============================================================================
// channel_delete audit event
// ============================================================================

#[tokio::test]
async fn channel_delete_produces_audit_log() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Chan Delete Test").await;
    let server_id = server["id"].as_str().unwrap();

    let channel = common::create_channel(app.clone(), &token, server_id, "doomed-channel").await;
    let channel_id = channel["id"].as_str().unwrap();

    // Delete the channel
    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/channels/{channel_id}"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, logs) = get_audit_logs_filtered(app, &token, server_id, "channel_delete").await;
    assert_eq!(status, StatusCode::OK);

    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a channel_delete audit log");

    let entry = &logs[0];
    assert_eq!(entry["action"], "channel_delete");
    assert_eq!(entry["target_type"], "channel");
    assert_eq!(entry["details"]["name"], "doomed-channel");
}

// ============================================================================
// Filtering and pagination
// ============================================================================

#[tokio::test]
async fn audit_logs_filter_by_action() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Filter Test").await;
    let server_id = server["id"].as_str().unwrap();

    // Create a channel to generate a channel_create event alongside the server_create
    common::create_channel(app.clone(), &token, server_id, "test-chan").await;

    // Filter for only server_create
    let (_, logs) = get_audit_logs_filtered(app.clone(), &token, server_id, "server_create").await;
    let logs = logs.as_array().unwrap();
    assert!(logs.iter().all(|l| l["action"] == "server_create"));

    // Filter for only channel_create
    let (_, logs) = get_audit_logs_filtered(app, &token, server_id, "channel_create").await;
    let logs = logs.as_array().unwrap();
    assert!(logs.iter().all(|l| l["action"] == "channel_create"));
}

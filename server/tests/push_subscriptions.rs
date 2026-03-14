mod common;

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

// ── helpers not in common ─────────────────────────────────────────────────────

async fn put_json_authed(
    app: axum::Router,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::PUT)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn delete_json_authed(
    app: axum::Router,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::DELETE)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

async fn post_json_no_auth(app: axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

// ============================================================================
// test_register_web_push_subscription
// ============================================================================

#[tokio::test]
async fn test_register_web_push_subscription() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    let (status, body) = common::post_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({
            "subscription_type": "web",
            "endpoint": "https://fcm.googleapis.com/fcm/send/unique-endpoint-abc123",
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtT5d4Bs274ureHNJpg",
            "auth_key": "tBHItJI5svbpez7KI4CCXg"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "body: {body}");
}

// ============================================================================
// test_register_web_push_duplicate_endpoint
// ============================================================================

#[tokio::test]
async fn test_register_web_push_duplicate_endpoint() {
    let pool = common::test_pool().await;
    let username = common::unique_username();
    let endpoint = format!(
        "https://fcm.googleapis.com/fcm/send/dup-{}",
        uuid::Uuid::new_v4().simple()
    );

    // First registration
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;
    let (status, body) = common::post_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({
            "subscription_type": "web",
            "endpoint": endpoint,
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtT5d4Bs274ureHNJpg",
            "auth_key": "tBHItJI5svbpez7KI4CCXg"
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "first registration failed: {body}"
    );

    // Second registration with identical endpoint (upsert — must also succeed with 201)
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({
            "subscription_type": "web",
            "endpoint": endpoint,
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtT5d4Bs274ureHNJpgUPDATED",
            "auth_key": "tBHItJI5svbpez7KI4CCXgUPDATED"
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "duplicate upsert failed: {body}"
    );
}

// ============================================================================
// test_delete_subscription
// ============================================================================

#[tokio::test]
async fn test_delete_subscription() {
    let pool = common::test_pool().await;
    let username = common::unique_username();
    let endpoint = format!(
        "https://fcm.googleapis.com/fcm/send/del-{}",
        uuid::Uuid::new_v4().simple()
    );

    // Register the subscription first
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;
    let (status, body) = common::post_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({
            "subscription_type": "web",
            "endpoint": endpoint,
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtT5d4Bs274ureHNJpg",
            "auth_key": "tBHItJI5svbpez7KI4CCXg"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "setup register failed: {body}");

    // Delete it
    let app = common::create_test_app(pool);
    let (status, body) = delete_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({ "endpoint": endpoint }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "delete failed: {body}");
}

// ============================================================================
// test_notification_preferences_defaults
// ============================================================================

#[tokio::test]
async fn test_notification_preferences_defaults() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    let (status, body) = common::get_authed(app, "/notifications/preferences", &token).await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(
        body["dm_notifications"].as_bool(),
        Some(true),
        "dm_notifications default should be true: {body}"
    );
    assert_eq!(
        body["mention_notifications"].as_bool(),
        Some(true),
        "mention_notifications default should be true: {body}"
    );
    assert_eq!(
        body["all_messages"].as_bool(),
        Some(false),
        "all_messages default should be false: {body}"
    );
}

// ============================================================================
// test_update_notification_preferences
// ============================================================================

#[tokio::test]
async fn test_update_notification_preferences() {
    let pool = common::test_pool().await;
    let username = common::unique_username();

    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    // Update only all_messages — other fields should remain at defaults
    let (status, body) = put_json_authed(
        app,
        "/notifications/preferences",
        &token,
        json!({ "all_messages": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "put preferences failed: {body}");
    assert_eq!(
        body["all_messages"].as_bool(),
        Some(true),
        "all_messages should be updated to true: {body}"
    );
    // Unchanged fields should keep their defaults
    assert_eq!(
        body["dm_notifications"].as_bool(),
        Some(true),
        "dm_notifications should be preserved: {body}"
    );
    assert_eq!(
        body["mention_notifications"].as_bool(),
        Some(true),
        "mention_notifications should be preserved: {body}"
    );

    // Now update dm_notifications to false, verify all_messages stays true
    let app = common::create_test_app(pool);
    let (status, body) = put_json_authed(
        app,
        "/notifications/preferences",
        &token,
        json!({ "dm_notifications": false }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "second put preferences failed: {body}"
    );
    assert_eq!(
        body["dm_notifications"].as_bool(),
        Some(false),
        "dm_notifications should be updated to false: {body}"
    );
    assert_eq!(
        body["all_messages"].as_bool(),
        Some(true),
        "all_messages should remain true after partial update: {body}"
    );
}

// ============================================================================
// test_subscription_requires_auth
// ============================================================================

#[tokio::test]
async fn test_subscription_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _body) = post_json_no_auth(
        app,
        "/notifications/subscriptions",
        json!({
            "subscription_type": "web",
            "endpoint": "https://fcm.googleapis.com/fcm/send/unauth-test",
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtT5d4Bs274ureHNJpg",
            "auth_key": "tBHItJI5svbpez7KI4CCXg"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// test_invalid_subscription_type
// ============================================================================

#[tokio::test]
async fn test_invalid_subscription_type() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    let (status, body) = common::post_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({
            "subscription_type": "telegram",
            "endpoint": "https://example.com/push"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
}

// ============================================================================
// test_web_push_missing_fields
// ============================================================================

#[tokio::test]
async fn test_web_push_missing_fields() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();
    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    // Web push without p256dh (and auth_key) — should fail validation
    let (status, body) = common::post_json_authed(
        app,
        "/notifications/subscriptions",
        &token,
        json!({
            "subscription_type": "web",
            "endpoint": "https://fcm.googleapis.com/fcm/send/missing-fields-test"
            // p256dh and auth_key intentionally omitted
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
}

// ============================================================================
// test_vapid_key_endpoint
// ============================================================================

#[tokio::test]
async fn test_vapid_key_endpoint() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    // No auth needed for the VAPID public key endpoint.
    // In the test environment VAPID is not configured, so we accept either:
    //   200 OK with { "public_key": "..." }  — if VAPID_PUBLIC_KEY env var is set
    //   400 Bad Request                       — if VAPID is not configured (default for tests)
    let (status, body) = common::get_no_auth(app, "/notifications/vapid-public-key").await;

    assert!(
        status == StatusCode::OK || status == StatusCode::BAD_REQUEST,
        "expected 200 or 400 from vapid-public-key endpoint, got {status}: {body}"
    );

    if status == StatusCode::OK {
        assert!(
            body["public_key"].is_string(),
            "200 response should include public_key string: {body}"
        );
    }
}

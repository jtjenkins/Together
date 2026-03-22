mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// GET /servers/:id/export — owner-only ZIP export
// ============================================================================

#[tokio::test]
async fn export_server_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Export Guild").await;
    let server_id = server["id"].as_str().unwrap();

    // Create a channel and a message so the export has content.
    let channel = common::create_channel(app.clone(), &owner_token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();
    common::create_message(app.clone(), &owner_token, channel_id, "Hello export!").await;

    let (status, bytes) =
        common::get_raw_authed(app, &format!("/servers/{server_id}/export"), &owner_token).await;

    assert_eq!(
        status,
        StatusCode::OK,
        "export failed (body len={}): {:?}",
        bytes.len(),
        String::from_utf8_lossy(&bytes[..bytes.len().min(500)])
    );
    // ZIP files start with PK magic bytes (0x50, 0x4b).
    assert!(
        bytes.len() > 4,
        "export response should be a non-trivial ZIP"
    );
    assert_eq!(
        &bytes[0..2],
        &[0x50, 0x4b],
        "export response should start with ZIP magic bytes"
    );
}

// ============================================================================
// Non-owner cannot export
// ============================================================================

#[tokio::test]
async fn export_server_non_owner_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Private Guild").await;
    let server_id = server["id"].as_str().unwrap();

    // Make server public and join as a member.
    common::make_server_public(app.clone(), &owner_token, server_id).await;
    let member =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &member,
        json!({}),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "join failed: {status}"
    );

    // Member tries to export — should be rejected.
    let (status, _) =
        common::get_raw_authed(app, &format!("/servers/{server_id}/export"), &member).await;

    // Returns 404 (not 403) to avoid leaking server existence.
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// No auth → 401
// ============================================================================

#[tokio::test]
async fn export_server_no_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::get_raw_no_auth(app, &format!("/servers/{fake_id}/export")).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// Nonexistent server → 404
// ============================================================================

#[tokio::test]
async fn export_server_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) =
        common::get_raw_authed(app, &format!("/servers/{fake_id}/export"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// Export with empty server (no channels/messages)
// ============================================================================

#[tokio::test]
async fn export_empty_server() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Empty Guild").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, bytes) =
        common::get_raw_authed(app, &format!("/servers/{server_id}/export"), &owner_token).await;

    assert_eq!(
        status,
        StatusCode::OK,
        "empty export failed: {:?}",
        String::from_utf8_lossy(&bytes)
    );
    assert!(
        bytes.len() > 4,
        "even empty export should produce a valid ZIP"
    );
    assert_eq!(&bytes[0..2], &[0x50, 0x4b]);
}

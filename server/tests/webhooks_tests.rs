mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Register a user, create a server, and return `(token, server_id)`.
async fn setup_server(app: axum::Router) -> (String, String) {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Webhook Guild").await;
    let server_id = server["id"].as_str().unwrap().to_owned();
    (token, server_id)
}

fn webhook_payload(name: &str) -> serde_json::Value {
    json!({
        "name": name,
        "url": "https://example.com/webhook",
        "event_types": ["message.created"]
    })
}

// ============================================================================
// POST /servers/:id/webhooks — create webhook
// ============================================================================

#[tokio::test]
async fn create_webhook_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("my-hook"),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "create failed: {body}");
    assert_eq!(body["webhook"]["name"], "my-hook");
    assert!(
        body["secret"].is_string(),
        "secret should be returned on create"
    );
    assert_eq!(body["webhook"]["server_id"], sid);
    assert!(body["webhook"]["enabled"].as_bool().unwrap());
}

#[tokio::test]
async fn create_webhook_empty_name_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &token,
        json!({
            "name": "   ",
            "url": "https://example.com/webhook",
            "event_types": ["message.created"]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_webhook_invalid_url_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &token,
        json!({
            "name": "hook",
            "url": "ftp://bad-scheme.com/x",
            "event_types": ["message.created"]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_webhook_invalid_event_type_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &token,
        json!({
            "name": "hook",
            "url": "https://example.com/webhook",
            "event_types": ["invalid.event"]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_webhook_empty_event_types_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &token,
        json!({
            "name": "hook",
            "url": "https://example.com/webhook",
            "event_types": []
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// GET /servers/:id/webhooks — list webhooks
// ============================================================================

#[tokio::test]
async fn list_webhooks_empty() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (status, body) = common::get_authed(app, &format!("/servers/{sid}/webhooks"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["webhooks"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_webhooks_returns_created() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    // Create two webhooks.
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("hook-1"),
    )
    .await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("hook-2"),
    )
    .await;

    let (status, body) = common::get_authed(app, &format!("/servers/{sid}/webhooks"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["webhooks"].as_array().unwrap().len(), 2);
}

// ============================================================================
// GET /servers/:id/webhooks/:webhook_id — get single webhook
// ============================================================================

#[tokio::test]
async fn get_webhook_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (_, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("get-me"),
    )
    .await;
    let wh_id = created["webhook"]["id"].as_str().unwrap();

    let (status, body) =
        common::get_authed(app, &format!("/servers/{sid}/webhooks/{wh_id}"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "get-me");
}

#[tokio::test]
async fn get_webhook_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) =
        common::get_authed(app, &format!("/servers/{sid}/webhooks/{fake_id}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// PATCH /servers/:id/webhooks/:webhook_id — update webhook
// ============================================================================

#[tokio::test]
async fn update_webhook_name() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (_, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("old-name"),
    )
    .await;
    let wh_id = created["webhook"]["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/webhooks/{wh_id}"),
        &token,
        json!({ "name": "new-name" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "new-name");
}

#[tokio::test]
async fn update_webhook_disable() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (_, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("disable-me"),
    )
    .await;
    let wh_id = created["webhook"]["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/webhooks/{wh_id}"),
        &token,
        json!({ "enabled": false }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(!body["enabled"].as_bool().unwrap());
}

#[tokio::test]
async fn update_webhook_invalid_url_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (_, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("bad-url"),
    )
    .await;
    let wh_id = created["webhook"]["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/webhooks/{wh_id}"),
        &token,
        json!({ "url": "ftp://nope.com" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_webhook_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/webhooks/{fake_id}"),
        &token,
        json!({ "name": "x" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE /servers/:id/webhooks/:webhook_id — delete webhook
// ============================================================================

#[tokio::test]
async fn delete_webhook_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (_, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("delete-me"),
    )
    .await;
    let wh_id = created["webhook"]["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks/{wh_id}"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify it's gone.
    let (status, _) =
        common::get_authed(app, &format!("/servers/{sid}/webhooks/{wh_id}"), &token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_webhook_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) =
        common::delete_authed(app, &format!("/servers/{sid}/webhooks/{fake_id}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// POST /servers/:id/webhooks/:webhook_id/test — test webhook
// ============================================================================

#[tokio::test]
async fn test_webhook_accepted() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let (_, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/webhooks"),
        &token,
        webhook_payload("test-hook"),
    )
    .await;
    let wh_id = created["webhook"]["id"].as_str().unwrap();

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks/{wh_id}/test"),
        &token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::ACCEPTED);
}

#[tokio::test]
async fn test_webhook_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks/{fake_id}/test"),
        &token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// Permission checks — non-owner / non-member
// ============================================================================

#[tokio::test]
async fn non_member_cannot_create_webhook() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_owner_token, sid) = setup_server(app.clone()).await;

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &outsider,
        webhook_payload("sneaky"),
    )
    .await;

    // Non-member should get 404 (server not found from their perspective).
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn non_owner_member_cannot_create_webhook() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid) = setup_server(app.clone()).await;

    // Make server public and join as a regular member.
    common::make_server_public(app.clone(), &owner_token, &sid).await;
    let member =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &member,
        json!({}),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "join failed: {status}"
    );

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/webhooks"),
        &member,
        webhook_payload("sneaky"),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn create_webhook_no_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let fake_sid = uuid::Uuid::new_v4();
    let (status, _) = common::post_json(
        app,
        &format!("/servers/{fake_sid}/webhooks"),
        webhook_payload("no-auth"),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// Timeout checks — timed-out admin cannot manage webhooks
// ============================================================================

/// Set up a server where the server owner has timed out a non-owner admin
/// (a member with ADMINISTRATOR permission).  Returns `(app, owner_token,
/// admin_token, server_id, webhook_id)` where `webhook_id` is a webhook the
/// owner created before the admin was timed out.
async fn setup_server_with_timed_out_admin() -> (
    axum::Router,
    String, // owner token
    String, // admin token
    String, // server_id
    String, // pre-created webhook_id (owner-created)
) {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_token = admin_body["access_token"].as_str().unwrap().to_owned();
    let admin_id = admin_body["user"]["id"].as_str().unwrap().to_owned();

    let server = common::create_server(app.clone(), &owner_token, "Webhook Guild").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

    // Make server public and let admin join.
    common::make_server_public(app.clone(), &owner_token, &server_id).await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "admin join failed: {status}"
    );

    // Create a role with ADMINISTRATOR permission and assign it to admin.
    const PERMISSION_ADMINISTRATOR: i64 = 8192;
    let (status, role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        serde_json::json!({ "name": "Admin", "permissions": PERMISSION_ADMINISTRATOR }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create role failed: {role}");
    let role_id = role["id"].as_str().unwrap();

    let (status, _) = common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{admin_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "assign role failed: {status}"
    );

    // Owner creates a webhook that the admin can then try to update/delete/test.
    let (status, created) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/webhooks"),
        &owner_token,
        webhook_payload("owner-hook"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "owner create webhook failed");
    let webhook_id = created["webhook"]["id"].as_str().unwrap().to_owned();

    // Owner times out the admin.
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{admin_id}/timeout"),
        &owner_token,
        serde_json::json!({ "duration_minutes": 60 }),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "timeout failed: {status}"
    );

    (app, owner_token, admin_token, server_id, webhook_id)
}

#[tokio::test]
async fn timed_out_admin_cannot_create_webhook() {
    let (app, _owner, admin_token, server_id, _wh_id) = setup_server_with_timed_out_admin().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/webhooks"),
        &admin_token,
        webhook_payload("blocked-hook"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn timed_out_admin_cannot_update_webhook() {
    let (app, _owner, admin_token, server_id, wh_id) = setup_server_with_timed_out_admin().await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{server_id}/webhooks/{wh_id}"),
        &admin_token,
        serde_json::json!({ "name": "sneaky-rename" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn timed_out_admin_cannot_delete_webhook() {
    let (app, _owner, admin_token, server_id, wh_id) = setup_server_with_timed_out_admin().await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{server_id}/webhooks/{wh_id}"),
        &admin_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn timed_out_admin_cannot_test_webhook() {
    let (app, _owner, admin_token, server_id, wh_id) = setup_server_with_timed_out_admin().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/webhooks/{wh_id}/test"),
        &admin_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

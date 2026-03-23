mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

async fn setup_admin() -> (axum::Router, String, sqlx::PgPool) {
    let pool = common::test_pool().await;

    // Reset registration mode to 'open' before registering test users.
    // Tests share the DB, so a previous test may have left it in 'closed' or 'invite_only'.
    sqlx::query("UPDATE instance_settings SET registration_mode = 'open' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();

    let app = common::create_test_app(pool.clone());

    let admin_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_token = admin_body["access_token"].as_str().unwrap().to_owned();
    let admin_id = admin_body["user"]["id"].as_str().unwrap();

    sqlx::query("UPDATE users SET is_admin = true WHERE id = $1")
        .bind(uuid::Uuid::parse_str(admin_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    (app, admin_token, pool)
}

async fn set_registration_mode(pool: &sqlx::PgPool, mode: &str) {
    // Direct DB update to avoid race conditions with parallel tests.
    sqlx::query("UPDATE instance_settings SET registration_mode = $1 WHERE id = 1")
        .bind(mode)
        .execute(pool)
        .await
        .unwrap();
}

async fn reset_registration_mode(pool: &sqlx::PgPool) {
    set_registration_mode(pool, "open").await;
}

// ============================================================================
// GET /instance/registration-mode — public endpoint
// ============================================================================

#[tokio::test]
async fn registration_mode_public_endpoint() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::get_no_auth(app, "/instance/registration-mode").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["registration_mode"].is_string());
}

// ============================================================================
// GET/PATCH /admin/settings
// ============================================================================

#[tokio::test]
async fn admin_settings_requires_admin() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(app, "/admin/settings", &token).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_get_settings() {
    let (app, admin_token, _pool) = setup_admin().await;

    let (status, body) = common::get_authed(app, "/admin/settings", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["registration_mode"].is_string());
}

#[tokio::test]
async fn admin_update_registration_mode() {
    let (app, admin_token, pool) = setup_admin().await;

    // Use API to update and check the response directly (avoids race with parallel tests)
    let (status, body) = common::patch_json_authed(
        app,
        "/admin/settings",
        &admin_token,
        json!({ "registration_mode": "closed" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["registration_mode"], "closed");

    reset_registration_mode(&pool).await;
}

#[tokio::test]
async fn admin_update_invalid_mode_rejected() {
    let (app, admin_token, _pool) = setup_admin().await;

    let (status, _) = common::patch_json_authed(
        app,
        "/admin/settings",
        &admin_token,
        json!({ "registration_mode": "invalid_mode" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// Registration policy enforcement
// ============================================================================

#[tokio::test]
async fn registration_open_allows_signup() {
    let (app, _admin_token, pool) = setup_admin().await;

    set_registration_mode(&pool, "open").await;

    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": common::unique_username(),
            "password": "pass1234"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn registration_closed_blocks_signup() {
    let (app, _admin_token, pool) = setup_admin().await;

    set_registration_mode(&pool, "closed").await;

    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": common::unique_username(),
            "password": "pass1234"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body["error"].as_str().unwrap().contains("closed"));

    // Reset so parallel tests aren't affected
    reset_registration_mode(&pool).await;
}

#[tokio::test]
async fn registration_invite_only_without_code_fails() {
    let (app, _admin_token, pool) = setup_admin().await;

    set_registration_mode(&pool, "invite_only").await;

    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": common::unique_username(),
            "password": "pass1234"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    reset_registration_mode(&pool).await;
}

#[tokio::test]
async fn registration_invite_only_with_invalid_code_fails() {
    let (app, _admin_token, pool) = setup_admin().await;

    set_registration_mode(&pool, "invite_only").await;

    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": common::unique_username(),
            "password": "pass1234",
            "invite_code": "BADCODE1"
        }),
    )
    .await;
    // Should fail because the code doesn't exist
    assert!(
        status == StatusCode::BAD_REQUEST || status == StatusCode::NOT_FOUND,
        "expected 400 or 404, got {status}"
    );

    reset_registration_mode(&pool).await;
}

// ============================================================================
// Server require_invite
// ============================================================================

#[tokio::test]
async fn server_require_invite_blocks_direct_join() {
    let (app, admin_token, pool) = setup_admin().await;

    // Reset registration to open for this test
    set_registration_mode(&pool, "open").await;

    // Create a public server with require_invite
    let (status, server) = common::post_json_authed(
        app.clone(),
        "/servers",
        &admin_token,
        json!({ "name": "Invite Only Club", "is_public": true, "require_invite": true }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let server_id = server["id"].as_str().unwrap();

    // Register a second user
    let joiner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    // Try to join directly — should fail
    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body["error"].as_str().unwrap().contains("invite"));
}

#[tokio::test]
async fn server_without_require_invite_allows_join() {
    let pool = common::test_pool().await;
    // Reset registration mode before creating users
    sqlx::query("UPDATE instance_settings SET registration_mode = 'open' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();

    let (app, admin_token, _pool) = setup_admin().await;

    // Create a public server WITHOUT require_invite
    let server = common::create_server(app.clone(), &admin_token, "Open Server").await;
    let server_id = server["id"].as_str().unwrap();

    common::make_server_public(app.clone(), &admin_token, server_id).await;

    let joiner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "join should succeed, got {status}"
    );
}

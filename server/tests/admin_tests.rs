mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

/// Register the first user (auto-admin via migration) and a second regular user.
/// Returns (app, admin_token, user_token, user_id).
async fn setup_admin_and_user() -> (axum::Router, String, String, String) {
    let pool = common::test_pool().await;

    // Ensure the first user gets is_admin = true
    // The migration 20240312000003 sets is_admin on the user with the earliest created_at.
    // In a fresh test pool, the first registered user should get it.
    // However, other concurrent tests may have already created users.
    // We'll promote our admin manually to be safe.
    let app = common::create_test_app(pool.clone());

    let admin_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_token = admin_body["access_token"].as_str().unwrap().to_owned();
    let admin_id = admin_body["user"]["id"].as_str().unwrap();

    // Manually promote to admin since test DB may have pre-existing users
    sqlx::query("UPDATE users SET is_admin = true WHERE id = $1")
        .bind(uuid::Uuid::parse_str(admin_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let user_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let user_token = user_body["access_token"].as_str().unwrap().to_owned();
    let user_id = user_body["user"]["id"].as_str().unwrap().to_owned();

    (app, admin_token, user_token, user_id)
}

// ============================================================================
// Access control
// ============================================================================

#[tokio::test]
async fn admin_stats_requires_admin() {
    let (app, _, user_token, _) = setup_admin_and_user().await;

    let (status, _) = common::get_authed(app, "/admin/stats", &user_token).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn admin_stats_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(app, "/admin/stats").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_users_requires_admin() {
    let (app, _, user_token, _) = setup_admin_and_user().await;

    let (status, _) = common::get_authed(app, "/admin/users", &user_token).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// GET /admin/stats
// ============================================================================

#[tokio::test]
async fn admin_stats_returns_data() {
    let (app, admin_token, _, _) = setup_admin_and_user().await;

    let (status, body) = common::get_authed(app, "/admin/stats", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["total_users"].is_number());
    assert!(body["total_servers"].is_number());
    assert!(body["total_messages"].is_number());
    assert!(body["total_channels"].is_number());
    assert!(body["active_ws_connections"].is_number());
    assert!(body["db_latency_ms"].is_number());
}

// ============================================================================
// GET /admin/users
// ============================================================================

#[tokio::test]
async fn admin_list_users_returns_paginated() {
    let (app, admin_token, _, _) = setup_admin_and_user().await;

    let (status, body) = common::get_authed(app, "/admin/users?limit=10", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["users"].is_array());
    assert!(body["total"].is_number());
    assert!(body["page"].is_number());
    assert!(body["per_page"].is_number());

    let users = body["users"].as_array().unwrap();
    assert!(
        users.len() >= 2,
        "should have at least admin + regular user"
    );
}

#[tokio::test]
async fn admin_list_users_search_filter() {
    let (app, admin_token, _, _) = setup_admin_and_user().await;

    // Search for a username that definitely doesn't exist
    let (status, body) =
        common::get_authed(app, "/admin/users?search=zzz_nonexistent_zzz", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    let users = body["users"].as_array().unwrap();
    assert!(users.is_empty());
}

// ============================================================================
// PATCH /admin/users/:user_id
// ============================================================================

#[tokio::test]
async fn admin_promote_user() {
    let (app, admin_token, _, user_id) = setup_admin_and_user().await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/admin/users/{user_id}"),
        &admin_token,
        json!({ "is_admin": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn admin_cannot_demote_self() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());

    let admin_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_token = admin_body["access_token"].as_str().unwrap();
    let admin_id = admin_body["user"]["id"].as_str().unwrap();

    sqlx::query("UPDATE users SET is_admin = true WHERE id = $1")
        .bind(uuid::Uuid::parse_str(admin_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/admin/users/{admin_id}"),
        admin_token,
        json!({ "is_admin": false }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn admin_disable_user() {
    let (app, admin_token, _, user_id) = setup_admin_and_user().await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/admin/users/{user_id}"),
        &admin_token,
        json!({ "disabled": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn disabled_user_cannot_login() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());

    let admin_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_token = admin_body["access_token"].as_str().unwrap();
    let admin_id = admin_body["user"]["id"].as_str().unwrap();

    sqlx::query("UPDATE users SET is_admin = true WHERE id = $1")
        .bind(uuid::Uuid::parse_str(admin_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let target_username = common::unique_username();
    let target_body = common::register_user(app.clone(), &target_username, "pass1234").await;
    let target_id = target_body["user"]["id"].as_str().unwrap();

    // Disable the user
    common::patch_json_authed(
        app.clone(),
        &format!("/admin/users/{target_id}"),
        admin_token,
        json!({ "disabled": true }),
    )
    .await;

    // Disabled user tries to login
    let (status, body) = common::post_json(
        app,
        "/auth/login",
        json!({ "username": target_username, "password": "pass1234" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body["error"].as_str().unwrap().contains("disabled"));
}

// ============================================================================
// DELETE /admin/users/:user_id
// ============================================================================

#[tokio::test]
async fn admin_cannot_delete_self() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());

    let admin_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let admin_token = admin_body["access_token"].as_str().unwrap();
    let admin_id = admin_body["user"]["id"].as_str().unwrap();

    sqlx::query("UPDATE users SET is_admin = true WHERE id = $1")
        .bind(uuid::Uuid::parse_str(admin_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let (status, _) =
        common::delete_authed(app, &format!("/admin/users/{admin_id}"), admin_token).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn admin_delete_user_success() {
    let (app, admin_token, _, user_id) = setup_admin_and_user().await;

    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/admin/users/{user_id}"),
        &admin_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // User should not appear in admin user list
    let (_, body) = common::get_authed(app, "/admin/users", &admin_token).await;
    let users = body["users"].as_array().unwrap();
    assert!(!users.iter().any(|u| u["id"].as_str() == Some(&user_id)));
}

// ============================================================================
// GET /admin/servers
// ============================================================================

#[tokio::test]
async fn admin_list_servers() {
    let (app, admin_token, _, _) = setup_admin_and_user().await;

    // Create a server
    common::create_server(app.clone(), &admin_token, "Admin Test Server").await;

    let (status, body) = common::get_authed(app, "/admin/servers", &admin_token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["servers"].is_array());
    assert!(body["total"].is_number());
}

// ============================================================================
// DELETE /admin/servers/:server_id
// ============================================================================

#[tokio::test]
async fn admin_delete_server() {
    let (app, admin_token, _, _) = setup_admin_and_user().await;

    let server = common::create_server(app.clone(), &admin_token, "Doomed Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _) =
        common::delete_authed(app, &format!("/admin/servers/{server_id}"), &admin_token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

async fn setup_server_with_member() -> (axum::Router, String, String, String, String) {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let member_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let member_token = member_body["access_token"].as_str().unwrap().to_owned();
    let member_user_id = member_body["user"]["id"].as_str().unwrap().to_owned();

    let server = common::create_server(app.clone(), &owner_token, "Invite Test").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

    common::make_server_public(app.clone(), &owner_token, &server_id).await;

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &member_token,
        json!({}),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "join failed with {status}"
    );

    (app, owner_token, member_token, server_id, member_user_id)
}

async fn create_invite(app: axum::Router, token: &str, server_id: &str) -> serde_json::Value {
    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/invites"),
        token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create_invite failed: {body}");
    body
}

// ============================================================================
// POST /servers/:id/invites — create invite
// ============================================================================

#[tokio::test]
async fn create_invite_success() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/invites"),
        &owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["id"].is_string());
    assert!(body["code"].is_string());
    let code = body["code"].as_str().unwrap();
    assert_eq!(code.len(), 8, "invite code should be 8 characters");
    assert!(
        code.chars().all(|c| c.is_ascii_alphanumeric()),
        "code should be alphanumeric"
    );
    assert_eq!(body["uses"], 0);
}

#[tokio::test]
async fn create_invite_with_options() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/invites"),
        &owner_token,
        json!({ "max_uses": 5, "expires_in_hours": 24 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["max_uses"], 5);
    assert!(body["expires_at"].is_string());
}

#[tokio::test]
async fn create_invite_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::post_json(
        app,
        "/servers/00000000-0000-0000-0000-000000000000/invites",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_invite_requires_permission() {
    let (app, _, member_token, server_id, _) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/invites"),
        &member_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// GET /servers/:id/invites — list invites
// ============================================================================

#[tokio::test]
async fn list_invites_success() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    create_invite(app.clone(), &owner_token, &server_id).await;
    create_invite(app.clone(), &owner_token, &server_id).await;

    let (status, body) =
        common::get_authed(app, &format!("/servers/{server_id}/invites"), &owner_token).await;
    assert_eq!(status, StatusCode::OK);
    let invites = body.as_array().unwrap();
    assert!(invites.len() >= 2);
}

// ============================================================================
// DELETE /servers/:id/invites/:invite_id — revoke invite
// ============================================================================

#[tokio::test]
async fn delete_invite_success() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let invite = create_invite(app.clone(), &owner_token, &server_id).await;
    let invite_id = invite["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{server_id}/invites/{invite_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn delete_invite_not_found() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{server_id}/invites/00000000-0000-0000-0000-000000000000"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /invites/:code — preview invite
// ============================================================================

#[tokio::test]
async fn preview_invite_success() {
    let (app, owner_token, member_token, server_id, _) = setup_server_with_member().await;

    let invite = create_invite(app.clone(), &owner_token, &server_id).await;
    let code = invite["code"].as_str().unwrap();

    // Any authenticated user can preview
    let (status, body) = common::get_authed(app, &format!("/invites/{code}"), &member_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["code"], code);
    assert!(body["server_name"].is_string());
    assert!(body["member_count"].is_number());
}

// ============================================================================
// POST /invites/:code/accept — join via invite
// ============================================================================

#[tokio::test]
async fn accept_invite_to_private_server() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let joiner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    // Create a PRIVATE server (not public)
    let server = common::create_server(app.clone(), &owner_token, "Private Club").await;
    let server_id = server["id"].as_str().unwrap();

    // Create invite
    let invite = create_invite(app.clone(), &owner_token, server_id).await;
    let code = invite["code"].as_str().unwrap();

    // Joiner cannot join directly (private)
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "private server should reject direct join"
    );

    // But can join via invite
    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/invites/{code}/accept"),
        &joiner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(body["server_id"].is_string());

    // Verify membership
    let (status, _) =
        common::get_authed(app, &format!("/servers/{server_id}/members"), &owner_token).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn accept_invite_already_member() {
    let (app, owner_token, member_token, server_id, _) = setup_server_with_member().await;

    let invite = create_invite(app.clone(), &owner_token, &server_id).await;
    let code = invite["code"].as_str().unwrap();

    // Member is already in the server
    let (status, _) = common::post_json_authed(
        app,
        &format!("/invites/{code}/accept"),
        &member_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn accept_invite_max_uses_exceeded() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let user1_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let user2_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &owner_token, "Max Uses Test").await;
    let server_id = server["id"].as_str().unwrap();
    common::make_server_public(app.clone(), &owner_token, server_id).await;

    // Create invite with max_uses = 1
    let (_, invite) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/invites"),
        &owner_token,
        json!({ "max_uses": 1 }),
    )
    .await;
    let code = invite["code"].as_str().unwrap();

    // First user accepts — should succeed
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/invites/{code}/accept"),
        &user1_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Second user tries — should fail (max uses reached)
    let (status, _) = common::post_json_authed(
        app,
        &format!("/invites/{code}/accept"),
        &user2_token,
        json!({}),
    )
    .await;
    assert!(
        status == StatusCode::BAD_REQUEST || status == StatusCode::GONE,
        "expected 400 or 410 for maxed invite, got {status}"
    );
}

#[tokio::test]
async fn accept_invite_banned_user_rejected() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    // Ban the member
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/ban"),
        &owner_token,
        json!({}),
    )
    .await;

    // Create a fresh scenario with a banned user:
    let pool = common::test_pool().await;
    let app2 = common::create_test_app(pool);

    let owner2 =
        common::register_and_get_token(app2.clone(), &common::unique_username(), "pass1234").await;
    let victim_body =
        common::register_user(app2.clone(), &common::unique_username(), "pass1234").await;
    let victim_token = victim_body["access_token"].as_str().unwrap();
    let victim_id = victim_body["user"]["id"].as_str().unwrap();

    let srv = common::create_server(app2.clone(), &owner2, "Ban Test").await;
    let srv_id = srv["id"].as_str().unwrap();
    common::make_server_public(app2.clone(), &owner2, srv_id).await;

    // Join then ban
    common::post_json_authed(
        app2.clone(),
        &format!("/servers/{srv_id}/join"),
        victim_token,
        json!({}),
    )
    .await;
    common::post_json_authed(
        app2.clone(),
        &format!("/servers/{srv_id}/members/{victim_id}/ban"),
        &owner2,
        json!({}),
    )
    .await;

    // Create invite
    let inv = create_invite(app2.clone(), &owner2, srv_id).await;
    let inv_code = inv["code"].as_str().unwrap();

    // Banned user tries to accept
    let (status, _) = common::post_json_authed(
        app2,
        &format!("/invites/{inv_code}/accept"),
        victim_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// Invite code not found
// ============================================================================

#[tokio::test]
async fn preview_invalid_code_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(app, "/invites/nonexist", &token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn accept_invalid_code_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::post_json_authed(app, "/invites/nonexist/accept", &token, json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// Uses counter increments
// ============================================================================

#[tokio::test]
async fn accept_invite_increments_uses() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let joiner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &owner_token, "Uses Test").await;
    let server_id = server["id"].as_str().unwrap();
    common::make_server_public(app.clone(), &owner_token, server_id).await;

    let invite = create_invite(app.clone(), &owner_token, server_id).await;
    let code = invite["code"].as_str().unwrap();
    assert_eq!(invite["uses"], 0);

    // Accept invite
    common::post_json_authed(
        app.clone(),
        &format!("/invites/{code}/accept"),
        &joiner_token,
        json!({}),
    )
    .await;

    // Check uses incremented
    let (_, invites) =
        common::get_authed(app, &format!("/servers/{server_id}/invites"), &owner_token).await;
    let invites = invites.as_array().unwrap();
    let updated = invites
        .iter()
        .find(|i| i["code"].as_str() == Some(code))
        .unwrap();
    assert_eq!(updated["uses"], 1);
}

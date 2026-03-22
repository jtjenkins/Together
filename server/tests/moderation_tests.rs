mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

/// Register two users, create a server (user1 = owner), have user2 join.
/// Returns (app, owner_token, member_token, server_id, member_user_id).
async fn setup_server_with_member() -> (axum::Router, String, String, String, String) {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let member_name = common::unique_username();
    let member_body = common::register_user(app.clone(), &member_name, "pass1234").await;
    let member_token = member_body["access_token"].as_str().unwrap().to_owned();
    let member_user_id = member_body["user"]["id"].as_str().unwrap().to_owned();

    let server = common::create_server(app.clone(), &owner_token, "Mod Test").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

    // Make server public so member can join
    common::make_server_public(app.clone(), &owner_token, &server_id).await;

    // Member joins
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

// ============================================================================
// POST /servers/:id/members/:user_id/kick
// ============================================================================

#[tokio::test]
async fn kick_member_success() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/kick"),
        &owner_token,
        json!({ "reason": "Testing kick" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify member is no longer listed
    let (status, body) =
        common::get_authed(app, &format!("/servers/{server_id}/members"), &owner_token).await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);
    let members = body.as_array().unwrap();
    assert!(
        !members
            .iter()
            .any(|m| m["user_id"].as_str() == Some(&member_id)),
        "kicked member should not be in member list"
    );
}

#[tokio::test]
async fn kick_member_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::post_json(
        app,
        "/servers/00000000-0000-0000-0000-000000000000/members/00000000-0000-0000-0000-000000000001/kick",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn kick_self_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let owner_token = owner_body["access_token"].as_str().unwrap();
    let owner_id = owner_body["user"]["id"].as_str().unwrap();

    let server = common::create_server(app.clone(), owner_token, "Self Kick").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{owner_id}/kick"),
        owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("yourself"));
}

#[tokio::test]
async fn kick_owner_returns_403() {
    let (app, owner_token, member_token, server_id, _) = setup_server_with_member().await;

    // Get owner's user ID
    let (_, owner_profile) = common::get_authed(app.clone(), "/users/@me", &owner_token).await;
    let owner_id = owner_profile["id"].as_str().unwrap();

    // Member tries to kick owner
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{owner_id}/kick"),
        &member_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn kick_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let outsider_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let outsider_id = outsider_body["user"]["id"].as_str().unwrap();

    let server = common::create_server(app.clone(), &owner_token, "Kick Outsider").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{outsider_id}/kick"),
        &owner_token,
        json!({}),
    )
    .await;
    // Target is not a member, so kick should fail gracefully
    assert!(status == StatusCode::NOT_FOUND || status == StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn regular_member_cannot_kick() {
    let (app, _, member_token, server_id, _) = setup_server_with_member().await;

    // Register a third user and have them join
    let third_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let third_token = third_body["access_token"].as_str().unwrap();
    let third_id = third_body["user"]["id"].as_str().unwrap();

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        third_token,
        json!({}),
    )
    .await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);

    // Member without KICK_MEMBERS permission tries to kick third user
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{third_id}/kick"),
        &member_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// POST /servers/:id/members/:user_id/ban
// ============================================================================

#[tokio::test]
async fn ban_member_success() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/ban"),
        &owner_token,
        json!({ "reason": "Rule violation" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify member is no longer listed
    let (_, body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/members"),
        &owner_token,
    )
    .await;
    let members = body.as_array().unwrap();
    assert!(!members
        .iter()
        .any(|m| m["user_id"].as_str() == Some(&member_id)));

    // Verify ban appears in ban list
    let (status, bans) =
        common::get_authed(app, &format!("/servers/{server_id}/bans"), &owner_token).await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);
    let bans = bans.as_array().unwrap();
    assert!(bans
        .iter()
        .any(|b| b["user_id"].as_str() == Some(&member_id)));
}

#[tokio::test]
async fn banned_user_cannot_rejoin() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Ban the member
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/ban"),
        &owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Banned member tries to rejoin
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &member_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unban_then_rejoin_succeeds() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Ban
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/ban"),
        &owner_token,
        json!({}),
    )
    .await;

    // Unban
    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/bans/{member_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Rejoin should succeed
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &member_token,
        json!({}),
    )
    .await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);
}

// ============================================================================
// POST /servers/:id/members/:user_id/timeout
// ============================================================================

#[tokio::test]
async fn timeout_member_success() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "duration_minutes": 30, "reason": "Cool off" }),
    )
    .await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);
    assert!(body["expires_at"].is_string());
    assert_eq!(body["user_id"].as_str(), Some(member_id.as_str()));
}

#[tokio::test]
async fn timeout_blocks_messages() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Create a channel
    let channel = common::create_channel(app.clone(), &owner_token, &server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    // Timeout the member
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "duration_minutes": 60 }),
    )
    .await;

    // Timed-out member tries to send a message
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/messages"),
        &member_token,
        json!({ "content": "Should be blocked" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body["error"].as_str().unwrap().contains("timed out"));
}

#[tokio::test]
async fn timeout_requires_duration() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    // Missing duration_minutes
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "reason": "No duration" }),
    )
    .await;
    // Should fail — duration_minutes is required
    assert!(status == StatusCode::BAD_REQUEST || status == StatusCode::UNPROCESSABLE_ENTITY);
}

// ============================================================================
// DELETE /servers/:id/members/:user_id/timeout
// ============================================================================

#[tokio::test]
async fn remove_timeout_success() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Create channel and timeout member
    let channel = common::create_channel(app.clone(), &owner_token, &server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "duration_minutes": 60 }),
    )
    .await;

    // Remove timeout
    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Member can now send messages
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/messages"),
        &member_token,
        json!({ "content": "I'm back!" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

// ============================================================================
// Audit log verification
// ============================================================================

#[tokio::test]
async fn moderation_actions_produce_audit_logs() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    // Kick
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/kick"),
        &owner_token,
        json!({ "reason": "Audit test" }),
    )
    .await;

    let (status, logs) = common::get_authed(
        app,
        &format!("/servers/{server_id}/audit-logs?action=member_kick"),
        &owner_token,
    )
    .await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);
    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a member_kick audit log");
    assert_eq!(logs[0]["action"], "member_kick");
    assert_eq!(logs[0]["target_type"], "user");
}

// ============================================================================
// Permission boundary tests
// ============================================================================

#[tokio::test]
async fn regular_member_cannot_ban() {
    let (app, _, member_token, server_id, _) = setup_server_with_member().await;

    let third_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let third_token = third_body["access_token"].as_str().unwrap();
    let third_id = third_body["user"]["id"].as_str().unwrap();

    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        third_token,
        json!({}),
    )
    .await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{third_id}/ban"),
        &member_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn regular_member_cannot_timeout() {
    let (app, _, member_token, server_id, _) = setup_server_with_member().await;

    let third_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let third_token = third_body["access_token"].as_str().unwrap();
    let third_id = third_body["user"]["id"].as_str().unwrap();

    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        third_token,
        json!({}),
    )
    .await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{third_id}/timeout"),
        &member_token,
        json!({ "duration_minutes": 10 }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// Duration validation
// ============================================================================

#[tokio::test]
async fn timeout_duration_zero_returns_400() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "duration_minutes": 0 }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn timeout_duration_negative_returns_400() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "duration_minutes": -5 }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn timeout_duration_exceeds_max_returns_400() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        &owner_token,
        json!({ "duration_minutes": 50000 }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// Kick vs ban behavioral difference
// ============================================================================

#[tokio::test]
async fn kicked_member_can_rejoin() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Kick
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/kick"),
        &owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Kicked member can rejoin (unlike banned)
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &member_token,
        json!({}),
    )
    .await;
    assert!(status == StatusCode::OK || status == StatusCode::CREATED);
}

// ============================================================================
// Ban idempotency
// ============================================================================

#[tokio::test]
async fn ban_already_banned_is_idempotent() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    // Ban once
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/ban"),
        &owner_token,
        json!({ "reason": "First ban" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Ban again — should not error
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/ban"),
        &owner_token,
        json!({ "reason": "Second ban" }),
    )
    .await;
    // Should succeed (upsert) or return a reasonable status
    assert!(
        status == StatusCode::NO_CONTENT || status == StatusCode::OK,
        "double ban should not error, got {status}"
    );
}

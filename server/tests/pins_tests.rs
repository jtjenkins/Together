mod common;

use axum::http::StatusCode;

/// Setup helper: creates a server, channel, and message owned by a new user.
/// Returns (owner_token, server_id, channel_id, message_id).
async fn setup(app: axum::Router) -> (String, String, String, String) {
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "PinTestGuild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &owner_token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    let msg = common::create_message(app.clone(), &owner_token, &cid, "hello pins").await;
    let mid = msg["id"].as_str().unwrap().to_owned();
    (owner_token, sid, cid, mid)
}

// ── pin_message tests ─────────────────────────────────────────────────────────

#[sqlx::test]
async fn owner_can_pin_message(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, mid) = setup(app.clone()).await;

    let (status, _body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn pin_is_idempotent(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, mid) = setup(app.clone()).await;

    let (status1, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status1, StatusCode::NO_CONTENT);

    let (status2, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status2, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn non_member_cannot_pin(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (_owner_token, _sid, cid, mid) = setup(app.clone()).await;

    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &outsider_token,
        serde_json::json!({}),
    )
    .await;

    // require_member returns 404 (not 403) to avoid leaking server existence
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[sqlx::test]
async fn member_without_manage_messages_cannot_pin(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid, mid) = setup(app.clone()).await;

    // Make the server public so another user can join.
    common::make_server_public(app.clone(), &owner_token, &sid).await;

    // Join as a plain member (no special roles).
    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (join_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &member_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(join_status, StatusCode::CREATED);

    // Member is in the server but lacks MANAGE_MESSAGES → 403.
    let (status, _body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &member_token,
        serde_json::json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test]
async fn list_pinned_messages_not_shown_after_unpin(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, mid) = setup(app.clone()).await;

    // Pin the message
    let (pin_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(pin_status, StatusCode::NO_CONTENT);

    // Unpin the message
    let (unpin_status, _) = common::delete_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
    )
    .await;
    assert_eq!(unpin_status, StatusCode::NO_CONTENT);

    // List should be empty again
    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{cid}/pinned-messages"),
        &owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());
}

#[sqlx::test]
async fn unauthenticated_cannot_pin(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (_owner_token, _sid, cid, mid) = setup(app.clone()).await;

    let (status, _body) = common::post_json(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        serde_json::json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn pin_message_wrong_channel_returns_404(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, sid, _cid, mid) = setup(app.clone()).await;

    // Create a second channel in the same server
    let channel_b = common::create_channel(app.clone(), &owner_token, &sid, "other-channel").await;
    let cid_b = channel_b["id"].as_str().unwrap().to_owned();

    // Try to pin the message (which belongs to the first channel) under channel_b
    let (status, _body) = common::post_json_authed(
        app,
        &format!("/channels/{cid_b}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── timeout tests ────────────────────────────────────────────────────────────

/// Helper: register a member, join the given public server, grant MANAGE_MESSAGES,
/// and apply a 60-minute timeout.  Returns (member_token, member_id).
async fn setup_timed_out_member_with_manage_messages(
    app: axum::Router,
    owner_token: &str,
    server_id: &str,
) -> (String, String) {
    let member_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let member_token = member_body["access_token"].as_str().unwrap().to_owned();
    let member_id = member_body["user"]["id"].as_str().unwrap().to_owned();

    let (join_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &member_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(join_status, StatusCode::CREATED, "member join failed");

    // Grant MANAGE_MESSAGES (bit 2 = 4) via a role so the member would normally be allowed.
    let (role_status, role_body) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        owner_token,
        serde_json::json!({ "name": "Pinner", "permissions": 4 }),
    )
    .await;
    assert_eq!(role_status, StatusCode::CREATED, "role creation failed");
    let role_id = role_body["id"].as_str().unwrap().to_owned();

    let (assign_status, _) = common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        owner_token,
    )
    .await;
    assert_eq!(assign_status, StatusCode::NO_CONTENT, "role assign failed");

    // Apply a 60-minute timeout to the member.
    let (timeout_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/timeout"),
        owner_token,
        serde_json::json!({ "duration_minutes": 60 }),
    )
    .await;
    assert_eq!(timeout_status, StatusCode::NO_CONTENT, "timeout failed");

    (member_token, member_id)
}

#[sqlx::test]
async fn timed_out_member_cannot_pin_message(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid, mid) = setup(app.clone()).await;

    common::make_server_public(app.clone(), &owner_token, &sid).await;
    let (member_token, _) =
        setup_timed_out_member_with_manage_messages(app.clone(), &owner_token, &sid).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &member_token,
        serde_json::json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        body["error"].as_str().unwrap_or("").contains("timed out"),
        "expected 'timed out' in error, got: {body}"
    );
}

#[sqlx::test]
async fn timed_out_member_cannot_unpin_message(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid, mid) = setup(app.clone()).await;

    common::make_server_public(app.clone(), &owner_token, &sid).await;
    let (member_token, _) =
        setup_timed_out_member_with_manage_messages(app.clone(), &owner_token, &sid).await;

    // Owner pins the message first.
    let (pin_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(pin_status, StatusCode::NO_CONTENT);

    // Timed-out member tries to unpin → 403.
    let (status, body) = common::delete_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &member_token,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        body["error"].as_str().unwrap_or("").contains("timed out"),
        "expected 'timed out' in error, got: {body}"
    );
}

// ── unpin_message tests ───────────────────────────────────────────────────────

#[sqlx::test]
async fn owner_can_unpin_pinned_message(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, mid) = setup(app.clone()).await;

    // Pin first
    let (pin_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(pin_status, StatusCode::NO_CONTENT);

    // Then unpin
    let (unpin_status, _) = common::delete_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
    )
    .await;
    assert_eq!(unpin_status, StatusCode::NO_CONTENT);
}

#[sqlx::test]
async fn unpin_not_pinned_returns_404(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, mid) = setup(app.clone()).await;

    // Message is not pinned; unpin should return 404
    let (status, _body) = common::delete_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── list_pinned_messages tests ────────────────────────────────────────────────

#[sqlx::test]
async fn list_pinned_messages_empty_initially(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, _mid) = setup(app.clone()).await;

    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{cid}/pinned-messages"),
        &owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.as_array().unwrap().is_empty());
}

#[sqlx::test]
async fn list_pinned_messages_shows_pinned(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (owner_token, _sid, cid, mid) = setup(app.clone()).await;

    // Pin the message
    let (pin_status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/pin"),
        &owner_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(pin_status, StatusCode::NO_CONTENT);

    // List pinned messages
    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{cid}/pinned-messages"),
        &owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let pinned = body.as_array().unwrap();
    assert_eq!(pinned.len(), 1);
    assert_eq!(pinned[0]["id"].as_str().unwrap(), mid);
}

#[sqlx::test]
async fn non_member_cannot_list_pinned_messages(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (_owner_token, _sid, cid, _mid) = setup(app.clone()).await;

    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _body) = common::get_authed(
        app,
        &format!("/channels/{cid}/pinned-messages"),
        &outsider_token,
    )
    .await;

    // require_member returns 404 (not 403) to avoid leaking server existence
    assert_eq!(status, StatusCode::NOT_FOUND);
}

mod common;

use axum::http::StatusCode;
use serde_json::json;
use uuid::Uuid;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Register two fresh users; return (token_a, id_a, token_b, id_b).
async fn setup_two_users(app: axum::Router) -> (String, String, String, String) {
    let body_a = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token_a = body_a["access_token"].as_str().unwrap().to_owned();
    let id_a = body_a["user"]["id"].as_str().unwrap().to_owned();

    let body_b = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token_b = body_b["access_token"].as_str().unwrap().to_owned();
    let id_b = body_b["user"]["id"].as_str().unwrap().to_owned();

    (token_a, id_a, token_b, id_b)
}

// ============================================================================
// POST /dm-channels — open or retrieve a DM channel
// ============================================================================

#[tokio::test]
async fn open_dm_channel_creates_new_channel() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let (status, body) =
        common::post_json_authed(app, "/dm-channels", &token_a, json!({ "user_id": id_b })).await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(body["id"].is_string());
    assert_eq!(body["recipient"]["id"], id_b);
}

#[tokio::test]
async fn open_dm_channel_idempotent() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let (s1, b1) = common::post_json_authed(
        app.clone(),
        "/dm-channels",
        &token_a,
        json!({ "user_id": id_b }),
    )
    .await;

    let (s2, b2) =
        common::post_json_authed(app, "/dm-channels", &token_a, json!({ "user_id": id_b })).await;

    // Second call must return 200 OK (not 201), same channel ID.
    assert_eq!(s1, StatusCode::CREATED);
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(b1["id"], b2["id"]);
}

#[tokio::test]
async fn open_dm_channel_self_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let body = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token = body["access_token"].as_str().unwrap().to_owned();
    let my_id = body["user"]["id"].as_str().unwrap().to_owned();

    let (status, _) =
        common::post_json_authed(app, "/dm-channels", &token, json!({ "user_id": my_id })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn open_dm_channel_nonexistent_user_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let body = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token = body["access_token"].as_str().unwrap().to_owned();

    let ghost_id = uuid::Uuid::new_v4().to_string();
    let (status, _) =
        common::post_json_authed(app, "/dm-channels", &token, json!({ "user_id": ghost_id })).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// POST /dm-channels/:id/messages — send a DM message
// ============================================================================

#[tokio::test]
async fn send_dm_message_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/dm-channels/{channel_id}/messages"),
        &token_a,
        json!({ "content": "hello there" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["content"], "hello there");
    assert_eq!(body["channel_id"], channel_id);
    // `deleted` must not be serialized to clients.
    assert!(body["deleted"].is_null());
}

#[tokio::test]
async fn send_dm_message_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    // Third user who is not part of this DM.
    let token_c =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/dm-channels/{channel_id}/messages"),
        &token_c,
        json!({ "content": "intruder!" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /dm-channels/:id/messages — list DM messages
// ============================================================================

#[tokio::test]
async fn list_dm_messages_returns_messages_newest_first() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    common::send_dm_message(app.clone(), &token_a, &channel_id, "first").await;
    common::send_dm_message(app.clone(), &token_a, &channel_id, "second").await;

    let (status, body) = common::get_authed(
        app,
        &format!("/dm-channels/{channel_id}/messages"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert_eq!(msgs.len(), 2);
    // Newest first.
    assert_eq!(msgs[0]["content"], "second");
    assert_eq!(msgs[1]["content"], "first");
}

#[tokio::test]
async fn list_dm_messages_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    let token_c =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(
        app,
        &format!("/dm-channels/{channel_id}/messages"),
        &token_c,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// POST /dm-channels/:id/ack — acknowledge DM channel
// ============================================================================

#[tokio::test]
async fn ack_dm_channel_member_succeeds() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    let (status, _) = common::post_json_authed(
        app,
        &format!("/dm-channels/{channel_id}/ack"),
        &token_a,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn ack_dm_channel_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    let token_c =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/dm-channels/{channel_id}/ack"),
        &token_c,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /dm-channels — list DM channels
// ============================================================================

#[tokio::test]
async fn list_dm_channels_empty_initially() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let body = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token = body["access_token"].as_str().unwrap().to_owned();

    let (status, body) = common::get_authed(app, "/dm-channels", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_dm_channels_shows_opened_channel() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    // Open a DM channel
    common::open_dm_channel(app.clone(), &token_a, &id_b).await;

    // List should show exactly one channel
    let (status, body) = common::get_authed(app, "/dm-channels", &token_a).await;
    assert_eq!(status, StatusCode::OK);
    let channels = body.as_array().unwrap();
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0]["recipient"]["id"], id_b);
}

#[tokio::test]
async fn list_dm_channels_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(app, "/dm-channels").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// Edge cases for DM messages
// ============================================================================

#[tokio::test]
async fn send_dm_message_empty_content_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    let (status, _) = common::post_json_authed(
        app,
        &format!("/dm-channels/{channel_id}/messages"),
        &token_a,
        json!({ "content": "" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn send_dm_message_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let fake_channel = Uuid::new_v4();

    let (status, _) = common::post_json(
        app,
        &format!("/dm-channels/{fake_channel}/messages"),
        json!({ "content": "hello" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_dm_messages_with_cursor_pagination() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, _id_a, _token_b, id_b) = setup_two_users(app.clone()).await;

    let ch = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = ch["id"].as_str().unwrap().to_owned();

    // Send 3 messages
    common::send_dm_message(app.clone(), &token_a, &channel_id, "msg1").await;
    common::send_dm_message(app.clone(), &token_a, &channel_id, "msg2").await;
    let msg3 = common::send_dm_message(app.clone(), &token_a, &channel_id, "msg3").await;
    let msg3_id = msg3["id"].as_str().unwrap();

    // Fetch with limit=1
    let (status, body) = common::get_authed(
        app.clone(),
        &format!("/dm-channels/{channel_id}/messages?limit=1"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["content"], "msg3"); // newest first

    // Fetch with before cursor (before msg3)
    let (status, body) = common::get_authed(
        app,
        &format!("/dm-channels/{channel_id}/messages?before={msg3_id}&limit=10"),
        &token_a,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["content"], "msg2");
    assert_eq!(msgs[1]["content"], "msg1");
}

#[tokio::test]
async fn open_dm_channel_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let fake_user_id = Uuid::new_v4();

    let (status, _) =
        common::post_json(app, "/dm-channels", json!({ "user_id": fake_user_id })).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn both_participants_see_dm_channel() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, id_a, token_b, id_b) = setup_two_users(app.clone()).await;

    // A opens a DM with B
    common::open_dm_channel(app.clone(), &token_a, &id_b).await;

    // B should also see the channel in their list
    let (status, body) = common::get_authed(app, "/dm-channels", &token_b).await;
    assert_eq!(status, StatusCode::OK);
    let channels = body.as_array().unwrap();
    assert_eq!(channels.len(), 1);
    // B sees A as the recipient
    assert_eq!(channels[0]["recipient"]["id"], id_a);
}

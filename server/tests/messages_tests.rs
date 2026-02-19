mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Set up a server + channel owned by a fresh user; return (token, server_id, channel_id).
async fn setup_server_and_channel(app: axum::Router) -> (String, String, String) {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    (token, sid, cid)
}

/// Register a second user and have them join the given server; return their token.
async fn join_as_member(app: axum::Router, server_id: &str) -> String {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &token,
        json!({}),
    )
    .await;
    token
}

// ============================================================================
// POST /channels/:channel_id/messages — create message
// ============================================================================

#[tokio::test]
async fn create_message_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": "Hello world!" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["content"], "Hello world!");
    assert_eq!(body["channel_id"], cid);
    assert!(body["id"].is_string());
    assert!(!body["deleted"].as_bool().unwrap());
}

#[tokio::test]
async fn create_message_member_can_post() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup_server_and_channel(app.clone()).await;
    let _ = owner_token;
    let member_token = join_as_member(app.clone(), &sid).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &member_token,
        json!({ "content": "Member message" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["content"], "Member message");
}

#[tokio::test]
async fn create_message_non_member_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_, _, cid) = setup_server_and_channel(app.clone()).await;
    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &outsider,
        json!({ "content": "Sneaky!" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_message_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) = common::post_json(
        app,
        &format!("/channels/{cid}/messages"),
        json!({ "content": "No auth" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_message_rejects_empty_content() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": "" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_message_rejects_content_too_long() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let long_content = "a".repeat(4001);
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": long_content }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_message_unknown_channel_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        "/channels/00000000-0000-0000-0000-000000000000/messages",
        &token,
        json!({ "content": "Hello" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn create_message_with_reply_to() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let parent = common::create_message(app.clone(), &token, &cid, "Parent").await;
    let parent_id = parent["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": "Reply", "reply_to": parent_id }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["reply_to"], parent_id);
}

#[tokio::test]
async fn create_message_reply_to_nonexistent_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": "Reply", "reply_to": "00000000-0000-0000-0000-000000000000" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /channels/:channel_id/messages — list messages
// ============================================================================

#[tokio::test]
async fn list_messages_empty_channel() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!([]));
}

#[tokio::test]
async fn list_messages_returns_newest_first() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    common::create_message(app.clone(), &token, &cid, "first").await;
    common::create_message(app.clone(), &token, &cid, "second").await;
    common::create_message(app.clone(), &token, &cid, "third").await;

    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert_eq!(msgs.len(), 3);
    assert_eq!(msgs[0]["content"], "third");
    assert_eq!(msgs[2]["content"], "first");
}

#[tokio::test]
async fn list_messages_default_limit_50() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    for i in 0..55u32 {
        common::create_message(app.clone(), &token, &cid, &format!("msg {i}")).await;
    }

    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 50);
}

#[tokio::test]
async fn list_messages_custom_limit() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    for i in 0..10u32 {
        common::create_message(app.clone(), &token, &cid, &format!("msg {i}")).await;
    }

    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages?limit=3"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn list_messages_cursor_pagination() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    common::create_message(app.clone(), &token, &cid, "oldest").await;
    common::create_message(app.clone(), &token, &cid, "middle").await;
    let newest = common::create_message(app.clone(), &token, &cid, "newest").await;
    let newest_id = newest["id"].as_str().unwrap();

    // Fetch messages before "newest" — should return "middle" and "oldest".
    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{cid}/messages?before={newest_id}"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0]["content"], "middle");
    assert_eq!(msgs[1]["content"], "oldest");
}

#[tokio::test]
async fn list_messages_excludes_deleted() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    common::create_message(app.clone(), &token, &cid, "visible").await;
    let msg = common::create_message(app.clone(), &token, &cid, "to be deleted").await;
    let mid = msg["id"].as_str().unwrap();

    common::delete_authed(app.clone(), &format!("/messages/{mid}"), &token).await;

    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;

    assert_eq!(status, StatusCode::OK);
    let msgs = body.as_array().unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["content"], "visible");
}

#[tokio::test]
async fn list_messages_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) = common::get_no_auth(app, &format!("/channels/{cid}/messages")).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_messages_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_, _, cid) = setup_server_and_channel(app.clone()).await;
    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &outsider).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// PATCH /messages/:message_id — update message
// ============================================================================

#[tokio::test]
async fn update_message_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &token, &cid, "original").await;
    let mid = msg["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/messages/{mid}"),
        &token,
        json!({ "content": "edited" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["content"], "edited");
    assert!(body["edited_at"].is_string(), "edited_at should be set");
}

#[tokio::test]
async fn update_message_non_author_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &owner_token, &cid, "owner message").await;
    let mid = msg["id"].as_str().unwrap();

    let member_token = join_as_member(app.clone(), &sid).await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/messages/{mid}"),
        &member_token,
        json!({ "content": "hijacked" }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn update_message_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &token, &cid, "msg").await;
    let mid = msg["id"].as_str().unwrap();

    let (status, _) = common::patch_no_auth(
        app,
        &format!("/messages/{mid}"),
        json!({ "content": "no token" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn update_message_empty_content_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &token, &cid, "original").await;
    let mid = msg["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/messages/{mid}"),
        &token,
        json!({ "content": "" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_message_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::patch_json_authed(
        app,
        "/messages/00000000-0000-0000-0000-000000000000",
        &token,
        json!({ "content": "ghost" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE /messages/:message_id — soft delete message
// ============================================================================

#[tokio::test]
async fn delete_message_author_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &token, &cid, "bye").await;
    let mid = msg["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(app.clone(), &format!("/messages/{mid}"), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Deleted message should no longer appear in the list.
    let (_, body) = common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;
    assert_eq!(body, json!([]));
}

#[tokio::test]
async fn delete_message_server_owner_can_delete_any() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup_server_and_channel(app.clone()).await;
    let member_token = join_as_member(app.clone(), &sid).await;

    let msg = common::create_message(app.clone(), &member_token, &cid, "member msg").await;
    let mid = msg["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(app, &format!("/messages/{mid}"), &owner_token).await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn delete_message_non_author_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &owner_token, &cid, "owner msg").await;
    let mid = msg["id"].as_str().unwrap();

    let member_token = join_as_member(app.clone(), &sid).await;

    let (status, _) = common::delete_authed(app, &format!("/messages/{mid}"), &member_token).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn delete_message_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &token, &cid, "msg").await;
    let mid = msg["id"].as_str().unwrap();

    let (status, _) = common::delete_no_auth(app, &format!("/messages/{mid}")).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn delete_message_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::delete_authed(
        app,
        "/messages/00000000-0000-0000-0000-000000000000",
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_message_already_deleted_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;
    let msg = common::create_message(app.clone(), &token, &cid, "bye").await;
    let mid = msg["id"].as_str().unwrap();

    common::delete_authed(app.clone(), &format!("/messages/{mid}"), &token).await;
    let (status, _) = common::delete_authed(app, &format!("/messages/{mid}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

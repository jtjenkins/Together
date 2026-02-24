mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Create a server + text channel owned by a fresh user.
/// Returns (owner_token, server_id, channel_id).
async fn setup(app: axum::Router) -> (String, String, String) {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Thread Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    (token, sid, cid)
}

// ============================================================================
// create_thread_reply_success
// ============================================================================

#[tokio::test]
async fn create_thread_reply_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    // Post a root message.
    let root = common::create_message(app.clone(), &token, &cid, "Root message").await;
    let root_id = root["id"].as_str().unwrap();

    // Post a thread reply to that root message.
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{root_id}/thread"),
        &token,
        json!({ "content": "First thread reply" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "unexpected status: {body}");
    assert_eq!(body["content"], "First thread reply");
    assert_eq!(body["thread_id"], root_id);
    assert!(body["reply_to"].is_null());
}

// ============================================================================
// thread_reply_excluded_from_channel_list
// ============================================================================

#[tokio::test]
async fn thread_reply_excluded_from_channel_list() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    let root = common::create_message(app.clone(), &token, &cid, "Root").await;
    let root_id = root["id"].as_str().unwrap();

    // Create a thread reply.
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{root_id}/thread"),
        &token,
        json!({ "content": "Thread reply" }),
    )
    .await;

    // Fetch the channel message list — should contain only the root message.
    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;

    assert_eq!(status, StatusCode::OK, "unexpected status: {body}");
    let messages = body.as_array().unwrap();
    assert_eq!(
        messages.len(),
        1,
        "expected only root message, got {messages:?}"
    );
    assert_eq!(messages[0]["id"], root_id);
}

// ============================================================================
// thread_reply_count_on_root
// ============================================================================

#[tokio::test]
async fn thread_reply_count_on_root() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    let root = common::create_message(app.clone(), &token, &cid, "Root").await;
    let root_id = root["id"].as_str().unwrap();

    // Add one thread reply.
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{root_id}/thread"),
        &token,
        json!({ "content": "Reply 1" }),
    )
    .await;

    // Fetch the channel list and verify thread_reply_count is 1.
    let (status, body) =
        common::get_authed(app, &format!("/channels/{cid}/messages"), &token).await;

    assert_eq!(status, StatusCode::OK, "unexpected status: {body}");
    let messages = body.as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(
        messages[0]["thread_reply_count"], 1,
        "expected thread_reply_count=1, got {:?}",
        messages[0]["thread_reply_count"]
    );
}

// ============================================================================
// list_thread_replies_ordered_asc
// ============================================================================

#[tokio::test]
async fn list_thread_replies_ordered_asc() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    let root = common::create_message(app.clone(), &token, &cid, "Root").await;
    let root_id = root["id"].as_str().unwrap();

    // Post replies in order.
    for i in 1..=3u32 {
        common::post_json_authed(
            app.clone(),
            &format!("/channels/{cid}/messages/{root_id}/thread"),
            &token,
            json!({ "content": format!("Reply {i}") }),
        )
        .await;
    }

    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{cid}/messages/{root_id}/thread"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::OK, "unexpected status: {body}");
    let replies = body.as_array().unwrap();
    assert_eq!(replies.len(), 3);

    // Replies must be returned oldest-first.
    assert_eq!(replies[0]["content"], "Reply 1");
    assert_eq!(replies[1]["content"], "Reply 2");
    assert_eq!(replies[2]["content"], "Reply 3");
}

// ============================================================================
// cannot_thread_from_thread_reply
// ============================================================================

#[tokio::test]
async fn cannot_thread_from_thread_reply() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    let root = common::create_message(app.clone(), &token, &cid, "Root").await;
    let root_id = root["id"].as_str().unwrap();

    // Create a thread reply.
    let (_, reply_body) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{root_id}/thread"),
        &token,
        json!({ "content": "First reply" }),
    )
    .await;
    let reply_id = reply_body["id"].as_str().unwrap();

    // Try to create a thread from the reply — must return 422.
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{reply_id}/thread"),
        &token,
        json!({ "content": "Nested thread attempt" }),
    )
    .await;

    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "expected 400, got {status}"
    );
}

// ============================================================================
// thread_reply_mentions_work
// ============================================================================

#[tokio::test]
async fn thread_reply_mentions_work() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup(app.clone()).await;

    // Register alice and have her join the server.
    let alice_name = format!("alice{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let alice_token = common::register_and_get_token(app.clone(), &alice_name, "pass1234").await;
    let (_, alice_body) = common::get_authed(app.clone(), "/users/@me", &alice_token).await;
    let alice_id = alice_body["id"].as_str().unwrap();
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &alice_token,
        json!({}),
    )
    .await;

    let root = common::create_message(app.clone(), &owner_token, &cid, "Root").await;
    let root_id = root["id"].as_str().unwrap();

    // Post a thread reply mentioning alice.
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages/{root_id}/thread"),
        &owner_token,
        json!({ "content": format!("Hey @{alice_name} check this thread") }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "unexpected status: {body}");
    assert_eq!(body["mention_everyone"], false);

    let ids = body["mention_user_ids"].as_array().unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], alice_id);
}

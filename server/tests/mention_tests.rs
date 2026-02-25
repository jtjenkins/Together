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
    let server = common::create_server(app.clone(), &token, "Mention Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    (token, sid, cid)
}

/// Register a second user with a known username, join the server, return
/// (token, user_id).
async fn register_member(
    app: axum::Router,
    owner_token: &str,
    username: &str,
    server_id: &str,
) -> (String, String) {
    let token = common::register_and_get_token(app.clone(), username, "pass1234").await;
    // Get user ID from /users/@me
    let (_, body) = common::get_authed(app.clone(), "/users/@me", &token).await;
    let user_id = body["id"].as_str().unwrap().to_owned();
    // Make server public, then join.
    common::make_server_public(app.clone(), owner_token, server_id).await;
    common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &token,
        json!({}),
    )
    .await;
    (token, user_id)
}

// ============================================================================
// @everyone detection
// ============================================================================

#[tokio::test]
async fn mention_everyone_parsed() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": "Raid tonight @everyone join up!" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["mention_everyone"], true);
    assert_eq!(body["mention_user_ids"], json!([]));
}

#[tokio::test]
async fn no_mention_gives_empty_fields() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &token,
        json!({ "content": "Hello, world!" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["mention_everyone"], false);
    assert_eq!(body["mention_user_ids"], json!([]));
}

// ============================================================================
// @username resolution
// ============================================================================

#[tokio::test]
async fn mention_username_resolved() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup(app.clone()).await;

    // Create a member with a predictable username.
    let alice_name = format!("alice{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let (_, alice_id) = register_member(app.clone(), &owner_token, &alice_name, &sid).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &owner_token,
        json!({ "content": format!("Hey @{alice_name} you around?") }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["mention_everyone"], false);

    let ids = body["mention_user_ids"].as_array().unwrap();
    assert_eq!(ids.len(), 1);
    assert_eq!(ids[0], alice_id);
}

// ============================================================================
// Non-member @mention is ignored
// ============================================================================

#[tokio::test]
async fn mention_nonmember_ignored() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, _, cid) = setup(app.clone()).await;

    // Register a user but do NOT join the server.
    let ghost_name = format!("ghost{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    common::register_and_get_token(app.clone(), &ghost_name, "pass1234").await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &owner_token,
        json!({ "content": format!("Hey @{ghost_name} you there?") }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["mention_everyone"], false);
    assert_eq!(body["mention_user_ids"], json!([]));
}

// ============================================================================
// Multiple mentions in one message
// ============================================================================

#[tokio::test]
async fn multiple_username_mentions() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (owner_token, sid, cid) = setup(app.clone()).await;

    let alice_name = format!("alice{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let bob_name = format!("bob{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let (_, alice_id) = register_member(app.clone(), &owner_token, &alice_name, &sid).await;
    let (_, bob_id) = register_member(app.clone(), &owner_token, &bob_name, &sid).await;

    let content = format!("@{alice_name} and @{bob_name} please check this out");
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/messages"),
        &owner_token,
        json!({ "content": content }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["mention_everyone"], false);

    let ids = body["mention_user_ids"].as_array().unwrap();
    assert_eq!(ids.len(), 2);

    let id_strings: Vec<&str> = ids.iter().map(|v| v.as_str().unwrap()).collect();
    assert!(id_strings.contains(&alice_id.as_str()));
    assert!(id_strings.contains(&bob_id.as_str()));
}

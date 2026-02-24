mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Register a user, create a server + channel + message.
/// Returns (token, server_id, channel_id, message_id).
async fn setup_with_message(app: axum::Router) -> (String, String, String, String) {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "React Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    let message = common::create_message(app.clone(), &token, &cid, "Hello!").await;
    let mid = message["id"].as_str().unwrap().to_owned();
    (token, sid, cid, mid)
}

// ============================================================================
// PUT /channels/:channel_id/messages/:message_id/reactions/:emoji
// ============================================================================

#[tokio::test]
async fn add_reaction_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _sid, cid, mid) = setup_with_message(app.clone()).await;

    let (status, _) = common::put_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn add_reaction_idempotent() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _sid, cid, mid) = setup_with_message(app.clone()).await;

    let (s1, _) = common::put_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token,
    )
    .await;
    let (s2, _) = common::put_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token,
    )
    .await;

    // Both calls succeed — ON CONFLICT DO NOTHING makes it idempotent.
    assert_eq!(s1, StatusCode::NO_CONTENT);
    assert_eq!(s2, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn add_reaction_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_token, _sid, cid, mid) = setup_with_message(app.clone()).await;

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::put_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &outsider,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE /channels/:channel_id/messages/:message_id/reactions/:emoji
// ============================================================================

#[tokio::test]
async fn remove_reaction_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _sid, cid, mid) = setup_with_message(app.clone()).await;

    common::put_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token,
    )
    .await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn remove_nonexistent_reaction_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _sid, cid, mid) = setup_with_message(app.clone()).await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /channels/:channel_id/messages/:message_id/reactions
// ============================================================================

#[tokio::test]
async fn list_reactions_count_and_me_flag() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token_a, sid, cid, mid) = setup_with_message(app.clone()).await;

    // Register a second user and join the server.
    let token_b =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &token_b,
        json!({}),
    )
    .await;

    // Both react with 👍; only token_b reacts with ❤️.
    common::put_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token_a,
    )
    .await;
    common::put_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/reactions/👍"),
        &token_b,
    )
    .await;
    common::put_authed(
        app.clone(),
        &format!("/channels/{cid}/messages/{mid}/reactions/❤️"),
        &token_b,
    )
    .await;

    // token_a sees: 👍 count=2 me=true, ❤️ count=1 me=false.
    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions"),
        &token_a,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let reactions = body.as_array().unwrap();

    let thumbs = reactions.iter().find(|r| r["emoji"] == "👍").unwrap();
    assert_eq!(thumbs["count"], 2);
    assert_eq!(thumbs["me"], true);

    let heart = reactions.iter().find(|r| r["emoji"] == "❤️").unwrap();
    assert_eq!(heart["count"], 1);
    assert_eq!(heart["me"], false);
}

#[tokio::test]
async fn list_reactions_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_token, _sid, cid, mid) = setup_with_message(app.clone()).await;

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(
        app,
        &format!("/channels/{cid}/messages/{mid}/reactions"),
        &outsider,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

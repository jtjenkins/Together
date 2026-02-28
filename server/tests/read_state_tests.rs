mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Set up a server + channel; return (token, server_id, channel_id).
async fn setup_server_and_channel(app: axum::Router) -> (String, String, String) {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Read State Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    (token, sid, cid)
}

// ============================================================================
// POST /channels/:channel_id/ack — acknowledge a server channel
// ============================================================================

#[tokio::test]
async fn test_ack_channel_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) =
        common::post_json_authed(app, &format!("/channels/{cid}/ack"), &token, json!({})).await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_ack_channel_idempotent() {
    // Calling ack twice on the same channel should succeed both times.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (s1, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{cid}/ack"),
        &token,
        json!({}),
    )
    .await;
    let (s2, _) =
        common::post_json_authed(app, &format!("/channels/{cid}/ack"), &token, json!({})).await;

    assert_eq!(s1, StatusCode::NO_CONTENT);
    assert_eq!(s2, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_ack_channel_non_member_returns_404() {
    // A non-member should not be able to ack a channel.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_, _, cid) = setup_server_and_channel(app.clone()).await;

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::post_json_authed(app, &format!("/channels/{cid}/ack"), &outsider, json!({})).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_ack_channel_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) = common::post_json(app, &format!("/channels/{cid}/ack"), json!({})).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// POST /dm-channels/:id/ack — acknowledge a DM channel
// ============================================================================

#[tokio::test]
async fn test_ack_dm_channel_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    // Register two users; user A opens a DM with user B.
    let body_a = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token_a = body_a["access_token"].as_str().unwrap().to_owned();

    let body_b = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let id_b = body_b["user"]["id"].as_str().unwrap().to_owned();

    let dm = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = dm["id"].as_str().unwrap().to_owned();

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
async fn test_ack_dm_channel_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let body_a = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let token_a = body_a["access_token"].as_str().unwrap().to_owned();

    let body_b = common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let id_b = body_b["user"]["id"].as_str().unwrap().to_owned();

    let dm = common::open_dm_channel(app.clone(), &token_a, &id_b).await;
    let channel_id = dm["id"].as_str().unwrap().to_owned();

    // A third user who is not part of this DM.
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

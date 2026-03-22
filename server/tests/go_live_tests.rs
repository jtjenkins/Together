mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

async fn create_voice_channel(
    app: axum::Router,
    token: &str,
    server_id: &str,
    name: &str,
) -> serde_json::Value {
    let uri = format!("/servers/{server_id}/channels");
    let (status, body) =
        common::post_json_authed(app, &uri, token, json!({ "name": name, "type": "voice" })).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup create_voice_channel failed: {body}"
    );
    body
}

/// Join a voice channel via POST /channels/:channel_id/voice.
async fn join_voice(app: axum::Router, token: &str, channel_id: &str) {
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/voice"),
        token,
        json!({}),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "setup join_voice failed ({status}): {body}"
    );
}

struct GoLiveFixture {
    owner_token: String,
    member_token: String,
    #[allow(dead_code)]
    server_id: String,
    voice_channel_id: String,
    text_channel_id: String,
}

async fn setup(app: axum::Router) -> GoLiveFixture {
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "GoLive Guild").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

    let vc = create_voice_channel(app.clone(), &owner_token, &server_id, "Stream Room").await;
    let voice_channel_id = vc["id"].as_str().unwrap().to_owned();

    let text = common::create_channel(app.clone(), &owner_token, &server_id, "general").await;
    let text_channel_id = text["id"].as_str().unwrap().to_owned();

    // Create a member who joins the server.
    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
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
        "join failed: {status}"
    );

    GoLiveFixture {
        owner_token,
        member_token,
        server_id,
        voice_channel_id,
        text_channel_id,
    }
}

// ============================================================================
// GET /channels/:channel_id/go-live — no active session → 404
// ============================================================================

#[tokio::test]
async fn get_go_live_no_session() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::get_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// POST /channels/:channel_id/go-live — must be in voice channel
// ============================================================================

#[tokio::test]
async fn start_go_live_not_in_voice() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "expected 400: {body}");
}

// ============================================================================
// POST /channels/:channel_id/go-live — text channel rejected
// ============================================================================

#[tokio::test]
async fn start_go_live_text_channel_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{}/go-live", f.text_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// POST /channels/:channel_id/go-live — success flow
// ============================================================================

#[tokio::test]
async fn start_and_get_go_live() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Join voice channel first.
    join_voice(app.clone(), &f.owner_token, &f.voice_channel_id).await;

    // Start go-live.
    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({ "quality": "1080p" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "start go-live failed: {body}");
    assert_eq!(body["quality"], "1080p");

    // GET should return the active session.
    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["quality"], "1080p");
}

// ============================================================================
// POST — default quality is 720p
// ============================================================================

#[tokio::test]
async fn start_go_live_default_quality() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    join_voice(app.clone(), &f.owner_token, &f.voice_channel_id).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "start go-live failed: {body}");
    assert_eq!(body["quality"], "720p");
}

// ============================================================================
// POST — invalid quality rejected
// ============================================================================

#[tokio::test]
async fn start_go_live_invalid_quality() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    join_voice(app.clone(), &f.owner_token, &f.voice_channel_id).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({ "quality": "4k" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// One broadcaster enforcement — second user rejected
// ============================================================================

#[tokio::test]
async fn one_broadcaster_enforcement() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Owner joins voice and starts go-live.
    join_voice(app.clone(), &f.owner_token, &f.voice_channel_id).await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Member joins voice and tries to go live — should be rejected.
    join_voice(app.clone(), &f.member_token, &f.voice_channel_id).await;
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.member_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// DELETE /channels/:channel_id/go-live — stop session
// ============================================================================

#[tokio::test]
async fn stop_go_live_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    join_voice(app.clone(), &f.owner_token, &f.voice_channel_id).await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Stop go-live.
    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);

    // GET should return 404 now.
    let (status, _) = common::get_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE — no active session → 404
// ============================================================================

#[tokio::test]
async fn stop_go_live_no_session() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE — non-broadcaster cannot stop
// ============================================================================

#[tokio::test]
async fn non_broadcaster_cannot_stop() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    join_voice(app.clone(), &f.owner_token, &f.voice_channel_id).await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Member tries to stop — should be rejected.
    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &f.member_token,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// Non-member cannot access go-live
// ============================================================================

#[tokio::test]
async fn non_member_cannot_get_go_live() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(
        app,
        &format!("/channels/{}/go-live", f.voice_channel_id),
        &outsider,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

mod common;

use axum::http::StatusCode;
use serde_json::json;
use uuid::Uuid;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Create a voice channel in a server and return the full response body.
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

/// Full fixture: owner, member, outsider; server with vc1, vc2 (voice) and a text channel.
struct Fixture {
    owner_token: String,
    member_token: String,
    outsider_token: String,
    #[allow(dead_code)]
    server_id: String,
    vc1_id: String,
    vc2_id: String,
    text_channel_id: String,
}

async fn setup(app: axum::Router) -> Fixture {
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Voice Guild").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

    let vc1 = create_voice_channel(app.clone(), &owner_token, &server_id, "General Voice").await;
    let vc1_id = vc1["id"].as_str().unwrap().to_owned();

    let vc2 = create_voice_channel(app.clone(), &owner_token, &server_id, "Gaming Voice").await;
    let vc2_id = vc2["id"].as_str().unwrap().to_owned();

    let text = common::create_channel(app.clone(), &owner_token, &server_id, "general").await;
    let text_channel_id = text["id"].as_str().unwrap().to_owned();

    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    Fixture {
        owner_token,
        member_token,
        outsider_token,
        server_id,
        vc1_id,
        vc2_id,
        text_channel_id,
    }
}

// ============================================================================
// POST /channels/:channel_id/voice — join
// ============================================================================

#[tokio::test]
async fn join_voice_channel_returns_201() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["channel_id"], f.vc1_id);
    assert!(!body["self_mute"].as_bool().unwrap());
    assert!(!body["self_deaf"].as_bool().unwrap());
    assert!(!body["server_mute"].as_bool().unwrap());
    assert!(!body["server_deaf"].as_bool().unwrap());
    assert!(body["joined_at"].is_string());
    assert!(body["user_id"].is_string());
}

#[tokio::test]
async fn join_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) =
        common::post_json(app, &format!("/channels/{}/voice", f.vc1_id), json!({})).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn join_requires_server_membership() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.outsider_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn join_text_channel_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{}/voice", f.text_channel_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn join_nonexistent_channel_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let fake_id = Uuid::new_v4();
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{fake_id}/voice"),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn joining_second_channel_auto_leaves_first() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Join vc1
    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["channel_id"], f.vc1_id);

    // Join vc2 — should atomically move the user
    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc2_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["channel_id"], f.vc2_id);

    // vc1 should now be empty
    let (status, list) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 0);
}

// ============================================================================
// DELETE /channels/:channel_id/voice — leave
// ============================================================================

#[tokio::test]
async fn leave_voice_channel_returns_204() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Join first
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn leave_when_not_in_any_channel_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn leave_wrong_channel_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Join vc1
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    // Try to leave vc2 — should be 404 (user is in vc1, not vc2)
    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{}/voice", f.vc2_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// PATCH /channels/:channel_id/voice — update state
// ============================================================================

#[tokio::test]
async fn update_self_mute_returns_200() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_mute": true }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["self_mute"].as_bool().unwrap());
    assert!(!body["self_deaf"].as_bool().unwrap());
}

#[tokio::test]
async fn update_self_deaf_returns_200() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_deaf": true }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["self_deaf"].as_bool().unwrap());
    assert!(!body["self_mute"].as_bool().unwrap());
}

#[tokio::test]
async fn update_when_not_in_channel_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_mute": true }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn update_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::patch_no_auth(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        json!({ "self_mute": true }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// GET /channels/:channel_id/voice — list participants
// ============================================================================

#[tokio::test]
async fn list_voice_participants_empty() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_voice_participants_returns_joined_users() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Owner and member both join vc1
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.member_token,
        json!({}),
    )
    .await;

    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2);
    // All entries reference vc1
    for entry in body.as_array().unwrap() {
        assert_eq!(entry["channel_id"], f.vc1_id);
    }
}

#[tokio::test]
async fn list_voice_requires_membership() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.outsider_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

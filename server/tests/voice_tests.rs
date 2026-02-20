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
// POST /channels/:channel_id/voice — additional join tests
// ============================================================================

/// Re-joining the same channel is valid: the UPSERT resets self_mute/self_deaf
/// to false and refreshes joined_at, but must not increase the participant count.
#[tokio::test]
async fn rejoin_same_channel_resets_self_mute() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Join and mute self.
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    common::patch_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_mute": true }),
    )
    .await;

    // Re-join the same channel — UPSERT must reset self_mute to false.
    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(
        !body["self_mute"].as_bool().unwrap(),
        "self_mute should be reset to false on rejoin"
    );

    // Participant count must remain 1 — no duplicate row.
    let (_, list) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;
    assert_eq!(
        list.as_array().unwrap().len(),
        1,
        "rejoining must not create a duplicate participant entry"
    );
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
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify the user is actually gone from the participant list.
    let (list_status, list_body) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;
    assert_eq!(list_status, StatusCode::OK);
    assert_eq!(
        list_body.as_array().unwrap().len(),
        0,
        "participant should be removed from the list after leaving"
    );
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
// PATCH /channels/:channel_id/voice — additional update tests
// ============================================================================

#[tokio::test]
async fn update_with_no_fields_returns_400() {
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

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_preserves_existing_state_when_field_omitted() {
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

    // Set both flags.
    common::patch_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_mute": true, "self_deaf": true }),
    )
    .await;

    // Patch only self_mute — self_deaf must be preserved.
    let (status, body) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "self_mute": false }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(!body["self_mute"].as_bool().unwrap());
    assert!(
        body["self_deaf"].as_bool().unwrap(),
        "self_deaf should be preserved"
    );
}

#[tokio::test]
async fn update_wrong_channel_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // User is in vc1 but tries to PATCH vc2.
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc2_id),
        &f.owner_token,
        json!({ "self_mute": true }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE /channels/:channel_id/voice — additional leave tests
// ============================================================================

#[tokio::test]
async fn leave_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::delete_no_auth(app, &format!("/channels/{}/voice", f.vc1_id)).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn leave_requires_server_membership() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.outsider_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /channels/:channel_id/voice — list participants
// ============================================================================

#[tokio::test]
async fn list_voice_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::get_no_auth(app, &format!("/channels/{}/voice", f.vc1_id)).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

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

// ============================================================================
// GET /channels/:channel_id/voice — additional list tests
// ============================================================================

/// The list must include `username` so clients can display participant names
/// without a separate lookup — matching the VOICE_STATE_UPDATE broadcast shape.
#[tokio::test]
async fn list_voice_participants_includes_username() {
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

    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let participants = body.as_array().unwrap();
    assert_eq!(participants.len(), 1);
    assert!(
        participants[0]["username"].is_string(),
        "each participant entry must include a username string"
    );
}

/// Users in vc2 must not appear in vc1's participant list.
#[tokio::test]
async fn list_voice_excludes_users_in_other_channels() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    // Owner joins vc1, member joins vc2.
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({}),
    )
    .await;
    common::post_json_authed(
        app.clone(),
        &format!("/channels/{}/voice", f.vc2_id),
        &f.member_token,
        json!({}),
    )
    .await;

    // vc1 list must contain only the owner.
    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    let participants = body.as_array().unwrap();
    assert_eq!(
        participants.len(),
        1,
        "vc1 list must not include the member who joined vc2"
    );
    assert_eq!(
        participants[0]["channel_id"], f.vc1_id,
        "the single participant must be in vc1"
    );
}

// ============================================================================
// PATCH /channels/:channel_id/voice — additional update tests
// ============================================================================

/// `server_mute` and `server_deaf` are excluded from the request type.
/// Sending them must return an error — not silently ignore them.
#[tokio::test]
async fn update_rejects_unknown_fields() {
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

    // Attempting to set server_mute (a privileged field) must be rejected.
    let (status, _) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.owner_token,
        json!({ "server_mute": false }),
    )
    .await;

    assert!(
        status.is_client_error(),
        "PATCH with unknown/privileged field must return a client error, got {status}"
    );
}

#[tokio::test]
async fn update_requires_server_membership() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let f = setup(app.clone()).await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc1_id),
        &f.outsider_token,
        json!({ "self_mute": true }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// `server_mute`/`server_deaf` are preserved when a user switches channels.
///
/// This is a security-relevant invariant: a muted user must not be able to
/// bypass a moderator restriction by simply joining a different voice channel.
/// The UPSERT in `join_voice_channel` intentionally omits these fields from
/// its SET clause; this test guards against future regressions.
#[tokio::test]
async fn server_mute_preserved_across_channel_switch() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let f = setup(app.clone()).await;

    // Resolve the owner's user_id via the /users/@me endpoint.
    let (_, me) = common::get_authed(app.clone(), "/users/@me", &f.owner_token).await;
    let owner_id = Uuid::parse_str(me["id"].as_str().unwrap()).unwrap();
    let vc1_id = Uuid::parse_str(&f.vc1_id).unwrap();

    // Seed a voice_states row with server_mute = TRUE directly in the DB,
    // simulating a moderator action (no REST endpoint exposes this field).
    sqlx::query(
        "INSERT INTO voice_states (user_id, channel_id, server_mute)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (user_id) DO UPDATE
             SET channel_id   = EXCLUDED.channel_id,
                 server_mute  = TRUE",
    )
    .bind(owner_id)
    .bind(vc1_id)
    .execute(&pool)
    .await
    .expect("failed to seed voice state with server_mute=true");

    // Switch to vc2 via REST — server_mute must survive the channel switch.
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{}/voice", f.vc2_id),
        &f.owner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(
        body["server_mute"].as_bool().unwrap(),
        "server_mute must be preserved when switching voice channels"
    );
}

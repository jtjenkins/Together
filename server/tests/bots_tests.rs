mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Create a bot and return `(bot_id, bot_token)`.
async fn create_bot(app: axum::Router, token: &str, name: &str) -> (String, String) {
    let (status, body) =
        common::post_json_authed(app, "/bots", token, json!({ "name": name })).await;
    assert_eq!(status, StatusCode::CREATED, "create_bot failed: {body}");
    let bot_id = body["bot"]["id"].as_str().unwrap().to_owned();
    let bot_token = body["token"].as_str().unwrap().to_owned();
    (bot_id, bot_token)
}

// ============================================================================
// POST /bots — create bot
// ============================================================================

#[tokio::test]
async fn create_bot_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) = common::post_json_authed(
        app,
        "/bots",
        &token,
        json!({ "name": "TestBot", "description": "A test bot" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "create failed: {body}");
    assert_eq!(body["bot"]["name"], "TestBot");
    assert!(body["token"].is_string(), "token should be returned");
    assert!(body["bot"]["id"].is_string());
}

#[tokio::test]
async fn create_bot_empty_name_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::post_json_authed(app, "/bots", &token, json!({ "name": "   " })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_bot_name_too_long_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let long_name = "x".repeat(65);
    let (status, _) =
        common::post_json_authed(app, "/bots", &token, json!({ "name": long_name })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_bot_all_special_chars_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::post_json_authed(app, "/bots", &token, json!({ "name": "!!!" })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_bot_description_too_long_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let long_desc = "x".repeat(513);
    let (status, _) = common::post_json_authed(
        app,
        "/bots",
        &token,
        json!({ "name": "Bot", "description": long_desc }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_bot_no_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::post_json(app, "/bots", json!({ "name": "NoBearerBot" })).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// GET /bots — list bots
// ============================================================================

#[tokio::test]
async fn list_bots_empty() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) = common::get_authed(app, "/bots", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bots"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_bots_returns_created() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    create_bot(app.clone(), &token, "Bot1").await;
    create_bot(app.clone(), &token, "Bot2").await;

    let (status, body) = common::get_authed(app, "/bots", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["bots"].as_array().unwrap().len(), 2);
}

// ============================================================================
// GET /bots/:id — get single bot
// ============================================================================

#[tokio::test]
async fn get_bot_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "GetMe").await;

    let (status, body) = common::get_authed(app, &format!("/bots/{bot_id}"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "GetMe");
}

#[tokio::test]
async fn get_bot_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::get_authed(app, &format!("/bots/{fake_id}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_bot_other_users_bot_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let user1 =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let user2 =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &user1, "PrivateBot").await;

    // user2 should not see user1's bot.
    let (status, _) = common::get_authed(app, &format!("/bots/{bot_id}"), &user2).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// PATCH /bots/:id — update bot
// ============================================================================

#[tokio::test]
async fn update_bot_name() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "OldName").await;

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/bots/{bot_id}"),
        &token,
        json!({ "name": "NewName" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "NewName");
}

#[tokio::test]
async fn update_bot_description() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "DescBot").await;

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/bots/{bot_id}"),
        &token,
        json!({ "description": "Updated description" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["description"], "Updated description");
}

#[tokio::test]
async fn update_bot_invalid_name_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "ValidBot").await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/bots/{bot_id}"),
        &token,
        json!({ "name": "" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_bot_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::patch_json_authed(
        app,
        &format!("/bots/{fake_id}"),
        &token,
        json!({ "name": "x" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE /bots/:id — revoke bot
// ============================================================================

#[tokio::test]
async fn revoke_bot_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "RevokeMe").await;

    let (status, _) = common::delete_authed(app.clone(), &format!("/bots/{bot_id}"), &token).await;

    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify the bot is revoked (GET still works but revoked_at is set).
    let (status, body) = common::get_authed(app, &format!("/bots/{bot_id}"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !body["revoked_at"].is_null(),
        "revoked_at should be set after revocation"
    );
}

#[tokio::test]
async fn revoke_bot_already_revoked() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "DoubleRevoke").await;

    // First revoke.
    let (status, _) = common::delete_authed(app.clone(), &format!("/bots/{bot_id}"), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Second revoke — should fail.
    let (status, _) = common::delete_authed(app, &format!("/bots/{bot_id}"), &token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn revoke_bot_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::delete_authed(app, &format!("/bots/{fake_id}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// POST /bots/:id/token/regenerate — regenerate bot token
// ============================================================================

#[tokio::test]
async fn regenerate_bot_token_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, old_token) = create_bot(app.clone(), &token, "RegenBot").await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/bots/{bot_id}/token/regenerate"),
        &token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "regenerate failed: {body}");
    let new_token = body["token"].as_str().unwrap();
    assert_ne!(new_token, old_token, "regenerated token should differ");
    assert_eq!(body["bot"]["name"], "RegenBot");
}

#[tokio::test]
async fn regenerate_token_revoked_bot_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "RevokedRegenBot").await;

    // Revoke first.
    common::delete_authed(app.clone(), &format!("/bots/{bot_id}"), &token).await;

    // Try to regenerate.
    let (status, _) = common::post_json_authed(
        app,
        &format!("/bots/{bot_id}/token/regenerate"),
        &token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn regenerate_token_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::post_json_authed(
        app,
        &format!("/bots/{fake_id}/token/regenerate"),
        &token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /bots/:id/logs — bot activity logs
// ============================================================================

#[tokio::test]
async fn bot_logs_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "LogBot").await;

    let (status, body) = common::get_authed(app, &format!("/bots/{bot_id}/logs"), &token).await;

    assert_eq!(status, StatusCode::OK);
    let logs = body["logs"].as_array().unwrap();
    // At minimum should contain the bot_created event.
    assert!(
        logs.iter().any(|e| e["event"] == "bot_created"),
        "logs should include bot_created event"
    );
}

#[tokio::test]
async fn bot_logs_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::get_authed(app, &format!("/bots/{fake_id}/logs"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bot_logs_revoked_includes_revocation() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "RevLogBot").await;

    // Revoke the bot.
    common::delete_authed(app.clone(), &format!("/bots/{bot_id}"), &token).await;

    let (status, body) = common::get_authed(app, &format!("/bots/{bot_id}/logs"), &token).await;

    assert_eq!(status, StatusCode::OK);
    let logs = body["logs"].as_array().unwrap();
    assert!(
        logs.iter().any(|e| e["event"] == "bot_revoked"),
        "logs should include bot_revoked event after revocation"
    );
}

// ============================================================================
// Update revoked bot — rejected
// ============================================================================

#[tokio::test]
async fn update_revoked_bot_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (bot_id, _) = create_bot(app.clone(), &token, "RevokedUpdateBot").await;

    // Revoke.
    common::delete_authed(app.clone(), &format!("/bots/{bot_id}"), &token).await;

    // Try to update — should be rejected.
    let (status, _) = common::patch_json_authed(
        app,
        &format!("/bots/{bot_id}"),
        &token,
        json!({ "name": "Updated" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

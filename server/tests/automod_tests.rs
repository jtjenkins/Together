mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// GET /servers/:id/automod
// ============================================================================

#[tokio::test]
async fn get_automod_config_not_found_when_unconfigured() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_automod_config_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let other_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &other_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// PATCH /servers/:id/automod
// ============================================================================

#[tokio::test]
async fn patch_automod_config_creates_and_returns_config() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "enabled": true, "spam_enabled": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], true);
    assert_eq!(body["spam_enabled"], true);
}

#[tokio::test]
async fn patch_automod_config_is_idempotent() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    // First patch
    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "enabled": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Second patch — updates spam_enabled while preserving enabled
    let (status, body) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "spam_enabled": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], true);
    assert_eq!(body["spam_enabled"], true);
}

#[tokio::test]
async fn patch_automod_config_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let other_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &other_token,
        json!({ "enabled": true }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn patch_automod_config_invalid_action_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "spam_action": "explode" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// GET/POST/DELETE /servers/:id/automod/words
// ============================================================================

#[tokio::test]
async fn list_word_filters_empty_initially() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn add_word_filter_and_list() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "badword" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["word"], "badword");

    let (status, body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["word"], "badword");
}

#[tokio::test]
async fn add_word_filter_normalizes_to_lowercase() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "BadWord" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["word"], "badword");
}

#[tokio::test]
async fn add_empty_word_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "   " }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn remove_word_filter_returns_204() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    // Add it first
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "badword" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Delete it
    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words/badword"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify it's gone
    let (status, body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}

// ============================================================================
// GET /servers/:id/automod/logs
// ============================================================================

#[tokio::test]
async fn list_automod_logs_empty_initially() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/logs"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_automod_logs_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let other_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/logs"),
        &other_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// GET /servers/:id/bans
// ============================================================================

#[tokio::test]
async fn list_bans_empty_initially() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, body) =
        common::get_authed(app.clone(), &format!("/servers/{server_id}/bans"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_bans_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let other_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/bans"),
        &other_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// DELETE /servers/:id/bans/:user_id
// ============================================================================

#[tokio::test]
async fn remove_ban_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let other_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();
    let fake_user_id = uuid::Uuid::new_v4();

    let (status, _body) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/bans/{fake_user_id}"),
        &other_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn remove_ban_owner_no_content_even_if_not_banned() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test Server").await;
    let server_id = server["id"].as_str().unwrap();
    let fake_user_id = uuid::Uuid::new_v4();

    // Deleting a non-existent ban should silently succeed
    let (status, _body) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/bans/{fake_user_id}"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

// ============================================================================
// Enforcement: check_automod wired into create_message
// ============================================================================

#[tokio::test]
async fn word_filter_blocks_message_with_banned_word() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = common::create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    // Enable automod + word filter
    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "enabled": true, "word_filter_enabled": true, "word_filter_action": "delete" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Add banned word
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "badword" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Try to send message with banned word
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "this is a badword message" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn word_filter_allows_clean_message() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = common::create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "enabled": true, "word_filter_enabled": true, "word_filter_action": "delete" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "badword" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "this is a clean message" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn duplicate_detection_blocks_repeat_message() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = common::create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "enabled": true, "duplicate_enabled": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // First message allowed
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "hello world" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Same message immediately blocked
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "hello world" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn timeout_blocks_further_messages() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = common::create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({
            "enabled": true,
            "word_filter_enabled": true,
            "word_filter_action": "timeout",
            "timeout_minutes": 60
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "triggerword" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // First message with banned word → gets timed out AND blocked
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "this is a triggerword" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Clean message is also blocked because of active timeout
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "clean message" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn automod_disabled_allows_all_messages() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Test").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = common::create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    // Configure everything enabled but master switch off
    let (status, _) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod"),
        &token,
        json!({ "enabled": false, "word_filter_enabled": true, "word_filter_action": "ban" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/automod/words"),
        &token,
        json!({ "word": "badword" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &token,
        json!({ "content": "this is a badword message" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

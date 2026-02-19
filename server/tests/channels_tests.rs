mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// POST /servers/:id/channels — create channel
// ============================================================================

#[tokio::test]
async fn create_channel_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &token,
        json!({ "name": "general", "type": "text" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["name"], "general");
    assert_eq!(body["type"], "text");
    assert_eq!(body["server_id"], sid);
    assert_eq!(body["position"], 0, "first channel should get position 0");
}

#[tokio::test]
async fn create_channel_voice_type() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Voice Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &token,
        json!({ "name": "General Voice", "type": "voice" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["type"], "voice");
}

#[tokio::test]
async fn create_channel_with_topic_and_category() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Rich Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &token,
        json!({
            "name": "announcements",
            "type": "text",
            "topic": "Server news",
            "category": "INFO"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["topic"], "Server news");
    assert_eq!(body["category"], "INFO");
}

#[tokio::test]
async fn create_channel_positions_increment() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Multi Channel Guild").await;
    let sid = server["id"].as_str().unwrap();

    let ch1 = common::create_channel(app.clone(), &token, sid, "first").await;
    let ch2 = common::create_channel(app.clone(), &token, sid, "second").await;

    assert_eq!(ch1["position"], 0);
    assert_eq!(ch2["position"], 1);
}

#[tokio::test]
async fn create_channel_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Auth Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, _) = common::post_json(
        app,
        &format!("/servers/{sid}/channels"),
        json!({ "name": "general", "type": "text" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_channel_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Owner Guild").await;
    let sid = server["id"].as_str().unwrap();

    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &member_token,
        json!({ "name": "hijack", "type": "text" }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn create_channel_invalid_type() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Type Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &token,
        json!({ "name": "bad", "type": "invalid" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn create_channel_rejects_empty_name() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Validation Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &token,
        json!({ "name": "", "type": "text" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_channel_on_unknown_server_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        "/servers/00000000-0000-0000-0000-000000000000/channels",
        &token,
        json!({ "name": "general", "type": "text" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /servers/:id/channels — list channels
// ============================================================================

#[tokio::test]
async fn list_channels_empty_on_new_server() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Empty Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, body) = common::get_authed(app, &format!("/servers/{sid}/channels"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!([]), "new server should have no channels");
}

#[tokio::test]
async fn list_channels_includes_created_channels() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "List Guild").await;
    let sid = server["id"].as_str().unwrap();

    common::create_channel(app.clone(), &token, sid, "general").await;
    common::create_channel(app.clone(), &token, sid, "announcements").await;

    let (status, body) = common::get_authed(app, &format!("/servers/{sid}/channels"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2);
    // Channels should be ordered by position ASC.
    assert_eq!(body[0]["name"], "general");
    assert_eq!(body[1]["name"], "announcements");
}

#[tokio::test]
async fn list_channels_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Auth List Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, _) = common::get_no_auth(app, &format!("/servers/{sid}/channels")).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_channels_non_member_sees_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Private Guild").await;
    let sid = server["id"].as_str().unwrap();

    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, _) =
        common::get_authed(app, &format!("/servers/{sid}/channels"), &outsider_token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// GET /servers/:id/channels/:channel_id — get channel
// ============================================================================

#[tokio::test]
async fn get_channel_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Get Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &token, sid, "general").await;
    let cid = ch["id"].as_str().unwrap();

    let (status, body) =
        common::get_authed(app, &format!("/servers/{sid}/channels/{cid}"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], cid);
    assert_eq!(body["name"], "general");
}

#[tokio::test]
async fn get_channel_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "NF Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, _) = common::get_authed(
        app,
        &format!("/servers/{sid}/channels/00000000-0000-0000-0000-000000000000"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// PATCH /servers/:id/channels/:channel_id — update channel
// ============================================================================

#[tokio::test]
async fn update_channel_name_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Update Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &token, sid, "old-name").await;
    let cid = ch["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/channels/{cid}"),
        &token,
        json!({ "name": "new-name" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "new-name");
    // Type and position should be unchanged.
    assert_eq!(body["type"], "text");
    assert_eq!(body["position"], 0);
}

#[tokio::test]
async fn update_channel_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Perm Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &owner_token, sid, "channel").await;
    let cid = ch["id"].as_str().unwrap();

    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/channels/{cid}"),
        &member_token,
        json!({ "name": "hijacked" }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// DELETE /servers/:id/channels/:channel_id — delete channel
// ============================================================================

#[tokio::test]
async fn delete_channel_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Delete Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &token, sid, "doomed").await;
    let cid = ch["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{sid}/channels/{cid}"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Confirm it's gone.
    let (status, _) =
        common::get_authed(app, &format!("/servers/{sid}/channels/{cid}"), &token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_channel_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Del Perm Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &owner_token, sid, "protected").await;
    let cid = ch["id"].as_str().unwrap();

    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{sid}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{sid}/channels/{cid}"),
        &member_token,
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn delete_channel_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Del NF Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{sid}/channels/00000000-0000-0000-0000-000000000000"),
        &token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

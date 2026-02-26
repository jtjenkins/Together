mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

/// Register a user and have them join a server, returning their token.
async fn register_and_join(
    app: axum::Router,
    owner_token: &str,
    server_id: &str,
    password: &str,
) -> String {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), password).await;
    common::make_server_public(app.clone(), owner_token, server_id).await;
    common::post_json_authed(
        app,
        &format!("/servers/{server_id}/join"),
        &token,
        json!({}),
    )
    .await;
    token
}

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
    common::make_server_public(app.clone(), &owner_token, sid).await;
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

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{sid}/channels"),
        &token,
        json!({ "name": "bad", "type": "invalid" }),
    )
    .await;

    // ChannelType deserialization failure → axum JsonRejection → 422
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
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
    common::make_server_public(app.clone(), &owner_token, sid).await;
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
    common::make_server_public(app.clone(), &owner_token, sid).await;
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

// ============================================================================
// Auth guard tests — PATCH and DELETE require authentication
// ============================================================================

#[tokio::test]
async fn update_channel_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Auth PATCH Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &token, sid, "channel").await;
    let cid = ch["id"].as_str().unwrap();

    let req = axum::http::Request::builder()
        .method(axum::http::Method::PATCH)
        .uri(format!("/servers/{sid}/channels/{cid}"))
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(json!({ "name": "x" }).to_string()))
        .unwrap();
    let response = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn delete_channel_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Auth DELETE Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &token, sid, "channel").await;
    let cid = ch["id"].as_str().unwrap();

    let req = axum::http::Request::builder()
        .method(axum::http::Method::DELETE)
        .uri(format!("/servers/{sid}/channels/{cid}"))
        .body(axum::body::Body::empty())
        .unwrap();
    let response = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

// ============================================================================
// Member read access — non-owners can still GET channels they belong to
// ============================================================================

#[tokio::test]
async fn get_channel_member_can_read() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Member Read Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &owner_token, sid, "general").await;
    let cid = ch["id"].as_str().unwrap();

    let member_token = register_and_join(app.clone(), &owner_token, sid, "pass1234").await;

    let (status, body) = common::get_authed(
        app,
        &format!("/servers/{sid}/channels/{cid}"),
        &member_token,
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], cid);
}

#[tokio::test]
async fn get_channel_non_member_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Non-Member Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &owner_token, sid, "secret").await;
    let cid = ch["id"].as_str().unwrap();

    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(
        app,
        &format!("/servers/{sid}/channels/{cid}"),
        &outsider_token,
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn list_channels_member_can_list() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Member List Guild").await;
    let sid = server["id"].as_str().unwrap();
    common::create_channel(app.clone(), &owner_token, sid, "general").await;

    let member_token = register_and_join(app.clone(), &owner_token, sid, "pass1234").await;

    let (status, body) =
        common::get_authed(app, &format!("/servers/{sid}/channels"), &member_token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
}

// ============================================================================
// PATCH validation — empty name and non-existent channel
// ============================================================================

#[tokio::test]
async fn update_channel_empty_name_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Validation PATCH Guild").await;
    let sid = server["id"].as_str().unwrap();
    let ch = common::create_channel(app.clone(), &token, sid, "channel").await;
    let cid = ch["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/channels/{cid}"),
        &token,
        json!({ "name": "" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn update_channel_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "NF PATCH Guild").await;
    let sid = server["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{sid}/channels/00000000-0000-0000-0000-000000000000"),
        &token,
        json!({ "name": "new" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// Cross-server isolation — channels must not be reachable via another server's ID
// ============================================================================

#[tokio::test]
async fn get_channel_cross_server_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server_a = common::create_server(app.clone(), &token, "Server A").await;
    let sid_a = server_a["id"].as_str().unwrap();
    let server_b = common::create_server(app.clone(), &token, "Server B").await;
    let sid_b = server_b["id"].as_str().unwrap();

    // Channel belongs to server B.
    let ch = common::create_channel(app.clone(), &token, sid_b, "channel-b").await;
    let cid = ch["id"].as_str().unwrap();

    // Try to access it through server A's route.
    let (status, _) =
        common::get_authed(app, &format!("/servers/{sid_a}/channels/{cid}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn update_channel_cross_server_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server_a = common::create_server(app.clone(), &token, "XS Update A").await;
    let sid_a = server_a["id"].as_str().unwrap();
    let server_b = common::create_server(app.clone(), &token, "XS Update B").await;
    let sid_b = server_b["id"].as_str().unwrap();

    let ch = common::create_channel(app.clone(), &token, sid_b, "channel-b").await;
    let cid = ch["id"].as_str().unwrap();

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{sid_a}/channels/{cid}"),
        &token,
        json!({ "name": "sneaky" }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_channel_cross_server_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server_a = common::create_server(app.clone(), &token, "XS Delete A").await;
    let sid_a = server_a["id"].as_str().unwrap();
    let server_b = common::create_server(app.clone(), &token, "XS Delete B").await;
    let sid_b = server_b["id"].as_str().unwrap();

    let ch = common::create_channel(app.clone(), &token, sid_b, "channel-b").await;
    let cid = ch["id"].as_str().unwrap();

    let (status, _) =
        common::delete_authed(app, &format!("/servers/{sid_a}/channels/{cid}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

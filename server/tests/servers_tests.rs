mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// POST /servers — create server
// ============================================================================

#[tokio::test]
async fn create_server_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) =
        common::post_json_authed(app, "/servers", &token, json!({ "name": "My Guild" })).await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["name"], "My Guild");
    assert!(body["id"].is_string());
    assert!(body["owner_id"].is_string());
    assert_eq!(body["member_count"], 1, "creator should be auto-joined");
}

#[tokio::test]
async fn create_server_with_icon() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) = common::post_json_authed(
        app,
        "/servers",
        &token,
        json!({ "name": "Fancy Server", "icon_url": "https://example.com/icon.png" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["icon_url"], "https://example.com/icon.png");
}

#[tokio::test]
async fn create_server_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::post_json(app, "/servers", json!({ "name": "No Auth" })).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn create_server_rejects_empty_name() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) =
        common::post_json_authed(app, "/servers", &token, json!({ "name": "" })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
}

#[tokio::test]
async fn create_server_rejects_name_too_long() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let long_name = "a".repeat(101);
    let (status, _) =
        common::post_json_authed(app, "/servers", &token, json!({ "name": long_name })).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// GET /servers — list servers
// ============================================================================

#[tokio::test]
async fn list_servers_returns_empty_before_joining() {
    // Create a brand-new user who hasn't joined anything yet, then register
    // — registration does NOT auto-join any server.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) = common::get_authed(app, "/servers", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!([]), "new user should have no servers");
}

#[tokio::test]
async fn list_servers_includes_created_server() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    common::create_server(app.clone(), &token, "Test Guild").await;

    let (status, body) = common::get_authed(app, "/servers", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["name"], "Test Guild");
}

#[tokio::test]
async fn list_servers_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(app, "/servers").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// GET /servers/:id — get server
// ============================================================================

#[tokio::test]
async fn get_server_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Guild Alpha").await;
    let id = server["id"].as_str().unwrap();

    let (status, body) = common::get_authed(app, &format!("/servers/{id}"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], id);
    assert_eq!(body["name"], "Guild Alpha");
}

#[tokio::test]
async fn get_server_not_found() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::get_authed(app, "/servers/00000000-0000-0000-0000-000000000000", &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_server_non_member_sees_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    // Owner creates server.
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Private Guild").await;
    let id = server["id"].as_str().unwrap();

    // Outsider cannot see it.
    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, _) = common::get_authed(app, &format!("/servers/{id}"), &outsider_token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// PATCH /servers/:id — update server
// ============================================================================

#[tokio::test]
async fn update_server_name_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Old Name").await;
    let id = server["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/servers/{id}"),
        &token,
        json!({ "name": "New Name" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "New Name");
}

#[tokio::test]
async fn update_server_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Owner's Guild").await;
    let id = server["id"].as_str().unwrap();

    // Member joins.
    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{id}"),
        &member_token,
        json!({ "name": "Hijacked" }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// DELETE /servers/:id — delete server
// ============================================================================

#[tokio::test]
async fn delete_server_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Doomed Guild").await;
    let id = server["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(app.clone(), &format!("/servers/{id}"), &token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Confirm it's gone.
    let (status, _) = common::get_authed(app, &format!("/servers/{id}"), &token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_server_non_owner_forbidden() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Protected Guild").await;
    let id = server["id"].as_str().unwrap();

    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let (status, _) = common::delete_authed(app, &format!("/servers/{id}"), &member_token).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// POST /servers/:id/join — join server
// ============================================================================

#[tokio::test]
async fn join_server_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Open Guild").await;
    let id = server["id"].as_str().unwrap();

    let joiner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);

    // Joiner should now see the server in their list.
    let (status, body) = common::get_authed(app, "/servers", &joiner_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn join_server_twice_returns_conflict() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Once Guild").await;
    let id = server["id"].as_str().unwrap();

    let joiner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn join_nonexistent_server_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        "/servers/00000000-0000-0000-0000-000000000000/join",
        &token,
        json!({}),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ============================================================================
// DELETE /servers/:id/leave — leave server
// ============================================================================

#[tokio::test]
async fn leave_server_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Leavable Guild").await;
    let id = server["id"].as_str().unwrap();

    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let (status, _) =
        common::delete_authed(app.clone(), &format!("/servers/{id}/leave"), &member_token).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Member should no longer see the server.
    let (_, body) = common::get_authed(app, "/servers", &member_token).await;
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn owner_cannot_leave_server() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Sticky Guild").await;
    let id = server["id"].as_str().unwrap();

    let (status, body) = common::delete_authed(app, &format!("/servers/{id}/leave"), &token).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap().contains("owner"));
}

// ============================================================================
// GET /servers/browse — discover public servers
// ============================================================================

#[tokio::test]
async fn browse_servers_returns_only_public() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    // Create a public server.
    let public_server =
        common::create_server(app.clone(), &owner_token, "Public Browse Guild").await;
    let public_id = public_server["id"].as_str().unwrap();

    // Create a private server (default is_public = false).
    let private_server =
        common::create_server(app.clone(), &owner_token, "Private Browse Guild").await;
    let private_id = private_server["id"].as_str().unwrap();

    // Make only the first one public.
    common::patch_json_authed(
        app.clone(),
        &format!("/servers/{public_id}"),
        &owner_token,
        json!({ "is_public": true }),
    )
    .await;

    // Browse as a different user.
    let viewer_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, body) = common::get_authed(app, "/servers/browse", &viewer_token).await;

    assert_eq!(status, StatusCode::OK);
    let list = body.as_array().unwrap();
    // Public server appears in results.
    assert!(list.iter().any(|s| s["id"] == public_id));
    // Private server does not appear.
    assert!(!list.iter().any(|s| s["id"] == private_id));
}

#[tokio::test]
async fn browse_servers_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(app, "/servers/browse").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn make_server_public_via_update() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Soon Public Guild").await;
    let id = server["id"].as_str().unwrap();

    // Initially not in browse results.
    let (_, body) = common::get_authed(app.clone(), "/servers/browse", &token).await;
    assert!(!body.as_array().unwrap().iter().any(|s| s["id"] == id));

    // Make it public via PATCH.
    let (status, body) = common::patch_json_authed(
        app.clone(),
        &format!("/servers/{id}"),
        &token,
        json!({ "is_public": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["is_public"], true);

    // Now appears in browse.
    let (_, body) = common::get_authed(app, "/servers/browse", &token).await;
    assert!(body.as_array().unwrap().iter().any(|s| s["id"] == id));
}

#[tokio::test]
async fn non_owner_cannot_make_server_public() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Owner-Only Guild").await;
    let id = server["id"].as_str().unwrap();

    // Non-owner joins.
    let member_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &member_token,
        json!({}),
    )
    .await;

    // Non-owner attempts to make server public.
    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{id}"),
        &member_token,
        json!({ "is_public": true }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// GET /servers/:id/members — list members
// ============================================================================

#[tokio::test]
async fn list_members_includes_owner() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();
    let token = common::register_and_get_token(app.clone(), &username, "pass1234").await;

    let server = common::create_server(app.clone(), &token, "Member Guild").await;
    let id = server["id"].as_str().unwrap();

    let (status, body) = common::get_authed(app, &format!("/servers/{id}/members"), &token).await;

    assert_eq!(status, StatusCode::OK);
    let members = body.as_array().unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0]["username"], username.as_str());
}

#[tokio::test]
async fn list_members_includes_joined_user() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Growing Guild").await;
    let id = server["id"].as_str().unwrap();

    let joiner_name = common::unique_username();
    let joiner_token = common::register_and_get_token(app.clone(), &joiner_name, "pass1234").await;
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{id}/join"),
        &joiner_token,
        json!({}),
    )
    .await;

    let (status, body) =
        common::get_authed(app, &format!("/servers/{id}/members"), &owner_token).await;

    assert_eq!(status, StatusCode::OK);
    let members = body.as_array().unwrap();
    assert_eq!(members.len(), 2);
    let usernames: Vec<&str> = members
        .iter()
        .map(|m| m["username"].as_str().unwrap())
        .collect();
    assert!(usernames.contains(&joiner_name.as_str()));
}

#[tokio::test]
async fn list_members_non_member_sees_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &owner_token, "Secret Guild").await;
    let id = server["id"].as_str().unwrap();

    let outsider_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let (status, _) =
        common::get_authed(app, &format!("/servers/{id}/members"), &outsider_token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

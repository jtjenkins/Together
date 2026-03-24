mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

async fn setup_server_with_channel_and_member() -> (
    axum::Router,
    String,
    String,
    String,
    String,
    String,
    sqlx::PgPool,
) {
    let pool = common::test_pool().await;

    // Reset registration mode to open
    sqlx::query("UPDATE instance_settings SET registration_mode = 'open' WHERE id = 1")
        .execute(&pool)
        .await
        .unwrap();

    let app = common::create_test_app(pool.clone());

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let member_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let member_token = member_body["access_token"].as_str().unwrap().to_owned();
    let member_user_id = member_body["user"]["id"].as_str().unwrap().to_owned();

    let server = common::create_server(app.clone(), &owner_token, "Override Test").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

    common::make_server_public(app.clone(), &owner_token, &server_id).await;

    // Member joins
    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &member_token,
        json!({}),
    )
    .await;

    let channel = common::create_channel(app.clone(), &owner_token, &server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap().to_owned();

    (
        app,
        owner_token,
        member_token,
        server_id,
        channel_id,
        member_user_id,
        pool,
    )
}

// ============================================================================
// GET /channels/:channel_id/overrides
// ============================================================================

#[tokio::test]
async fn list_overrides_empty() {
    let (app, owner_token, _, _, channel_id, _, _) = setup_server_with_channel_and_member().await;

    let (status, body) = common::get_authed(
        app,
        &format!("/channels/{channel_id}/overrides"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let overrides = body.as_array().unwrap();
    assert!(overrides.is_empty());
}

#[tokio::test]
async fn list_overrides_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(
        app,
        "/channels/00000000-0000-0000-0000-000000000000/overrides",
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ============================================================================
// PUT /channels/:channel_id/overrides — set override
// ============================================================================

#[tokio::test]
async fn set_override_success() {
    let (app, owner_token, _, server_id, channel_id, _, _) =
        setup_server_with_channel_and_member().await;

    // Create a role first
    let (_, role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Test Role", "permissions": 3 }),
    )
    .await;
    let role_id = role["id"].as_str().unwrap();

    // Set override: deny SEND_MESSAGES (bit 1 = 2) for this role
    let (status, _) = common::put_json_authed(
        app,
        &format!("/channels/{channel_id}/overrides"),
        &owner_token,
        json!({ "role_id": role_id, "allow": 0, "deny": 2 }),
    )
    .await;
    assert!(
        status == StatusCode::OK || status == StatusCode::CREATED,
        "set override failed with {status}"
    );
}

#[tokio::test]
async fn set_override_invalid_overlap() {
    let (app, owner_token, _, server_id, channel_id, _, _) =
        setup_server_with_channel_and_member().await;

    let (_, role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Overlap Role", "permissions": 0 }),
    )
    .await;
    let role_id = role["id"].as_str().unwrap();

    // allow and deny overlap on bit 1
    let req = axum::http::Request::builder()
        .method(axum::http::Method::PUT)
        .uri(format!("/channels/{channel_id}/overrides"))
        .header("authorization", format!("Bearer {owner_token}"))
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            json!({ "role_id": role_id, "allow": 2, "deny": 2 }).to_string(),
        ))
        .unwrap();

    let response = tower::ServiceExt::oneshot(app, req).await.unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

// ============================================================================
// Permission enforcement
// ============================================================================

#[tokio::test]
async fn deny_send_messages_blocks_message() {
    let (app, owner_token, member_token, server_id, channel_id, member_user_id, pool) =
        setup_server_with_channel_and_member().await;

    // Create a role and assign to member
    let (_, role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Restricted", "permissions": 3 }), // VIEW + SEND
    )
    .await;
    let role_id = role["id"].as_str().unwrap();

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_user_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;

    // Set channel override: deny SEND_MESSAGES for this role
    sqlx::query(
        "INSERT INTO channel_permission_overrides (channel_id, role_id, allow, deny)
         VALUES ($1, $2, 0, 2)
         ON CONFLICT (channel_id, role_id, user_id) DO UPDATE SET deny = 2",
    )
    .bind(uuid::Uuid::parse_str(&channel_id).unwrap())
    .bind(uuid::Uuid::parse_str(role_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    // Member tries to send a message — should be denied
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/messages"),
        &member_token,
        json!({ "content": "Should be blocked" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(body["error"].as_str().unwrap_or("").contains("permission"));
}

#[tokio::test]
async fn owner_bypasses_deny() {
    let (app, owner_token, _, server_id, channel_id, _, pool) =
        setup_server_with_channel_and_member().await;

    // Create a role
    let (_, role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Denied Role", "permissions": 3 }),
    )
    .await;
    let role_id = role["id"].as_str().unwrap();

    // Set deny on SEND_MESSAGES
    sqlx::query(
        "INSERT INTO channel_permission_overrides (channel_id, role_id, allow, deny) VALUES ($1, $2, 0, 2)",
    )
    .bind(uuid::Uuid::parse_str(&channel_id).unwrap())
    .bind(uuid::Uuid::parse_str(role_id).unwrap())
    .execute(&pool)
    .await
    .unwrap();

    // Owner can still send (bypasses all overrides)
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/messages"),
        &owner_token,
        json!({ "content": "Owner bypass" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn no_override_preserves_existing_behavior() {
    let (app, _, member_token, _, channel_id, _, _) = setup_server_with_channel_and_member().await;

    // Member can send message without any overrides (default behavior)
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/messages"),
        &member_token,
        json!({ "content": "No overrides, should work" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

// ============================================================================
// DELETE /channels/:channel_id/overrides/:override_id
// ============================================================================

#[tokio::test]
async fn delete_override_restores_access() {
    let (app, owner_token, member_token, server_id, channel_id, member_user_id, pool) =
        setup_server_with_channel_and_member().await;

    // Create role, assign to member
    let (_, role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Temp Deny", "permissions": 3 }),
    )
    .await;
    let role_id = role["id"].as_str().unwrap();

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_user_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;

    // Insert override via DB
    let override_id: uuid::Uuid = sqlx::query_scalar(
        "INSERT INTO channel_permission_overrides (channel_id, role_id, allow, deny)
         VALUES ($1, $2, 0, 2)
         RETURNING id",
    )
    .bind(uuid::Uuid::parse_str(&channel_id).unwrap())
    .bind(uuid::Uuid::parse_str(role_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    // Verify message is blocked
    let (status, _) = common::post_json_authed(
        app.clone(),
        &format!("/channels/{channel_id}/messages"),
        &member_token,
        json!({ "content": "Should fail" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Delete the override
    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/channels/{channel_id}/overrides/{override_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Now message should succeed
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/messages"),
        &member_token,
        json!({ "content": "Should work now" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

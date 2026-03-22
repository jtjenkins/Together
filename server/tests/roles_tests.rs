mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Helpers
// ============================================================================

async fn setup_server_with_member() -> (axum::Router, String, String, String, String) {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let owner_token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let member_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let member_token = member_body["access_token"].as_str().unwrap().to_owned();
    let member_user_id = member_body["user"]["id"].as_str().unwrap().to_owned();

    let server = common::create_server(app.clone(), &owner_token, "Role Test").await;
    let server_id = server["id"].as_str().unwrap().to_owned();

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
        "join failed with {status}"
    );

    (app, owner_token, member_token, server_id, member_user_id)
}

async fn create_role(
    app: axum::Router,
    token: &str,
    server_id: &str,
    name: &str,
    permissions: i64,
) -> serde_json::Value {
    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/roles"),
        token,
        json!({ "name": name, "permissions": permissions }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "create_role failed: {body}");
    body
}

// ============================================================================
// POST /servers/:id/roles — create role
// ============================================================================

#[tokio::test]
async fn create_role_success() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Moderator", "permissions": 896, "color": "#e74c3c" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["name"], "Moderator");
    assert_eq!(body["permissions"], 896);
    assert_eq!(body["color"], "#e74c3c");
    assert!(body["id"].is_string());
    assert!(body["position"].is_number());
}

#[tokio::test]
async fn create_role_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::post_json(
        app,
        "/servers/00000000-0000-0000-0000-000000000000/roles",
        json!({ "name": "Test" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_role_requires_permission() {
    let (app, _, member_token, server_id, _) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/roles"),
        &member_token,
        json!({ "name": "Sneaky Role" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// GET /servers/:id/roles — list roles
// ============================================================================

#[tokio::test]
async fn list_roles_any_member_can_view() {
    let (app, owner_token, member_token, server_id, _) = setup_server_with_member().await;

    // Owner creates a role
    create_role(app.clone(), &owner_token, &server_id, "Admin", 8192).await;

    // Regular member can list roles
    let (status, body) =
        common::get_authed(app, &format!("/servers/{server_id}/roles"), &member_token).await;
    assert_eq!(status, StatusCode::OK);
    let roles = body.as_array().unwrap();
    assert!(!roles.is_empty());
    assert!(roles.iter().any(|r| r["name"] == "Admin"));
}

// ============================================================================
// PATCH /servers/:id/roles/:role_id — update role
// ============================================================================

#[tokio::test]
async fn update_role_success() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let role = create_role(app.clone(), &owner_token, &server_id, "Old Name", 0).await;
    let role_id = role["id"].as_str().unwrap();

    let (status, body) = common::patch_json_authed(
        app,
        &format!("/servers/{server_id}/roles/{role_id}"),
        &owner_token,
        json!({ "name": "New Name", "permissions": 4, "color": "#3498db" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["name"], "New Name");
    assert_eq!(body["permissions"], 4);
    assert_eq!(body["color"], "#3498db");
}

// ============================================================================
// DELETE /servers/:id/roles/:role_id — delete role
// ============================================================================

#[tokio::test]
async fn delete_role_success() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let role = create_role(app.clone(), &owner_token, &server_id, "Doomed", 0).await;
    let role_id = role["id"].as_str().unwrap();

    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify role is gone
    let (_, body) =
        common::get_authed(app, &format!("/servers/{server_id}/roles"), &owner_token).await;
    let roles = body.as_array().unwrap();
    assert!(!roles.iter().any(|r| r["id"].as_str() == Some(role_id)));
}

// ============================================================================
// PUT /servers/:id/members/:user_id/roles/:role_id — assign role
// ============================================================================

#[tokio::test]
async fn assign_role_success() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let role = create_role(app.clone(), &owner_token, &server_id, "Mod", 896).await;
    let role_id = role["id"].as_str().unwrap();

    let (status, _) = common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify member has the role in member list
    let (_, body) =
        common::get_authed(app, &format!("/servers/{server_id}/members"), &owner_token).await;
    let members = body.as_array().unwrap();
    let member = members
        .iter()
        .find(|m| m["user_id"].as_str() == Some(&member_id))
        .unwrap();
    let roles = member["roles"].as_array().unwrap();
    assert!(roles.iter().any(|r| r["id"].as_str() == Some(role_id)));
}

#[tokio::test]
async fn assign_role_idempotent() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let role = create_role(app.clone(), &owner_token, &server_id, "Mod", 0).await;
    let role_id = role["id"].as_str().unwrap();

    // Assign twice — should not error
    let (status, _) = common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, _) = common::put_authed(
        app,
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

// ============================================================================
// DELETE /servers/:id/members/:user_id/roles/:role_id — remove role
// ============================================================================

#[tokio::test]
async fn remove_role_success() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let role = create_role(app.clone(), &owner_token, &server_id, "Temp", 0).await;
    let role_id = role["id"].as_str().unwrap();

    // Assign then remove
    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;

    let (status, _) = common::delete_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Verify role removed from member
    let (_, body) =
        common::get_authed(app, &format!("/servers/{server_id}/members"), &owner_token).await;
    let members = body.as_array().unwrap();
    let member = members
        .iter()
        .find(|m| m["user_id"].as_str() == Some(&member_id))
        .unwrap();
    let roles = member["roles"].as_array().unwrap();
    assert!(!roles.iter().any(|r| r["id"].as_str() == Some(role_id)));
}

// ============================================================================
// Hierarchy enforcement
// ============================================================================

#[tokio::test]
async fn cannot_grant_permissions_you_dont_have() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Create a low-level role with only MANAGE_ROLES (2048), assign to member
    let manager_role = create_role(
        app.clone(),
        &owner_token,
        &server_id,
        "Role Manager",
        2048, // MANAGE_ROLES only
    )
    .await;
    let manager_role_id = manager_role["id"].as_str().unwrap();

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{manager_role_id}"),
        &owner_token,
    )
    .await;

    // Member with MANAGE_ROLES tries to create a role with BAN_MEMBERS (512)
    // They don't have BAN_MEMBERS themselves, so this should fail
    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/roles"),
        &member_token,
        json!({ "name": "Overpowered", "permissions": 512 }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cannot_remove_role_from_owner() {
    let (app, owner_token, member_token, server_id, member_id) = setup_server_with_member().await;

    // Create a role with MANAGE_ROLES, assign to member
    let manager_role = create_role(app.clone(), &owner_token, &server_id, "Manager", 2048).await;
    let manager_role_id = manager_role["id"].as_str().unwrap();

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{manager_role_id}"),
        &owner_token,
    )
    .await;

    // Also assign a role to the owner
    let vip_role = create_role(app.clone(), &owner_token, &server_id, "VIP", 0).await;
    let vip_role_id = vip_role["id"].as_str().unwrap();

    // Get owner user ID
    let (_, owner_profile) = common::get_authed(app.clone(), "/users/@me", &owner_token).await;
    let owner_id = owner_profile["id"].as_str().unwrap();

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{owner_id}/roles/{vip_role_id}"),
        &owner_token,
    )
    .await;

    // Member with MANAGE_ROLES tries to remove a role from the owner
    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{server_id}/members/{owner_id}/roles/{vip_role_id}"),
        &member_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// Position hierarchy enforcement (non-owner with MANAGE_ROLES)
// ============================================================================

/// Helper: set up a member with MANAGE_ROLES at a specific position.
/// Returns (app, owner_token, manager_token, server_id, manager_id, low_role_id, high_role_id).
async fn setup_role_manager() -> (axum::Router, String, String, String, String, String, String) {
    let (app, owner_token, manager_token, server_id, manager_id) = setup_server_with_member().await;

    // Create a low-position role (pos 1) with MANAGE_ROLES, assign to manager
    let low_role = create_role(app.clone(), &owner_token, &server_id, "Manager", 2048).await;
    let low_role_id = low_role["id"].as_str().unwrap().to_owned();

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{manager_id}/roles/{low_role_id}"),
        &owner_token,
    )
    .await;

    // Create a high-position role (pos 2+) that the manager cannot touch
    let high_role = create_role(app.clone(), &owner_token, &server_id, "Admin", 8192).await;
    let high_role_id = high_role["id"].as_str().unwrap().to_owned();

    (
        app,
        owner_token,
        manager_token,
        server_id,
        manager_id,
        low_role_id,
        high_role_id,
    )
}

#[tokio::test]
async fn hierarchy_cannot_update_higher_role() {
    let (app, _, manager_token, server_id, _, _, high_role_id) = setup_role_manager().await;

    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{server_id}/roles/{high_role_id}"),
        &manager_token,
        json!({ "name": "Hacked Admin" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn hierarchy_cannot_delete_higher_role() {
    let (app, _, manager_token, server_id, _, _, high_role_id) = setup_role_manager().await;

    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{server_id}/roles/{high_role_id}"),
        &manager_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn hierarchy_cannot_assign_higher_role() {
    let (app, _, manager_token, server_id, _, _, high_role_id) = setup_role_manager().await;

    // Register a third user and join them
    let third_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let third_token = third_body["access_token"].as_str().unwrap();
    let third_id = third_body["user"]["id"].as_str().unwrap();

    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        third_token,
        json!({}),
    )
    .await;

    // Manager tries to assign the high-position role — should fail
    let (status, _) = common::put_authed(
        app,
        &format!("/servers/{server_id}/members/{third_id}/roles/{high_role_id}"),
        &manager_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn hierarchy_cannot_remove_higher_role() {
    let (app, owner_token, manager_token, server_id, _, _, high_role_id) =
        setup_role_manager().await;

    // Register a third user, join them, assign the high role via owner
    let third_body =
        common::register_user(app.clone(), &common::unique_username(), "pass1234").await;
    let third_token = third_body["access_token"].as_str().unwrap();
    let third_id = third_body["user"]["id"].as_str().unwrap();

    common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        third_token,
        json!({}),
    )
    .await;

    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{third_id}/roles/{high_role_id}"),
        &owner_token,
    )
    .await;

    // Manager tries to remove the high-position role — should fail
    let (status, _) = common::delete_authed(
        app,
        &format!("/servers/{server_id}/members/{third_id}/roles/{high_role_id}"),
        &manager_token,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn hierarchy_cannot_escalate_permissions_via_update() {
    let (app, owner_token, manager_token, server_id, _, _, _) = setup_role_manager().await;

    // Create a low role the manager CAN edit (position below manager's)
    // The manager's role has position auto-assigned. Create a new role that
    // will have a lower position since it was created after the manager role.
    // Actually, positions auto-increment, so we need to create a role with
    // explicit low position. Use owner to create at position 0.
    let (status, editable_role) = common::post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Peon", "permissions": 0, "position": 0 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let editable_role_id = editable_role["id"].as_str().unwrap();

    // Manager tries to update the Peon role to add BAN_MEMBERS (512)
    // Manager only has MANAGE_ROLES (2048), not BAN_MEMBERS
    let (status, _) = common::patch_json_authed(
        app,
        &format!("/servers/{server_id}/roles/{editable_role_id}"),
        &manager_token,
        json!({ "permissions": 512 }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

// ============================================================================
// Validation
// ============================================================================

#[tokio::test]
async fn create_role_rejects_empty_name() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn create_role_rejects_invalid_permissions() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/servers/{server_id}/roles"),
        &owner_token,
        json!({ "name": "Bad", "permissions": 99999 }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// Audit log verification
// ============================================================================

#[tokio::test]
async fn role_operations_produce_audit_logs() {
    let (app, owner_token, _, server_id, _) = setup_server_with_member().await;

    // Create a role
    create_role(app.clone(), &owner_token, &server_id, "Audited", 0).await;

    let (status, logs) = common::get_authed(
        app,
        &format!("/servers/{server_id}/audit-logs?action=role_create"),
        &owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let logs = logs.as_array().unwrap();
    assert!(!logs.is_empty(), "should have a role_create audit log");
    assert_eq!(logs[0]["action"], "role_create");
}

// ============================================================================
// List members includes roles
// ============================================================================

#[tokio::test]
async fn list_members_includes_roles() {
    let (app, owner_token, _, server_id, member_id) = setup_server_with_member().await;

    let role = create_role(app.clone(), &owner_token, &server_id, "VIP", 0).await;
    let role_id = role["id"].as_str().unwrap();

    // Assign role to member
    common::put_authed(
        app.clone(),
        &format!("/servers/{server_id}/members/{member_id}/roles/{role_id}"),
        &owner_token,
    )
    .await;

    let (status, body) =
        common::get_authed(app, &format!("/servers/{server_id}/members"), &owner_token).await;
    assert_eq!(status, StatusCode::OK);

    let members = body.as_array().unwrap();
    let member = members
        .iter()
        .find(|m| m["user_id"].as_str() == Some(&member_id))
        .unwrap();

    assert!(member["roles"].is_array(), "member should have roles array");
    let roles = member["roles"].as_array().unwrap();
    assert!(roles.iter().any(|r| r["name"] == "VIP"));
}

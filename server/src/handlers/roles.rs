//! Role management: create, list, update, delete roles and assign/remove member roles.
//!
//! All mutating endpoints require MANAGE_ROLES permission and enforce position
//! hierarchy: non-owners cannot manage roles at or above their own highest position.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use super::shared::{
    fetch_server, get_user_highest_position, get_user_permissions, require_member,
    require_permission, PERMISSION_ADMINISTRATOR, PERMISSION_MANAGE_ROLES,
};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    handlers::audit::log_action,
    models::{AuditAction, CreateAuditLog, CreateRoleRequest, Role, UpdateRoleRequest},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{
            EVENT_MEMBER_ROLE_ADD, EVENT_MEMBER_ROLE_REMOVE, EVENT_ROLE_CREATE, EVENT_ROLE_DELETE,
            EVENT_ROLE_UPDATE,
        },
    },
};

/// Maximum valid permission value (14 bits: bits 0-13).
const MAX_PERMISSIONS: i64 = 16383;

// ============================================================================
// Handlers
// ============================================================================

/// POST /servers/:id/roles — create a new role.
pub async fn create_role(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateRoleRequest>,
) -> AppResult<(StatusCode, Json<Role>)> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_MANAGE_ROLES,
        "You need the Manage Roles permission",
    )
    .await?;

    // Validate name length.
    if req.name.is_empty() || req.name.len() > 100 {
        return Err(AppError::Validation(
            "Role name must be 1-100 characters".into(),
        ));
    }

    let permissions = req.permissions.unwrap_or(0);
    if !(0..=MAX_PERMISSIONS).contains(&permissions) {
        return Err(AppError::Validation(format!(
            "Permissions must be between 0 and {MAX_PERMISSIONS}"
        )));
    }

    let is_owner = server.owner_id == auth.user_id();

    // Hierarchy checks for non-owners.
    if !is_owner {
        if let Some(pos) = req.position {
            let actor_highest =
                get_user_highest_position(&state.pool, server_id, auth.user_id()).await?;
            if pos >= actor_highest {
                return Err(AppError::Forbidden(
                    "Cannot create a role at or above your highest role position".into(),
                ));
            }
        }

        // Cannot grant permissions you don't have.
        let actor_perms = get_user_permissions(&state.pool, server_id, auth.user_id()).await?;
        let has_admin = actor_perms & PERMISSION_ADMINISTRATOR != 0;
        if !has_admin && (permissions & !actor_perms) != 0 {
            return Err(AppError::Forbidden(
                "Cannot grant permissions you do not have".into(),
            ));
        }
    }

    // Default position: MAX(position) + 1.
    let position = match req.position {
        Some(p) => p,
        None => {
            let max_pos: Option<i32> = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position), 0) FROM roles WHERE server_id = $1",
            )
            .bind(server_id)
            .fetch_one(&state.pool)
            .await?;
            max_pos.unwrap_or(0) + 1
        }
    };

    let role = sqlx::query_as::<_, Role>(
        "INSERT INTO roles (server_id, name, permissions, color, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, server_id, name, permissions, color, position, created_at",
    )
    .bind(server_id)
    .bind(&req.name)
    .bind(permissions)
    .bind(&req.color)
    .bind(position)
    .fetch_one(&state.pool)
    .await?;

    // Broadcast + audit.
    match serde_json::to_value(&role) {
        Ok(payload) => {
            broadcast_to_server(&state, server_id, EVENT_ROLE_CREATE, payload).await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize role for broadcast");
        }
    }

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::RoleCreate,
            target_type: Some("role".into()),
            target_id: Some(role.id),
            details: json!({ "name": &role.name, "permissions": role.permissions }),
            ip_address: None,
        },
    )
    .await;

    Ok((StatusCode::CREATED, Json(role)))
}

/// GET /servers/:id/roles — list all roles in a server.
pub async fn list_roles(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<Role>>> {
    fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let roles = sqlx::query_as::<_, Role>(
        "SELECT id, server_id, name, permissions, color, position, created_at
         FROM roles WHERE server_id = $1
         ORDER BY position DESC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(roles))
}

/// PATCH /servers/:id/roles/:role_id — update a role.
pub async fn update_role(
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<UpdateRoleRequest>,
) -> AppResult<Json<Role>> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_MANAGE_ROLES,
        "You need the Manage Roles permission",
    )
    .await?;

    // Fetch the role and verify it belongs to this server.
    let role = sqlx::query_as::<_, Role>(
        "SELECT id, server_id, name, permissions, color, position, created_at
         FROM roles WHERE id = $1",
    )
    .bind(role_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Role not found".into()))?;

    if role.server_id != server_id {
        return Err(AppError::NotFound("Role not found".into()));
    }

    // Validate name if provided.
    if let Some(ref name) = req.name {
        if name.is_empty() || name.len() > 100 {
            return Err(AppError::Validation(
                "Role name must be 1-100 characters".into(),
            ));
        }
    }

    if let Some(permissions) = req.permissions {
        if !(0..=MAX_PERMISSIONS).contains(&permissions) {
            return Err(AppError::Validation(format!(
                "Permissions must be between 0 and {MAX_PERMISSIONS}"
            )));
        }
    }

    let is_owner = server.owner_id == auth.user_id();

    // Hierarchy checks for non-owners.
    if !is_owner {
        let actor_highest =
            get_user_highest_position(&state.pool, server_id, auth.user_id()).await?;

        // Cannot edit a role at or above your own highest position.
        if role.position >= actor_highest {
            return Err(AppError::Forbidden(
                "Cannot edit a role at or above your highest role position".into(),
            ));
        }

        // Cannot move a role to a position at or above your own.
        if let Some(new_position) = req.position {
            if new_position >= actor_highest {
                return Err(AppError::Forbidden(
                    "Cannot move a role to a position at or above your highest role position"
                        .into(),
                ));
            }
        }

        // Cannot grant permissions you don't have.
        if let Some(permissions) = req.permissions {
            let actor_perms = get_user_permissions(&state.pool, server_id, auth.user_id()).await?;
            let has_admin = actor_perms & PERMISSION_ADMINISTRATOR != 0;
            if !has_admin && (permissions & !actor_perms) != 0 {
                return Err(AppError::Forbidden(
                    "Cannot grant permissions you do not have".into(),
                ));
            }
        }
    }

    let updated = sqlx::query_as::<_, Role>(
        "UPDATE roles
         SET name        = COALESCE($1, name),
             permissions = COALESCE($2, permissions),
             color       = COALESCE($3, color),
             position    = COALESCE($4, position)
         WHERE id = $5
         RETURNING id, server_id, name, permissions, color, position, created_at",
    )
    .bind(&req.name)
    .bind(req.permissions)
    .bind(&req.color)
    .bind(req.position)
    .bind(role_id)
    .fetch_one(&state.pool)
    .await?;

    match serde_json::to_value(&updated) {
        Ok(payload) => {
            broadcast_to_server(&state, server_id, EVENT_ROLE_UPDATE, payload).await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize role for broadcast");
        }
    }

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::RoleUpdate,
            target_type: Some("role".into()),
            target_id: Some(role_id),
            details: json!({
                "name": &updated.name,
                "permissions": updated.permissions,
            }),
            ip_address: None,
        },
    )
    .await;

    Ok(Json(updated))
}

/// DELETE /servers/:id/roles/:role_id — delete a role.
pub async fn delete_role(
    Path((server_id, role_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_MANAGE_ROLES,
        "You need the Manage Roles permission",
    )
    .await?;

    let role = sqlx::query_as::<_, Role>(
        "SELECT id, server_id, name, permissions, color, position, created_at
         FROM roles WHERE id = $1",
    )
    .bind(role_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Role not found".into()))?;

    if role.server_id != server_id {
        return Err(AppError::NotFound("Role not found".into()));
    }

    let is_owner = server.owner_id == auth.user_id();

    if !is_owner {
        let actor_highest =
            get_user_highest_position(&state.pool, server_id, auth.user_id()).await?;
        if role.position >= actor_highest {
            return Err(AppError::Forbidden(
                "Cannot delete a role at or above your highest role position".into(),
            ));
        }
    }

    // DELETE cascades to member_roles.
    sqlx::query("DELETE FROM roles WHERE id = $1")
        .bind(role_id)
        .execute(&state.pool)
        .await?;

    let payload = json!({ "server_id": server_id, "role_id": role_id });
    broadcast_to_server(&state, server_id, EVENT_ROLE_DELETE, payload).await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::RoleDelete,
            target_type: Some("role".into()),
            target_id: Some(role_id),
            details: json!({ "name": &role.name }),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// PUT /servers/:id/members/:user_id/roles/:role_id — assign a role to a member.
pub async fn assign_role(
    Path((server_id, target_user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_member(&state.pool, server_id, target_user_id).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_MANAGE_ROLES,
        "You need the Manage Roles permission",
    )
    .await?;

    let role = sqlx::query_as::<_, Role>(
        "SELECT id, server_id, name, permissions, color, position, created_at
         FROM roles WHERE id = $1",
    )
    .bind(role_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Role not found".into()))?;

    if role.server_id != server_id {
        return Err(AppError::NotFound("Role not found".into()));
    }

    let is_owner = server.owner_id == auth.user_id();

    if !is_owner {
        let actor_highest =
            get_user_highest_position(&state.pool, server_id, auth.user_id()).await?;
        if role.position >= actor_highest {
            return Err(AppError::Forbidden(
                "Cannot assign a role at or above your highest role position".into(),
            ));
        }
    }

    sqlx::query(
        "INSERT INTO member_roles (user_id, server_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING",
    )
    .bind(target_user_id)
    .bind(server_id)
    .bind(role_id)
    .execute(&state.pool)
    .await?;

    let payload = json!({
        "server_id": server_id,
        "user_id": target_user_id,
        "role_id": role_id,
        "role_name": &role.name,
        "role_color": &role.color,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_ROLE_ADD, payload).await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberRoleAdd,
            target_type: Some("user".into()),
            target_id: Some(target_user_id),
            details: json!({ "role_id": role_id, "role_name": &role.name }),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /servers/:id/members/:user_id/roles/:role_id — remove a role from a member.
pub async fn remove_role(
    Path((server_id, target_user_id, role_id)): Path<(Uuid, Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_member(&state.pool, server_id, target_user_id).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_MANAGE_ROLES,
        "You need the Manage Roles permission",
    )
    .await?;

    let role = sqlx::query_as::<_, Role>(
        "SELECT id, server_id, name, permissions, color, position, created_at
         FROM roles WHERE id = $1",
    )
    .bind(role_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Role not found".into()))?;

    if role.server_id != server_id {
        return Err(AppError::NotFound("Role not found".into()));
    }

    let is_owner = server.owner_id == auth.user_id();

    // Non-owners cannot remove roles from the server owner.
    if !is_owner && target_user_id == server.owner_id {
        return Err(AppError::Forbidden(
            "Cannot remove roles from the server owner".into(),
        ));
    }

    if !is_owner {
        let actor_highest =
            get_user_highest_position(&state.pool, server_id, auth.user_id()).await?;
        if role.position >= actor_highest {
            return Err(AppError::Forbidden(
                "Cannot remove a role at or above your highest role position".into(),
            ));
        }
    }

    sqlx::query("DELETE FROM member_roles WHERE user_id = $1 AND server_id = $2 AND role_id = $3")
        .bind(target_user_id)
        .bind(server_id)
        .bind(role_id)
        .execute(&state.pool)
        .await?;

    let payload = json!({
        "server_id": server_id,
        "user_id": target_user_id,
        "role_id": role_id,
        "role_name": &role.name,
        "role_color": &role.color,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_ROLE_REMOVE, payload).await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberRoleRemove,
            target_type: Some("user".into()),
            target_id: Some(target_user_id),
            details: json!({ "role_id": role_id, "role_name": &role.name }),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

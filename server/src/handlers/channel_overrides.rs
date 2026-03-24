//! Channel permission override CRUD: list, upsert, and delete per-channel overrides.
//!
//! All mutating endpoints require MANAGE_CHANNELS permission for the channel's server.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use super::shared::{
    fetch_channel_by_id, require_channel_permission, require_member, PERMISSION_MANAGE_CHANNELS,
};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    handlers::audit::log_action,
    models::{AuditAction, ChannelPermissionOverride, CreateAuditLog, SetChannelOverrideRequest},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{EVENT_CHANNEL_OVERRIDE_DELETE, EVENT_CHANNEL_OVERRIDE_UPDATE},
    },
};

/// Maximum valid permission value (15 bits: bits 0-14).
const MAX_PERMISSIONS: i64 = 32767;

// ============================================================================
// Handlers
// ============================================================================

/// GET /channels/:channel_id/overrides — list all permission overrides for a channel.
pub async fn list_overrides(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<ChannelPermissionOverride>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let overrides = sqlx::query_as::<_, ChannelPermissionOverride>(
        "SELECT id, channel_id, role_id, user_id, allow, deny
         FROM channel_permission_overrides WHERE channel_id = $1
         ORDER BY role_id NULLS LAST, user_id NULLS LAST",
    )
    .bind(channel_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(overrides))
}

/// PUT /channels/:channel_id/overrides — upsert a permission override.
///
/// Requires MANAGE_CHANNELS permission. The request must specify exactly one of
/// `role_id` or `user_id`. The `allow` and `deny` bitfields must not overlap.
pub async fn set_override(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SetChannelOverrideRequest>,
) -> AppResult<Json<ChannelPermissionOverride>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_channel_permission(
        &state.pool,
        channel.server_id,
        channel_id,
        auth.user_id(),
        PERMISSION_MANAGE_CHANNELS,
        "You need the Manage Channels permission to edit channel overrides",
    )
    .await?;

    // Validate: exactly one of role_id or user_id must be set.
    match (&req.role_id, &req.user_id) {
        (None, None) => {
            return Err(AppError::Validation(
                "Either role_id or user_id must be provided".into(),
            ));
        }
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "Only one of role_id or user_id may be provided".into(),
            ));
        }
        _ => {}
    }

    // Validate: allow and deny must not overlap.
    if req.allow & req.deny != 0 {
        return Err(AppError::Validation(
            "allow and deny must not have overlapping bits".into(),
        ));
    }

    // Validate: within valid permission range.
    if req.allow < 0 || req.allow > MAX_PERMISSIONS {
        return Err(AppError::Validation(format!(
            "allow must be between 0 and {MAX_PERMISSIONS}"
        )));
    }
    if req.deny < 0 || req.deny > MAX_PERMISSIONS {
        return Err(AppError::Validation(format!(
            "deny must be between 0 and {MAX_PERMISSIONS}"
        )));
    }

    let ov = sqlx::query_as::<_, ChannelPermissionOverride>(
        "INSERT INTO channel_permission_overrides (channel_id, role_id, user_id, allow, deny)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, role_id, user_id) DO UPDATE
             SET allow = EXCLUDED.allow,
                 deny  = EXCLUDED.deny
         RETURNING id, channel_id, role_id, user_id, allow, deny",
    )
    .bind(channel_id)
    .bind(req.role_id)
    .bind(req.user_id)
    .bind(req.allow)
    .bind(req.deny)
    .fetch_one(&state.pool)
    .await?;

    // Broadcast + audit.
    match serde_json::to_value(&ov) {
        Ok(payload) => {
            broadcast_to_server(
                &state,
                channel.server_id,
                EVENT_CHANNEL_OVERRIDE_UPDATE,
                payload,
            )
            .await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize override for broadcast");
        }
    }

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id: channel.server_id,
            actor_id: auth.user_id(),
            action: AuditAction::ChannelOverrideUpdate,
            target_type: Some("channel".into()),
            target_id: Some(channel_id),
            details: json!({
                "override_id": ov.id,
                "role_id": req.role_id,
                "user_id": req.user_id,
                "allow": req.allow,
                "deny": req.deny,
            }),
            ip_address: None,
        },
    )
    .await;

    Ok(Json(ov))
}

/// DELETE /channels/:channel_id/overrides/:override_id — remove a permission override.
pub async fn delete_override(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, override_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_channel_permission(
        &state.pool,
        channel.server_id,
        channel_id,
        auth.user_id(),
        PERMISSION_MANAGE_CHANNELS,
        "You need the Manage Channels permission to delete channel overrides",
    )
    .await?;

    let result =
        sqlx::query("DELETE FROM channel_permission_overrides WHERE id = $1 AND channel_id = $2")
            .bind(override_id)
            .bind(channel_id)
            .execute(&state.pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Override not found".into()));
    }

    let payload = json!({
        "channel_id": channel_id,
        "override_id": override_id,
    });
    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_CHANNEL_OVERRIDE_DELETE,
        payload,
    )
    .await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id: channel.server_id,
            actor_id: auth.user_id(),
            action: AuditAction::ChannelOverrideDelete,
            target_type: Some("channel".into()),
            target_id: Some(channel_id),
            details: json!({ "override_id": override_id }),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

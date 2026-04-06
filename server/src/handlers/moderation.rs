//! Manual member moderation: kick, ban, timeout, remove timeout.
//!
//! These are human-initiated actions (as opposed to automod-triggered).
//! All endpoints require appropriate permission bits or server ownership.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use super::shared::{
    can_moderate, require_member, PERMISSION_BAN_MEMBERS, PERMISSION_KICK_MEMBERS,
    PERMISSION_MUTE_MEMBERS,
};
use crate::{
    auth::AuthUser,
    error::AppResult,
    handlers::audit::log_action,
    models::{
        AuditAction, AutomodTimeout, BanMemberRequest, CreateAuditLog, KickMemberRequest,
        TimeoutMemberRequest, VoiceStateDto,
    },
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{
            EVENT_MEMBER_BAN, EVENT_MEMBER_KICK, EVENT_MEMBER_TIMEOUT, EVENT_MEMBER_TIMEOUT_REMOVE,
            EVENT_VOICE_STATE_UPDATE,
        },
    },
};

/// POST /servers/:id/members/:user_id/kick
///
/// Remove a member from the server. Requires KICK_MEMBERS permission.
#[utoipa::path(
    post,
    path = "/servers/{id}/members/{user_id}/kick",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("user_id" = Uuid, Path, description = "Target user ID"),
    ),
    request_body(content = KickMemberRequest, description = "Optional kick reason"),
    responses(
        (status = 204, description = "Member kicked"),
        (status = 403, description = "Insufficient permissions"),
    ),
    security(("bearer_auth" = [])),
    tag = "Moderation"
)]
pub async fn kick_member(
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
    body: Option<Json<KickMemberRequest>>,
) -> AppResult<StatusCode> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_member(&state.pool, server_id, target_user_id).await?;
    can_moderate(
        &state.pool,
        server_id,
        auth.user_id(),
        target_user_id,
        PERMISSION_KICK_MEMBERS,
    )
    .await?;

    let reason = body.and_then(|b| b.0.reason);

    // Clean up voice state if the target is in a voice channel.
    let voice_removed = sqlx::query_scalar::<_, Uuid>(
        "DELETE FROM voice_states WHERE user_id = $1 RETURNING channel_id",
    )
    .bind(target_user_id)
    .fetch_optional(&state.pool)
    .await?;

    if voice_removed.is_some() {
        let leave_dto = VoiceStateDto::leave(target_user_id);
        match serde_json::to_value(&leave_dto) {
            Ok(payload) => {
                broadcast_to_server(&state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
            }
            Err(e) => {
                tracing::error!(error = ?e, "Failed to serialize VoiceStateDto");
            }
        }
    }

    // Broadcast MEMBER_KICK before deleting membership so the target receives it.
    let kick_payload = json!({
        "server_id": server_id,
        "user_id": target_user_id,
        "reason": reason,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_KICK, kick_payload).await;

    // Remove membership.
    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(target_user_id)
        .execute(&state.pool)
        .await?;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberKick,
            target_type: Some("user".into()),
            target_id: Some(target_user_id),
            details: json!({ "reason": reason }),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /servers/:id/members/:user_id/ban
///
/// Ban a member from the server (remove + prevent rejoin). Requires BAN_MEMBERS permission.
#[utoipa::path(
    post,
    path = "/servers/{id}/members/{user_id}/ban",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("user_id" = Uuid, Path, description = "Target user ID"),
    ),
    request_body(content = BanMemberRequest, description = "Optional ban reason"),
    responses(
        (status = 204, description = "Member banned"),
        (status = 403, description = "Insufficient permissions"),
    ),
    security(("bearer_auth" = [])),
    tag = "Moderation"
)]
pub async fn ban_member(
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
    body: Option<Json<BanMemberRequest>>,
) -> AppResult<StatusCode> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    can_moderate(
        &state.pool,
        server_id,
        auth.user_id(),
        target_user_id,
        PERMISSION_BAN_MEMBERS,
    )
    .await?;

    let reason = body.and_then(|b| b.0.reason);

    // Clean up voice state.
    let voice_removed = sqlx::query_scalar::<_, Uuid>(
        "DELETE FROM voice_states WHERE user_id = $1 RETURNING channel_id",
    )
    .bind(target_user_id)
    .fetch_optional(&state.pool)
    .await?;

    if voice_removed.is_some() {
        let leave_dto = VoiceStateDto::leave(target_user_id);
        match serde_json::to_value(&leave_dto) {
            Ok(payload) => {
                broadcast_to_server(&state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
            }
            Err(e) => {
                tracing::error!(error = ?e, "Failed to serialize VoiceStateDto");
            }
        }
    }

    // Broadcast MEMBER_BAN before deleting membership so the target receives it.
    let ban_payload = json!({
        "server_id": server_id,
        "user_id": target_user_id,
        "reason": reason,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_BAN, ban_payload).await;

    // Ban + remove membership atomically.
    let mut tx = state.pool.begin().await?;

    sqlx::query(
        r#"INSERT INTO server_bans (user_id, server_id, banned_by, reason)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, server_id) DO UPDATE SET
             banned_by = EXCLUDED.banned_by,
             reason = EXCLUDED.reason"#,
    )
    .bind(target_user_id)
    .bind(server_id)
    .bind(auth.user_id())
    .bind(&reason)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberBan,
            target_type: Some("user".into()),
            target_id: Some(target_user_id),
            details: json!({ "reason": reason }),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /servers/:id/members/:user_id/timeout
///
/// Timeout a member for N minutes. Requires MUTE_MEMBERS permission.
#[utoipa::path(
    post,
    path = "/servers/{id}/members/{user_id}/timeout",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("user_id" = Uuid, Path, description = "Target user ID"),
    ),
    request_body = TimeoutMemberRequest,
    responses(
        (status = 200, description = "Member timed out", body = AutomodTimeout),
        (status = 400, description = "Invalid duration"),
        (status = 403, description = "Insufficient permissions"),
    ),
    security(("bearer_auth" = [])),
    tag = "Moderation"
)]
pub async fn timeout_member(
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<TimeoutMemberRequest>,
) -> AppResult<Json<AutomodTimeout>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_member(&state.pool, server_id, target_user_id).await?;
    can_moderate(
        &state.pool,
        server_id,
        auth.user_id(),
        target_user_id,
        PERMISSION_MUTE_MEMBERS,
    )
    .await?;

    if body.duration_minutes < 1 || body.duration_minutes > 40320 {
        return Err(crate::error::AppError::Validation(
            "duration_minutes must be between 1 and 40320 (28 days)".into(),
        ));
    }

    let timeout = sqlx::query_as::<_, AutomodTimeout>(
        r#"INSERT INTO automod_timeouts (user_id, server_id, expires_at, reason, created_by)
           VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, $4, $5)
           ON CONFLICT (user_id, server_id) DO UPDATE SET
             expires_at = NOW() + ($3 || ' minutes')::interval,
             reason = EXCLUDED.reason,
             created_by = EXCLUDED.created_by
           RETURNING user_id, server_id, expires_at, reason, created_by, created_at"#,
    )
    .bind(target_user_id)
    .bind(server_id)
    .bind(body.duration_minutes.to_string())
    .bind(&body.reason)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await?;

    let timeout_payload = json!({
        "server_id": server_id,
        "user_id": target_user_id,
        "expires_at": timeout.expires_at,
        "reason": body.reason,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_TIMEOUT, timeout_payload).await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberTimeout,
            target_type: Some("user".into()),
            target_id: Some(target_user_id),
            details: json!({
                "duration_minutes": body.duration_minutes,
                "reason": body.reason,
            }),
            ip_address: None,
        },
    )
    .await;

    Ok(Json(timeout))
}

/// DELETE /servers/:id/members/:user_id/timeout
///
/// Remove an active timeout from a member. Requires MUTE_MEMBERS permission.
#[utoipa::path(
    delete,
    path = "/servers/{id}/members/{user_id}/timeout",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("user_id" = Uuid, Path, description = "Target user ID"),
    ),
    responses(
        (status = 204, description = "Timeout removed"),
        (status = 403, description = "Insufficient permissions"),
    ),
    security(("bearer_auth" = [])),
    tag = "Moderation"
)]
pub async fn remove_timeout(
    Path((server_id, target_user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_member(&state.pool, server_id, target_user_id).await?;
    can_moderate(
        &state.pool,
        server_id,
        auth.user_id(),
        target_user_id,
        PERMISSION_MUTE_MEMBERS,
    )
    .await?;

    sqlx::query("DELETE FROM automod_timeouts WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(target_user_id)
        .execute(&state.pool)
        .await?;

    let payload = json!({
        "server_id": server_id,
        "user_id": target_user_id,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_TIMEOUT_REMOVE, payload).await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberTimeoutRemove,
            target_type: Some("user".into()),
            target_id: Some(target_user_id),
            details: json!({}),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

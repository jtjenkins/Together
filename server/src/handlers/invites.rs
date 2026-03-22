use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use super::shared::{require_member, require_permission, PERMISSION_CREATE_INVITES};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    handlers::audit::log_action,
    models::{AuditAction, CreateAuditLog, CreateInviteRequest, InvitePreviewDto, ServerInvite},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{EVENT_INVITE_CREATE, EVENT_INVITE_DELETE},
    },
};

/// Generate an 8-character alphanumeric invite code.
fn generate_invite_code() -> String {
    use rand::distributions::Alphanumeric;
    use rand::Rng;
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect()
}

// ── POST /servers/:id/invites ────────────────────────────────────────────────

pub async fn create_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateInviteRequest>,
) -> AppResult<(StatusCode, Json<ServerInvite>)> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_CREATE_INVITES,
        "You need the Create Invites permission",
    )
    .await?;

    // Validate max_uses if provided.
    if let Some(max_uses) = req.max_uses {
        if max_uses <= 0 {
            return Err(AppError::Validation(
                "max_uses must be greater than 0".into(),
            ));
        }
    }

    // Validate expires_in_hours if provided (1-720 hours = 30 days).
    if let Some(hours) = req.expires_in_hours {
        if !(1..=720).contains(&hours) {
            return Err(AppError::Validation(
                "expires_in_hours must be between 1 and 720".into(),
            ));
        }
    }

    let expires_at = req
        .expires_in_hours
        .map(|h| chrono::Utc::now() + chrono::Duration::hours(h));

    // Retry up to 3 times on UNIQUE violation (code collision).
    let mut attempts = 0;
    let invite = loop {
        attempts += 1;
        let code = generate_invite_code();

        let result = sqlx::query_as::<_, ServerInvite>(
            "INSERT INTO server_invites (server_id, code, created_by, max_uses, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, server_id, code, created_by, max_uses, uses, expires_at, created_at",
        )
        .bind(server_id)
        .bind(&code)
        .bind(auth.user_id())
        .bind(req.max_uses)
        .bind(expires_at)
        .fetch_one(&state.pool)
        .await;

        match result {
            Ok(invite) => break invite,
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() && attempts < 3 => {
                continue;
            }
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                // All 3 attempts collided — astronomically unlikely with 62^8 codes.
                tracing::error!(
                    server_id = %server_id,
                    "Invite code collision after {attempts} attempts"
                );
                return Err(AppError::Internal);
            }
            Err(e) => return Err(e.into()),
        }
    };

    // Audit log.
    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::InviteCreate,
            target_type: Some("invite".into()),
            target_id: Some(invite.id),
            details: json!({ "code": &invite.code, "max_uses": invite.max_uses }),
            ip_address: None,
        },
    )
    .await;

    // Broadcast to server members.
    match serde_json::to_value(&invite) {
        Ok(payload) => {
            broadcast_to_server(&state, server_id, EVENT_INVITE_CREATE, payload).await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize invite for broadcast");
        }
    }

    Ok((StatusCode::CREATED, Json(invite)))
}

// ── GET /servers/:id/invites ─────────────────────────────────────────────────

pub async fn list_invites(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerInvite>>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_CREATE_INVITES,
        "You need the Create Invites permission",
    )
    .await?;

    let invites = sqlx::query_as::<_, ServerInvite>(
        "SELECT id, server_id, code, created_by, max_uses, uses, expires_at, created_at
         FROM server_invites WHERE server_id = $1
         ORDER BY created_at DESC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(invites))
}

// ── DELETE /servers/:id/invites/:invite_id ───────────────────────────────────

pub async fn delete_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, invite_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_CREATE_INVITES,
        "You need the Create Invites permission",
    )
    .await?;

    let rows = sqlx::query("DELETE FROM server_invites WHERE id = $1 AND server_id = $2")
        .bind(invite_id)
        .bind(server_id)
        .execute(&state.pool)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::NotFound("Invite not found".into()));
    }

    // Audit log.
    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::InviteRevoke,
            target_type: Some("invite".into()),
            target_id: Some(invite_id),
            details: json!({}),
            ip_address: None,
        },
    )
    .await;

    // Broadcast to server members.
    let payload = json!({ "server_id": server_id, "invite_id": invite_id });
    broadcast_to_server(&state, server_id, EVENT_INVITE_DELETE, payload).await;

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /invites/:code ───────────────────────────────────────────────────────

/// Preview an invite — any authenticated user can view server info before joining.
pub async fn preview_invite(
    _auth: AuthUser,
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> AppResult<Json<InvitePreviewDto>> {
    #[derive(sqlx::FromRow)]
    struct InvitePreviewRow {
        code: String,
        server_name: String,
        server_icon_url: Option<String>,
        member_count: i64,
        expires_at: Option<chrono::DateTime<chrono::Utc>>,
    }

    let row = sqlx::query_as::<_, InvitePreviewRow>(
        "SELECT si.code, s.name AS server_name, s.icon_url AS server_icon_url,
                (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id) AS member_count,
                si.expires_at
         FROM server_invites si
         JOIN servers s ON s.id = si.server_id
         WHERE si.code = $1
           AND (si.expires_at IS NULL OR si.expires_at > NOW())
           AND (si.max_uses IS NULL OR si.uses < si.max_uses)",
    )
    .bind(&code)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Invite not found or has expired".into()))?;

    Ok(Json(InvitePreviewDto {
        code: row.code,
        server_name: row.server_name,
        server_icon_url: row.server_icon_url,
        member_count: row.member_count,
        expires_at: row.expires_at,
    }))
}

// ── POST /invites/:code/accept ───────────────────────────────────────────────

/// Accept an invite and join the server.
pub async fn accept_invite(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(code): Path<String>,
) -> AppResult<(StatusCode, Json<serde_json::Value>)> {
    // Fetch the invite + server info.
    #[derive(sqlx::FromRow)]
    struct InviteRow {
        id: Uuid,
        server_id: Uuid,
        max_uses: Option<i32>,
        uses: i32,
        expires_at: Option<chrono::DateTime<chrono::Utc>>,
    }

    let invite = sqlx::query_as::<_, InviteRow>(
        "SELECT id, server_id, max_uses, uses, expires_at
         FROM server_invites
         WHERE code = $1",
    )
    .bind(&code)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Invite not found".into()))?;

    // Check expiry.
    if let Some(expires_at) = invite.expires_at {
        if expires_at <= chrono::Utc::now() {
            return Err(AppError::Validation("This invite has expired".into()));
        }
    }

    // Check max uses.
    if let Some(max_uses) = invite.max_uses {
        if invite.uses >= max_uses {
            return Err(AppError::Validation(
                "This invite has reached its maximum uses".into(),
            ));
        }
    }

    // Check ban.
    let is_banned: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_bans WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(invite.server_id)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await?;

    if is_banned {
        return Err(AppError::Forbidden(
            "You are banned from this server".into(),
        ));
    }

    // Check already a member.
    let already_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(invite.server_id)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await?;

    if already_member {
        return Err(AppError::Conflict("Already a member of this server".into()));
    }

    // Transaction: insert member + atomically increment uses.
    let mut tx = state.pool.begin().await?;

    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)")
        .bind(auth.user_id())
        .bind(invite.server_id)
        .execute(&mut *tx)
        .await?;

    // Atomic uses increment — the WHERE clause prevents exceeding max_uses
    // and accepting expired invites even under concurrent requests.
    let updated = sqlx::query(
        "UPDATE server_invites SET uses = uses + 1
         WHERE id = $1
           AND (max_uses IS NULL OR uses < max_uses)
           AND (expires_at IS NULL OR expires_at > NOW())",
    )
    .bind(invite.id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    if updated == 0 {
        // The invite was maxed out or expired between our initial check and
        // this atomic UPDATE. Returning an error drops `tx` without commit,
        // which implicitly rolls back the member INSERT above.
        // This rollback is load-bearing — do not move the INSERT outside the tx.
        return Err(AppError::Validation(
            "This invite has expired or reached its maximum uses".into(),
        ));
    }

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "message": "Joined server",
            "server_id": invite.server_id,
        })),
    ))
}

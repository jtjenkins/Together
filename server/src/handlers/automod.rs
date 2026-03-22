//! Automod configuration and management handlers.
//!
//! Provides:
//! - `GET /servers/:id/automod` — Get automod config (owner only)
//! - `PATCH /servers/:id/automod` — Upsert automod config (owner only)
//! - `GET /servers/:id/automod/words` — List word filters (owner only)
//! - `POST /servers/:id/automod/words` — Add word filter (owner only)
//! - `DELETE /servers/:id/automod/words/:word` — Remove word filter (owner only)
//! - `GET /servers/:id/automod/logs` — List automod logs (owner only)
//! - `GET /servers/:id/bans` — List server bans (owner only)
//! - `DELETE /servers/:id/bans/:user_id` — Remove a ban (owner only)

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use sqlx::Row;
use uuid::Uuid;

use super::shared::{fetch_server, require_permission, PERMISSION_BAN_MEMBERS};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    handlers::audit::log_action,
    models::{
        AddWordFilterRequest, AuditAction, AutomodConfig, AutomodLog, AutomodWordFilter,
        CreateAuditLog, ServerBan, UpdateAutomodConfigRequest,
    },
    state::AppState,
    websocket::{broadcast_to_server, events::EVENT_MEMBER_UNBAN},
};

// ============================================================================
// Handlers
// ============================================================================

/// GET /servers/:id/automod — Returns 404 if no config exists yet.
///
/// Only the server owner can view automod settings.
pub async fn get_automod_config(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<AutomodConfig>> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage automod".into(),
        ));
    }

    let config = sqlx::query_as::<_, AutomodConfig>(
        "SELECT server_id, enabled, spam_enabled, spam_max_messages, spam_window_secs,
                spam_action, duplicate_enabled, word_filter_enabled, word_filter_action,
                timeout_minutes, updated_at
         FROM automod_configs WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("no automod config".into()))?;

    Ok(Json(config))
}

/// PATCH /servers/:id/automod — Upsert automod config with partial updates via COALESCE.
///
/// Only the server owner can update automod settings.
pub async fn update_automod_config(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<UpdateAutomodConfigRequest>,
) -> AppResult<Json<AutomodConfig>> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage automod".into(),
        ));
    }

    // Validate action values
    for action in [
        body.spam_action.as_deref(),
        body.word_filter_action.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !matches!(action, "delete" | "timeout" | "kick" | "ban") {
            return Err(AppError::Validation(
                "action must be delete, timeout, kick, or ban".into(),
            ));
        }
    }

    let config = sqlx::query_as::<_, AutomodConfig>(
        r#"INSERT INTO automod_configs
               (server_id, enabled, spam_enabled, spam_max_messages, spam_window_secs,
                spam_action, duplicate_enabled, word_filter_enabled, word_filter_action,
                timeout_minutes)
           VALUES (
               $1,
               COALESCE($2, FALSE),
               COALESCE($3, FALSE),
               COALESCE($4, 5),
               COALESCE($5, 5),
               COALESCE($6, 'delete'),
               COALESCE($7, FALSE),
               COALESCE($8, FALSE),
               COALESCE($9, 'delete'),
               COALESCE($10, 10)
           )
           ON CONFLICT (server_id) DO UPDATE SET
             enabled             = COALESCE($2, automod_configs.enabled),
             spam_enabled        = COALESCE($3, automod_configs.spam_enabled),
             spam_max_messages   = COALESCE($4, automod_configs.spam_max_messages),
             spam_window_secs    = COALESCE($5, automod_configs.spam_window_secs),
             spam_action         = COALESCE($6, automod_configs.spam_action),
             duplicate_enabled   = COALESCE($7, automod_configs.duplicate_enabled),
             word_filter_enabled = COALESCE($8, automod_configs.word_filter_enabled),
             word_filter_action  = COALESCE($9, automod_configs.word_filter_action),
             timeout_minutes     = COALESCE($10, automod_configs.timeout_minutes),
             updated_at          = now()
           RETURNING server_id, enabled, spam_enabled, spam_max_messages, spam_window_secs,
                     spam_action, duplicate_enabled, word_filter_enabled, word_filter_action,
                     timeout_minutes, updated_at"#,
    )
    .bind(server_id)
    .bind(body.enabled)
    .bind(body.spam_enabled)
    .bind(body.spam_max_messages)
    .bind(body.spam_window_secs)
    .bind(body.spam_action)
    .bind(body.duplicate_enabled)
    .bind(body.word_filter_enabled)
    .bind(body.word_filter_action)
    .bind(body.timeout_minutes)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(config))
}

/// GET /servers/:id/automod/words — List all word filters for a server.
///
/// Only the server owner can view word filters.
pub async fn list_word_filters(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<AutomodWordFilter>>> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage automod".into(),
        ));
    }

    let words = sqlx::query_as::<_, AutomodWordFilter>(
        "SELECT id, server_id, word, created_by, created_at
         FROM automod_word_filters WHERE server_id = $1 ORDER BY created_at ASC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(words))
}

/// POST /servers/:id/automod/words — Add a word to the filter list.
///
/// Only the server owner can add word filters.
/// Words are normalized to lowercase before storage.
pub async fn add_word_filter(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
    Json(body): Json<AddWordFilterRequest>,
) -> AppResult<(StatusCode, Json<AutomodWordFilter>)> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage automod".into(),
        ));
    }

    let word = body.word.trim().to_lowercase();
    if word.is_empty() {
        return Err(AppError::Validation("word cannot be empty".into()));
    }

    let filter = sqlx::query_as::<_, AutomodWordFilter>(
        r#"INSERT INTO automod_word_filters (server_id, word, created_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (server_id, word) DO UPDATE SET word = EXCLUDED.word
           RETURNING id, server_id, word, created_by, created_at"#,
    )
    .bind(server_id)
    .bind(&word)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(filter)))
}

/// DELETE /servers/:id/automod/words/:word — Remove a word from the filter list.
///
/// Only the server owner can remove word filters.
/// Silently succeeds even if the word was not in the list.
pub async fn remove_word_filter(
    Path((server_id, word)): Path<(Uuid, String)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage automod".into(),
        ));
    }

    sqlx::query("DELETE FROM automod_word_filters WHERE server_id = $1 AND word = $2")
        .bind(server_id)
        .bind(word.to_lowercase())
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /servers/:id/automod/logs — List the 100 most recent automod actions.
///
/// Only the server owner can view automod logs.
pub async fn list_automod_logs(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<AutomodLog>>> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can view automod logs".into(),
        ));
    }

    let logs = sqlx::query_as::<_, AutomodLog>(
        "SELECT id, server_id, channel_id, user_id, username, rule_type, action_taken,
                matched_term, message_content, created_at
         FROM automod_logs WHERE server_id = $1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(logs))
}

/// GET /servers/:id/bans — List all bans for a server.
///
/// Requires BAN_MEMBERS permission (or server owner / ADMINISTRATOR).
pub async fn list_bans(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerBan>>> {
    fetch_server(&state.pool, server_id).await?;

    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_BAN_MEMBERS,
        "You need the Ban Members permission to view bans",
    )
    .await?;

    let bans = sqlx::query_as::<_, ServerBan>(
        "SELECT user_id, server_id, banned_by, reason, created_at
         FROM server_bans WHERE server_id = $1 ORDER BY created_at DESC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(bans))
}

/// DELETE /servers/:id/bans/:user_id — Unban a user from a server.
///
/// Requires BAN_MEMBERS permission (or server owner / ADMINISTRATOR).
/// Silently succeeds even if the user was not banned.
pub async fn remove_ban(
    Path((server_id, banned_user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    fetch_server(&state.pool, server_id).await?;

    require_permission(
        &state.pool,
        server_id,
        auth.user_id(),
        PERMISSION_BAN_MEMBERS,
        "You need the Ban Members permission to manage bans",
    )
    .await?;

    sqlx::query("DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(banned_user_id)
        .execute(&state.pool)
        .await?;

    // Broadcast unban event.
    let payload = serde_json::json!({
        "server_id": server_id,
        "user_id": banned_user_id,
    });
    broadcast_to_server(&state, server_id, EVENT_MEMBER_UNBAN, payload).await;

    log_action(
        &state.pool,
        &CreateAuditLog {
            server_id,
            actor_id: auth.user_id(),
            action: AuditAction::MemberUnban,
            target_type: Some("user".into()),
            target_id: Some(banned_user_id),
            details: serde_json::json!({}),
            ip_address: None,
        },
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

// ============================================================================
// Enforcement
// ============================================================================

/// Check if a user is currently timed out in a server.
///
/// This is independent of automod config — manual timeouts also use the
/// `automod_timeouts` table, so this check applies to both automated and
/// manually-applied timeouts.
pub async fn check_timeout(pool: &sqlx::PgPool, server_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let timed_out: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM automod_timeouts WHERE server_id = $1 AND user_id = $2 AND expires_at > NOW())",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if timed_out {
        return Err(AppError::Forbidden("User is timed out".into()));
    }

    Ok(())
}

/// Returns Ok(()) if the message should be allowed, or Err(AppError::Forbidden) if blocked.
/// message_id is None for pre-insert checks, Some(id) for post-insert spam check.
pub async fn check_automod(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    user_id: Uuid,
    username: &str,
    content: &str,
    message_id: Option<Uuid>,
) -> AppResult<()> {
    // 1. Load config — if none exists or disabled, allow
    let config = sqlx::query_as::<_, crate::models::AutomodConfig>(
        "SELECT server_id, enabled, spam_enabled, spam_max_messages, spam_window_secs,
                spam_action, duplicate_enabled, word_filter_enabled, word_filter_action,
                timeout_minutes, updated_at
         FROM automod_configs WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_optional(pool)
    .await?;

    let config = match config {
        Some(c) => c,
        None => return Ok(()),
    };

    if !config.enabled {
        return Ok(());
    }

    // 2. Check active timeout — if user is timed out, block
    let now = chrono::Utc::now();
    let timeout_active = sqlx::query(
        "SELECT expires_at FROM automod_timeouts WHERE user_id = $1 AND server_id = $2 AND expires_at > $3",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(now)
    .fetch_optional(pool)
    .await?
    .is_some();

    if timeout_active {
        return Err(AppError::Forbidden("User is timed out".into()));
    }

    // 3. Word filter (pre-insert only: message_id.is_none())
    if message_id.is_none() && config.word_filter_enabled {
        let content_lower = content.to_lowercase();
        let words = sqlx::query("SELECT word FROM automod_word_filters WHERE server_id = $1")
            .bind(server_id)
            .fetch_all(pool)
            .await?;

        for row in &words {
            let Ok(word): Result<String, _> = row.try_get("word") else {
                continue;
            };
            if content_lower.contains(&word) {
                log_automod_action(
                    pool,
                    server_id,
                    channel_id,
                    user_id,
                    username,
                    "word_filter",
                    &config.word_filter_action,
                    Some(&word),
                    Some(content),
                )
                .await;
                apply_action(
                    pool,
                    server_id,
                    user_id,
                    &config.word_filter_action,
                    config.timeout_minutes,
                )
                .await?;
                return Err(AppError::Forbidden("Message blocked by word filter".into()));
            }
        }
    }

    // 4. Duplicate detection (pre-insert only)
    if message_id.is_none() && config.duplicate_enabled {
        let cutoff = now - chrono::Duration::seconds(30);
        let duplicate = sqlx::query(
            r#"SELECT id FROM messages
               WHERE channel_id = $1 AND author_id = $2 AND content = $3
                 AND created_at > $4 AND deleted = FALSE"#,
        )
        .bind(channel_id)
        .bind(user_id)
        .bind(content)
        .bind(cutoff)
        .fetch_optional(pool)
        .await?
        .is_some();

        if duplicate {
            log_automod_action(
                pool,
                server_id,
                channel_id,
                user_id,
                username,
                "duplicate",
                "delete",
                None,
                Some(content),
            )
            .await;
            return Err(AppError::Forbidden("Duplicate message blocked".into()));
        }
    }

    // 5. Spam detection (post-insert only: message_id.is_some())
    if let Some(msg_id) = message_id {
        if config.spam_enabled {
            let window_start = now - chrono::Duration::seconds(config.spam_window_secs as i64);
            let count: i64 = sqlx::query_scalar(
                r#"SELECT COUNT(*) FROM messages
                   WHERE channel_id = $1 AND author_id = $2
                     AND created_at > $3 AND deleted = FALSE"#,
            )
            .bind(channel_id)
            .bind(user_id)
            .bind(window_start)
            .fetch_one(pool)
            .await?;

            if count > config.spam_max_messages as i64 {
                // Soft-delete the message that just triggered it
                sqlx::query("UPDATE messages SET deleted = TRUE WHERE id = $1")
                    .bind(msg_id)
                    .execute(pool)
                    .await?;

                log_automod_action(
                    pool,
                    server_id,
                    channel_id,
                    user_id,
                    username,
                    "spam",
                    &config.spam_action,
                    None,
                    Some(content),
                )
                .await;
                let _ = apply_action(
                    pool,
                    server_id,
                    user_id,
                    &config.spam_action,
                    config.timeout_minutes,
                )
                .await;
            }
        }
    }

    Ok(())
}

async fn apply_action(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
    action: &str,
    timeout_minutes: i32,
) -> AppResult<()> {
    match action {
        "timeout" => {
            let expires_at = chrono::Utc::now() + chrono::Duration::minutes(timeout_minutes as i64);
            sqlx::query(
                r#"INSERT INTO automod_timeouts (user_id, server_id, expires_at)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (user_id, server_id) DO UPDATE SET expires_at = EXCLUDED.expires_at"#,
            )
            .bind(user_id)
            .bind(server_id)
            .bind(expires_at)
            .execute(pool)
            .await?;
        }
        "kick" => {
            sqlx::query("DELETE FROM server_members WHERE user_id = $1 AND server_id = $2")
                .bind(user_id)
                .bind(server_id)
                .execute(pool)
                .await?;
        }
        "ban" => {
            sqlx::query(
                r#"INSERT INTO server_bans (user_id, server_id)
                   VALUES ($1, $2)
                   ON CONFLICT (user_id, server_id) DO NOTHING"#,
            )
            .bind(user_id)
            .bind(server_id)
            .execute(pool)
            .await?;
            // Also remove from members
            sqlx::query("DELETE FROM server_members WHERE user_id = $1 AND server_id = $2")
                .bind(user_id)
                .bind(server_id)
                .execute(pool)
                .await?;
        }
        // "delete" and unknown — no server-level action (message handling is caller's responsibility)
        _ => {}
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn log_automod_action(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    channel_id: Uuid,
    user_id: Uuid,
    username: &str,
    rule_type: &str,
    action_taken: &str,
    matched_term: Option<&str>,
    message_content: Option<&str>,
) {
    // Fire-and-forget: ignore errors so automod logging never blocks message delivery
    let _ = sqlx::query(
        r#"INSERT INTO automod_logs (server_id, channel_id, user_id, username, rule_type, action_taken, matched_term, message_content)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(server_id)
    .bind(channel_id)
    .bind(user_id)
    .bind(username)
    .bind(rule_type)
    .bind(action_taken)
    .bind(matched_term)
    .bind(message_content)
    .execute(pool)
    .await;
}

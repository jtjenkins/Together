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
use uuid::Uuid;

use super::shared::fetch_server;
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{
        AddWordFilterRequest, AutomodConfig, AutomodLog, AutomodWordFilter, ServerBan,
        UpdateAutomodConfigRequest,
    },
    state::AppState,
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
/// Only the server owner can view the ban list.
pub async fn list_bans(
    Path(server_id): Path<Uuid>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerBan>>> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage bans".into(),
        ));
    }

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
/// Only the server owner can remove bans.
/// Silently succeeds even if the user was not banned.
pub async fn remove_ban(
    Path((server_id, banned_user_id)): Path<(Uuid, Uuid)>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;

    if auth.user_id() != server.owner_id {
        return Err(AppError::Forbidden(
            "Only the server owner can manage bans".into(),
        ));
    }

    sqlx::query("DELETE FROM server_bans WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(banned_user_id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

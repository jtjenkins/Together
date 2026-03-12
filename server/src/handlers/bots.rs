use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    auth::{create_access_token, AuthUser},
    bot_auth::{generate_bot_token, hash_bot_token},
    error::AppError,
    models::{Bot, BotCreatedResponse, BotDto, CreateBotDto},
    state::AppState,
};

pub async fn create_bot(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(payload): Json<CreateBotDto>,
) -> Result<(StatusCode, Json<BotCreatedResponse>), AppError> {
    if auth.is_bot() {
        return Err(AppError::Forbidden("Bots cannot create other bots".into()));
    }

    let name = payload.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(AppError::Validation(
            "Bot name must be 1–64 characters".into(),
        ));
    }
    if payload
        .description
        .as_deref()
        .map(|d| d.chars().count())
        .unwrap_or(0)
        > 512
    {
        return Err(AppError::Validation(
            "Bot description must be ≤512 characters".into(),
        ));
    }

    // Reject names whose alphanumeric content is empty (e.g., "!!!") — they
    // would produce a username with a leading hyphen after slugging.
    if !name.chars().any(|c| c.is_alphanumeric()) {
        return Err(AppError::Validation(
            "Bot name must contain at least one alphanumeric character".into(),
        ));
    }

    let short_id = &Uuid::new_v4().to_string()[..8];
    let bot_username = format!("{}-bot-{}", slug_name(&name), short_id);
    let placeholder_hash = "$2b$12$BOTS.DO.NOT.HAVE.PASSWORDS.REPLACE.WITH.LONG.INVALID.HASH";

    let mut tx = state.pool.begin().await.map_err(|e| {
        tracing::error!(error = ?e, "Failed to begin transaction");
        AppError::Internal
    })?;

    let bot_user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (username, password_hash, status, is_bot)
         VALUES ($1, $2, 'online', TRUE)
         RETURNING id",
    )
    .bind(&bot_username)
    .bind(placeholder_hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "Failed to create bot user account");
        AppError::Internal
    })?;

    let raw_token = generate_bot_token();
    let token_hash = hash_bot_token(&raw_token);

    let bot = sqlx::query_as::<_, Bot>(
        "INSERT INTO bots (user_id, name, description, token_hash, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, name, description, token_hash, created_by, revoked_at, created_at",
    )
    .bind(bot_user_id)
    .bind(&name)
    .bind(payload.description.as_deref())
    .bind(&token_hash)
    .bind(auth.user_id())
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "Failed to insert bot record");
        AppError::Internal
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!(error = ?e, "Failed to commit bot creation transaction");
        AppError::Internal
    })?;

    tracing::info!(bot_id = %bot.id, created_by = %auth.user_id(), "Bot registered");

    Ok((
        StatusCode::CREATED,
        Json(BotCreatedResponse {
            bot: bot.into(),
            token: raw_token,
        }),
    ))
}

pub async fn list_bots(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    if auth.is_bot() {
        return Err(AppError::Forbidden("Bots cannot list bots".into()));
    }

    let bots: Vec<BotDto> = sqlx::query_as::<_, Bot>(
        "SELECT id, user_id, name, description, token_hash, created_by, revoked_at, created_at
         FROM bots WHERE created_by = $1
         ORDER BY created_at ASC",
    )
    .bind(auth.user_id())
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "Failed to list bots");
        AppError::Internal
    })?
    .into_iter()
    .map(BotDto::from)
    .collect();

    Ok(Json(json!({ "bots": bots })))
}

pub async fn get_bot(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(bot_id): Path<Uuid>,
) -> Result<Json<BotDto>, AppError> {
    if auth.is_bot() {
        return Err(AppError::Forbidden(
            "Bots cannot access bot management endpoints".into(),
        ));
    }

    let bot = sqlx::query_as::<_, Bot>(
        "SELECT id, user_id, name, description, token_hash, created_by, revoked_at, created_at
         FROM bots WHERE id = $1 AND created_by = $2",
    )
    .bind(bot_id)
    .bind(auth.user_id())
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "Failed to fetch bot");
        AppError::Internal
    })?
    .ok_or_else(|| AppError::NotFound("Bot not found".into()))?;

    Ok(Json(bot.into()))
}

pub async fn revoke_bot(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(bot_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    if auth.is_bot() {
        return Err(AppError::Forbidden("Bots cannot revoke bots".into()));
    }

    let rows_affected = sqlx::query(
        "UPDATE bots SET revoked_at = NOW()
         WHERE id = $1 AND created_by = $2 AND revoked_at IS NULL",
    )
    .bind(bot_id)
    .bind(auth.user_id())
    .execute(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, bot_id = %bot_id, "Failed to revoke bot");
        AppError::Internal
    })?
    .rows_affected();

    if rows_affected == 0 {
        return Err(AppError::NotFound(
            "Bot not found or already revoked".into(),
        ));
    }

    tracing::info!(bot_id = %bot_id, revoked_by = %auth.user_id(), "Bot revoked");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn regenerate_bot_token(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(bot_id): Path<Uuid>,
) -> Result<Json<BotCreatedResponse>, AppError> {
    if auth.is_bot() {
        return Err(AppError::Forbidden("Bots cannot regenerate tokens".into()));
    }

    let bot = sqlx::query_as::<_, Bot>(
        "SELECT id, user_id, name, description, token_hash, created_by, revoked_at, created_at
         FROM bots WHERE id = $1 AND created_by = $2",
    )
    .bind(bot_id)
    .bind(auth.user_id())
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "Failed to fetch bot for token regeneration");
        AppError::Internal
    })?
    .ok_or_else(|| AppError::NotFound("Bot not found".into()))?;

    if bot.revoked_at.is_some() {
        return Err(AppError::Validation(
            "Cannot regenerate token for a revoked bot. Create a new bot instead.".into(),
        ));
    }

    let raw_token = generate_bot_token();
    let token_hash = hash_bot_token(&raw_token);

    let updated_bot = sqlx::query_as::<_, Bot>(
        "UPDATE bots SET token_hash = $1 WHERE id = $2 AND created_by = $3
         RETURNING id, user_id, name, description, token_hash, created_by, revoked_at, created_at",
    )
    .bind(&token_hash)
    .bind(bot_id)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "Failed to update bot token");
        AppError::Internal
    })?;

    tracing::info!(bot_id = %bot_id, "Bot token regenerated");
    Ok(Json(BotCreatedResponse {
        bot: updated_bot.into(),
        token: raw_token,
    }))
}

/// POST /bots/connect — Exchange a static bot token for a short-lived JWT.
///
/// Bots should use this endpoint to obtain a short-lived access token (15 min)
/// for WebSocket connections via `?token=<jwt>`. This avoids exposing the
/// static bot token in server/proxy access logs.
///
/// Returns: {"access_token": "<jwt>"}
pub async fn bot_connect(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    if !auth.is_bot() {
        return Err(AppError::Forbidden(
            "Only bots can use this endpoint".into(),
        ));
    }

    let token = create_access_token(
        auth.user_id(),
        auth.username().to_string(),
        &state.jwt_secret,
    )
    .map_err(|_| AppError::Internal)?;

    Ok(Json(json!({ "access_token": token })))
}

fn slug_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_name_lowercases_and_replaces_spaces() {
        assert_eq!(slug_name("My Cool Bot"), "my-cool-bot");
    }

    #[test]
    fn slug_name_handles_special_chars() {
        assert_eq!(slug_name("Bot!@#123"), "bot---123");
    }

    #[test]
    fn slug_name_preserves_alphanumeric() {
        assert_eq!(slug_name("GuildBot2"), "guildbot2");
    }

    #[test]
    fn slug_name_trims_hyphens() {
        assert_eq!(slug_name("  Bot  "), "bot");
    }

    #[test]
    fn slug_name_all_special_chars_returns_empty_or_hyphens() {
        // This tests the edge case documented in code review: all-special input
        let result = slug_name("!!!");
        // trim_matches('-') on "---" should give ""
        assert_eq!(
            result, "",
            "all-special-char input should produce empty string after trim"
        );
    }

    #[test]
    fn slug_name_mixed_unicode_lowercases_ascii_replaces_non_ascii() {
        // ASCII portion lowercased, non-ASCII (non-alphanumeric) replaced with hyphens
        let result = slug_name("Bot-v2.0");
        assert_eq!(result, "bot-v2-0");
    }
}

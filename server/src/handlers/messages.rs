use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use uuid::Uuid;
use validator::Validate;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CreateMessageDto, Message, UpdateMessageDto},
    state::AppState,
};
use super::shared::{fetch_channel_by_id, fetch_server, require_member};

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct CreateMessageRequest {
    #[validate(length(min = 1, max = 4000, message = "Message content must be 1–4 000 characters"))]
    pub content: String,
    pub reply_to: Option<Uuid>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateMessageRequest {
    #[validate(length(min = 1, max = 4000, message = "Message content must be 1–4 000 characters"))]
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ListMessagesQuery {
    /// Return messages created before this message ID (cursor-based pagination).
    pub before: Option<Uuid>,
    /// Maximum number of messages to return (default 50, max 100).
    pub limit: Option<i64>,
}

// ============================================================================
// Private helpers
// ============================================================================

fn validation_error(e: validator::ValidationErrors) -> AppError {
    AppError::Validation(
        e.field_errors()
            .values()
            .flat_map(|v| v.iter())
            .filter_map(|e| e.message.as_ref())
            .map(|m| m.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    )
}

/// Fetch a message by ID, returning 404 if deleted or not found.
async fn fetch_message(pool: &sqlx::PgPool, message_id: Uuid) -> AppResult<Message> {
    sqlx::query_as::<_, Message>(
        "SELECT id, channel_id, author_id, content, reply_to, edited_at, deleted, created_at
         FROM messages WHERE id = $1 AND deleted = FALSE",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /channels/:channel_id/messages — send a message (members only).
pub async fn create_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<CreateMessageRequest>,
) -> AppResult<(StatusCode, Json<Message>)> {
    req.validate().map_err(validation_error)?;

    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    // Validate reply_to target exists in the same channel, if provided.
    if let Some(reply_to_id) = req.reply_to {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE id = $1 AND channel_id = $2 AND deleted = FALSE)",
        )
        .bind(reply_to_id)
        .bind(channel_id)
        .fetch_one(&state.pool)
        .await?;

        if !exists {
            return Err(AppError::NotFound("Reply target message not found".into()));
        }
    }

    let dto = CreateMessageDto {
        content: req.content,
        reply_to: req.reply_to,
    };

    let message = sqlx::query_as::<_, Message>(
        "INSERT INTO messages (channel_id, author_id, content, reply_to)
         VALUES ($1, $2, $3, $4)
         RETURNING id, channel_id, author_id, content, reply_to, edited_at, deleted, created_at",
    )
    .bind(channel_id)
    .bind(auth.user_id())
    .bind(&dto.content)
    .bind(dto.reply_to)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(message)))
}

/// GET /channels/:channel_id/messages — list messages with cursor pagination (members only).
///
/// Returns up to `limit` messages (default 50, max 100), ordered newest-first.
/// Pass `before=<message_id>` to paginate backwards through history.
pub async fn list_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<ListMessagesQuery>,
) -> AppResult<Json<Vec<Message>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    let messages = if let Some(before_id) = query.before {
        sqlx::query_as::<_, Message>(
            "SELECT id, channel_id, author_id, content, reply_to, edited_at, deleted, created_at
             FROM messages
             WHERE channel_id = $1
               AND deleted = FALSE
               AND created_at < (SELECT created_at FROM messages WHERE id = $2)
             ORDER BY created_at DESC
             LIMIT $3",
        )
        .bind(channel_id)
        .bind(before_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Message>(
            "SELECT id, channel_id, author_id, content, reply_to, edited_at, deleted, created_at
             FROM messages
             WHERE channel_id = $1 AND deleted = FALSE
             ORDER BY created_at DESC
             LIMIT $2",
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(messages))
}

/// PATCH /messages/:message_id — edit a message's content (author only).
pub async fn update_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(req): Json<UpdateMessageRequest>,
) -> AppResult<Json<Message>> {
    req.validate().map_err(validation_error)?;

    let message = fetch_message(&state.pool, message_id).await?;

    if message.author_id != Some(auth.user_id()) {
        return Err(AppError::Forbidden(
            "Only the message author can edit it".into(),
        ));
    }

    let dto = UpdateMessageDto {
        content: req.content,
    };

    let updated = sqlx::query_as::<_, Message>(
        "UPDATE messages
         SET content = $1, edited_at = NOW()
         WHERE id = $2
         RETURNING id, channel_id, author_id, content, reply_to, edited_at, deleted, created_at",
    )
    .bind(&dto.content)
    .bind(message_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(updated))
}

/// DELETE /messages/:message_id — soft-delete a message (author or server owner).
///
/// The message row is retained with `deleted = TRUE`; no content is returned.
pub async fn delete_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let message = fetch_message(&state.pool, message_id).await?;

    // Resolve the server this message belongs to (message → channel → server).
    let channel = fetch_channel_by_id(&state.pool, message.channel_id).await?;
    let server = fetch_server(&state.pool, channel.server_id).await?;

    let is_author = message.author_id == Some(auth.user_id());
    let is_owner = server.owner_id == auth.user_id();

    if !is_author && !is_owner {
        return Err(AppError::Forbidden(
            "Only the message author or server owner can delete it".into(),
        ));
    }

    sqlx::query("UPDATE messages SET deleted = TRUE WHERE id = $1")
        .bind(message_id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

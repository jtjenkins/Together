use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Channel, Message, Server, ServerMember},
};

/// Convert [`validator::ValidationErrors`] into an [`AppError::Validation`] with
/// a human-readable message. Shared across all handler modules to avoid
/// copy-pasting the same boilerplate.
pub fn validation_error(e: validator::ValidationErrors) -> AppError {
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

/// Fetch a non-deleted message by ID, returning 404 if not found or deleted.
pub async fn fetch_message(pool: &sqlx::PgPool, message_id: Uuid) -> AppResult<Message> {
    sqlx::query_as::<_, Message>(
        "SELECT id, channel_id, author_id, content, reply_to,
                mention_user_ids, mention_everyone, thread_id,
                0 AS thread_reply_count, edited_at, deleted, created_at
         FROM messages WHERE id = $1 AND deleted = FALSE",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))
}

/// Fetch a channel by its ID alone (no server scope), returning 404 if not found.
pub async fn fetch_channel_by_id(pool: &sqlx::PgPool, channel_id: Uuid) -> AppResult<Channel> {
    sqlx::query_as::<_, Channel>(
        "SELECT id, server_id, name, type, position, category, topic, created_at
         FROM channels WHERE id = $1",
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))
}

/// Fetch a server row, returning 404 if it does not exist.
pub async fn fetch_server(pool: &sqlx::PgPool, server_id: Uuid) -> AppResult<Server> {
    sqlx::query_as::<_, Server>(
        "SELECT id, name, owner_id, icon_url, is_public, created_at, updated_at
         FROM servers WHERE id = $1",
    )
    .bind(server_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))
}

/// Verify the user is a member of the server.
///
/// Returns 404 (not 403) when the user is not a member — this prevents leaking
/// information about server existence to unauthenticated or non-member users.
pub async fn require_member(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<ServerMember> {
    sqlx::query_as::<_, ServerMember>(
        "SELECT user_id, server_id, nickname, joined_at
         FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))
}

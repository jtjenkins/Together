use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use super::messages::enrich_messages;
use super::shared::{fetch_channel_by_id, fetch_message, require_manage_messages, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Message, MessageDto},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{EVENT_MESSAGE_PIN, EVENT_MESSAGE_UNPIN},
    },
};

// ============================================================================
// Handlers
// ============================================================================

/// POST /channels/:channel_id/messages/:message_id/pin
///
/// Pin a message in a channel.  Requires the MANAGE_MESSAGES permission
/// (or ADMINISTRATOR, or server ownership).  Idempotent — pinning an already-
/// pinned message succeeds without error.
#[utoipa::path(
    post,
    path = "/channels/{channel_id}/messages/{message_id}/pin",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("message_id" = Uuid, Path, description = "Message ID"),
    ),
    responses(
        (status = 204, description = "Message pinned"),
    ),
    security(("bearer_auth" = [])),
    tag = "Pins"
)]
pub async fn pin_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_manage_messages(&state.pool, channel.server_id, auth.user_id()).await?;

    let msg = fetch_message(&state.pool, message_id).await?;
    if msg.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let result = sqlx::query(
        "UPDATE messages
         SET pinned = TRUE, pinned_by = $2, pinned_at = NOW()
         WHERE id = $1 AND pinned = FALSE",
    )
    .bind(message_id)
    .bind(auth.user_id())
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        // Already pinned — idempotent success, no event needed.
        return Ok(StatusCode::NO_CONTENT);
    }

    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_MESSAGE_PIN,
        serde_json::json!({
            "message_id": message_id,
            "channel_id": channel_id,
            "pinned_by": auth.user_id(),
        }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /channels/:channel_id/messages/:message_id/pin
///
/// Unpin a message in a channel.  Requires the MANAGE_MESSAGES permission.
/// Returns 404 if the message is not currently pinned.
#[utoipa::path(
    delete,
    path = "/channels/{channel_id}/messages/{message_id}/pin",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
        ("message_id" = Uuid, Path, description = "Message ID"),
    ),
    responses(
        (status = 204, description = "Message unpinned"),
        (status = 404, description = "Message is not pinned"),
    ),
    security(("bearer_auth" = [])),
    tag = "Pins"
)]
pub async fn unpin_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_manage_messages(&state.pool, channel.server_id, auth.user_id()).await?;

    let msg = fetch_message(&state.pool, message_id).await?;
    if msg.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let result = sqlx::query(
        "UPDATE messages
         SET pinned = FALSE, pinned_by = NULL, pinned_at = NULL
         WHERE id = $1 AND pinned = TRUE",
    )
    .bind(message_id)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Message is not pinned".into()));
    }

    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_MESSAGE_UNPIN,
        serde_json::json!({
            "message_id": message_id,
            "channel_id": channel_id,
            "unpinned_by": auth.user_id(),
        }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /channels/:channel_id/pinned-messages
///
/// List all pinned messages in a channel, ordered by pin time (newest first).
/// Any server member can view pinned messages.
#[utoipa::path(
    get,
    path = "/channels/{channel_id}/pinned-messages",
    params(
        ("channel_id" = Uuid, Path, description = "Channel ID"),
    ),
    responses(
        (status = 200, description = "List of pinned messages", body = Vec<MessageDto>),
    ),
    security(("bearer_auth" = [])),
    tag = "Pins"
)]
pub async fn list_pinned_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<MessageDto>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let messages = sqlx::query_as::<_, Message>(
        "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to,
                m.mention_user_ids, m.mention_everyone, m.thread_id,
                COALESCE(
                    (SELECT COUNT(*)::int FROM messages t
                     WHERE t.thread_id = m.id AND t.deleted = FALSE),
                    0
                ) AS thread_reply_count,
                m.edited_at, m.deleted, m.created_at,
                m.pinned, m.pinned_by, m.pinned_at
         FROM messages m
         WHERE m.channel_id = $1 AND m.pinned = TRUE AND m.deleted = FALSE
         ORDER BY m.pinned_at DESC",
    )
    .bind(channel_id)
    .fetch_all(&state.pool)
    .await?;

    let enriched = enrich_messages(&state.pool, auth.user_id(), messages).await?;
    Ok(Json(enriched))
}

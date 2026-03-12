use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, fetch_message, require_manage_messages, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::MessageDto,
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
pub async fn list_pinned_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<MessageDto>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    #[derive(sqlx::FromRow)]
    struct PinnedRow {
        id: Uuid,
        channel_id: Uuid,
        author_id: Option<Uuid>,
        content: String,
        reply_to: Option<Uuid>,
        mention_user_ids: Vec<Uuid>,
        mention_everyone: bool,
        thread_id: Option<Uuid>,
        edited_at: Option<chrono::DateTime<chrono::Utc>>,
        deleted: bool,
        created_at: chrono::DateTime<chrono::Utc>,
        pinned: bool,
        pinned_by: Option<Uuid>,
        pinned_at: Option<chrono::DateTime<chrono::Utc>>,
    }

    let rows = sqlx::query_as::<_, PinnedRow>(
        "SELECT id, channel_id, author_id, content, reply_to,
                mention_user_ids, mention_everyone, thread_id,
                edited_at, deleted, created_at,
                pinned, pinned_by, pinned_at
         FROM messages
         WHERE channel_id = $1 AND pinned = TRUE AND deleted = FALSE
         ORDER BY pinned_at DESC",
    )
    .bind(channel_id)
    .fetch_all(&state.pool)
    .await?;

    let dtos = rows
        .into_iter()
        .map(|r| MessageDto {
            id: r.id,
            channel_id: r.channel_id,
            author_id: r.author_id,
            content: r.content,
            reply_to: r.reply_to,
            mention_user_ids: r.mention_user_ids,
            mention_everyone: r.mention_everyone,
            thread_id: r.thread_id,
            thread_reply_count: 0,
            edited_at: r.edited_at,
            deleted: r.deleted,
            created_at: r.created_at,
            pinned: r.pinned,
            pinned_by: r.pinned_by,
            pinned_at: r.pinned_at,
            poll: None,
            event: None,
        })
        .collect();

    Ok(Json(dtos))
}

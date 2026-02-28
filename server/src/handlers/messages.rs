use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use super::shared::{
    fetch_channel_by_id, fetch_message, fetch_server, require_member, validation_error,
};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CreateMessageDto, Message, MessageDto, PollDto, ServerEventDto, UpdateMessageDto},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{
            EVENT_MESSAGE_CREATE, EVENT_MESSAGE_DELETE, EVENT_MESSAGE_UPDATE,
            EVENT_THREAD_MESSAGE_CREATE,
        },
    },
};

use super::polls::fetch_poll_dto;

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct CreateMessageRequest {
    #[validate(length(
        min = 1,
        max = 4000,
        message = "Message content must be 1–4 000 characters"
    ))]
    pub content: String,
    pub reply_to: Option<Uuid>,
}

/// Request body for posting a reply into a thread.
///
/// Intentionally excludes `reply_to` — thread replies are always children of
/// the root message identified by the URL parameter, never quote-replies.
#[derive(Debug, Deserialize, Validate)]
pub struct CreateThreadReplyRequest {
    #[validate(length(
        min = 1,
        max = 4000,
        message = "Message content must be 1–4 000 characters"
    ))]
    pub content: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateMessageRequest {
    #[validate(length(
        min = 1,
        max = 4000,
        message = "Message content must be 1–4 000 characters"
    ))]
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ListMessagesQuery {
    /// Cursor: return messages created strictly before the message with this ID.
    ///
    /// The ID is resolved to a `(created_at, id)` pair server-side, so the
    /// actual comparison is on timestamp + UUID — not the ID alone. This gives
    /// a stable total order even when two messages share an identical timestamp.
    ///
    /// If the cursor ID does not exist or belongs to a different channel the
    /// query returns an empty array (no error).
    pub before: Option<Uuid>,
    /// Maximum number of messages to return (default 50, max 100).
    pub limit: Option<i64>,
}

// ============================================================================
// Private helpers
// ============================================================================

/// Row types for enrich_messages sub-queries
#[derive(sqlx::FromRow)]
struct PollMapRow {
    id: uuid::Uuid,
    message_id: uuid::Uuid,
}

#[derive(sqlx::FromRow)]
struct EventMapRow {
    id: uuid::Uuid,
    message_id: uuid::Uuid,
    name: String,
    description: Option<String>,
    starts_at: chrono::DateTime<chrono::Utc>,
    created_by: Option<uuid::Uuid>,
    created_at: chrono::DateTime<chrono::Utc>,
}

/// Batch-enrich a list of messages with poll and event data.
/// Runs 2 queries regardless of message count (no N+1 for event/poll mapping),
/// plus one query per poll found on this page (typically 0–2 per page).
async fn enrich_messages(
    pool: &sqlx::PgPool,
    caller_id: uuid::Uuid,
    messages: Vec<Message>,
) -> AppResult<Vec<MessageDto>> {
    if messages.is_empty() {
        return Ok(vec![]);
    }

    let ids: Vec<uuid::Uuid> = messages.iter().map(|m| m.id).collect();

    // Map message_id → (poll_id, channel_id)
    let poll_rows = sqlx::query_as::<_, PollMapRow>(
        "SELECT id, message_id FROM polls WHERE message_id = ANY($1)",
    )
    .bind(&ids as &[uuid::Uuid])
    .fetch_all(pool)
    .await?;

    // Map message_id → ServerEventDto
    let event_rows = sqlx::query_as::<_, EventMapRow>(
        "SELECT id, message_id, name, description, starts_at, created_by, created_at
         FROM server_events WHERE message_id = ANY($1)",
    )
    .bind(&ids as &[uuid::Uuid])
    .fetch_all(pool)
    .await?;

    // Build poll_id map: message_id → poll_id
    let poll_id_map: std::collections::HashMap<uuid::Uuid, uuid::Uuid> =
        poll_rows.iter().map(|r| (r.message_id, r.id)).collect();

    // Build event map: message_id → ServerEventDto
    let mut event_map: std::collections::HashMap<uuid::Uuid, ServerEventDto> = event_rows
        .into_iter()
        .map(|r| {
            (
                r.message_id,
                ServerEventDto {
                    id: r.id,
                    name: r.name,
                    description: r.description,
                    starts_at: r.starts_at,
                    created_by: r.created_by,
                    created_at: r.created_at,
                },
            )
        })
        .collect();

    // Fetch PollDtos (one call per poll; typically 0–2 per page)
    let mut poll_dto_map: std::collections::HashMap<uuid::Uuid, PollDto> =
        std::collections::HashMap::new();
    for (msg_id, poll_id) in &poll_id_map {
        if let Ok(dto) = fetch_poll_dto(pool, *poll_id, caller_id).await {
            poll_dto_map.insert(*msg_id, dto);
        }
    }

    Ok(messages
        .into_iter()
        .map(|m| {
            let id = m.id;
            let mut dto = MessageDto::from_message(m);
            dto.poll = poll_dto_map.remove(&id);
            dto.event = event_map.remove(&id);
            dto
        })
        .collect())
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
) -> AppResult<(StatusCode, Json<MessageDto>)> {
    req.validate().map_err(validation_error)?;

    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    // Validate reply_to: target must exist in the same channel and not be deleted.
    if let Some(reply_to_id) = req.reply_to {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM messages
                 WHERE id = $1 AND channel_id = $2 AND deleted = FALSE
             )",
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

    // Parse @mention tokens from content.
    // Use token-level check to avoid matching mid-word (e.g. "email@everyone.com").
    let mention_everyone = dto.content.split_whitespace().any(|word| {
        word.strip_prefix('@')
            .map(|name| {
                name.trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_') == "everyone"
            })
            .unwrap_or(false)
    });
    let mention_words: Vec<&str> = dto
        .content
        .split_whitespace()
        .filter_map(|word| {
            // Strip trailing punctuation so "@alice!" resolves to "alice".
            word.strip_prefix('@')
                .map(|name| name.trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_'))
        })
        .filter(|name| !name.is_empty() && *name != "everyone")
        .collect();

    // Resolve @username tokens to user IDs among current server members.
    let mention_user_ids: Vec<uuid::Uuid> = if mention_words.is_empty() {
        vec![]
    } else {
        sqlx::query_scalar(
            "SELECT sm.user_id FROM server_members sm
             JOIN users u ON u.id = sm.user_id
             WHERE sm.server_id = $1 AND u.username = ANY($2)",
        )
        .bind(channel.server_id)
        .bind(&mention_words as &[&str])
        .fetch_all(&state.pool)
        .await?
    };

    let message = sqlx::query_as::<_, Message>(
        "INSERT INTO messages (channel_id, author_id, content, reply_to, mention_user_ids, mention_everyone)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, channel_id, author_id, content, reply_to,
                   mention_user_ids, mention_everyone, thread_id,
                   0 AS thread_reply_count, edited_at, deleted, created_at",
    )
    .bind(channel_id)
    .bind(auth.user_id())
    .bind(&dto.content)
    .bind(dto.reply_to)
    .bind(&mention_user_ids as &[uuid::Uuid])
    .bind(mention_everyone)
    .fetch_one(&state.pool)
    .await?;

    let enriched = enrich_messages(&state.pool, auth.user_id(), vec![message]).await?;
    let dto = enriched
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Internal)?;

    // Broadcast MESSAGE_CREATE to all connected server members.
    match serde_json::to_value(&dto) {
        Ok(payload) => {
            broadcast_to_server(&state, channel.server_id, EVENT_MESSAGE_CREATE, payload).await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize MessageDto for broadcast");
        }
    }

    Ok((StatusCode::CREATED, Json(dto)))
}

/// GET /channels/:channel_id/messages — list messages with cursor pagination (members only).
///
/// Returns up to `limit` messages (default 50, max 100), ordered newest-first.
/// Pass `before=<message_id>` to paginate backwards.
///
/// The cursor uses a compound `(created_at, id)` comparison to give a stable
/// total order even when messages share an identical timestamp.
pub async fn list_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<ListMessagesQuery>,
) -> AppResult<Json<Vec<MessageDto>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    // Thread replies are excluded from the main channel list (thread_id IS NULL).
    // A subquery supplies the live reply count for each root message.
    let messages = if let Some(before_id) = query.before {
        // Compound cursor: (created_at, id) gives a total order even when
        // two messages land in the same microsecond.
        sqlx::query_as::<_, Message>(
            "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to,
                    m.mention_user_ids, m.mention_everyone, m.thread_id,
                    COALESCE(
                      (SELECT COUNT(*)::int FROM messages t
                       WHERE t.thread_id = m.id AND t.deleted = FALSE),
                      0
                    ) AS thread_reply_count,
                    m.edited_at, m.deleted, m.created_at
             FROM messages m
             WHERE m.channel_id = $1
               AND m.thread_id IS NULL
               AND m.deleted = FALSE
               AND (m.created_at, m.id) < (
                   SELECT created_at, id FROM messages WHERE id = $2
               )
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT $3",
        )
        .bind(channel_id)
        .bind(before_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Message>(
            "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to,
                    m.mention_user_ids, m.mention_everyone, m.thread_id,
                    COALESCE(
                      (SELECT COUNT(*)::int FROM messages t
                       WHERE t.thread_id = m.id AND t.deleted = FALSE),
                      0
                    ) AS thread_reply_count,
                    m.edited_at, m.deleted, m.created_at
             FROM messages m
             WHERE m.channel_id = $1 AND m.thread_id IS NULL AND m.deleted = FALSE
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT $2",
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    };

    let enriched = enrich_messages(&state.pool, auth.user_id(), messages).await?;
    Ok(Json(enriched))
}

/// PATCH /messages/:message_id — edit a message's content (author only).
pub async fn update_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    Json(req): Json<UpdateMessageRequest>,
) -> AppResult<Json<MessageDto>> {
    req.validate().map_err(validation_error)?;

    let message = fetch_message(&state.pool, message_id).await?;

    // Verify the caller is still a member of the server that owns this channel.
    let channel = fetch_channel_by_id(&state.pool, message.channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    if message.author_id != Some(auth.user_id()) {
        return Err(AppError::Forbidden(
            "Only the message author can edit it".into(),
        ));
    }

    let dto = UpdateMessageDto {
        content: req.content,
    };

    // Re-parse @mentions from the new content (same logic as create_message).
    let mention_everyone = dto.content.split_whitespace().any(|word| {
        word.strip_prefix('@')
            .map(|name| {
                name.trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_') == "everyone"
            })
            .unwrap_or(false)
    });
    let mention_words: Vec<&str> = dto
        .content
        .split_whitespace()
        .filter_map(|word| {
            word.strip_prefix('@')
                .map(|name| name.trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_'))
        })
        .filter(|name| !name.is_empty() && *name != "everyone")
        .collect();
    let mention_user_ids: Vec<uuid::Uuid> = if mention_words.is_empty() {
        vec![]
    } else {
        sqlx::query_scalar(
            "SELECT sm.user_id FROM server_members sm
             JOIN users u ON u.id = sm.user_id
             WHERE sm.server_id = $1 AND u.username = ANY($2)",
        )
        .bind(channel.server_id)
        .bind(&mention_words as &[&str])
        .fetch_all(&state.pool)
        .await?
    };

    // AND deleted = FALSE guards against editing a message that was soft-deleted
    // between the fetch above and this update (TOCTOU).
    // The thread_reply_count subquery returns the live count so the broadcast
    // carries the correct value (not a hardcoded 0).
    let updated = sqlx::query_as::<_, Message>(
        "UPDATE messages
         SET content = $1, edited_at = NOW(),
             mention_user_ids = $3, mention_everyone = $4
         WHERE id = $2 AND deleted = FALSE
         RETURNING id, channel_id, author_id, content, reply_to,
                   mention_user_ids, mention_everyone, thread_id,
                   COALESCE(
                     (SELECT COUNT(*)::int FROM messages t
                      WHERE t.thread_id = messages.id AND t.deleted = FALSE),
                     0
                   ) AS thread_reply_count,
                   edited_at, deleted, created_at",
    )
    .bind(&dto.content)
    .bind(message_id)
    .bind(&mention_user_ids as &[uuid::Uuid])
    .bind(mention_everyone)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    let enriched = enrich_messages(&state.pool, auth.user_id(), vec![updated]).await?;
    let dto = enriched
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Internal)?;

    // Broadcast MESSAGE_UPDATE to all connected server members.
    match serde_json::to_value(&dto) {
        Ok(payload) => {
            broadcast_to_server(&state, channel.server_id, EVENT_MESSAGE_UPDATE, payload).await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize MessageDto for broadcast");
        }
    }

    Ok(Json(dto))
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

    // Verify the caller is still an active member.
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let is_author = message.author_id == Some(auth.user_id());
    let is_owner = server.owner_id == auth.user_id();

    if !is_author && !is_owner {
        return Err(AppError::Forbidden(
            "Only the message author or server owner can delete it".into(),
        ));
    }

    // AND deleted = FALSE ensures rows_affected() == 0 on a concurrent double-delete.
    let result =
        sqlx::query("UPDATE messages SET deleted = TRUE WHERE id = $1 AND deleted = FALSE")
            .bind(message_id)
            .execute(&state.pool)
            .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Message not found".into()));
    }

    // Broadcast MESSAGE_DELETE to all connected server members.
    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_MESSAGE_DELETE,
        json!({ "id": message_id, "channel_id": message.channel_id }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /channels/:channel_id/messages/:message_id/thread — post a reply into a thread.
///
/// The parent message must be a root message (`thread_id IS NULL`). Thread replies
/// cannot themselves be threaded (no nested threads). Returns 400 if the parent is
/// already a thread reply.
pub async fn create_thread_reply(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<CreateThreadReplyRequest>,
) -> AppResult<(StatusCode, Json<MessageDto>)> {
    req.validate().map_err(validation_error)?;

    // Auth check first — fetch the channel and verify membership before
    // reading any message data, to avoid leaking message existence to non-members.
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let parent = fetch_message(&state.pool, message_id).await?;

    // Verify the parent message belongs to the requested channel.
    if parent.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    // Reject attempts to thread off a thread reply.
    if parent.thread_id.is_some() {
        return Err(AppError::Validation(
            "Cannot create a thread from a thread reply".into(),
        ));
    }

    // Parse @mentions (same logic as create_message).
    let mention_everyone = req.content.split_whitespace().any(|word| {
        word.strip_prefix('@')
            .map(|name| {
                name.trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_') == "everyone"
            })
            .unwrap_or(false)
    });
    let mention_words: Vec<&str> = req
        .content
        .split_whitespace()
        .filter_map(|word| {
            word.strip_prefix('@')
                .map(|name| name.trim_end_matches(|c: char| !c.is_alphanumeric() && c != '_'))
        })
        .filter(|name| !name.is_empty() && *name != "everyone")
        .collect();
    let mention_user_ids: Vec<uuid::Uuid> = if mention_words.is_empty() {
        vec![]
    } else {
        sqlx::query_scalar(
            "SELECT sm.user_id FROM server_members sm
             JOIN users u ON u.id = sm.user_id
             WHERE sm.server_id = $1 AND u.username = ANY($2)",
        )
        .bind(channel.server_id)
        .bind(&mention_words as &[&str])
        .fetch_all(&state.pool)
        .await?
    };

    let message = sqlx::query_as::<_, Message>(
        "INSERT INTO messages
           (channel_id, author_id, content, thread_id, mention_user_ids, mention_everyone)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, channel_id, author_id, content, reply_to,
                   mention_user_ids, mention_everyone, thread_id,
                   0 AS thread_reply_count, edited_at, deleted, created_at",
    )
    .bind(channel_id)
    .bind(auth.user_id())
    .bind(&req.content)
    .bind(message_id)
    .bind(&mention_user_ids as &[uuid::Uuid])
    .bind(mention_everyone)
    .fetch_one(&state.pool)
    .await?;

    let enriched = enrich_messages(&state.pool, auth.user_id(), vec![message]).await?;
    let dto = enriched
        .into_iter()
        .next()
        .ok_or_else(|| AppError::Internal)?;

    // Broadcast THREAD_MESSAGE_CREATE to all connected server members.
    match serde_json::to_value(&dto) {
        Ok(payload) => {
            broadcast_to_server(
                &state,
                channel.server_id,
                EVENT_THREAD_MESSAGE_CREATE,
                payload,
            )
            .await;
        }
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize MessageDto for broadcast");
        }
    }

    Ok((StatusCode::CREATED, Json(dto)))
}

/// GET /channels/:channel_id/messages/:message_id/thread — list thread replies.
///
/// Replies are returned in ascending order (oldest first) — threads read top-to-bottom.
/// Cursor pagination via `before=<uuid>`: pass the ID of the *newest* reply already
/// displayed to receive the next page of older replies (used when scrolling up). Replies
/// that come *after* the cursor in time are not returned; this is appropriate for
/// history loading. Pass no cursor for the initial load (returns the first page
/// ordered oldest-first). The `thread_reply_count` field defaults to 0 on these rows
/// (it is only meaningful on root messages in the channel list).
pub async fn list_thread_replies(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
    Query(query): Query<ListMessagesQuery>,
) -> AppResult<Json<Vec<MessageDto>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    // Verify the parent message exists and belongs to this channel.
    let parent = fetch_message(&state.pool, message_id).await?;
    if parent.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    let replies = if let Some(before_id) = query.before {
        // Compound cursor: scope the subquery to this thread to prevent
        // cross-thread timestamp leakage.  ASC order with `>` means "replies
        // that arrived after the cursor" — correct for forward pagination in a
        // thread displayed oldest-first.
        sqlx::query_as::<_, Message>(
            "SELECT id, channel_id, author_id, content, reply_to,
                    mention_user_ids, mention_everyone, thread_id,
                    0 AS thread_reply_count, edited_at, deleted, created_at
             FROM messages
             WHERE thread_id = $1
               AND deleted = FALSE
               AND (created_at, id) > (
                   SELECT created_at, id FROM messages
                   WHERE id = $2 AND thread_id = $1
               )
             ORDER BY created_at ASC, id ASC
             LIMIT $3",
        )
        .bind(message_id)
        .bind(before_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, Message>(
            "SELECT id, channel_id, author_id, content, reply_to,
                    mention_user_ids, mention_everyone, thread_id,
                    0 AS thread_reply_count, edited_at, deleted, created_at
             FROM messages
             WHERE thread_id = $1 AND deleted = FALSE
             ORDER BY created_at ASC, id ASC
             LIMIT $2",
        )
        .bind(message_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    };

    let enriched = enrich_messages(&state.pool, auth.user_id(), replies).await?;
    Ok(Json(enriched))
}

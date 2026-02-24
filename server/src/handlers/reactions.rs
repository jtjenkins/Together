use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, fetch_message, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::ReactionCount,
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{EVENT_REACTION_ADD, EVENT_REACTION_REMOVE},
    },
};

// ============================================================================
// Helpers
// ============================================================================

/// Maximum byte length of an emoji string accepted by the API.
const MAX_EMOJI_BYTES: usize = 64;

fn validate_emoji(emoji: &str) -> AppResult<()> {
    if emoji.is_empty() || emoji.len() > MAX_EMOJI_BYTES {
        return Err(AppError::Validation(
            "Emoji must be between 1 and 64 bytes".into(),
        ));
    }
    Ok(())
}

// ============================================================================
// Handlers
// ============================================================================

/// PUT /channels/:channel_id/messages/:message_id/reactions/:emoji
///
/// Add an emoji reaction to a message.  Idempotent — adding the same emoji
/// twice is not an error (the duplicate is silently ignored).
pub async fn add_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id, emoji)): Path<(Uuid, Uuid, String)>,
) -> AppResult<StatusCode> {
    validate_emoji(&emoji)?;

    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    // Verify the message belongs to this channel and is not deleted.
    let msg = fetch_message(&state.pool, message_id).await?;
    if msg.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    // ON CONFLICT DO NOTHING — idempotent, no error on duplicate.
    sqlx::query(
        "INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING",
    )
    .bind(message_id)
    .bind(auth.user_id())
    .bind(&emoji)
    .execute(&state.pool)
    .await?;

    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_REACTION_ADD,
        serde_json::json!({
            "message_id": message_id,
            "channel_id": channel_id,
            "user_id": auth.user_id(),
            "emoji": emoji,
        }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /channels/:channel_id/messages/:message_id/reactions/:emoji
///
/// Remove the authenticated user's reaction from a message.
/// Returns 404 if the message or reaction does not exist.
pub async fn remove_reaction(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id, emoji)): Path<(Uuid, Uuid, String)>,
) -> AppResult<StatusCode> {
    validate_emoji(&emoji)?;

    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let msg = fetch_message(&state.pool, message_id).await?;
    if msg.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    let result = sqlx::query(
        "DELETE FROM message_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
    )
    .bind(message_id)
    .bind(auth.user_id())
    .bind(&emoji)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Reaction not found".into()));
    }

    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_REACTION_REMOVE,
        serde_json::json!({
            "message_id": message_id,
            "channel_id": channel_id,
            "user_id": auth.user_id(),
            "emoji": emoji,
        }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /channels/:channel_id/messages/:message_id/reactions
///
/// List aggregated reaction counts for a message, with a `me` flag indicating
/// whether the authenticated user has added each reaction.
pub async fn list_reactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<Vec<ReactionCount>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let msg = fetch_message(&state.pool, message_id).await?;
    if msg.channel_id != channel_id {
        return Err(AppError::NotFound("Message not found".into()));
    }

    #[derive(sqlx::FromRow)]
    struct Row {
        emoji: String,
        count: i64,
        me: bool,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT
             emoji,
             COUNT(*) AS count,
             BOOL_OR(user_id = $2) AS me
         FROM message_reactions
         WHERE message_id = $1
         GROUP BY emoji
         ORDER BY MIN(created_at) ASC",
    )
    .bind(message_id)
    .bind(auth.user_id())
    .fetch_all(&state.pool)
    .await?;

    let reactions = rows
        .into_iter()
        .map(|r| ReactionCount {
            emoji: r.emoji,
            count: r.count,
            me: r.me,
        })
        .collect();

    Ok(Json(reactions))
}

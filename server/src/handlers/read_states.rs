use axum::{
    extract::{Path, State},
    http::StatusCode,
};
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, require_member};
use crate::{auth::AuthUser, error::AppResult, state::AppState};

/// POST /channels/:channel_id/ack — mark a server channel as read.
///
/// Upserts the user's read-state to `NOW()`.  Called by the client whenever
/// the user views a channel (tab focus, navigation).
pub async fn ack_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    sqlx::query(
        "INSERT INTO channel_read_states (user_id, channel_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, channel_id)
         DO UPDATE SET last_read_at = EXCLUDED.last_read_at",
    )
    .bind(auth.user_id())
    .bind(channel_id)
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /dm-channels/:channel_id/ack — mark a DM channel as read.
pub async fn ack_dm_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    // Verify membership.
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM direct_message_members
             WHERE channel_id = $1 AND user_id = $2
         )",
    )
    .bind(channel_id)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await?;

    if !is_member {
        return Err(crate::error::AppError::NotFound(
            "DM channel not found".into(),
        ));
    }

    sqlx::query(
        "INSERT INTO channel_read_states (user_id, channel_id, last_read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, channel_id)
         DO UPDATE SET last_read_at = EXCLUDED.last_read_at",
    )
    .bind(auth.user_id())
    .bind(channel_id)
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{ChannelType, UpdateVoiceStateRequest, VoiceState},
    state::AppState,
    websocket::{broadcast_to_server, events::EVENT_VOICE_STATE_UPDATE},
};

// ============================================================================
// Private helpers
// ============================================================================

/// Return 400 if the channel is not a voice channel.
fn require_voice_channel(channel: &crate::models::Channel) -> AppResult<()> {
    if !matches!(channel.r#type, ChannelType::Voice) {
        return Err(AppError::Validation(
            "Channel is not a voice channel".into(),
        ));
    }
    Ok(())
}

/// Look up a user's username and broadcast VOICE_STATE_UPDATE for an active state.
async fn broadcast_voice_update(state: &AppState, vs: &VoiceState, server_id: Uuid) {
    let username: Option<String> = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(vs.user_id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);

    let payload = json!({
        "user_id":     vs.user_id,
        "username":    username,
        "channel_id":  vs.channel_id,
        "self_mute":   vs.self_mute,
        "self_deaf":   vs.self_deaf,
        "server_mute": vs.server_mute,
        "server_deaf": vs.server_deaf,
        "joined_at":   vs.joined_at,
    });

    broadcast_to_server(state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
}

/// Broadcast VOICE_STATE_UPDATE indicating the user has left all voice channels.
async fn broadcast_voice_leave(state: &AppState, user_id: Uuid, server_id: Uuid) {
    let username: Option<String> = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);

    let payload = json!({
        "user_id":     user_id,
        "username":    username,
        "channel_id":  serde_json::Value::Null,
        "self_mute":   false,
        "self_deaf":   false,
        "server_mute": false,
        "server_deaf": false,
        "joined_at":   serde_json::Value::Null,
    });

    broadcast_to_server(state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /channels/:channel_id/voice — join a voice channel.
///
/// Uses UPSERT so the user is atomically moved from any prior channel to
/// this one. Self-mute and self-deaf are reset on channel switch.
pub async fn join_voice_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<VoiceState>)> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;

    let vs = sqlx::query_as::<_, VoiceState>(
        "INSERT INTO voice_states (user_id, channel_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
             SET channel_id = EXCLUDED.channel_id,
                 self_mute  = FALSE,
                 self_deaf  = FALSE,
                 joined_at  = NOW()
         RETURNING user_id, channel_id, self_mute, self_deaf,
                   server_mute, server_deaf, joined_at",
    )
    .bind(auth.user_id())
    .bind(channel_id)
    .fetch_one(&state.pool)
    .await?;

    broadcast_voice_update(&state, &vs, channel.server_id).await;

    Ok((StatusCode::CREATED, Json(vs)))
}

/// DELETE /channels/:channel_id/voice — leave a voice channel.
///
/// Returns 404 if the user is not currently in this specific channel.
pub async fn leave_voice_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;

    let result = sqlx::query("DELETE FROM voice_states WHERE user_id = $1 AND channel_id = $2")
        .bind(auth.user_id())
        .bind(channel_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Not in this voice channel".into()));
    }

    broadcast_voice_leave(&state, auth.user_id(), channel.server_id).await;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /channels/:channel_id/voice — update self-mute / self-deaf state.
///
/// Returns 404 if the user is not currently in this channel.
pub async fn update_voice_state(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<UpdateVoiceStateRequest>,
) -> AppResult<Json<VoiceState>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;

    let vs = sqlx::query_as::<_, VoiceState>(
        "UPDATE voice_states
         SET self_mute = COALESCE($1, self_mute),
             self_deaf = COALESCE($2, self_deaf)
         WHERE user_id = $3 AND channel_id = $4
         RETURNING user_id, channel_id, self_mute, self_deaf,
                   server_mute, server_deaf, joined_at",
    )
    .bind(req.self_mute)
    .bind(req.self_deaf)
    .bind(auth.user_id())
    .bind(channel_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Not in this voice channel".into()))?;

    broadcast_voice_update(&state, &vs, channel.server_id).await;

    Ok(Json(vs))
}

/// GET /channels/:channel_id/voice — list all participants (members only).
pub async fn list_voice_participants(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<VoiceState>>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;

    let participants = sqlx::query_as::<_, VoiceState>(
        "SELECT user_id, channel_id, self_mute, self_deaf, server_mute, server_deaf, joined_at
         FROM voice_states
         WHERE channel_id = $1
         ORDER BY joined_at ASC",
    )
    .bind(channel_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(participants))
}

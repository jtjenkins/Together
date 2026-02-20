use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{ChannelType, UpdateVoiceStateRequest, VoiceState, VoiceStateDto},
    state::AppState,
    websocket::{broadcast_to_server, events::EVENT_VOICE_STATE_UPDATE},
};

// ============================================================================
// Private helpers
// ============================================================================

/// Returns `AppError::Validation` (HTTP 400) if the channel's type is not `Voice`.
fn require_voice_channel(channel: &crate::models::Channel) -> AppResult<()> {
    if !matches!(channel.r#type, ChannelType::Voice) {
        return Err(AppError::Validation(
            "Channel is not a voice channel".into(),
        ));
    }
    Ok(())
}

/// Fetch a user's username for broadcast payloads.
///
/// On DB error: logs a warning and returns `None` so the broadcast still
/// fires — the REST operation has already succeeded and the state change
/// should still be announced to other members.
async fn fetch_username_for_broadcast(state: &AppState, user_id: Uuid) -> Option<String> {
    match sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(opt) => opt,
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error = ?e,
                "Failed to fetch username for VOICE_STATE_UPDATE broadcast; \
                 proceeding with null username"
            );
            None
        }
    }
}

/// Broadcast VOICE_STATE_UPDATE for an active voice state.
///
/// The payload is derived from `VoiceStateDto` (ensuring all DTO fields are
/// included automatically if the type grows) with `username` injected
/// separately since it is not part of the stored voice state.
async fn broadcast_voice_update(state: &AppState, vs: &VoiceState, server_id: Uuid) {
    let username = fetch_username_for_broadcast(state, vs.user_id).await;
    let dto = VoiceStateDto::from(vs.clone());

    let mut payload = match serde_json::to_value(&dto) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize VoiceStateDto; this is a programming error");
            return;
        }
    };
    if let serde_json::Value::Object(ref mut map) = payload {
        map.insert("username".to_owned(), serde_json::json!(username));
    }

    broadcast_to_server(state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
}

/// Broadcast VOICE_STATE_UPDATE with `channel_id: null`, indicating the user
/// has left their voice channel.
///
/// Uses `VoiceStateDto` for the base payload so field additions to the DTO
/// automatically appear in this broadcast as well.
async fn broadcast_voice_leave(state: &AppState, user_id: Uuid, server_id: Uuid) {
    let username = fetch_username_for_broadcast(state, user_id).await;
    let dto = VoiceStateDto {
        user_id,
        channel_id: None,
        self_mute: false,
        self_deaf: false,
        server_mute: false,
        server_deaf: false,
        joined_at: None,
    };

    let mut payload = match serde_json::to_value(&dto) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize VoiceStateDto; this is a programming error");
            return;
        }
    };
    if let serde_json::Value::Object(ref mut map) = payload {
        map.insert("username".to_owned(), serde_json::json!(username));
    }

    broadcast_to_server(state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /channels/:channel_id/voice — join a voice channel.
///
/// Uses UPSERT to atomically move the user from any prior channel to this one.
/// `self_mute` and `self_deaf` are reset to `false` on channel switch.
/// `server_mute` and `server_deaf` are intentionally preserved so
/// moderator-applied restrictions survive channel switches.
pub async fn join_voice_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<VoiceStateDto>)> {
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

    Ok((StatusCode::CREATED, Json(VoiceStateDto::from(vs))))
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
/// At least one field must be provided; an empty body returns 400.
/// Returns 404 if the user is not currently in this channel.
pub async fn update_voice_state(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<UpdateVoiceStateRequest>,
) -> AppResult<Json<VoiceStateDto>> {
    if req.self_mute.is_none() && req.self_deaf.is_none() {
        return Err(AppError::Validation(
            "At least one field (self_mute or self_deaf) must be provided".into(),
        ));
    }

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

    Ok(Json(VoiceStateDto::from(vs)))
}

/// GET /channels/:channel_id/voice — list all participants (members only).
pub async fn list_voice_participants(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<Vec<VoiceStateDto>>> {
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
    .await?
    .into_iter()
    .map(VoiceStateDto::from)
    .collect();

    Ok(Json(participants))
}

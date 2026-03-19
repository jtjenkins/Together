use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::ChannelType,
    state::{AppState, GoLiveSession},
    websocket::{
        broadcast_to_server,
        events::{EVENT_GO_LIVE_START, EVENT_GO_LIVE_STOP},
    },
};

/// Allowed quality tiers for a Go Live session.
const VALID_QUALITIES: &[&str] = &["480p", "720p", "1080p"];

// ============================================================================
// Request / response types
// ============================================================================

#[derive(Debug, Deserialize)]
pub struct StartGoLiveRequest {
    /// Quality tier: "480p" | "720p" | "1080p". Defaults to "720p".
    pub quality: Option<String>,
}

// ============================================================================
// Private helpers
// ============================================================================

fn require_voice_channel(channel: &crate::models::Channel) -> AppResult<()> {
    if !matches!(channel.r#type, ChannelType::Voice) {
        return Err(AppError::Validation(
            "Channel is not a voice channel".into(),
        ));
    }
    Ok(())
}

/// Verify the requesting user is currently in the target voice channel.
async fn require_in_voice_channel(
    state: &AppState,
    user_id: Uuid,
    channel_id: Uuid,
) -> AppResult<()> {
    let in_channel: Option<bool> =
        sqlx::query_scalar("SELECT TRUE FROM voice_states WHERE user_id = $1 AND channel_id = $2")
            .bind(user_id)
            .bind(channel_id)
            .fetch_optional(&state.pool)
            .await?;

    if in_channel.is_none() {
        return Err(AppError::Validation(
            "You must be in the voice channel to go live".into(),
        ));
    }
    Ok(())
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /channels/:channel_id/go-live — start a Go Live broadcast.
///
/// Enforces: one broadcaster per channel, broadcaster must be in the channel.
/// Broadcasts `GO_LIVE_START` to all server members on success.
pub async fn start_go_live(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<StartGoLiveRequest>,
) -> AppResult<(StatusCode, Json<GoLiveSession>)> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;
    require_in_voice_channel(&state, auth.user_id(), channel_id).await?;

    let quality = req.quality.unwrap_or_else(|| "720p".to_string());

    if !VALID_QUALITIES.contains(&quality.as_str()) {
        return Err(AppError::Validation(
            "quality must be one of: 480p, 720p, 1080p".into(),
        ));
    }

    let session = {
        let mut sessions = state.go_live_sessions.write().await;

        // Reject if someone else is already live in this channel.
        if let Some(existing) = sessions.get(&channel_id) {
            if existing.broadcaster_id != auth.user_id() {
                return Err(AppError::Validation(
                    "Another user is already broadcasting in this channel".into(),
                ));
            }
            // Caller is already the broadcaster — update quality and return.
        }

        let session = GoLiveSession {
            broadcaster_id: auth.user_id(),
            quality: quality.clone(),
            started_at: Utc::now(),
        };
        sessions.insert(channel_id, session.clone());
        session
    };

    // Broadcast to all server members so viewers can show the Go Live banner.
    let payload = serde_json::json!({
        "channel_id":     channel_id,
        "broadcaster_id": session.broadcaster_id,
        "quality":        session.quality,
        "started_at":     session.started_at,
    });
    broadcast_to_server(&state, channel.server_id, EVENT_GO_LIVE_START, payload).await;

    Ok((StatusCode::CREATED, Json(session)))
}

/// DELETE /channels/:channel_id/go-live — end the active Go Live broadcast.
///
/// Only the current broadcaster (or a server admin) may stop the session.
/// Broadcasts `GO_LIVE_STOP` to all server members.
pub async fn stop_go_live(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;

    {
        let mut sessions = state.go_live_sessions.write().await;
        let session = sessions.get(&channel_id).ok_or_else(|| {
            AppError::NotFound("No active Go Live session in this channel".into())
        })?;

        if session.broadcaster_id != auth.user_id() {
            return Err(AppError::Forbidden(
                "Only the broadcaster can end the Go Live session".into(),
            ));
        }

        sessions.remove(&channel_id);
    }

    let payload = serde_json::json!({
        "channel_id":     channel_id,
        "broadcaster_id": auth.user_id(),
    });
    broadcast_to_server(&state, channel.server_id, EVENT_GO_LIVE_STOP, payload).await;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /channels/:channel_id/go-live — get the active Go Live session, if any.
///
/// Returns 200 with the session JSON when live, 404 when no session is active.
pub async fn get_go_live(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
) -> AppResult<Json<serde_json::Value>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;
    require_voice_channel(&channel)?;

    let sessions = state.go_live_sessions.read().await;
    match sessions.get(&channel_id) {
        Some(session) => Ok(Json(serde_json::json!({
            "channel_id":     channel_id,
            "broadcaster_id": session.broadcaster_id,
            "quality":        session.quality,
            "started_at":     session.started_at,
        }))),
        None => Err(AppError::NotFound("No active Go Live session".into())),
    }
}

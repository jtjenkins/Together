use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures::{SinkExt, StreamExt};
use serde_json::json;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::events::{
    GatewayMessage, GatewayOp, EVENT_PRESENCE_UPDATE, EVENT_READY, EVENT_VOICE_SIGNAL,
};
use crate::{
    auth::{validate_token, TokenType},
    models::{Server, User, UserDto},
    state::AppState,
};

// ============================================================================
// Query params
// ============================================================================

/// JWT is passed as a query parameter because WebSocket upgrade requests are
/// plain GET requests and cannot carry an Authorization header reliably across
/// all client environments.
///
/// Note: query-parameter tokens appear in server and proxy access logs; use
/// short-lived access tokens to limit exposure.
#[derive(Debug, serde::Deserialize)]
pub struct WsParams {
    pub token: String,
}

// ============================================================================
// Upgrade handler
// ============================================================================

/// GET /ws?token=<access_token> — upgrade to a WebSocket connection.
///
/// The JWT is validated before the upgrade is accepted; invalid tokens get a
/// plain 401 without an upgrade attempt.
pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsParams>,
    State(state): State<AppState>,
) -> Response {
    let claims = match validate_token(&params.token, &state.jwt_secret) {
        Ok(c) => c,
        Err(_) => {
            return (StatusCode::UNAUTHORIZED, "Invalid or expired token").into_response();
        }
    };

    // Reject refresh tokens used as WebSocket credentials.
    if claims.token_type != TokenType::Access {
        return (StatusCode::UNAUTHORIZED, "Access token required").into_response();
    }

    let user_id = match claims.user_id() {
        Ok(id) => id,
        Err(_) => {
            return (StatusCode::UNAUTHORIZED, "Invalid token subject").into_response();
        }
    };

    ws.on_upgrade(move |socket| handle_socket(socket, user_id, state))
}

// ============================================================================
// Connection lifecycle
// ============================================================================

async fn handle_socket(socket: WebSocket, user_id: Uuid, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Build and send READY before registering so the client receives user
    // context before any events can arrive.
    let ready_json = match build_ready(&state, user_id).await {
        Some(json) => json,
        None => {
            tracing::warn!(
                user_id = %user_id,
                "Failed to build READY payload; closing connection"
            );
            return;
        }
    };

    if ws_sender.send(Message::Text(ready_json)).await.is_err() {
        // Client disconnected before READY could be sent.
        return;
    }

    // Register connection and go online *after* READY is delivered,
    // so no broadcast events can arrive before the client has its initial state.
    let conn_id = state.connections.add(user_id, tx).await;
    set_presence(&state, user_id, "online", None).await;

    // Forward outbound events from the mpsc channel to the WebSocket.
    let mut send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Handle inbound messages from the client.
    let state_clone = state.clone();
    let mut recv_task = tokio::spawn(async move {
        loop {
            match ws_receiver.next().await {
                Some(Ok(msg)) => match msg {
                    Message::Text(text) => {
                        handle_client_message(user_id, &text, &state_clone).await;
                    }
                    Message::Close(_) => break,
                    // Axum handles Pong frames automatically; Ping frames are
                    // echoed back transparently by the underlying library.
                    _ => {}
                },
                Some(Err(e)) => {
                    tracing::debug!(
                        user_id = %user_id,
                        error = ?e,
                        "WebSocket receive error; closing connection"
                    );
                    break;
                }
                None => break,
            }
        }
    });

    // Wait for either task to finish — then abort the other.
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    // Clean up on disconnect.
    state.connections.remove(user_id, conn_id).await;
    set_presence(&state, user_id, "offline", None).await;
}

// ============================================================================
// Inbound message handling
// ============================================================================

/// Process a text frame received from the client.
async fn handle_client_message(user_id: Uuid, text: &str, state: &AppState) {
    let Ok(msg) = serde_json::from_str::<GatewayMessage>(text) else {
        // Ignore unparseable frames — don't disconnect for bad JSON.
        return;
    };

    match msg.op {
        GatewayOp::Heartbeat => {
            let ack = GatewayMessage::heartbeat_ack();
            if let Ok(json) = serde_json::to_string(&ack) {
                state.connections.send_to_user(user_id, &json).await;
            }
        }
        GatewayOp::PresenceUpdate => {
            if let Some(data) = msg.d {
                let status = data["status"].as_str().unwrap_or("online");
                // Reject status values that violate the DB CHECK constraint.
                if !matches!(status, "online" | "away" | "dnd" | "offline") {
                    return;
                }
                let custom_status = data["custom_status"].as_str().map(ToOwned::to_owned);
                set_presence(state, user_id, status, custom_status).await;
            }
        }
        GatewayOp::VoiceSignal => {
            if let Some(data) = msg.d {
                handle_voice_signal(user_id, data, state).await;
            }
        }
        // Client should not send Dispatch or HeartbeatAck — silently ignore.
        _ => {}
    }
}

// ============================================================================
// Voice signaling relay
// ============================================================================

/// Relay a WebRTC SDP/ICE signal from `user_id` to the target peer.
///
/// Both users must be in the same voice channel; signals for users in
/// different channels are silently dropped to prevent cross-channel leakage.
async fn handle_voice_signal(user_id: Uuid, data: serde_json::Value, state: &AppState) {
    let to_user_id = match data["to_user_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
    {
        Some(id) => id,
        None => return,
    };

    // Verify co-membership in the same voice channel before relaying.
    let same_channel: bool = match sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM voice_states vs1
             JOIN voice_states vs2 ON vs1.channel_id = vs2.channel_id
             WHERE vs1.user_id = $1 AND vs2.user_id = $2
         )",
    )
    .bind(user_id)
    .bind(to_user_id)
    .fetch_one(&state.pool)
    .await
    {
        Ok(b) => b,
        Err(_) => return,
    };

    if !same_channel {
        return;
    }

    // Forward the signal with from_user_id substituted for to_user_id.
    let relayed = serde_json::json!({
        "from_user_id": user_id,
        "type":         data["type"],
        "sdp":          data["sdp"],
        "candidate":    data["candidate"],
    });

    let event = GatewayMessage::dispatch(EVENT_VOICE_SIGNAL, relayed);
    if let Ok(json) = serde_json::to_string(&event) {
        state.connections.send_to_user(to_user_id, &json).await;
    }
}

// ============================================================================
// READY event
// ============================================================================

/// Build the READY event payload for the connecting user.
///
/// Returns `None` if the user no longer exists in the database or if a
/// database error occurs. Either case is treated as fatal for this
/// connection's READY handshake.
async fn build_ready(state: &AppState, user_id: Uuid) -> Option<String> {
    let user: UserDto = sqlx::query_as::<_, User>(
        "SELECT id, username, email, password_hash, avatar_url, status, custom_status,
                created_at, updated_at
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .ok()??
    .into();

    let servers = sqlx::query_as::<_, Server>(
        "SELECT s.id, s.name, s.owner_id, s.icon_url, s.created_at, s.updated_at
         FROM servers s
         JOIN server_members sm ON s.id = sm.server_id
         WHERE sm.user_id = $1
         ORDER BY s.created_at ASC",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let payload =
        GatewayMessage::dispatch(EVENT_READY, json!({ "user": user, "servers": servers }));

    serde_json::to_string(&payload).ok()
}

// ============================================================================
// Presence
// ============================================================================

/// Update a user's status in the database and broadcast a PRESENCE_UPDATE
/// event to all server co-members. Members without an active WebSocket
/// connection are silently skipped by `broadcast_to_users`.
pub async fn set_presence(
    state: &AppState,
    user_id: Uuid,
    status: &str,
    custom_status: Option<String>,
) {
    // Persist status — non-fatal if this fails.
    if let Err(e) = sqlx::query("UPDATE users SET status = $1, custom_status = $2 WHERE id = $3")
        .bind(status)
        .bind(custom_status.as_deref())
        .bind(user_id)
        .execute(&state.pool)
        .await
    {
        tracing::warn!(
            user_id = %user_id,
            error = ?e,
            "Failed to persist presence status; broadcast will still proceed"
        );
    }

    // Collect all co-members across every server this user belongs to.
    let member_ids: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT DISTINCT sm2.user_id
         FROM server_members sm1
         JOIN server_members sm2 ON sm1.server_id = sm2.server_id
         WHERE sm1.user_id = $1 AND sm2.user_id != $1",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error = ?e,
                "Failed to fetch co-members for presence broadcast; update will not be delivered"
            );
            return;
        }
    };

    let event = GatewayMessage::dispatch(
        EVENT_PRESENCE_UPDATE,
        json!({
            "user_id": user_id,
            "status": status,
            "custom_status": custom_status,
        }),
    );

    match serde_json::to_string(&event) {
        Ok(json) => {
            state
                .connections
                .broadcast_to_users(&member_ids, &json)
                .await;
        }
        Err(e) => {
            tracing::error!(
                user_id = %user_id,
                error = ?e,
                "Failed to serialize presence event; this is a programming error"
            );
        }
    }
}

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

use super::events::{GatewayMessage, GatewayOp, EVENT_PRESENCE_UPDATE, EVENT_READY};
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

    // Register this connection so other handlers can push events to this user.
    state.connections.add(user_id, tx).await;

    // Set user online and notify their server members.
    set_presence(&state, user_id, "online", None).await;

    // Send READY event synchronously before spawning the forwarding task.
    if let Some(ready_json) = build_ready(&state, user_id).await {
        if ws_sender.send(Message::Text(ready_json)).await.is_err() {
            // Client disconnected during READY — clean up and bail.
            state.connections.remove(user_id).await;
            set_presence(&state, user_id, "offline", None).await;
            return;
        }
    }

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
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    handle_client_message(user_id, &text, &state_clone).await;
                }
                Message::Close(_) => break,
                // Axum handles Pong frames automatically; Ping frames are
                // echoed back transparently by the underlying library.
                _ => {}
            }
        }
    });

    // Wait for either task to finish — then abort the other.
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    // Clean up on disconnect.
    state.connections.remove(user_id).await;
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
                let custom_status = data["custom_status"].as_str().map(ToOwned::to_owned);
                set_presence(state, user_id, status, custom_status).await;
            }
        }
        // Client should not send Dispatch or HeartbeatAck — silently ignore.
        _ => {}
    }
}

// ============================================================================
// READY event
// ============================================================================

/// Build the READY event payload for the connecting user.
///
/// Returns `None` (and logs a warning) only if the user no longer exists in
/// the database — which should not happen in practice.
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
/// event to all online members who share a server with that user.
pub async fn set_presence(
    state: &AppState,
    user_id: Uuid,
    status: &str,
    custom_status: Option<String>,
) {
    // Persist status — non-fatal if this fails.
    let _ = sqlx::query("UPDATE users SET status = $1, custom_status = $2 WHERE id = $3")
        .bind(status)
        .bind(custom_status.as_deref())
        .bind(user_id)
        .execute(&state.pool)
        .await;

    // Collect all co-members across every server this user belongs to.
    let member_ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT sm2.user_id
         FROM server_members sm1
         JOIN server_members sm2 ON sm1.server_id = sm2.server_id
         WHERE sm1.user_id = $1 AND sm2.user_id != $1",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let event = GatewayMessage::dispatch(
        EVENT_PRESENCE_UPDATE,
        json!({
            "user_id": user_id,
            "status": status,
            "custom_status": custom_status,
        }),
    );

    if let Ok(json) = serde_json::to_string(&event) {
        state
            .connections
            .broadcast_to_users(&member_ids, &json)
            .await;
    }
}

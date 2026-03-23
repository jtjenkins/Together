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
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::events::{
    GatewayMessage, GatewayOp, EVENT_PRESENCE_UPDATE, EVENT_READY, EVENT_TYPING_START,
    EVENT_VOICE_SIGNAL, EVENT_VOICE_STATE_UPDATE,
};
use crate::{
    auth::{validate_token, TokenType},
    models::{DirectMessageChannelDto, Role, Server, UnreadCount, User, UserDto, VoiceStateDto},
    state::AppState,
};

/// Per-channel mention count returned in the READY payload.
#[derive(Debug, sqlx::FromRow, serde::Serialize)]
struct MentionCount {
    channel_id: Uuid,
    count: i64,
}

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
    /// JWT access token for human users.
    pub token: Option<String>,
    /// Static bot token for bot connections. Prefer using POST /bots/connect to
    /// exchange this for a short-lived JWT (`token` param) to avoid the static
    /// token appearing in server access logs.
    pub bot_token: Option<String>,
}

// ============================================================================
// Upgrade handler
// ============================================================================

/// GET /ws?token=<access_token> — upgrade to a WebSocket connection.
/// GET /ws?bot_token=<static_token> — upgrade as a bot.
///
/// The token is validated before the upgrade is accepted; invalid tokens get a
/// plain 401 without an upgrade attempt.
pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WsParams>,
    State(state): State<AppState>,
) -> Response {
    let user_id = if let Some(jwt) = params.token {
        // ── Human user: JWT auth ──────────────────────────────────────────
        let claims = match validate_token(&jwt, &state.jwt_secret) {
            Ok(c) => c,
            Err(_) => {
                return (StatusCode::UNAUTHORIZED, "Invalid or expired token").into_response()
            }
        };
        if claims.token_type != TokenType::Access {
            return (StatusCode::UNAUTHORIZED, "Access token required").into_response();
        }
        match claims.user_id() {
            Ok(id) => id,
            Err(_) => return (StatusCode::UNAUTHORIZED, "Invalid token subject").into_response(),
        }
    } else if let Some(raw_token) = params.bot_token {
        // ── Bot: static token auth ────────────────────────────────────────
        // Note: the per-bot rate limiter (50 req/s) is enforced in the REST
        // auth extractor but not here, because WebSocket connections are
        // persistent resources rather than per-request calls. Abuse of the
        // WS upgrade itself is bounded by connection limits at the TCP/HTTP
        // layer. Prefer POST /bots/connect → ?token=<jwt> to use the limiter.
        use crate::bot_auth::hash_bot_token;
        let token_hash = hash_bot_token(&raw_token);

        #[derive(sqlx::FromRow)]
        struct BotLookup {
            user_id: Uuid,
            revoked_at: Option<chrono::DateTime<chrono::Utc>>,
        }

        let row = sqlx::query_as::<_, BotLookup>(
            "SELECT user_id, revoked_at FROM bots WHERE token_hash = $1",
        )
        .bind(&token_hash)
        .fetch_optional(&state.pool)
        .await;

        match row {
            Ok(Some(b)) if b.revoked_at.is_none() => b.user_id,
            Ok(Some(_)) => return (StatusCode::UNAUTHORIZED, "Bot token revoked").into_response(),
            Ok(None) => return (StatusCode::UNAUTHORIZED, "Invalid bot token").into_response(),
            Err(e) => {
                tracing::warn!(error = ?e, "DB error during bot WS auth");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Auth error").into_response();
            }
        }
    } else {
        return (
            StatusCode::UNAUTHORIZED,
            "token or bot_token query parameter required",
        )
            .into_response();
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
    set_presence(&state, user_id, "online", None, None).await;

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
        let mut last_messages: Vec<Instant> = Vec::new();
        loop {
            tokio::select! {
                msg = ws_receiver.next() => {
                    match msg {
                        Some(Ok(msg)) => {
                            // Frame size limit: reject oversized frames for all payload types.
                            let payload_len = match &msg {
                                Message::Text(text) => text.len(),
                                Message::Binary(bin) => bin.len(),
                                Message::Ping(ping) => ping.len(),
                                Message::Pong(pong) => pong.len(),
                                _ => 0,
                            };
                            if payload_len > 16_384 {
                                tracing::warn!(
                                    user_id = %user_id,
                                    len = payload_len,
                                    "WebSocket frame too large, closing connection"
                                );
                                break;
                            }

                            match msg {
                                Message::Text(text) => {
                                    // Per-connection rate limit: max 20 messages per second.
                                    let now = Instant::now();
                                    last_messages.retain(|t| now.duration_since(*t) < Duration::from_secs(1));
                                    if last_messages.len() >= 20 {
                                        tracing::warn!(user_id = %user_id, "WebSocket rate limit exceeded");
                                        continue;
                                    }
                                    last_messages.push(now);

                                    handle_client_message(user_id, &text, &state_clone).await;
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
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
                _ = tokio::time::sleep(Duration::from_secs(300)) => {
                    tracing::info!(user_id = %user_id, "WebSocket idle timeout, disconnecting");
                    break;
                }
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
    cleanup_voice_on_disconnect(&state, user_id).await;
    set_presence(&state, user_id, "offline", None, None).await;
}

// ============================================================================
// Inbound message handling
// ============================================================================

/// Process a text frame received from the client.
async fn handle_client_message(user_id: Uuid, text: &str, state: &AppState) {
    let Ok(msg) = serde_json::from_str::<GatewayMessage>(text) else {
        // Ignore unparseable frames — don't disconnect for bad JSON.
        tracing::debug!(user_id = %user_id, "Received unparseable WebSocket frame; ignoring");
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
                let activity = data["activity"].as_str().map(ToOwned::to_owned);
                set_presence(state, user_id, status, custom_status, activity).await;
            }
        }
        GatewayOp::TypingStart => {
            if let Some(data) = msg.d {
                handle_typing_start(user_id, data, state).await;
            }
        }
        GatewayOp::VoiceSignal => match msg.d {
            Some(data) => handle_voice_signal(user_id, data, state).await,
            None => {
                tracing::debug!(
                    user_id = %user_id,
                    "VoiceSignal frame missing data payload; dropping"
                );
            }
        },
        // Client should not send Dispatch or HeartbeatAck; log at debug so
        // client-side protocol bugs are visible without polluting warn logs.
        _ => {
            tracing::debug!(
                user_id = %user_id,
                op = ?msg.op,
                "Client sent unexpected gateway opcode; ignoring"
            );
        }
    }
}

// ============================================================================
// Voice disconnect cleanup
// ============================================================================

/// Combined DB row used to look up a user's active voice state plus the
/// server it belongs to in a single query.
#[derive(sqlx::FromRow)]
struct VoiceCleanupRow {
    channel_id: Uuid,
    server_id: Uuid,
    username: String,
}

/// Remove a disconnecting user from their voice channel (if any) and
/// broadcast a `VOICE_STATE_UPDATE` leave event to the server.
///
/// Called from the `handle_socket` cleanup path so that an abrupt disconnect
/// (browser close, network drop) does not leave a ghost participant in the
/// voice channel participant list.
async fn cleanup_voice_on_disconnect(state: &AppState, user_id: Uuid) {
    let row = sqlx::query_as::<_, VoiceCleanupRow>(
        "SELECT vs.channel_id, c.server_id, u.username
         FROM voice_states vs
         JOIN channels c ON vs.channel_id = c.id
         JOIN users    u ON vs.user_id     = u.id
         WHERE vs.user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await;

    let VoiceCleanupRow {
        channel_id,
        server_id,
        username,
    } = match row {
        Ok(Some(r)) => r,
        Ok(None) => return, // user was not in a voice channel
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error   = ?e,
                "Failed to query voice state during disconnect cleanup"
            );
            return;
        }
    };

    // Scope the DELETE to the specific channel_id captured above.
    // This prevents a race where the user reconnects and joins a new channel
    // between the SELECT and DELETE — without the channel_id guard the stale
    // cleanup would destroy the new connection's voice state.
    if let Err(e) = sqlx::query("DELETE FROM voice_states WHERE user_id = $1 AND channel_id = $2")
        .bind(user_id)
        .bind(channel_id)
        .execute(&state.pool)
        .await
    {
        tracing::warn!(
            user_id    = %user_id,
            channel_id = %channel_id,
            error      = ?e,
            "Failed to remove voice state on disconnect; participant list may be stale"
        );
        // Still attempt the broadcast. Two scenarios:
        // 1. A concurrent REST leave already deleted the row — broadcasting
        //    here is safe and ensures clients see the leave even if the REST
        //    broadcast raced with this cleanup.
        // 2. A genuine DB failure — the row is still present, but we broadcast
        //    a "left" event anyway, accepting a temporary inconsistency between
        //    the DB state and client views until the next channel join or
        //    server restart reconciles state.
    }

    // Build the leave payload via VoiceStateDto::leave so future field
    // additions automatically propagate to disconnect leave broadcasts.
    let dto = VoiceStateDto::leave(user_id);
    let mut payload = match serde_json::to_value(&dto) {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(
                user_id = %user_id,
                error   = ?e,
                "Failed to serialize VoiceStateDto::leave; this is a programming error"
            );
            return;
        }
    };
    if let serde_json::Value::Object(ref mut map) = payload {
        map.insert("username".to_owned(), serde_json::json!(username));
    }

    super::broadcast_to_server(state, server_id, EVENT_VOICE_STATE_UPDATE, payload).await;
}

// ============================================================================
// Voice signaling relay
// ============================================================================

/// Relay a WebRTC SDP/ICE signal from `user_id` to the target peer.
///
/// Both users must be in the same voice channel; signals for users in
/// different channels are dropped (debug-logged) to prevent cross-channel
/// leakage. A DB error during the co-membership check also drops the signal
/// (warn-logged) — if debugging broken signaling, check DB connectivity.
///
/// The forwarded payload adds `from_user_id` (the sender's identity) and
/// omits `to_user_id` entirely — the receiver already knows they are the
/// target. Both `sdp` and `candidate` are forwarded as-is; whichever was
/// absent in the original signal will be `null` in the relayed message.
async fn handle_voice_signal(user_id: Uuid, data: serde_json::Value, state: &AppState) {
    let to_user_id = match data["to_user_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
    {
        Some(id) => id,
        None => {
            tracing::debug!(
                from_user_id = %user_id,
                "VoiceSignal frame missing or invalid to_user_id; dropping"
            );
            return;
        }
    };

    // Validate the signal type — must be one of the three WebRTC signal types.
    // This prevents the relay from being used to forward arbitrary payloads.
    match data["type"].as_str() {
        Some("offer" | "answer" | "candidate") => {}
        Some(t) => {
            tracing::debug!(
                from_user_id = %user_id,
                signal_type  = %t,
                "VoiceSignal has invalid type field; dropping"
            );
            return;
        }
        None => {
            tracing::debug!(
                from_user_id = %user_id,
                "VoiceSignal missing type field; dropping"
            );
            return;
        }
    }

    // sdp and candidate must be strings or null — no nested objects or arrays.
    for (field_name, field_value) in [("sdp", &data["sdp"]), ("candidate", &data["candidate"])] {
        if !field_value.is_null() && !field_value.is_string() {
            tracing::debug!(
                from_user_id = %user_id,
                field        = %field_name,
                "VoiceSignal field is not a string or null; dropping"
            );
            return;
        }
    }

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
        Err(e) => {
            tracing::warn!(
                from_user_id = %user_id,
                to_user_id   = %to_user_id,
                error        = ?e,
                "DB error verifying voice channel co-membership; signal dropped"
            );
            return;
        }
    };

    if !same_channel {
        tracing::debug!(
            from_user_id = %user_id,
            to_user_id   = %to_user_id,
            "VoiceSignal dropped: users not in the same voice channel"
        );
        return;
    }

    // Build the forwarded payload: adds `from_user_id` and omits `to_user_id`
    // entirely — the receiver already knows they are the target.
    let relayed = serde_json::json!({
        "from_user_id": user_id,
        "type":         data["type"],
        "sdp":          data["sdp"],
        "candidate":    data["candidate"],
        "stream_type":  data["stream_type"],
    });

    let event = GatewayMessage::dispatch(EVENT_VOICE_SIGNAL, relayed);
    match serde_json::to_string(&event) {
        Ok(json) => {
            state.connections.send_to_user(to_user_id, &json).await;
        }
        Err(e) => {
            tracing::error!(
                from_user_id = %user_id,
                to_user_id   = %to_user_id,
                error        = ?e,
                "Failed to serialize VOICE_SIGNAL relay; this is a programming error"
            );
        }
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
    let user: UserDto = match sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
    {
        Err(e) => {
            tracing::error!(
                user_id = %user_id,
                error = ?e,
                "DB error fetching user for READY payload; closing connection"
            );
            return None;
        }
        Ok(None) => {
            tracing::warn!(
                user_id = %user_id,
                "User not found during READY handshake; token references deleted account"
            );
            return None;
        }
        Ok(Some(u)) => u,
    }
    .into();

    let servers = match sqlx::query_as::<_, Server>(
        "SELECT s.id, s.name, s.owner_id, s.icon_url, s.is_public, s.require_invite, s.created_at, s.updated_at
         FROM servers s
         JOIN server_members sm ON s.id = sm.server_id
         WHERE sm.user_id = $1
         ORDER BY s.created_at ASC",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error   = ?e,
                "Failed to fetch servers for READY payload; client will receive empty server list"
            );
            vec![]
        }
    };

    // DM channels: fetch channels this user participates in, plus the
    // recipient's public profile for each channel.
    #[derive(sqlx::FromRow)]
    struct DmRow {
        channel_id: Uuid,
        channel_created_at: chrono::DateTime<chrono::Utc>,
        recipient_id: Uuid,
        recipient_username: String,
        recipient_avatar_url: Option<String>,
        recipient_bio: Option<String>,
        recipient_pronouns: Option<String>,
        recipient_status: String,
        recipient_custom_status: Option<String>,
        recipient_created_at: chrono::DateTime<chrono::Utc>,
        last_message_at: Option<chrono::DateTime<chrono::Utc>>,
    }

    let dm_channels: Vec<DirectMessageChannelDto> = match sqlx::query_as::<_, DmRow>(
        "SELECT
            dmc.id             AS channel_id,
            dmc.created_at     AS channel_created_at,
            u.id               AS recipient_id,
            u.username         AS recipient_username,
            u.avatar_url       AS recipient_avatar_url,
            u.bio              AS recipient_bio,
            u.pronouns         AS recipient_pronouns,
            u.status           AS recipient_status,
            u.custom_status    AS recipient_custom_status,
            u.created_at       AS recipient_created_at,
            (SELECT MAX(dm.created_at)
             FROM direct_messages dm
             WHERE dm.channel_id = dmc.id AND dm.deleted = FALSE
            ) AS last_message_at
         FROM direct_message_channels dmc
         JOIN direct_message_members dmm1 ON dmm1.channel_id = dmc.id AND dmm1.user_id = $1
         JOIN direct_message_members dmm2 ON dmm2.channel_id = dmc.id AND dmm2.user_id != $1
         JOIN users u ON u.id = dmm2.user_id
         ORDER BY last_message_at DESC NULLS LAST",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows
            .into_iter()
            .map(|r| DirectMessageChannelDto {
                id: r.channel_id,
                recipient: UserDto {
                    id: r.recipient_id,
                    username: r.recipient_username,
                    email: None,
                    avatar_url: r.recipient_avatar_url,
                    bio: r.recipient_bio,
                    pronouns: r.recipient_pronouns,

                    status: r.recipient_status,
                    custom_status: r.recipient_custom_status,
                    activity: None,
                    created_at: r.recipient_created_at,
                    is_admin: false,
                },
                created_at: r.channel_created_at,
                last_message_at: r.last_message_at,
            })
            .collect(),
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error   = ?e,
                "Failed to fetch DM channels for READY payload; client will receive empty DM list"
            );
            vec![]
        }
    };

    // Unread counts: messages created after the user's last read timestamp
    // for channels they belong to (both server channels and DM channels).
    // Each UNION branch is scoped by JOINing to the appropriate channel table
    // so that a channel_read_states row for a server channel is never matched
    // against direct_messages (and vice versa).
    let unread_counts: Vec<UnreadCount> = match sqlx::query_as::<_, UnreadCount>(
        "SELECT
            crs.channel_id,
            COUNT(m.id) AS unread_count
         FROM channel_read_states crs
         JOIN channels c ON c.id = crs.channel_id
         JOIN messages m ON m.channel_id = crs.channel_id
             AND m.created_at > crs.last_read_at
             AND m.deleted = FALSE
             AND m.author_id != $1
         WHERE crs.user_id = $1
         GROUP BY crs.channel_id
         HAVING COUNT(m.id) > 0

         UNION ALL

         SELECT
            crs.channel_id,
            COUNT(dm.id) AS unread_count
         FROM channel_read_states crs
         JOIN direct_message_channels dmc ON dmc.id = crs.channel_id
         JOIN direct_messages dm ON dm.channel_id = crs.channel_id
             AND dm.created_at > crs.last_read_at
             AND dm.deleted = FALSE
             AND dm.author_id != $1
         WHERE crs.user_id = $1
         GROUP BY crs.channel_id
         HAVING COUNT(dm.id) > 0",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error   = ?e,
                "Failed to fetch unread counts for READY payload; client will not see unread indicators"
            );
            vec![]
        }
    };

    // Mention counts: server-channel messages created after the user's last read
    // that contain this user's ID in mention_user_ids OR have mention_everyone set.
    let mention_counts: Vec<MentionCount> = match sqlx::query_as::<_, MentionCount>(
        "SELECT crs.channel_id, COUNT(*) AS count
         FROM messages m
         JOIN channel_read_states crs
           ON crs.channel_id = m.channel_id AND crs.user_id = $1
         WHERE m.deleted = FALSE
           AND m.created_at > crs.last_read_at
           AND m.author_id != $1
           AND ($1 = ANY(m.mention_user_ids) OR m.mention_everyone = TRUE)
         GROUP BY crs.channel_id",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(
                user_id = %user_id,
                error   = ?e,
                "Failed to fetch mention counts for READY payload; client will not see mention badges"
            );
            vec![]
        }
    };

    // Roles for each server the user belongs to, grouped by server_id.
    let server_ids: Vec<Uuid> = servers.iter().map(|s| s.id).collect();
    let server_roles_map: serde_json::Value = if server_ids.is_empty() {
        json!({})
    } else {
        let role_rows = match sqlx::query_as::<_, Role>(
            "SELECT id, server_id, name, permissions, color, position, created_at
             FROM roles WHERE server_id = ANY($1)
             ORDER BY server_id, position DESC",
        )
        .bind(&server_ids)
        .fetch_all(&state.pool)
        .await
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(
                    user_id = %user_id,
                    error   = ?e,
                    "Failed to fetch roles for READY payload; client will receive empty server_roles"
                );
                vec![]
            }
        };

        let mut map: std::collections::HashMap<Uuid, Vec<&Role>> = std::collections::HashMap::new();
        for role in &role_rows {
            map.entry(role.server_id).or_default().push(role);
        }
        json!(map)
    };

    let payload = GatewayMessage::dispatch(
        EVENT_READY,
        json!({
            "user": user,
            "servers": servers,
            "dm_channels": dm_channels,
            "unread_counts": unread_counts,
            "mention_counts": mention_counts,
            "server_roles": server_roles_map,
        }),
    );

    match serde_json::to_string(&payload) {
        Ok(json) => Some(json),
        Err(e) => {
            tracing::error!(
                user_id = %user_id,
                error = ?e,
                "Failed to serialize READY payload; this is a programming error"
            );
            None
        }
    }
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
    activity: Option<String>,
) {
    // Persist status — non-fatal if this fails.
    if let Err(e) =
        sqlx::query("UPDATE users SET status = $1, custom_status = $2, activity = $3 WHERE id = $4")
            .bind(status)
            .bind(custom_status.as_deref())
            .bind(activity.as_deref())
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
            "activity": activity,
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

// ============================================================================
// Typing Indicators
// ============================================================================

/// Handle a TYPING_START event from a client.
///
/// Broadcasts a TYPING_START event to all members of the channel who can see
/// the typing indicator. The event includes the user ID, username, and channel ID.
/// Clients should auto-expire the typing indicator after ~10 seconds if no
/// further TYPING_START events are received.
async fn handle_typing_start(user_id: Uuid, data: serde_json::Value, state: &AppState) {
    let channel_id = match data["channel_id"].as_str() {
        Some(id) => match Uuid::parse_str(id) {
            Ok(uuid) => uuid,
            Err(_) => {
                tracing::debug!(user_id = %user_id, "Invalid channel_id in TYPING_START");
                return;
            }
        },
        None => {
            tracing::debug!(user_id = %user_id, "Missing channel_id in TYPING_START");
            return;
        }
    };

    // Verify user is a member of the server that owns this channel
    let server_id: Option<Uuid> =
        match sqlx::query_scalar("SELECT server_id FROM channels WHERE id = $1")
            .bind(channel_id)
            .fetch_optional(&state.pool)
            .await
        {
            Ok(Some(id)) => Some(id),
            Ok(None) => {
                tracing::debug!(channel_id = %channel_id, "Channel not found for TYPING_START");
                return;
            }
            Err(e) => {
                tracing::warn!(error = ?e, "Failed to fetch channel for TYPING_START");
                return;
            }
        };

    let server_id = match server_id {
        Some(id) => id,
        None => return,
    };

    // Verify membership
    let is_member: bool = match sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(&state.pool)
    .await
    {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = ?e, "Failed to verify membership for TYPING_START");
            return;
        }
    };

    if !is_member {
        tracing::debug!(
            user_id = %user_id,
            channel_id = %channel_id,
            "Non-member attempted TYPING_START"
        );
        return;
    }

    // Get username for the event payload
    let username: Option<String> = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();

    // Get all members of the server to broadcast to
    let member_ids: Vec<Uuid> =
        match sqlx::query_scalar("SELECT user_id FROM server_members WHERE server_id = $1")
            .bind(server_id)
            .fetch_all(&state.pool)
            .await
        {
            Ok(ids) => ids,
            Err(e) => {
                tracing::warn!(error = ?e, "Failed to fetch server members for TYPING_START");
                return;
            }
        };

    let event = GatewayMessage::dispatch(
        EVENT_TYPING_START,
        json!({
            "user_id": user_id,
            "username": username,
            "channel_id": channel_id,
            "timestamp": chrono::Utc::now().to_rfc3339(),
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
            tracing::error!(error = ?e, "Failed to serialize TYPING_START event");
        }
    }
}

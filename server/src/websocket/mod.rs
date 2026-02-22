pub mod connection_manager;
pub mod events;
pub mod handler;

pub use connection_manager::ConnectionManager;
pub use events::{
    EVENT_DM_CHANNEL_CREATE, EVENT_DM_MESSAGE_CREATE, EVENT_REACTION_ADD, EVENT_REACTION_REMOVE,
};
pub use handler::websocket_handler;

use serde_json::Value;
use uuid::Uuid;

use crate::state::AppState;
use events::{GatewayMessage, GatewayOp};

/// Serialize and send a gateway DISPATCH event to a fixed list of user IDs.
///
/// Used for DM broadcasts where the recipient list is already known.
pub async fn broadcast_to_user_list(
    state: &AppState,
    user_ids: &[Uuid],
    event_type: &str,
    data: Value,
) {
    let event = GatewayMessage {
        op: GatewayOp::Dispatch,
        t: Some(event_type.to_owned()),
        d: Some(data),
    };

    match serde_json::to_string(&event) {
        Ok(json) => {
            state.connections.broadcast_to_users(user_ids, &json).await;
        }
        Err(e) => {
            tracing::error!(
                event_type = %event_type,
                error = ?e,
                "Failed to serialize gateway event; this is a programming error"
            );
        }
    }
}

/// Fetch all members of a server and broadcast a gateway DISPATCH event to
/// every member who is currently connected.
///
/// Database errors are logged and treated as non-fatal — a failed broadcast
/// should never prevent the triggering REST request from succeeding.
pub async fn broadcast_to_server(state: &AppState, server_id: Uuid, event_type: &str, data: Value) {
    let member_ids: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT user_id FROM server_members WHERE server_id = $1",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(
                server_id = %server_id,
                event_type = %event_type,
                error = ?e,
                "Failed to fetch server members for event broadcast; real-time event will not be delivered"
            );
            return;
        }
    };

    let event = GatewayMessage {
        op: GatewayOp::Dispatch,
        t: Some(event_type.to_owned()),
        d: Some(data),
    };

    match serde_json::to_string(&event) {
        Ok(json) => {
            state
                .connections
                .broadcast_to_users(&member_ids, &json)
                .await;
        }
        Err(e) => {
            tracing::error!(
                server_id = %server_id,
                event_type = %event_type,
                error = ?e,
                "Failed to serialize gateway event; this is a programming error"
            );
        }
    }
}

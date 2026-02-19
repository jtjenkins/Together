pub mod connection_manager;
pub mod events;
pub mod handler;

pub use connection_manager::ConnectionManager;
pub use handler::websocket_handler;

use serde_json::Value;
use uuid::Uuid;

use crate::state::AppState;
use events::{GatewayMessage, GatewayOp};

/// Fetch all members of a server and broadcast a gateway DISPATCH event to
/// every member who is currently connected.
///
/// Database errors are silently swallowed — a failed broadcast is always
/// non-fatal and should never prevent the triggering REST request from
/// succeeding.
pub async fn broadcast_to_server(state: &AppState, server_id: Uuid, event_type: &str, data: Value) {
    let member_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM server_members WHERE server_id = $1")
            .bind(server_id)
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();

    let event = GatewayMessage {
        op: GatewayOp::Dispatch,
        t: Some(event_type.to_owned()),
        d: Some(data),
    };

    if let Ok(json) = serde_json::to_string(&event) {
        state
            .connections
            .broadcast_to_users(&member_ids, &json)
            .await;
    }
}

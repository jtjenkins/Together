use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Envelope for all gateway messages (both client→server and server→client).
#[derive(Debug, Serialize, Deserialize)]
pub struct GatewayMessage {
    pub op: GatewayOp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub t: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub d: Option<Value>,
}

impl GatewayMessage {
    pub fn dispatch(event_type: &str, data: Value) -> Self {
        Self {
            op: GatewayOp::Dispatch,
            t: Some(event_type.to_owned()),
            d: Some(data),
        }
    }

    pub fn heartbeat_ack() -> Self {
        Self {
            op: GatewayOp::HeartbeatAck,
            t: None,
            d: None,
        }
    }
}

/// Opcode discriminator for the gateway protocol.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GatewayOp {
    /// Server → client: a named event with a payload.
    Dispatch,
    /// Client → server: keepalive ping.
    Heartbeat,
    /// Server → client: reply to a HEARTBEAT.
    HeartbeatAck,
    /// Client → server: update own presence status.
    PresenceUpdate,
    /// Client → server: relay a WebRTC SDP/ICE signal to another peer in the
    /// same voice channel. The server verifies channel co-membership before
    /// forwarding — signals to users in different channels are silently dropped.
    VoiceSignal,
}

// ── Server-to-client event type strings ──────────────────────────────────────

pub const EVENT_READY: &str = "READY";
pub const EVENT_MESSAGE_CREATE: &str = "MESSAGE_CREATE";
pub const EVENT_MESSAGE_UPDATE: &str = "MESSAGE_UPDATE";
pub const EVENT_MESSAGE_DELETE: &str = "MESSAGE_DELETE";
pub const EVENT_PRESENCE_UPDATE: &str = "PRESENCE_UPDATE";
pub const EVENT_VOICE_STATE_UPDATE: &str = "VOICE_STATE_UPDATE";
pub const EVENT_VOICE_SIGNAL: &str = "VOICE_SIGNAL";
pub const EVENT_DM_CHANNEL_CREATE: &str = "DM_CHANNEL_CREATE";
pub const EVENT_DM_MESSAGE_CREATE: &str = "DM_MESSAGE_CREATE";
pub const EVENT_REACTION_ADD: &str = "REACTION_ADD";
pub const EVENT_REACTION_REMOVE: &str = "REACTION_REMOVE";
pub const EVENT_THREAD_MESSAGE_CREATE: &str = "THREAD_MESSAGE_CREATE";

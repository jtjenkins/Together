use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// ============================================================================
// User Models
// ============================================================================

/// Internal database row. Not serializable — use UserDto for API responses
/// to avoid accidentally exposing password_hash.
#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserDto {
    pub username: String,
    pub email: Option<String>,
    pub password: String,
}

/// Public user shape returned by all API responses.
#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserDto {
    fn from(user: User) -> Self {
        UserDto {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            status: user.status,
            custom_status: user.custom_status,
            created_at: user.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserDto {
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub custom_status: Option<String>,
}

// ============================================================================
// Session Models
// ============================================================================

#[derive(Debug, Clone, FromRow)]
pub struct Session {
    pub id: Uuid,
    pub user_id: Uuid,
    pub refresh_token_hash: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
}

// ============================================================================
// Server Models
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Server {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub icon_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerDto {
    pub name: String,
    pub icon_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerDto {
    pub name: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ServerMember {
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
}

/// Server enriched with live member count for API responses.
#[derive(Debug, Serialize)]
pub struct ServerDto {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub icon_url: Option<String>,
    pub member_count: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Member of a server, combining user fields with membership metadata.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct MemberDto {
    pub user_id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
}

// ============================================================================
// Channel Models
// ============================================================================

#[derive(Debug, Clone, Deserialize, Serialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "text", rename_all = "lowercase")]
pub enum ChannelType {
    Text,
    Voice,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Channel {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub r#type: ChannelType,
    pub position: i32,
    pub category: Option<String>,
    pub topic: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateChannelDto {
    pub name: String,
    pub r#type: ChannelType,
    pub topic: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateChannelDto {
    pub name: Option<String>,
    pub topic: Option<String>,
    pub category: Option<String>,
    pub position: Option<i32>,
}

// ============================================================================
// Message Models
// ============================================================================

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Message {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Option<Uuid>,
    pub content: String,
    pub reply_to: Option<Uuid>,
    pub mention_user_ids: Vec<Uuid>,
    pub mention_everyone: bool,
    pub edited_at: Option<DateTime<Utc>>,
    pub deleted: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateMessageDto {
    pub content: String,
    pub reply_to: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateMessageDto {
    pub content: String,
}

// ============================================================================
// Voice Models
// ============================================================================

/// Internal database row for a user's current voice channel state.
///
/// A user can only be in one channel at a time — enforced by the `user_id`
/// PRIMARY KEY constraint. This uniqueness constraint is what makes the
/// `ON CONFLICT (user_id)` UPSERT in `join_voice_channel` correct, and the
/// co-membership check in the WebRTC signal relay relies on the same
/// single-row-per-user invariant to confirm both participants share a channel.
///
/// Note: `server_mute`/`server_deaf` are moderator-applied and are intentionally
/// preserved across channel switches; only `self_mute`/`self_deaf` are reset.
#[derive(Debug, Clone, FromRow)]
pub struct VoiceState {
    pub user_id: Uuid,
    pub channel_id: Uuid,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub server_mute: bool,
    pub server_deaf: bool,
    pub joined_at: DateTime<Utc>,
}

/// Wire representation of voice state for REST responses and broadcast events.
///
/// `channel_id` and `joined_at` are `None` when representing a user who has
/// left all voice channels (used in `VOICE_STATE_UPDATE` leave broadcasts).
/// This is a separate type from `VoiceState` to decouple the API shape from
/// the DB row and prevent future field additions from accidentally leaking.
#[derive(Debug, Serialize)]
pub struct VoiceStateDto {
    pub user_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub self_mute: bool,
    pub self_deaf: bool,
    pub server_mute: bool,
    pub server_deaf: bool,
    pub joined_at: Option<DateTime<Utc>>,
}

impl From<VoiceState> for VoiceStateDto {
    fn from(vs: VoiceState) -> Self {
        VoiceStateDto {
            user_id: vs.user_id,
            channel_id: Some(vs.channel_id),
            self_mute: vs.self_mute,
            self_deaf: vs.self_deaf,
            server_mute: vs.server_mute,
            server_deaf: vs.server_deaf,
            joined_at: Some(vs.joined_at),
        }
    }
}

impl VoiceStateDto {
    /// Construct a leave-state DTO where `channel_id` and `joined_at` are `None`.
    ///
    /// Used for `VOICE_STATE_UPDATE` leave broadcasts — both REST-triggered leaves
    /// and WebSocket-disconnect cleanup use this constructor so both paths produce
    /// an identical payload. Future fields added to this type will automatically
    /// appear in all leave broadcasts.
    pub fn leave(user_id: Uuid) -> Self {
        VoiceStateDto {
            user_id,
            channel_id: None,
            self_mute: false,
            self_deaf: false,
            server_mute: false,
            server_deaf: false,
            joined_at: None,
        }
    }
}

/// Request body for PATCH /channels/:id/voice.
///
/// Only user-controlled flags are accepted; `server_mute`/`server_deaf` are
/// excluded at the type level to prevent privilege escalation. Unknown fields
/// are rejected (deny_unknown_fields) rather than silently ignored.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateVoiceStateRequest {
    pub self_mute: Option<bool>,
    pub self_deaf: Option<bool>,
}

// ============================================================================
// Attachment Models
// ============================================================================

/// A file attached to a message.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub filename: String,
    pub file_size: i64,
    pub mime_type: String,
    pub url: String,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_at: DateTime<Utc>,
}

// ============================================================================
// Direct Message Models
// ============================================================================

/// A private channel shared between exactly two users.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DirectMessageChannel {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
}

/// A DM channel enriched with participant info for API responses.
#[derive(Debug, Serialize)]
pub struct DirectMessageChannelDto {
    pub id: Uuid,
    /// The other participant (not the requesting user).
    pub recipient: UserDto,
    pub created_at: DateTime<Utc>,
    /// Timestamp of the most recent non-deleted message, used for list
    /// ordering and last-active display. `None` when no messages exist yet.
    pub last_message_at: Option<DateTime<Utc>>,
}

/// A message sent inside a DM channel.
///
/// `author_id` is `None` when the originating user account has been deleted
/// (the foreign key has `ON DELETE SET NULL`). Clients should render deleted
/// accounts as "Deleted User".
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct DirectMessage {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Option<Uuid>,
    pub content: String,
    pub edited_at: Option<DateTime<Utc>>,
    /// Soft-delete flag. Never serialized to clients — the list endpoint
    /// always filters `WHERE deleted = FALSE` so clients never receive
    /// deleted messages.
    #[serde(skip_serializing)]
    pub deleted: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDirectMessageDto {
    pub content: String,
}

// ============================================================================
// Reaction Models
// ============================================================================

/// A single emoji reaction on a message (server channel messages only —
/// DM reactions are not yet supported). Never serialized to clients directly;
/// only `ReactionCount` aggregates are sent over the wire.
#[derive(Debug, Clone, FromRow)]
pub struct MessageReaction {
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub emoji: String,
    pub created_at: DateTime<Utc>,
}

/// Aggregated reaction count for a single emoji on a message.
#[derive(Debug, Serialize)]
pub struct ReactionCount {
    pub emoji: String,
    pub count: i64,
    /// Whether the requesting user has added this reaction at the time of the
    /// query. Clients must apply `REACTION_ADD`/`REACTION_REMOVE` WebSocket
    /// delta events to keep this accurate after the initial fetch.
    pub me: bool,
}

// ============================================================================
// Read State Models
// ============================================================================

/// Tracks the last-read position for a user in a channel (server or DM).
///
/// `channel_id` deliberately has no foreign key constraint so a single table
/// can track both `channels.id` (server text/voice channels) and
/// `direct_message_channels.id` (DM channels). Application code is responsible
/// for verifying that `channel_id` references a real channel before upserting.
///
/// Orphaned rows (where the referenced channel has been deleted) are harmless —
/// they contribute zero to unread counts because no messages reference them.
#[derive(Debug, Clone, FromRow)]
pub struct ReadState {
    pub user_id: Uuid,
    pub channel_id: Uuid,
    pub last_read_at: DateTime<Utc>,
}

/// Unread summary returned in the READY event.
///
/// `unread_count` is always >= 1 (the query uses `HAVING COUNT > 0`).
/// Channels with no `channel_read_states` row are omitted entirely — this
/// means "never acknowledged" and "zero unread" are indistinguishable until
/// the user first acknowledges the channel.
#[derive(Debug, FromRow, Serialize)]
pub struct UnreadCount {
    pub channel_id: Uuid,
    pub unread_count: i64,
}

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use validator::Validate;

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
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub activity: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub is_admin: bool,
    pub disabled: bool,
    pub disabled_at: Option<DateTime<Utc>>,
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
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub activity: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_admin: bool,
}

impl From<User> for UserDto {
    fn from(user: User) -> Self {
        UserDto {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            bio: user.bio,
            pronouns: user.pronouns,
            status: user.status,
            custom_status: user.custom_status,
            activity: user.activity,
            created_at: user.created_at,
            is_admin: user.is_admin,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserDto {
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub status: Option<String>,
    pub custom_status: Option<String>,
    pub activity: Option<String>,
}

/// Public profile shape for GET /users/:id — omits private fields like email.
#[derive(Debug, Serialize)]
pub struct PublicProfileDto {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<User> for PublicProfileDto {
    fn from(user: User) -> Self {
        PublicProfileDto {
            id: user.id,
            username: user.username,
            avatar_url: user.avatar_url,
            status: user.status,
            custom_status: user.custom_status,
            bio: user.bio,
            pronouns: user.pronouns,
            created_at: user.created_at,
        }
    }
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
// Instance Settings Models
// ============================================================================

/// Singleton row holding instance-wide configuration.
#[derive(Debug, FromRow, Serialize)]
pub struct InstanceSettings {
    pub id: i32,
    pub registration_mode: String,
    pub updated_at: DateTime<Utc>,
    pub updated_by: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateSettingsRequest {
    pub registration_mode: Option<String>,
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
    pub is_public: bool,
    pub require_invite: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateServerDto {
    pub name: String,
    pub icon_url: Option<String>,
    pub is_public: Option<bool>,
    pub require_invite: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServerDto {
    pub name: Option<String>,
    pub icon_url: Option<String>,
    pub is_public: Option<bool>,
    pub require_invite: Option<bool>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ServerMember {
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub nickname: Option<String>,
    pub joined_at: DateTime<Utc>,
}

/// Server enriched with live member count for API responses.
#[derive(Debug, FromRow, Serialize)]
pub struct ServerDto {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub icon_url: Option<String>,
    pub is_public: bool,
    pub require_invite: bool,
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
    pub custom_status: Option<String>,
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
    /// Set on thread replies; `None` on root messages.
    #[sqlx(default)]
    pub thread_id: Option<Uuid>,
    /// Number of non-deleted thread replies on a root message.
    /// Populated only by `list_messages` via a subquery; defaults to 0
    /// on insert RETURNING and thread-reply list queries.
    #[sqlx(default)]
    pub thread_reply_count: i32,
    pub edited_at: Option<DateTime<Utc>>,
    pub deleted: bool,
    pub created_at: DateTime<Utc>,
    /// Whether this message has been pinned in its channel.
    /// Defaults to false; not included in some validation-only queries.
    #[sqlx(default)]
    pub pinned: bool,
    /// The user who pinned this message, if pinned.
    #[sqlx(default)]
    pub pinned_by: Option<Uuid>,
    /// When this message was pinned, if pinned.
    #[sqlx(default)]
    pub pinned_at: Option<DateTime<Utc>>,
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
    pub self_video: bool,
    pub self_screen: bool,
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
    pub self_video: bool,
    pub self_screen: bool,
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
            self_video: vs.self_video,
            self_screen: vs.self_screen,
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
            self_video: false,
            self_screen: false,
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
    pub self_video: Option<bool>,
    pub self_screen: Option<bool>,
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

// ── Custom Emojis ────────────────────────────────────────────────────────────

/// A custom emoji uploaded to a server.
#[derive(Debug, sqlx::FromRow)]
pub struct CustomEmoji {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub filename: String,
    pub content_type: String,
    pub file_size: i64,
    pub created_at: DateTime<Utc>,
}

/// API response shape for a custom emoji (omits internal `filename`).
#[derive(Debug, Serialize)]
pub struct CustomEmojiDto {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    /// URL to fetch the image: `/emojis/{id}`
    pub url: String,
    pub content_type: String,
    pub file_size: i64,
    pub created_at: DateTime<Utc>,
}

impl CustomEmojiDto {
    pub fn from_row(row: CustomEmoji) -> Self {
        let url = format!("/emojis/{}", row.id);
        Self {
            url,
            id: row.id,
            server_id: row.server_id,
            created_by: row.created_by,
            name: row.name,
            content_type: row.content_type,
            file_size: row.file_size,
            created_at: row.created_at,
        }
    }
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

pub mod link_preview;
pub use link_preview::LinkPreviewDto;

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

// ── MessageDto ─────────────────────────────────────────────────────────────
/// API response for a message. Wraps Message with optional rich content.
#[derive(Debug, Serialize)]
pub struct MessageDto {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Option<Uuid>,
    pub content: String,
    pub reply_to: Option<Uuid>,
    pub mention_user_ids: Vec<Uuid>,
    pub mention_everyone: bool,
    pub thread_id: Option<Uuid>,
    pub thread_reply_count: i32,
    pub edited_at: Option<DateTime<Utc>>,
    pub deleted: bool,
    pub created_at: DateTime<Utc>,
    pub pinned: bool,
    pub pinned_by: Option<Uuid>,
    pub pinned_at: Option<DateTime<Utc>>,
    /// Some when the message was created by /poll
    pub poll: Option<PollDto>,
    /// Some when the message was created by /event
    pub event: Option<ServerEventDto>,
}

impl MessageDto {
    pub fn from_message(msg: Message) -> Self {
        Self {
            id: msg.id,
            channel_id: msg.channel_id,
            author_id: msg.author_id,
            content: msg.content,
            reply_to: msg.reply_to,
            mention_user_ids: msg.mention_user_ids,
            mention_everyone: msg.mention_everyone,
            thread_id: msg.thread_id,
            thread_reply_count: msg.thread_reply_count,
            edited_at: msg.edited_at,
            deleted: msg.deleted,
            created_at: msg.created_at,
            pinned: msg.pinned,
            pinned_by: msg.pinned_by,
            pinned_at: msg.pinned_at,
            poll: None,
            event: None,
        }
    }
}

// ── Poll Models ────────────────────────────────────────────────────────────
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PollOption {
    pub id: Uuid,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct PollDto {
    pub id: Uuid,
    pub question: String,
    pub options: Vec<PollOptionDto>,
    pub total_votes: i64,
    /// The option_id the calling user voted for, or None
    pub user_vote: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct PollOptionDto {
    pub id: Uuid,
    pub text: String,
    pub votes: i64,
}

#[derive(Debug, Deserialize)]
pub struct CreatePollPayload {
    pub question: String,
    /// 2 to 10 option texts; IDs are generated server-side
    pub options: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CastVotePayload {
    pub option_id: Uuid,
}

// ── Server Event Models ─────────────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct ServerEventDto {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub starts_at: DateTime<Utc>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEventPayload {
    pub name: String,
    pub description: Option<String>,
    pub starts_at: DateTime<Utc>,
}

// ── Giphy ───────────────────────────────────────────────────────────────────
#[derive(Debug, Serialize)]
pub struct GifResult {
    pub url: String,
    pub preview_url: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
}

// ── Audit Logging ───────────────────────────────────────────────────────────

/// Audit log entry for admin actions.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct AuditLog {
    pub id: Uuid,
    pub server_id: Option<Uuid>,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub details: serde_json::Value,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// DTO for creating an audit log entry.
#[derive(Debug, Clone)]
pub struct CreateAuditLog {
    pub server_id: Uuid,
    pub actor_id: Uuid,
    pub action: AuditAction,
    pub target_type: Option<String>,
    pub target_id: Option<Uuid>,
    pub details: serde_json::Value,
    pub ip_address: Option<String>,
}

/// Audit action types.
#[derive(Debug, Clone, Copy, strum::Display)]
#[strum(serialize_all = "snake_case")]
pub enum AuditAction {
    // Server actions
    ServerCreate,
    ServerUpdate,
    ServerDelete,

    // Channel actions
    ChannelCreate,
    ChannelUpdate,
    ChannelDelete,

    // Member actions
    MemberKick,
    MemberBan,
    MemberUnban,
    MemberTimeout,
    MemberTimeoutRemove,
    MemberRoleAdd,
    MemberRoleRemove,

    // Role actions
    RoleCreate,
    RoleUpdate,
    RoleDelete,

    // Invite actions
    InviteCreate,
    InviteRevoke,
}

// ── Moderation Request DTOs ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KickMemberRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BanMemberRequest {
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeoutMemberRequest {
    pub reason: Option<String>,
    pub duration_minutes: i64,
}

/// Query parameters for listing audit logs.
#[derive(Debug, Deserialize)]
pub struct ListAuditLogsQuery {
    /// Filter by action type.
    pub action: Option<String>,
    /// Filter by actor user ID.
    pub actor_id: Option<Uuid>,
    /// Filter by target type.
    pub target_type: Option<String>,
    /// Cursor for pagination (created_at).
    pub before: Option<DateTime<Utc>>,
    /// Maximum results (default 50, max 100).
    pub limit: Option<i64>,
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Query parameters for message search.
#[derive(Debug, Deserialize, Validate)]
pub struct SearchQuery {
    /// Search query string (2-200 characters).
    #[validate(length(min = 2, max = 200, message = "Query must be 2–200 characters"))]
    pub q: String,
    /// Optional channel ID to limit search scope.
    pub channel_id: Option<Uuid>,
    /// Cursor for pagination: return results before this message ID.
    pub before: Option<Uuid>,
    /// Maximum results per page (default 50, max 100).
    #[validate(range(min = 1, max = 100, message = "Limit must be 1–100"))]
    pub limit: Option<i64>,
}

/// A single search result with highlighted snippet.
#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub id: Uuid,
    pub channel_id: Uuid,
    pub author_id: Option<Uuid>,
    pub author_username: Option<String>,
    pub content: String,
    /// HTML snippet with matching terms wrapped in <mark> tags.
    pub highlight: String,
    pub created_at: DateTime<Utc>,
    /// Relevance rank (higher = better match).
    pub rank: f32,
}

/// Paginated search response.
#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    /// Total matching messages (approximate for large result sets).
    pub total: i64,
    pub has_more: bool,
    /// Cursor for next page (message ID).
    pub next_cursor: Option<Uuid>,
}

// ── Bot Models ──────────────────────────────────────────────────────────────

/// Internal database row for a registered bot.
/// Never serialized to clients — use BotDto.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Bot {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub token_hash: String,
    pub created_by: Option<Uuid>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Public bot shape returned by REST API responses.
/// token_hash is intentionally excluded.
#[derive(Debug, Serialize)]
pub struct BotDto {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_by: Option<Uuid>,
    pub revoked_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl From<Bot> for BotDto {
    fn from(b: Bot) -> Self {
        BotDto {
            id: b.id,
            user_id: b.user_id,
            name: b.name,
            description: b.description,
            created_by: b.created_by,
            revoked_at: b.revoked_at,
            created_at: b.created_at,
        }
    }
}

/// Request body for POST /bots.
#[derive(Debug, Deserialize)]
pub struct CreateBotDto {
    pub name: String,
    pub description: Option<String>,
}

/// Request body for PATCH /bots/:id.
#[derive(Debug, Deserialize)]
pub struct UpdateBotDto {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
}

/// A single entry in a bot's activity log.
#[derive(Debug, Serialize)]
pub struct BotLogEntry {
    pub timestamp: DateTime<Utc>,
    pub event: String,
    pub detail: Option<String>,
}

/// Response for POST /bots and POST /bots/:id/token/regenerate.
/// Token is shown exactly once and never stored in plaintext.
#[derive(Debug, Serialize)]
pub struct BotCreatedResponse {
    pub bot: BotDto,
    /// Plaintext token — shown once at creation/regeneration only.
    pub token: String,
}

// ── Automod Models ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct AutomodConfig {
    pub server_id: Uuid,
    pub enabled: bool,
    pub spam_enabled: bool,
    pub spam_max_messages: i32,
    pub spam_window_secs: i32,
    pub spam_action: String,
    pub duplicate_enabled: bool,
    pub word_filter_enabled: bool,
    pub word_filter_action: String,
    pub timeout_minutes: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAutomodConfigRequest {
    pub enabled: Option<bool>,
    pub spam_enabled: Option<bool>,
    pub spam_max_messages: Option<i32>,
    pub spam_window_secs: Option<i32>,
    pub spam_action: Option<String>,
    pub duplicate_enabled: Option<bool>,
    pub word_filter_enabled: Option<bool>,
    pub word_filter_action: Option<String>,
    pub timeout_minutes: Option<i32>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct AutomodWordFilter {
    pub id: Uuid,
    pub server_id: Uuid,
    pub word: String,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AddWordFilterRequest {
    pub word: String,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct AutomodLog {
    pub id: Uuid,
    pub server_id: Uuid,
    pub channel_id: Option<Uuid>,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub rule_type: String,
    pub action_taken: String,
    pub matched_term: Option<String>,
    pub message_content: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct ServerBan {
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub banned_by: Option<Uuid>,
    pub reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct AutomodTimeout {
    pub user_id: Uuid,
    pub server_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub reason: Option<String>,
    pub created_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

// ── Role Models ────────────────────────────────────────────────────────────

/// A role within a server, carrying permission bitflags and display metadata.
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct Role {
    pub id: Uuid,
    pub server_id: Uuid,
    pub name: String,
    pub permissions: i64,
    pub color: Option<String>,
    pub position: i32,
    pub created_at: DateTime<Utc>,
}

/// Lightweight role info attached to member responses (no server_id/permissions).
#[derive(Debug, Clone, sqlx::FromRow, Serialize)]
pub struct MemberRoleInfo {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub position: i32,
}

/// Request body for POST /servers/:id/roles.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRoleRequest {
    pub name: String,
    pub permissions: Option<i64>,
    pub color: Option<String>,
    pub position: Option<i32>,
}

/// Request body for PATCH /servers/:id/roles/:role_id.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateRoleRequest {
    pub name: Option<String>,
    pub permissions: Option<i64>,
    pub color: Option<String>,
    pub position: Option<i32>,
}

// ── Webhook Models ──────────────────────────────────────────────────────────

/// Internal database row for a webhook.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Webhook {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub url: String,
    pub secret: String,
    pub event_types: serde_json::Value,
    pub enabled: bool,
    pub delivery_failures: i32,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Public webhook shape returned by REST API responses.
/// `secret` is intentionally excluded — shown only at creation.
#[derive(Debug, Serialize)]
pub struct WebhookDto {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub url: String,
    pub event_types: Vec<String>,
    pub enabled: bool,
    pub delivery_failures: i32,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<Webhook> for WebhookDto {
    fn from(w: Webhook) -> Self {
        let event_types: Vec<String> = serde_json::from_value(w.event_types).unwrap_or_default();
        WebhookDto {
            id: w.id,
            server_id: w.server_id,
            created_by: w.created_by,
            name: w.name,
            url: w.url,
            event_types,
            enabled: w.enabled,
            delivery_failures: w.delivery_failures,
            last_used_at: w.last_used_at,
            created_at: w.created_at,
            updated_at: w.updated_at,
        }
    }
}

/// Response for POST /servers/:id/webhooks — includes the secret (shown once).
#[derive(Debug, Serialize)]
pub struct WebhookCreatedResponse {
    pub webhook: WebhookDto,
    /// Plaintext HMAC signing secret — shown once at creation only.
    pub secret: String,
}

/// Request body for POST /servers/:id/webhooks.
#[derive(Debug, Deserialize)]
pub struct CreateWebhookDto {
    pub name: String,
    pub url: String,
    pub event_types: Vec<String>,
}

/// Request body for PATCH /servers/:id/webhooks/:webhook_id.
#[derive(Debug, Deserialize)]
pub struct UpdateWebhookDto {
    pub name: Option<String>,
    pub url: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

// ── Invite Models ──────────────────────────────────────────────────────────

/// Database row for a server invite link.
#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ServerInvite {
    pub id: Uuid,
    pub server_id: Uuid,
    pub code: String,
    pub created_by: Option<Uuid>,
    pub max_uses: Option<i32>,
    pub uses: i32,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Preview information shown before accepting an invite.
#[derive(Debug, Serialize)]
pub struct InvitePreviewDto {
    pub code: String,
    pub server_name: String,
    pub server_icon_url: Option<String>,
    pub member_count: i64,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Request body for POST /servers/:id/invites.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateInviteRequest {
    pub max_uses: Option<i32>,
    pub expires_in_hours: Option<i64>,
}

// ============================================================================
// Admin Dashboard Models
// ============================================================================

/// Instance-wide statistics returned by GET /admin/stats.
#[derive(Debug, Serialize)]
pub struct AdminStatsResponse {
    pub total_users: i64,
    pub total_servers: i64,
    pub total_messages: i64,
    pub total_channels: i64,
    pub active_ws_connections: usize,
    pub uptime_secs: Option<u64>,
    pub db_latency_ms: u64,
    pub storage_bytes: u64,
}

/// Admin-enriched user row for GET /admin/users.
#[derive(Debug, FromRow, Serialize)]
pub struct AdminUserDto {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
    pub is_admin: bool,
    pub disabled: bool,
    pub disabled_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub server_count: i64,
    pub message_count: i64,
}

/// Paginated admin user list response.
#[derive(Debug, Serialize)]
pub struct AdminUsersResponse {
    pub users: Vec<AdminUserDto>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

/// Admin-enriched server row for GET /admin/servers.
#[derive(Debug, FromRow, Serialize)]
pub struct AdminServerDto {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub owner_username: String,
    pub icon_url: Option<String>,
    pub is_public: bool,
    pub member_count: i64,
    pub channel_count: i64,
    pub message_count: i64,
    pub created_at: DateTime<Utc>,
}

/// Paginated admin server list response.
#[derive(Debug, Serialize)]
pub struct AdminServersResponse {
    pub servers: Vec<AdminServerDto>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

/// Request body for PATCH /admin/users/:user_id.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateAdminUserRequest {
    pub is_admin: Option<bool>,
    pub disabled: Option<bool>,
}

/// Query parameters for admin paginated list endpoints.
#[derive(Debug, Deserialize)]
pub struct AdminListQuery {
    pub page: Option<i64>,
    pub per_page: Option<i64>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
}

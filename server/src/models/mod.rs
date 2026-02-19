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

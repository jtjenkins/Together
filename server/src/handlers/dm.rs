use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use uuid::Uuid;
use validator::Validate;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{DirectMessage, DirectMessageChannelDto, UserDto},
    state::AppState,
    websocket::{broadcast_to_user_list, EVENT_DM_CHANNEL_CREATE, EVENT_DM_MESSAGE_CREATE},
};

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct OpenDmRequest {
    /// The ID of the user to open a DM with.
    pub user_id: Uuid,
}

#[derive(Debug, Deserialize, Validate)]
pub struct SendDmRequest {
    #[validate(length(
        min = 1,
        max = 4000,
        message = "Message content must be 1–4 000 characters"
    ))]
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct ListDmMessagesQuery {
    pub before: Option<Uuid>,
    pub limit: Option<i64>,
}

// ============================================================================
// Private helpers
// ============================================================================

fn validation_error(e: validator::ValidationErrors) -> AppError {
    AppError::Validation(
        e.field_errors()
            .values()
            .flat_map(|v| v.iter())
            .filter_map(|e| e.message.as_ref())
            .map(|m| m.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    )
}

/// Query the database for the DM channel shared by exactly these two users.
/// Returns `None` if no such channel exists yet.
async fn find_dm_channel(
    pool: &sqlx::PgPool,
    user_a: Uuid,
    user_b: Uuid,
) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT dmm1.channel_id
         FROM direct_message_members dmm1
         JOIN direct_message_members dmm2
           ON dmm1.channel_id = dmm2.channel_id AND dmm2.user_id = $2
         WHERE dmm1.user_id = $1
         LIMIT 1",
    )
    .bind(user_a)
    .bind(user_b)
    .fetch_optional(pool)
    .await
}

/// Require that `user_id` is a member of the given DM channel.
async fn require_dm_member(pool: &sqlx::PgPool, channel_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM direct_message_members
             WHERE channel_id = $1 AND user_id = $2
         )",
    )
    .bind(channel_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if !is_member {
        Err(AppError::NotFound("DM channel not found".into()))
    } else {
        Ok(())
    }
}

/// Build a `DirectMessageChannelDto` for a given channel + requesting user.
async fn build_channel_dto(
    pool: &sqlx::PgPool,
    channel_id: Uuid,
    requesting_user_id: Uuid,
) -> AppResult<DirectMessageChannelDto> {
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_created_at: DateTime<Utc>,
        recipient_id: Uuid,
        recipient_username: String,
        recipient_email: Option<String>,
        recipient_avatar_url: Option<String>,
        recipient_status: String,
        recipient_custom_status: Option<String>,
        recipient_created_at: DateTime<Utc>,
        last_message_at: Option<DateTime<Utc>>,
    }

    let row = sqlx::query_as::<_, Row>(
        "SELECT
             dmc.created_at        AS channel_created_at,
             u.id                  AS recipient_id,
             u.username            AS recipient_username,
             u.email               AS recipient_email,
             u.avatar_url          AS recipient_avatar_url,
             u.status              AS recipient_status,
             u.custom_status       AS recipient_custom_status,
             u.created_at          AS recipient_created_at,
             (SELECT MAX(dm.created_at)
              FROM direct_messages dm
              WHERE dm.channel_id = dmc.id AND dm.deleted = FALSE
             ) AS last_message_at
         FROM direct_message_channels dmc
         JOIN direct_message_members dmm ON dmm.channel_id = dmc.id AND dmm.user_id != $2
         JOIN users u ON u.id = dmm.user_id
         WHERE dmc.id = $1",
    )
    .bind(channel_id)
    .bind(requesting_user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("DM channel not found".into()))?;

    Ok(DirectMessageChannelDto {
        id: channel_id,
        recipient: UserDto {
            id: row.recipient_id,
            username: row.recipient_username,
            email: row.recipient_email,
            avatar_url: row.recipient_avatar_url,
            status: row.recipient_status,
            custom_status: row.recipient_custom_status,
            created_at: row.recipient_created_at,
        },
        created_at: row.channel_created_at,
        last_message_at: row.last_message_at,
    })
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /dm-channels — open or retrieve an existing DM channel with another user.
///
/// Idempotent: if a channel already exists between the two users, it is
/// returned rather than creating a duplicate.
pub async fn open_dm_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<OpenDmRequest>,
) -> AppResult<(StatusCode, Json<DirectMessageChannelDto>)> {
    let my_id = auth.user_id();
    let their_id = req.user_id;

    if my_id == their_id {
        return Err(AppError::Validation(
            "Cannot open a DM channel with yourself".into(),
        ));
    }

    // Ensure target user exists.
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(their_id)
        .fetch_one(&state.pool)
        .await?;
    if !exists {
        return Err(AppError::NotFound("User not found".into()));
    }

    // Return existing channel if found (idempotent).
    if let Some(channel_id) = find_dm_channel(&state.pool, my_id, their_id).await? {
        let dto = build_channel_dto(&state.pool, channel_id, my_id).await?;
        return Ok((StatusCode::OK, Json(dto)));
    }

    // Create new channel.
    let channel_id: Uuid =
        sqlx::query_scalar("INSERT INTO direct_message_channels DEFAULT VALUES RETURNING id")
            .fetch_one(&state.pool)
            .await?;

    sqlx::query(
        "INSERT INTO direct_message_members (channel_id, user_id) VALUES ($1, $2), ($1, $3)",
    )
    .bind(channel_id)
    .bind(my_id)
    .bind(their_id)
    .execute(&state.pool)
    .await?;

    let dto = build_channel_dto(&state.pool, channel_id, my_id).await?;

    // Notify both participants that a DM channel was created.
    if let Ok(payload) = serde_json::to_value(&dto) {
        broadcast_to_user_list(&state, &[my_id, their_id], EVENT_DM_CHANNEL_CREATE, payload).await;
    }

    Ok((StatusCode::CREATED, Json(dto)))
}

/// GET /dm-channels — list all DM channels for the authenticated user.
pub async fn list_dm_channels(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<DirectMessageChannelDto>>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        channel_id: Uuid,
        channel_created_at: DateTime<Utc>,
        recipient_id: Uuid,
        recipient_username: String,
        recipient_email: Option<String>,
        recipient_avatar_url: Option<String>,
        recipient_status: String,
        recipient_custom_status: Option<String>,
        recipient_created_at: DateTime<Utc>,
        last_message_at: Option<DateTime<Utc>>,
    }

    let rows = sqlx::query_as::<_, Row>(
        "SELECT
             dmc.id             AS channel_id,
             dmc.created_at     AS channel_created_at,
             u.id               AS recipient_id,
             u.username         AS recipient_username,
             u.email            AS recipient_email,
             u.avatar_url       AS recipient_avatar_url,
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
    .bind(auth.user_id())
    .fetch_all(&state.pool)
    .await?;

    let channels = rows
        .into_iter()
        .map(|r| DirectMessageChannelDto {
            id: r.channel_id,
            recipient: UserDto {
                id: r.recipient_id,
                username: r.recipient_username,
                email: r.recipient_email,
                avatar_url: r.recipient_avatar_url,
                status: r.recipient_status,
                custom_status: r.recipient_custom_status,
                created_at: r.recipient_created_at,
            },
            created_at: r.channel_created_at,
            last_message_at: r.last_message_at,
        })
        .collect();

    Ok(Json(channels))
}

/// POST /dm-channels/:id/messages — send a message to a DM channel.
pub async fn send_dm_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<SendDmRequest>,
) -> AppResult<(StatusCode, Json<DirectMessage>)> {
    req.validate().map_err(validation_error)?;

    require_dm_member(&state.pool, channel_id, auth.user_id()).await?;

    let message = sqlx::query_as::<_, DirectMessage>(
        "INSERT INTO direct_messages (channel_id, author_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, channel_id, author_id, content, edited_at, deleted, created_at",
    )
    .bind(channel_id)
    .bind(auth.user_id())
    .bind(&req.content)
    .fetch_one(&state.pool)
    .await?;

    // Get both participants to broadcast to.
    let participant_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT user_id FROM direct_message_members WHERE channel_id = $1")
            .bind(channel_id)
            .fetch_all(&state.pool)
            .await
            .unwrap_or_default();

    if let Ok(payload) = serde_json::to_value(&message) {
        broadcast_to_user_list(&state, &participant_ids, EVENT_DM_MESSAGE_CREATE, payload).await;
    }

    Ok((StatusCode::CREATED, Json(message)))
}

/// GET /dm-channels/:id/messages — list messages in a DM channel with cursor pagination.
pub async fn list_dm_messages(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Query(query): Query<ListDmMessagesQuery>,
) -> AppResult<Json<Vec<DirectMessage>>> {
    require_dm_member(&state.pool, channel_id, auth.user_id()).await?;

    let limit = query.limit.unwrap_or(50).clamp(1, 100);

    let messages = if let Some(before_id) = query.before {
        sqlx::query_as::<_, DirectMessage>(
            "SELECT id, channel_id, author_id, content, edited_at, deleted, created_at
             FROM direct_messages
             WHERE channel_id = $1
               AND deleted = FALSE
               AND (created_at, id) < (
                   SELECT created_at, id FROM direct_messages WHERE id = $2
               )
             ORDER BY created_at DESC, id DESC
             LIMIT $3",
        )
        .bind(channel_id)
        .bind(before_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, DirectMessage>(
            "SELECT id, channel_id, author_id, content, edited_at, deleted, created_at
             FROM direct_messages
             WHERE channel_id = $1 AND deleted = FALSE
             ORDER BY created_at DESC, id DESC
             LIMIT $2",
        )
        .bind(channel_id)
        .bind(limit)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(messages))
}

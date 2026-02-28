use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;
use validator::Validate;

use super::shared::{fetch_server, require_member, validation_error};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Channel, ChannelType, CreateChannelDto, UpdateChannelDto},
    state::AppState,
};

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, serde::Deserialize, Validate)]
pub struct CreateChannelRequest {
    #[validate(length(min = 1, max = 100, message = "Channel name must be 1–100 characters"))]
    pub name: String,
    pub r#type: ChannelType,
    #[validate(length(max = 1024, message = "Topic must be ≤ 1 024 characters"))]
    pub topic: Option<String>,
    #[validate(length(max = 100, message = "Category must be ≤ 100 characters"))]
    pub category: Option<String>,
}

#[derive(Debug, serde::Deserialize, Validate)]
pub struct UpdateChannelRequest {
    #[validate(length(min = 1, max = 100, message = "Channel name must be 1–100 characters"))]
    pub name: Option<String>,
    #[validate(length(max = 1024, message = "Topic must be ≤ 1 024 characters"))]
    pub topic: Option<String>,
    #[validate(length(max = 100, message = "Category must be ≤ 100 characters"))]
    pub category: Option<String>,
    #[validate(range(min = 0, message = "Position must be ≥ 0"))]
    pub position: Option<i32>,
}

// ============================================================================
// Private helpers
// ============================================================================

async fn fetch_channel(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    channel_id: Uuid,
) -> AppResult<Channel> {
    sqlx::query_as::<_, Channel>(
        "SELECT id, server_id, name, type, position, category, topic, created_at
         FROM channels WHERE id = $1 AND server_id = $2",
    )
    .bind(channel_id)
    .bind(server_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /servers/:id/channels — create a channel in a server (owner only).
pub async fn create_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(req): Json<CreateChannelRequest>,
) -> AppResult<(StatusCode, Json<Channel>)> {
    req.validate().map_err(validation_error)?;

    let server = fetch_server(&state.pool, server_id).await?;

    if server.owner_id != auth.user_id() {
        return Err(AppError::Forbidden(
            "Only the server owner can create channels".into(),
        ));
    }

    let dto = CreateChannelDto {
        name: req.name,
        r#type: req.r#type,
        topic: req.topic,
        category: req.category,
    };

    // The position subquery is part of the INSERT, making position assignment
    // atomic and free from the TOCTOU race of a separate SELECT + INSERT.
    let channel = sqlx::query_as::<_, Channel>(
        "INSERT INTO channels (server_id, name, type, position, category, topic)
         VALUES ($1, $2, $3,
                 (SELECT COALESCE(MAX(position) + 1, 0) FROM channels WHERE server_id = $1),
                 $4, $5)
         RETURNING id, server_id, name, type, position, category, topic, created_at",
    )
    .bind(server_id)
    .bind(&dto.name)
    .bind(&dto.r#type)
    .bind(&dto.category)
    .bind(&dto.topic)
    .fetch_one(&state.pool)
    .await?;

    Ok((StatusCode::CREATED, Json(channel)))
}

/// GET /servers/:id/channels — list all channels in a server (members only).
pub async fn list_channels(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<Channel>>> {
    fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let channels = sqlx::query_as::<_, Channel>(
        "SELECT id, server_id, name, type, position, category, topic, created_at
         FROM channels WHERE server_id = $1
         ORDER BY position ASC, created_at ASC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(channels))
}

/// GET /servers/:id/channels/:channel_id — get a single channel (members only).
pub async fn get_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<Channel>> {
    fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    let channel = fetch_channel(&state.pool, server_id, channel_id).await?;
    Ok(Json(channel))
}

/// PATCH /servers/:id/channels/:channel_id — update a channel (owner only).
pub async fn update_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateChannelRequest>,
) -> AppResult<Json<Channel>> {
    req.validate().map_err(validation_error)?;

    let server = fetch_server(&state.pool, server_id).await?;

    if server.owner_id != auth.user_id() {
        return Err(AppError::Forbidden(
            "Only the server owner can update channels".into(),
        ));
    }

    let dto = UpdateChannelDto {
        name: req.name,
        topic: req.topic,
        category: req.category,
        position: req.position,
    };

    // Use fetch_optional on the UPDATE itself — avoids a separate SELECT and
    // eliminates the TOCTOU window between an existence check and the write.
    let updated = sqlx::query_as::<_, Channel>(
        "UPDATE channels
         SET name     = COALESCE($1, name),
             topic    = COALESCE($2, topic),
             category = COALESCE($3, category),
             position = COALESCE($4, position)
         WHERE id = $5 AND server_id = $6
         RETURNING id, server_id, name, type, position, category, topic, created_at",
    )
    .bind(&dto.name)
    .bind(&dto.topic)
    .bind(&dto.category)
    .bind(dto.position)
    .bind(channel_id)
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    Ok(Json(updated))
}

/// DELETE /servers/:id/channels/:channel_id — delete a channel (owner only).
///
/// This is a hard delete; any messages in the channel are also removed by the
/// database cascade constraint (ON DELETE CASCADE on messages.channel_id).
pub async fn delete_channel(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, channel_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;

    if server.owner_id != auth.user_id() {
        return Err(AppError::Forbidden(
            "Only the server owner can delete channels".into(),
        ));
    }

    let result = sqlx::query("DELETE FROM channels WHERE id = $1 AND server_id = $2")
        .bind(channel_id)
        .bind(server_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Channel not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

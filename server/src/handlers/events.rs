use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CreateEventPayload, MessageDto, ServerEventDto},
    state::AppState,
    websocket::{broadcast_to_server, events::EVENT_MESSAGE_CREATE},
};

use super::shared::{fetch_channel_by_id, require_member};

// ── POST /channels/:channel_id/events ──────────────────────────────────────

pub async fn create_event(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<CreateEventPayload>,
) -> AppResult<(StatusCode, Json<MessageDto>)> {
    if req.name.trim().is_empty() || req.name.len() > 200 {
        return Err(AppError::Validation(
            "Event name must be 1–200 characters".into(),
        ));
    }

    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let display_time = req.starts_at.format("%b %-d, %Y at %-I:%M %p UTC");
    let message_content = format!("📅 **Event**: {} — {}", req.name.trim(), display_time);

    let mut tx = state.pool.begin().await?;

    let message = sqlx::query_as::<_, crate::models::Message>(
        "INSERT INTO messages (channel_id, author_id, content, mention_user_ids, mention_everyone)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id, channel_id, author_id, content, reply_to,
                   mention_user_ids, mention_everyone, thread_id,
                   0 AS thread_reply_count, edited_at, deleted, created_at",
    )
    .bind(channel_id)
    .bind(auth.user_id())
    .bind(&message_content)
    .bind(Vec::<Uuid>::new())
    .fetch_one(&mut *tx)
    .await?;

    let event_id: Uuid = sqlx::query_scalar(
        "INSERT INTO server_events
             (message_id, server_id, channel_id, name, description, starts_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id",
    )
    .bind(message.id)
    .bind(channel.server_id)
    .bind(channel_id)
    .bind(req.name.trim())
    .bind(req.description.as_deref())
    .bind(req.starts_at)
    .bind(auth.user_id())
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let event_dto = ServerEventDto {
        id: event_id,
        name: req.name,
        description: req.description,
        starts_at: req.starts_at,
        created_by: Some(auth.user_id()),
        created_at: message.created_at,
    };

    let mut dto = MessageDto::from_message(message);
    dto.event = Some(event_dto);

    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_MESSAGE_CREATE,
        serde_json::to_value(&dto).unwrap_or_default(),
    )
    .await;

    Ok((StatusCode::CREATED, Json(dto)))
}

// ── GET /servers/:id/events ─────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct ServerEventRow {
    id: Uuid,
    name: String,
    description: Option<String>,
    starts_at: chrono::DateTime<chrono::Utc>,
    created_by: Option<Uuid>,
    created_at: chrono::DateTime<chrono::Utc>,
}

pub async fn list_events(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<ServerEventDto>>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let rows = sqlx::query_as::<_, ServerEventRow>(
        "SELECT id, name, description, starts_at, created_by, created_at
         FROM server_events
         WHERE server_id = $1 AND starts_at > NOW()
         ORDER BY starts_at ASC
         LIMIT 50",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    let events: Vec<ServerEventDto> = rows
        .into_iter()
        .map(|r| ServerEventDto {
            id: r.id,
            name: r.name,
            description: r.description,
            starts_at: r.starts_at,
            created_by: r.created_by,
            created_at: r.created_at,
        })
        .collect();

    Ok(Json(events))
}

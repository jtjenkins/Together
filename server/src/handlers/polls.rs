use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CastVotePayload, CreatePollPayload, MessageDto, PollDto, PollOptionDto},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{EVENT_MESSAGE_CREATE, EVENT_POLL_VOTE},
    },
};

use super::shared::{fetch_channel_by_id, require_member};

// ── Row types for query_as ──────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct PollRow {
    id: Uuid,
    question: String,
    options: sqlx::types::Json<serde_json::Value>,
    channel_id: Uuid,
    server_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct VoteCountRow {
    option_id: Uuid,
    count: i64,
}

// ── Helper: load PollDto ────────────────────────────────────────────────────

/// Build a PollDto for the given poll_id, including per-option vote counts
/// and the caller's current vote selection.
pub async fn fetch_poll_dto(
    pool: &sqlx::PgPool,
    poll_id: Uuid,
    caller_id: Uuid,
) -> AppResult<PollDto> {
    let poll = sqlx::query_as::<_, PollRow>(
        "SELECT id, question, options, channel_id, server_id
         FROM polls WHERE id = $1",
    )
    .bind(poll_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Poll not found".into()))?;

    let vote_rows = sqlx::query_as::<_, VoteCountRow>(
        "SELECT option_id, COUNT(*)::bigint AS count
         FROM poll_votes WHERE poll_id = $1
         GROUP BY option_id",
    )
    .bind(poll_id)
    .fetch_all(pool)
    .await?;

    let caller_vote: Option<Uuid> =
        sqlx::query_scalar("SELECT option_id FROM poll_votes WHERE poll_id = $1 AND user_id = $2")
            .bind(poll_id)
            .bind(caller_id)
            .fetch_optional(pool)
            .await?;

    let vote_map: std::collections::HashMap<Uuid, i64> = vote_rows
        .into_iter()
        .map(|r| (r.option_id, r.count))
        .collect();

    let total_votes: i64 = vote_map.values().sum();

    let options_array = poll.options.0.as_array().cloned().unwrap_or_default();

    let options: Vec<PollOptionDto> = options_array
        .iter()
        .filter_map(|opt| {
            let id: Uuid = opt["id"].as_str().and_then(|s| s.parse().ok())?;
            let text = opt["text"].as_str()?.to_string();
            let votes = *vote_map.get(&id).unwrap_or(&0);
            Some(PollOptionDto { id, text, votes })
        })
        .collect();

    Ok(PollDto {
        id: poll.id,
        question: poll.question,
        options,
        total_votes,
        user_vote: caller_vote,
    })
}

// ── POST /channels/:channel_id/polls ───────────────────────────────────────

pub async fn create_poll(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(channel_id): Path<Uuid>,
    Json(req): Json<CreatePollPayload>,
) -> AppResult<(StatusCode, Json<MessageDto>)> {
    if req.options.len() < 2 || req.options.len() > 10 {
        return Err(AppError::Validation("Polls require 2 to 10 options".into()));
    }
    for opt in &req.options {
        if opt.trim().is_empty() || opt.len() > 200 {
            return Err(AppError::Validation(
                "Each option must be 1–200 characters".into(),
            ));
        }
    }
    if req.question.trim().is_empty() || req.question.len() > 500 {
        return Err(AppError::Validation(
            "Question must be 1–500 characters".into(),
        ));
    }

    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let options_json: Vec<serde_json::Value> = req
        .options
        .iter()
        .map(|text| json!({ "id": Uuid::new_v4().to_string(), "text": text.trim() }))
        .collect();

    let message_content = format!("📊 **Poll**: {}", req.question);

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

    let options_value = serde_json::Value::Array(options_json);

    let poll_id: Uuid = sqlx::query_scalar(
        "INSERT INTO polls (message_id, channel_id, server_id, question, options, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id",
    )
    .bind(message.id)
    .bind(channel_id)
    .bind(channel.server_id)
    .bind(&req.question)
    .bind(sqlx::types::Json(&options_value))
    .bind(auth.user_id())
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let poll_dto = fetch_poll_dto(&state.pool, poll_id, auth.user_id()).await?;

    let mut dto = MessageDto::from_message(message);
    dto.poll = Some(poll_dto);

    broadcast_to_server(
        &state,
        channel.server_id,
        EVENT_MESSAGE_CREATE,
        serde_json::to_value(&dto).unwrap_or_default(),
    )
    .await;

    Ok((StatusCode::CREATED, Json(dto)))
}

// ── GET /polls/:poll_id ─────────────────────────────────────────────────────

pub async fn get_poll(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(poll_id): Path<Uuid>,
) -> AppResult<Json<PollDto>> {
    let dto = fetch_poll_dto(&state.pool, poll_id, auth.user_id()).await?;
    Ok(Json(dto))
}

// ── POST /polls/:poll_id/vote ───────────────────────────────────────────────

pub async fn cast_vote(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(poll_id): Path<Uuid>,
    Json(req): Json<CastVotePayload>,
) -> AppResult<Json<PollDto>> {
    // Fetch poll to verify option_id and get server_id for broadcast
    let poll = sqlx::query_as::<_, PollRow>(
        "SELECT id, question, options, channel_id, server_id
         FROM polls WHERE id = $1",
    )
    .bind(poll_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Poll not found".into()))?;

    let valid = poll
        .options
        .0
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .any(|o| o["id"].as_str() == Some(&req.option_id.to_string()));

    if !valid {
        return Err(AppError::Validation("Invalid option_id".into()));
    }

    // Upsert vote (single-choice: PK on poll_id+user_id)
    sqlx::query(
        "INSERT INTO poll_votes (poll_id, user_id, option_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = $3, voted_at = NOW()",
    )
    .bind(poll_id)
    .bind(auth.user_id())
    .bind(req.option_id)
    .execute(&state.pool)
    .await?;

    let dto = fetch_poll_dto(&state.pool, poll_id, auth.user_id()).await?;

    broadcast_to_server(
        &state,
        poll.server_id,
        EVENT_POLL_VOTE,
        json!({
            "poll_id": poll_id,
            "channel_id": poll.channel_id,
            "updated_poll": &dto
        }),
    )
    .await;

    Ok(Json(dto))
}

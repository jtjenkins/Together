use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use chrono::{DateTime, Utc};
use sqlx::FromRow;

use super::shared::{fetch_server, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CreateWebhookDto, UpdateWebhookDto, Webhook, WebhookCreatedResponse, WebhookDto},
    state::AppState,
    webhook_delivery::{fire_event, DeliveryJob},
};

/// Webhook row without the `secret` column — used for list/get queries
/// where the signing secret should not be loaded from the database.
#[derive(Debug, Clone, FromRow)]
struct WebhookNoSecret {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub url: String,
    pub event_types: serde_json::Value,
    pub enabled: bool,
    pub delivery_failures: i32,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl From<WebhookNoSecret> for WebhookDto {
    fn from(w: WebhookNoSecret) -> Self {
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

// ── Permission guard ──────────────────────────────────────────────────────────

/// Require that the user is the server owner or has ADMINISTRATOR (bit 13).
async fn require_manage_webhooks(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    const PERMISSION_ADMINISTRATOR: i64 = 8192;

    let is_owner: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)")
            .bind(server_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    if is_owner {
        return Ok(());
    }

    let has_perm: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.user_id = $1
               AND mr.server_id = $2
               AND (r.permissions & $3 != 0)
         )",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(PERMISSION_ADMINISTRATOR)
    .fetch_one(pool)
    .await?;

    if has_perm {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "You need the Administrator permission to manage webhooks".into(),
        ))
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Generate a 64-character hex HMAC signing secret.
fn generate_webhook_secret() -> String {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let mut hasher = Sha256::new();
    hasher.update(a.as_bytes());
    hasher.update(b.as_bytes());
    format!("{:x}", hasher.finalize())
}

const VALID_EVENT_TYPES: &[&str] = &[
    "message.created",
    "message.updated",
    "message.deleted",
    "member.joined",
    "member.left",
];

fn validate_event_types(types: &[String]) -> AppResult<()> {
    if types.is_empty() {
        return Err(AppError::Validation(
            "event_types must contain at least one event".into(),
        ));
    }
    for t in types {
        if !VALID_EVENT_TYPES.contains(&t.as_str()) {
            return Err(AppError::Validation(format!(
                "Unknown event type '{}'. Valid types: {}",
                t,
                VALID_EVENT_TYPES.join(", ")
            )));
        }
    }
    Ok(())
}

fn validate_webhook_url(url: &str) -> AppResult<()> {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err(AppError::Validation(
            "Webhook URL must use http:// or https://".into(),
        ));
    }
    if url.len() > 2000 {
        return Err(AppError::Validation(
            "Webhook URL must be ≤2000 characters".into(),
        ));
    }
    Ok(())
}

// ── POST /servers/:id/webhooks ────────────────────────────────────────────────

#[utoipa::path(
    post,
    path = "/servers/{id}/webhooks",
    params(("id" = Uuid, Path, description = "Server ID")),
    request_body = CreateWebhookDto,
    responses(
        (status = 201, description = "Webhook created", body = WebhookCreatedResponse),
        (status = 400, description = "Validation error"),
        (status = 403, description = "Insufficient permissions"),
    ),
    security(("bearer_auth" = [])),
    tag = "Webhooks"
)]
pub async fn create_webhook(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<Uuid>,
    Json(payload): Json<CreateWebhookDto>,
) -> AppResult<(StatusCode, Json<WebhookCreatedResponse>)> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_manage_webhooks(&state.pool, server_id, auth.user_id()).await?;

    let name = payload.name.trim().to_string();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::Validation(
            "Webhook name must be 1–100 characters".into(),
        ));
    }
    validate_webhook_url(&payload.url)?;
    validate_event_types(&payload.event_types)?;

    // Check limit: max 10 webhooks per server.
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM webhooks WHERE server_id = $1")
        .bind(server_id)
        .fetch_one(&state.pool)
        .await?;
    if count >= 10 {
        return Err(AppError::Validation(
            "Servers are limited to 10 webhooks".into(),
        ));
    }

    let secret = generate_webhook_secret();
    let event_types_json =
        serde_json::to_value(&payload.event_types).map_err(|_| AppError::Internal)?;

    let webhook = sqlx::query_as::<_, Webhook>(
        "INSERT INTO webhooks (server_id, created_by, name, url, secret, event_types)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, server_id, created_by, name, url, secret, event_types,
                   enabled, delivery_failures, last_used_at, created_at, updated_at",
    )
    .bind(server_id)
    .bind(auth.user_id())
    .bind(&name)
    .bind(&payload.url)
    .bind(&secret)
    .bind(&event_types_json)
    .fetch_one(&state.pool)
    .await?;

    tracing::info!(
        webhook_id = %webhook.id,
        server_id = %server_id,
        created_by = %auth.user_id(),
        "Webhook created"
    );

    Ok((
        StatusCode::CREATED,
        Json(WebhookCreatedResponse {
            webhook: webhook.into(),
            secret,
        }),
    ))
}

// ── GET /servers/:id/webhooks ─────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/servers/{id}/webhooks",
    params(("id" = Uuid, Path, description = "Server ID")),
    responses(
        (status = 200, description = "List of webhooks"),
        (status = 403, description = "Insufficient permissions"),
    ),
    security(("bearer_auth" = [])),
    tag = "Webhooks"
)]
pub async fn list_webhooks(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_manage_webhooks(&state.pool, server_id, auth.user_id()).await?;

    let webhooks: Vec<WebhookDto> = sqlx::query_as::<_, WebhookNoSecret>(
        "SELECT id, server_id, created_by, name, url, event_types,
                enabled, delivery_failures, last_used_at, created_at, updated_at
         FROM webhooks WHERE server_id = $1
         ORDER BY created_at ASC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?
    .into_iter()
    .map(WebhookDto::from)
    .collect();

    Ok(Json(json!({ "webhooks": webhooks })))
}

// ── GET /servers/:id/webhooks/:webhook_id ─────────────────────────────────────

#[utoipa::path(
    get,
    path = "/servers/{id}/webhooks/{webhook_id}",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("webhook_id" = Uuid, Path, description = "Webhook ID"),
    ),
    responses(
        (status = 200, description = "Webhook details", body = WebhookDto),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Webhook not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "Webhooks"
)]
pub async fn get_webhook(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, webhook_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<WebhookDto>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_manage_webhooks(&state.pool, server_id, auth.user_id()).await?;

    let webhook = sqlx::query_as::<_, WebhookNoSecret>(
        "SELECT id, server_id, created_by, name, url, event_types,
                enabled, delivery_failures, last_used_at, created_at, updated_at
         FROM webhooks WHERE id = $1 AND server_id = $2",
    )
    .bind(webhook_id)
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    Ok(Json(webhook.into()))
}

// ── PATCH /servers/:id/webhooks/:webhook_id ───────────────────────────────────

#[utoipa::path(
    patch,
    path = "/servers/{id}/webhooks/{webhook_id}",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("webhook_id" = Uuid, Path, description = "Webhook ID"),
    ),
    request_body = UpdateWebhookDto,
    responses(
        (status = 200, description = "Webhook updated", body = WebhookDto),
        (status = 400, description = "Validation error"),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Webhook not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "Webhooks"
)]
pub async fn update_webhook(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, webhook_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<UpdateWebhookDto>,
) -> AppResult<Json<WebhookDto>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_manage_webhooks(&state.pool, server_id, auth.user_id()).await?;

    // Verify webhook belongs to this server.
    let existing = sqlx::query_as::<_, Webhook>(
        "SELECT id, server_id, created_by, name, url, secret, event_types,
                enabled, delivery_failures, last_used_at, created_at, updated_at
         FROM webhooks WHERE id = $1 AND server_id = $2",
    )
    .bind(webhook_id)
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    let name = match &payload.name {
        Some(n) => {
            let n = n.trim().to_string();
            if n.is_empty() || n.chars().count() > 100 {
                return Err(AppError::Validation(
                    "Webhook name must be 1–100 characters".into(),
                ));
            }
            n
        }
        None => existing.name.clone(),
    };

    let url = match &payload.url {
        Some(u) => {
            validate_webhook_url(u)?;
            u.clone()
        }
        None => existing.url.clone(),
    };

    let event_types_json = match &payload.event_types {
        Some(types) => {
            validate_event_types(types)?;
            serde_json::to_value(types).map_err(|_| AppError::Internal)?
        }
        None => existing.event_types.clone(),
    };

    let enabled = payload.enabled.unwrap_or(existing.enabled);

    let updated = sqlx::query_as::<_, Webhook>(
        "UPDATE webhooks
         SET name = $1, url = $2, event_types = $3, enabled = $4
         WHERE id = $5 AND server_id = $6
         RETURNING id, server_id, created_by, name, url, secret, event_types,
                   enabled, delivery_failures, last_used_at, created_at, updated_at",
    )
    .bind(&name)
    .bind(&url)
    .bind(&event_types_json)
    .bind(enabled)
    .bind(webhook_id)
    .bind(server_id)
    .fetch_one(&state.pool)
    .await?;

    tracing::info!(
        webhook_id = %webhook_id,
        updated_by = %auth.user_id(),
        "Webhook updated"
    );

    Ok(Json(updated.into()))
}

// ── DELETE /servers/:id/webhooks/:webhook_id ──────────────────────────────────

#[utoipa::path(
    delete,
    path = "/servers/{id}/webhooks/{webhook_id}",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("webhook_id" = Uuid, Path, description = "Webhook ID"),
    ),
    responses(
        (status = 204, description = "Webhook deleted"),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Webhook not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "Webhooks"
)]
pub async fn delete_webhook(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, webhook_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_manage_webhooks(&state.pool, server_id, auth.user_id()).await?;

    let rows = sqlx::query("DELETE FROM webhooks WHERE id = $1 AND server_id = $2")
        .bind(webhook_id)
        .bind(server_id)
        .execute(&state.pool)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::NotFound("Webhook not found".into()));
    }

    tracing::info!(
        webhook_id = %webhook_id,
        deleted_by = %auth.user_id(),
        "Webhook deleted"
    );

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /servers/:id/webhooks/:webhook_id/test ───────────────────────────────

/// Send a test ping event to the webhook URL.
#[utoipa::path(
    post,
    path = "/servers/{id}/webhooks/{webhook_id}/test",
    params(
        ("id" = Uuid, Path, description = "Server ID"),
        ("webhook_id" = Uuid, Path, description = "Webhook ID"),
    ),
    responses(
        (status = 202, description = "Test event queued"),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Webhook not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "Webhooks"
)]
pub async fn test_webhook(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((server_id, webhook_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    require_member(&state.pool, server_id, auth.user_id()).await?;
    require_manage_webhooks(&state.pool, server_id, auth.user_id()).await?;

    let webhook = sqlx::query_as::<_, Webhook>(
        "SELECT id, server_id, created_by, name, url, secret, event_types,
                enabled, delivery_failures, last_used_at, created_at, updated_at
         FROM webhooks WHERE id = $1 AND server_id = $2",
    )
    .bind(webhook_id)
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Webhook not found".into()))?;

    let server = fetch_server(&state.pool, server_id).await?;

    let test_payload = json!({
        "event": "ping",
        "server_id": server_id,
        "data": {
            "webhook_id": webhook_id,
            "server_name": server.name,
            "message": "This is a test event from Together.",
        }
    });

    let body = serde_json::to_string(&test_payload).map_err(|_| AppError::Internal)?;

    state.webhook_queue.send(DeliveryJob::new(
        webhook.id,
        webhook.url,
        webhook.secret,
        body,
    ));

    Ok(StatusCode::ACCEPTED)
}

// ── Internal helper (called from other handlers) ──────────────────────────────

/// Fire a webhook event for all matching webhooks on a server.
/// Non-blocking — schedules delivery jobs on the queue.
pub async fn dispatch_event(
    state: &AppState,
    server_id: Uuid,
    event_type: &str,
    data: serde_json::Value,
) {
    fire_event(
        &state.webhook_queue,
        &state.pool,
        server_id,
        event_type,
        data,
    )
    .await;
}

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;
use validator::Validate;

use super::shared::{fetch_server, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CreateServerDto, MemberDto, Server, ServerDto, UpdateServerDto},
    state::AppState,
};

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, serde::Deserialize, Validate)]
pub struct CreateServerRequest {
    #[validate(length(min = 1, max = 100, message = "Server name must be 1–100 characters"))]
    pub name: String,
    pub icon_url: Option<String>,
    pub is_public: Option<bool>,
}

#[derive(Debug, serde::Deserialize, Validate)]
pub struct UpdateServerRequest {
    #[validate(length(min = 1, max = 100, message = "Server name must be 1–100 characters"))]
    pub name: Option<String>,
    pub icon_url: Option<String>,
    pub is_public: Option<bool>,
}

// ============================================================================
// Helpers
// ============================================================================

/// Build a ServerDto from a Server row plus a live member count query.
async fn server_dto(pool: &sqlx::PgPool, server: Server) -> AppResult<ServerDto> {
    let member_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM server_members WHERE server_id = $1")
            .bind(server.id)
            .fetch_one(pool)
            .await?;

    Ok(ServerDto {
        id: server.id,
        name: server.name,
        owner_id: server.owner_id,
        icon_url: server.icon_url,
        is_public: server.is_public,
        member_count,
        created_at: server.created_at,
        updated_at: server.updated_at,
    })
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /servers — create a new server; creator is auto-joined as owner.
pub async fn create_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateServerRequest>,
) -> AppResult<(StatusCode, Json<ServerDto>)> {
    req.validate().map_err(|e| {
        AppError::Validation(
            e.field_errors()
                .values()
                .flat_map(|v| v.iter())
                .filter_map(|e| e.message.as_ref())
                .map(|m| m.to_string())
                .collect::<Vec<_>>()
                .join(", "),
        )
    })?;

    let dto = CreateServerDto {
        name: req.name,
        icon_url: req.icon_url,
        is_public: req.is_public,
    };

    let mut tx = state.pool.begin().await?;

    let server = sqlx::query_as::<_, Server>(
        "INSERT INTO servers (name, owner_id, icon_url, is_public)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, owner_id, icon_url, is_public, created_at, updated_at",
    )
    .bind(&dto.name)
    .bind(auth.user_id())
    .bind(&dto.icon_url)
    .bind(dto.is_public.unwrap_or(false))
    .fetch_one(&mut *tx)
    .await?;

    // Auto-join creator as first member.
    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)")
        .bind(auth.user_id())
        .bind(server.id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let dto = server_dto(&state.pool, server).await?;
    Ok((StatusCode::CREATED, Json(dto)))
}

/// GET /servers — list all servers the authenticated user belongs to.
pub async fn list_servers(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<ServerDto>>> {
    let servers = sqlx::query_as::<_, Server>(
        "SELECT s.id, s.name, s.owner_id, s.icon_url, s.is_public, s.created_at, s.updated_at
         FROM servers s
         JOIN server_members sm ON sm.server_id = s.id
         WHERE sm.user_id = $1
         ORDER BY s.created_at ASC",
    )
    .bind(auth.user_id())
    .fetch_all(&state.pool)
    .await?;

    let mut dtos = Vec::with_capacity(servers.len());
    for s in servers {
        dtos.push(server_dto(&state.pool, s).await?);
    }

    Ok(Json(dtos))
}

/// GET /servers/:id — get a single server (members only).
pub async fn get_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<ServerDto>> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;
    let dto = server_dto(&state.pool, server).await?;
    Ok(Json(dto))
}

/// PATCH /servers/:id — update name or icon (owner only).
pub async fn update_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    Json(req): Json<UpdateServerRequest>,
) -> AppResult<Json<ServerDto>> {
    req.validate().map_err(|e| {
        AppError::Validation(
            e.field_errors()
                .values()
                .flat_map(|v| v.iter())
                .filter_map(|e| e.message.as_ref())
                .map(|m| m.to_string())
                .collect::<Vec<_>>()
                .join(", "),
        )
    })?;

    let server = fetch_server(&state.pool, server_id).await?;

    if server.owner_id != auth.user_id() {
        return Err(AppError::Forbidden(
            "Only the server owner can update it".into(),
        ));
    }

    let dto = UpdateServerDto {
        name: req.name,
        icon_url: req.icon_url,
        is_public: req.is_public,
    };

    let updated = sqlx::query_as::<_, Server>(
        "UPDATE servers
         SET name       = COALESCE($1, name),
             icon_url   = COALESCE($2, icon_url),
             is_public  = COALESCE($3, is_public),
             updated_at = NOW()
         WHERE id = $4
         RETURNING id, name, owner_id, icon_url, is_public, created_at, updated_at",
    )
    .bind(&dto.name)
    .bind(&dto.icon_url)
    .bind(dto.is_public)
    .bind(server_id)
    .fetch_one(&state.pool)
    .await?;

    let dto = server_dto(&state.pool, updated).await?;
    Ok(Json(dto))
}

/// DELETE /servers/:id — delete server and all its data (owner only).
pub async fn delete_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;

    if server.owner_id != auth.user_id() {
        return Err(AppError::Forbidden(
            "Only the server owner can delete it".into(),
        ));
    }

    sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(server_id)
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /servers/:id/join — join a server as the authenticated user.
pub async fn join_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<(StatusCode, Json<Value>)> {
    // Verify server exists.
    fetch_server(&state.pool, server_id).await?;

    // Check not already a member (ON CONFLICT would also handle this, but
    // returning a meaningful error is more helpful).
    let existing = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)",
    )
    .bind(server_id)
    .bind(auth.user_id())
    .fetch_one(&state.pool)
    .await?;

    if existing {
        return Err(AppError::Conflict("Already a member of this server".into()));
    }

    sqlx::query("INSERT INTO server_members (user_id, server_id) VALUES ($1, $2)")
        .bind(auth.user_id())
        .bind(server_id)
        .execute(&state.pool)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "message": "Joined server" })),
    ))
}

/// DELETE /servers/:id/leave — leave a server (non-owners only).
pub async fn leave_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;

    if server.owner_id == auth.user_id() {
        return Err(AppError::Validation(
            "Server owner cannot leave — transfer ownership or delete the server".into(),
        ));
    }

    sqlx::query("DELETE FROM server_members WHERE server_id = $1 AND user_id = $2")
        .bind(server_id)
        .bind(auth.user_id())
        .execute(&state.pool)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /servers/browse — list all public servers (authenticated, no membership required).
///
/// Returns servers ordered by member count (descending) then creation date.
/// Results are capped at 50 — discovery is intentionally lightweight with no pagination.
/// Does NOT filter out servers the caller already belongs to; clients derive "Joined"
/// state by cross-referencing their own server list.
pub async fn browse_servers(
    State(state): State<AppState>,
    _auth: AuthUser,
) -> AppResult<Json<Vec<ServerDto>>> {
    let servers = sqlx::query_as::<_, ServerDto>(
        "SELECT s.id, s.name, s.owner_id, s.icon_url, s.is_public, s.created_at, s.updated_at,
                COUNT(sm.user_id)::BIGINT AS member_count
         FROM   servers s
         LEFT JOIN server_members sm ON sm.server_id = s.id
         WHERE  s.is_public = TRUE
         GROUP BY s.id
         ORDER BY member_count DESC, s.created_at DESC
         LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(servers))
}

/// GET /servers/:id/members — list all members of a server (members only).
pub async fn list_members(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<MemberDto>>> {
    fetch_server(&state.pool, server_id).await?;
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let members = sqlx::query_as::<_, MemberDto>(
        "SELECT u.id AS user_id, u.username, u.avatar_url, u.status,
                sm.nickname, sm.joined_at
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id = $1
         ORDER BY sm.joined_at ASC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(members))
}

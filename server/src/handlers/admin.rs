//! Instance admin dashboard handlers.
//!
//! All endpoints require the requesting user to have `is_admin = true`.
//! These are instance-level operations, not server-scoped.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use std::time::Instant;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    handlers::health::uptime_secs,
    models::{
        AdminListQuery, AdminServerDto, AdminServersResponse, AdminStatsResponse, AdminUserDto,
        AdminUsersResponse, UpdateAdminUserRequest,
    },
    state::AppState,
};

// ============================================================================
// Auth helper
// ============================================================================

/// Verify the requesting user is an instance admin.
///
/// Follows the `require_member` pattern — a standalone async function rather
/// than an extractor, keeping the auth check explicit at each call site.
async fn require_admin(pool: &sqlx::PgPool, user_id: Uuid) -> AppResult<()> {
    let is_admin: bool = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::Auth("User not found".into()))?;

    if !is_admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }
    Ok(())
}

// ============================================================================
// Handlers
// ============================================================================

/// GET /admin/stats — Instance overview statistics.
///
/// Returns aggregate counts, active WebSocket connections, uptime, DB latency,
/// and upload directory storage size.
pub async fn get_stats(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<AdminStatsResponse>> {
    require_admin(&state.pool, auth.user_id()).await?;

    // Single query for all counts — avoids 4 round trips.
    let counts: (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
            (SELECT COUNT(*) FROM users)::BIGINT,
            (SELECT COUNT(*) FROM servers)::BIGINT,
            (SELECT COUNT(*) FROM messages)::BIGINT,
            (SELECT COUNT(*) FROM channels)::BIGINT",
    )
    .fetch_one(&state.pool)
    .await?;

    // DB latency measurement.
    let db_start = Instant::now();
    sqlx::query("SELECT 1").execute(&state.pool).await?;
    let db_latency_ms = db_start.elapsed().as_millis() as u64;

    // Storage size — walk the upload directory.
    let storage_bytes = calculate_storage_bytes(&state.upload_dir).await;

    Ok(Json(AdminStatsResponse {
        total_users: counts.0,
        total_servers: counts.1,
        total_messages: counts.2,
        total_channels: counts.3,
        active_ws_connections: state.connections.connection_count().await,
        uptime_secs: uptime_secs(),
        db_latency_ms,
        storage_bytes,
    }))
}

/// Walk a directory tree and sum file sizes.
async fn calculate_storage_bytes(dir: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    let mut stack = vec![dir.to_path_buf()];

    while let Some(path) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&path).await {
            Ok(e) => e,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let meta = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
            }
        }
    }
    total
}

/// GET /admin/users — Paginated user list with search and sorting.
///
/// Query parameters:
/// - `page` (default 1)
/// - `per_page` (default 50, max 100)
/// - `search` — ILIKE match on username or email
/// - `sort_by` — one of: `username`, `created_at`, `message_count` (default `created_at`)
pub async fn list_users(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<AdminListQuery>,
) -> AppResult<Json<AdminUsersResponse>> {
    require_admin(&state.pool, auth.user_id()).await?;

    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(50).clamp(1, 100);
    let offset = (page - 1) * per_page;

    let search_pattern = query
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    // Whitelist sort columns — never interpolate user input into SQL.
    let order_clause = match query.sort_by.as_deref() {
        Some("username") => "u.username ASC",
        Some("message_count") => "message_count DESC",
        _ => "u.created_at DESC",
    };

    // Total count for pagination.
    let total: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM users u WHERE u.username ILIKE $1 OR u.email ILIKE $1",
        )
        .bind(pattern)
        .fetch_one(&state.pool)
        .await?
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&state.pool)
            .await?
    };

    // Build the query with sort_by baked in via match (safe — no user string interpolation).
    let users = if let Some(ref pattern) = search_pattern {
        let q = format!(
            "SELECT u.id, u.username, u.email, u.avatar_url, u.status,
                    u.is_admin, u.disabled, u.disabled_at, u.created_at,
                    (SELECT COUNT(*) FROM server_members sm WHERE sm.user_id = u.id)::BIGINT AS server_count,
                    (SELECT COUNT(*) FROM messages m WHERE m.author_id = u.id)::BIGINT AS message_count
             FROM users u
             WHERE u.username ILIKE $1 OR u.email ILIKE $1
             ORDER BY {order_clause}
             LIMIT $2 OFFSET $3"
        );
        sqlx::query_as::<_, AdminUserDto>(&q)
            .bind(pattern)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
    } else {
        let q = format!(
            "SELECT u.id, u.username, u.email, u.avatar_url, u.status,
                    u.is_admin, u.disabled, u.disabled_at, u.created_at,
                    (SELECT COUNT(*) FROM server_members sm WHERE sm.user_id = u.id)::BIGINT AS server_count,
                    (SELECT COUNT(*) FROM messages m WHERE m.author_id = u.id)::BIGINT AS message_count
             FROM users u
             ORDER BY {order_clause}
             LIMIT $1 OFFSET $2"
        );
        sqlx::query_as::<_, AdminUserDto>(&q)
            .bind(per_page)
            .bind(offset)
            .fetch_all(&state.pool)
            .await?
    };

    Ok(Json(AdminUsersResponse {
        users,
        total,
        page,
        per_page,
    }))
}

/// PATCH /admin/users/:user_id — Promote/demote admin, disable/enable account.
///
/// Self-operation guards: cannot demote or disable yourself (prevents admin lockout).
/// On disable: sets `disabled = true`, `disabled_at = NOW()`, deletes all sessions.
/// On enable: sets `disabled = false`, `disabled_at = NULL`.
pub async fn update_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(user_id): Path<Uuid>,
    Json(req): Json<UpdateAdminUserRequest>,
) -> AppResult<StatusCode> {
    require_admin(&state.pool, auth.user_id()).await?;

    // Self-operation guard.
    if user_id == auth.user_id() {
        if req.is_admin == Some(false) {
            return Err(AppError::Validation(
                "Cannot demote yourself from admin".into(),
            ));
        }
        if req.disabled == Some(true) {
            return Err(AppError::Validation("Cannot disable yourself".into()));
        }
    }

    // Verify target user exists.
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;

    if !exists {
        return Err(AppError::NotFound("User not found".into()));
    }

    let mut tx = state.pool.begin().await?;

    if let Some(is_admin) = req.is_admin {
        sqlx::query("UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2")
            .bind(is_admin)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }

    if let Some(disabled) = req.disabled {
        if disabled {
            sqlx::query(
                "UPDATE users SET disabled = true, disabled_at = NOW(), updated_at = NOW() WHERE id = $1",
            )
            .bind(user_id)
            .execute(&mut *tx)
            .await?;

            // Revoke all sessions so the user is forced to re-authenticate (and will be blocked).
            sqlx::query("DELETE FROM sessions WHERE user_id = $1")
                .bind(user_id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query(
                "UPDATE users SET disabled = false, disabled_at = NULL, updated_at = NOW() WHERE id = $1",
            )
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;

    Ok(StatusCode::OK)
}

/// DELETE /admin/users/:user_id — Permanently delete a user.
///
/// Transaction: delete sessions, anonymize messages (SET author_id = NULL),
/// then delete the user row (cascades memberships, DM participants, etc.).
/// Self-guard: cannot delete yourself.
pub async fn delete_user(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_admin(&state.pool, auth.user_id()).await?;

    if user_id == auth.user_id() {
        return Err(AppError::Validation("Cannot delete yourself".into()));
    }

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(user_id)
        .fetch_one(&state.pool)
        .await?;

    if !exists {
        return Err(AppError::NotFound("User not found".into()));
    }

    let mut tx = state.pool.begin().await?;

    // Delete sessions.
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Anonymize messages — preserve conversation context.
    sqlx::query("UPDATE messages SET author_id = NULL WHERE author_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Anonymize direct messages.
    sqlx::query("UPDATE direct_messages SET author_id = NULL WHERE author_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Delete the user — foreign keys with ON DELETE CASCADE handle memberships, etc.
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /admin/servers — Paginated server list with search and enriched counts.
///
/// Query parameters:
/// - `page` (default 1)
/// - `per_page` (default 50, max 100)
/// - `search` — ILIKE match on server name
pub async fn list_servers(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<AdminListQuery>,
) -> AppResult<Json<AdminServersResponse>> {
    require_admin(&state.pool, auth.user_id()).await?;

    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(50).clamp(1, 100);
    let offset = (page - 1) * per_page;

    let search_pattern = query
        .search
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("%{s}%"));

    let total: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar("SELECT COUNT(*) FROM servers WHERE name ILIKE $1")
            .bind(pattern)
            .fetch_one(&state.pool)
            .await?
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM servers")
            .fetch_one(&state.pool)
            .await?
    };

    let servers = if let Some(ref pattern) = search_pattern {
        sqlx::query_as::<_, AdminServerDto>(
            "SELECT s.id, s.name, s.owner_id,
                    u.username AS owner_username,
                    s.icon_url, s.is_public, s.created_at,
                    (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id)::BIGINT AS member_count,
                    (SELECT COUNT(*) FROM channels c WHERE c.server_id = s.id)::BIGINT AS channel_count,
                    (SELECT COUNT(*) FROM messages m
                     JOIN channels c2 ON c2.id = m.channel_id
                     WHERE c2.server_id = s.id)::BIGINT AS message_count
             FROM servers s
             JOIN users u ON u.id = s.owner_id
             WHERE s.name ILIKE $1
             ORDER BY s.created_at DESC
             LIMIT $2 OFFSET $3",
        )
        .bind(pattern)
        .bind(per_page)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?
    } else {
        sqlx::query_as::<_, AdminServerDto>(
            "SELECT s.id, s.name, s.owner_id,
                    u.username AS owner_username,
                    s.icon_url, s.is_public, s.created_at,
                    (SELECT COUNT(*) FROM server_members sm WHERE sm.server_id = s.id)::BIGINT AS member_count,
                    (SELECT COUNT(*) FROM channels c WHERE c.server_id = s.id)::BIGINT AS channel_count,
                    (SELECT COUNT(*) FROM messages m
                     JOIN channels c2 ON c2.id = m.channel_id
                     WHERE c2.server_id = s.id)::BIGINT AS message_count
             FROM servers s
             JOIN users u ON u.id = s.owner_id
             ORDER BY s.created_at DESC
             LIMIT $1 OFFSET $2",
        )
        .bind(per_page)
        .bind(offset)
        .fetch_all(&state.pool)
        .await?
    };

    Ok(Json(AdminServersResponse {
        servers,
        total,
        page,
        per_page,
    }))
}

/// DELETE /admin/servers/:server_id — Force-delete a server (admin override).
///
/// Deletes the server row; foreign key cascades handle channels, messages,
/// memberships, etc.
pub async fn delete_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    require_admin(&state.pool, auth.user_id()).await?;

    let result = sqlx::query("DELETE FROM servers WHERE id = $1")
        .bind(server_id)
        .execute(&state.pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Server not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

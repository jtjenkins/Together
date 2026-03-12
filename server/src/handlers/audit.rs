//! Audit logging for admin actions.
//!
//! Provides:
//! - `log_action()` - Record an admin action
//! - `GET /servers/:id/audit-logs` - List audit logs (owner only)

use axum::{
    extract::{Path, Query, State},
    Json,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::shared::fetch_server;
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{AuditLog, CreateAuditLog, ListAuditLogsQuery},
    state::AppState,
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 100;

// ============================================================================
// Public API
// ============================================================================

/// Log an admin action to the audit log.
///
/// This is the primary entry point for recording audit events.
/// It logs and continues on error - audit failures should not block operations.
pub async fn log_action(pool: &PgPool, entry: &CreateAuditLog) {
    let action_str = entry.action.to_string();

    let result = sqlx::query(
        r#"
        INSERT INTO audit_logs (server_id, actor_id, action, target_type, target_id, details, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(entry.server_id)
    .bind(entry.actor_id)
    .bind(&action_str)
    .bind(&entry.target_type)
    .bind(entry.target_id)
    .bind(&entry.details)
    .bind(&entry.ip_address)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::error!(
            error = ?e,
            server_id = %entry.server_id,
            action = %action_str,
            "Failed to write audit log"
        );
    }
}

// ============================================================================
// Handler
// ============================================================================

/// GET /servers/:id/audit-logs — List audit logs for a server.
///
/// Only the server owner can view audit logs.
/// Supports filtering by action, actor, and target type.
/// Paginated with cursor-based pagination.
pub async fn list_audit_logs(
    Path(server_id): Path<Uuid>,
    Query(params): Query<ListAuditLogsQuery>,
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<Vec<AuditLog>>> {
    let server = fetch_server(&state.pool, server_id).await?;

    // Only owner can view audit logs
    if server.owner_id != auth.user_id() {
        return Err(AppError::Forbidden(
            "Only the server owner can view audit logs".into(),
        ));
    }

    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).min(MAX_LIMIT);

    // Build query with optional filters
    let logs: Vec<AuditLog> = sqlx::query_as(
        r#"
        SELECT id, server_id, actor_id, action, target_type, target_id, details, ip_address, created_at
        FROM audit_logs
        WHERE server_id = $1
          AND ($2::text IS NULL OR action = $2)
          AND ($3::uuid IS NULL OR actor_id = $3)
          AND ($4::text IS NULL OR target_type = $4)
          AND ($5::timestamptz IS NULL OR created_at < $5)
        ORDER BY created_at DESC
        LIMIT $6
        "#,
    )
    .bind(server_id)
    .bind(&params.action)
    .bind(params.actor_id)
    .bind(&params.target_type)
    .bind(params.before)
    .bind(limit)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(logs))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use crate::models::AuditAction;

    #[test]
    fn test_audit_action_serialization() {
        assert_eq!(AuditAction::ServerCreate.to_string(), "server_create");
        assert_eq!(AuditAction::ChannelDelete.to_string(), "channel_delete");
        assert_eq!(AuditAction::MemberKick.to_string(), "member_kick");
        assert_eq!(AuditAction::RoleUpdate.to_string(), "role_update");
    }
}

use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Server, ServerMember},
};

/// Fetch a server row, returning 404 if it does not exist.
pub async fn fetch_server(pool: &sqlx::PgPool, server_id: Uuid) -> AppResult<Server> {
    sqlx::query_as::<_, Server>(
        "SELECT id, name, owner_id, icon_url, created_at, updated_at
         FROM servers WHERE id = $1",
    )
    .bind(server_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))
}

/// Verify the user is a member of the server.
///
/// Returns 404 (not 403) when the user is not a member — this prevents leaking
/// information about server existence to unauthenticated or non-member users.
pub async fn require_member(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<ServerMember> {
    sqlx::query_as::<_, ServerMember>(
        "SELECT user_id, server_id, nickname, joined_at
         FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))
}

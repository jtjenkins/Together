use axum::{extract::State, Json};
use tracing::info;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{UpdateUserDto, User, UserDto},
    state::AppState,
};

const VALID_STATUSES: &[&str] = &["online", "away", "dnd", "offline"];

pub async fn get_current_user(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> AppResult<Json<UserDto>> {
    info!("Getting current user: {}", auth_user.user_id());

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(auth_user.user_id())
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(user.into()))
}

pub async fn update_current_user(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(update): Json<UpdateUserDto>,
) -> AppResult<Json<UserDto>> {
    info!("Updating user: {}", auth_user.user_id());

    if let Some(ref status) = update.status {
        if !VALID_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid status '{}'. Must be one of: {}",
                status,
                VALID_STATUSES.join(", ")
            )));
        }
    }

    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users
        SET avatar_url    = COALESCE($1, avatar_url),
            status        = COALESCE($2, status),
            custom_status = COALESCE($3, custom_status),
            updated_at    = NOW()
        WHERE id = $4
        RETURNING *
        "#,
    )
    .bind(update.avatar_url)
    .bind(update.status)
    .bind(update.custom_status)
    .bind(auth_user.user_id())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(user.into()))
}

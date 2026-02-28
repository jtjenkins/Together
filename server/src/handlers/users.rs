use axum::{extract::State, Json};
use serde::Deserialize;
use tracing::info;
use validator::Validate;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{UpdateUserDto, User, UserDto},
    state::AppState,
};

const VALID_STATUSES: &[&str] = &["online", "away", "dnd", "offline"];

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct UpdateUserRequest {
    /// Must be a valid HTTP(S) URL when provided.
    #[validate(url)]
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    /// Free-form status text; capped at 128 characters.
    #[validate(length(max = 128))]
    pub custom_status: Option<String>,
}

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

// ============================================================================
// Handlers
// ============================================================================

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
    Json(req): Json<UpdateUserRequest>,
) -> AppResult<Json<UserDto>> {
    req.validate().map_err(validation_error)?;

    info!("Updating user: {}", auth_user.user_id());

    if let Some(ref status) = req.status {
        if !VALID_STATUSES.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid status '{}'. Must be one of: {}",
                status,
                VALID_STATUSES.join(", ")
            )));
        }
    }

    let update = UpdateUserDto {
        avatar_url: req.avatar_url,
        status: req.status,
        custom_status: req.custom_status,
    };

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

use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use tracing::info;
use utoipa::ToSchema;
use uuid::Uuid;
use validator::Validate;

use super::shared::{require_http_url, validation_error};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{PublicProfileDto, UpdateUserDto, User, UserDto},
    state::AppState,
};

const VALID_STATUSES: &[&str] = &["online", "away", "dnd", "offline"];

// ============================================================================
// Input validation
// ============================================================================

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct UpdateUserRequest {
    /// Must be a valid HTTP(S) URL when provided.
    #[validate(url)]
    pub avatar_url: Option<String>,
    /// Free-form biography; capped at 500 characters.
    #[validate(length(max = 500))]
    pub bio: Option<String>,
    /// Pronouns string, e.g. "they/them"; capped at 40 characters.
    #[validate(length(max = 40))]
    pub pronouns: Option<String>,
    pub status: Option<String>,
    /// Free-form status text; capped at 128 characters.
    #[validate(length(max = 128))]
    pub custom_status: Option<String>,
    /// Activity/rich presence text, e.g. "Playing Minecraft"; capped at 128 characters.
    #[validate(length(max = 128))]
    pub activity: Option<String>,
}

// ============================================================================
// Handlers
// ============================================================================

#[utoipa::path(
    get,
    path = "/users/@me",
    responses(
        (status = 200, description = "Current user profile", body = UserDto),
        (status = 401, description = "Not authenticated"),
        (status = 404, description = "User not found")
    ),
    security(("bearer_auth" = [])),
    tag = "Users"
)]
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

#[utoipa::path(
    patch,
    path = "/users/@me",
    request_body = UpdateUserRequest,
    responses(
        (status = 200, description = "User updated", body = UserDto),
        (status = 400, description = "Validation error"),
        (status = 401, description = "Not authenticated"),
        (status = 404, description = "User not found")
    ),
    security(("bearer_auth" = [])),
    tag = "Users"
)]
pub async fn update_current_user(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<UpdateUserRequest>,
) -> AppResult<Json<UserDto>> {
    req.validate().map_err(validation_error)?;

    if let Some(ref url) = req.avatar_url {
        require_http_url(url, "avatar_url")?;
    }

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
        bio: req.bio,
        pronouns: req.pronouns,

        status: req.status,
        custom_status: req.custom_status,
        activity: req.activity,
    };

    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users
        SET avatar_url    = COALESCE($1, avatar_url),
            bio           = COALESCE($2, bio),
            pronouns      = COALESCE($3, pronouns),
            status        = COALESCE($4, status),
            custom_status = COALESCE($5, custom_status),
            activity      = COALESCE($6, activity),
            updated_at    = NOW()
        WHERE id = $7
        RETURNING *
        "#,
    )
    .bind(update.avatar_url)
    .bind(update.bio)
    .bind(update.pronouns)
    .bind(update.status)
    .bind(update.custom_status)
    .bind(update.activity)
    .bind(auth_user.user_id())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(user.into()))
}

/// GET /users/:user_id — fetch any user's public profile.
/// Returns only public fields; never exposes email or password_hash.
#[utoipa::path(
    get,
    path = "/users/{user_id}",
    params(
        ("user_id" = Uuid, Path, description = "User ID")
    ),
    responses(
        (status = 200, description = "User public profile", body = PublicProfileDto),
        (status = 401, description = "Not authenticated"),
        (status = 404, description = "User not found")
    ),
    security(("bearer_auth" = [])),
    tag = "Users"
)]
pub async fn get_user_profile(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<PublicProfileDto>> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound("User not found".into()))?;
    if user.disabled {
        return Err(AppError::NotFound("User not found".into()));
    }
    Ok(Json(user.into()))
}

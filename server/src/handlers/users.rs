use axum::{extract::State, Json};
use sqlx::PgPool;
use tracing::info;

use crate::{
    auth::AuthUser,
    error::AppResult,
    models::{UpdateUserDto, User, UserDto},
};

pub async fn get_current_user(
    State(pool): State<PgPool>,
    auth_user: AuthUser,
) -> AppResult<Json<UserDto>> {
    info!("Getting current user: {}", auth_user.user_id);

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(auth_user.user_id)
        .fetch_one(&pool)
        .await?;

    Ok(Json(user.into()))
}

pub async fn update_current_user(
    State(pool): State<PgPool>,
    auth_user: AuthUser,
    Json(update): Json<UpdateUserDto>,
) -> AppResult<Json<UserDto>> {
    info!("Updating user: {}", auth_user.user_id);

    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users
        SET avatar_url = COALESCE($1, avatar_url),
            status = COALESCE($2, status),
            custom_status = $3,
            updated_at = NOW()
        WHERE id = $4
        RETURNING *
        "#,
    )
    .bind(update.avatar_url)
    .bind(update.status)
    .bind(update.custom_status)
    .bind(auth_user.user_id)
    .fetch_one(&pool)
    .await?;

    Ok(Json(user.into()))
}

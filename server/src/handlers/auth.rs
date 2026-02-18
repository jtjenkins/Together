use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use tracing::info;
use validator::Validate;

use crate::{
    auth::{create_access_token, create_refresh_token, hash_password, hash_refresh_token, verify_password},
    error::{AppError, AppResult},
    models::{User, UserDto},
    state::AppState,
};

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(length(min = 3, max = 32))]
    pub username: String,
    #[validate(email)]
    pub email: Option<String>,
    /// max = 128 prevents bcrypt's 72-byte truncation from becoming a DoS vector
    #[validate(length(min = 8, max = 128))]
    pub password: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginRequest {
    #[validate(length(min = 1, max = 128))]
    pub username: String,
    #[validate(length(min = 1, max = 128))]
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserDto,
}

// ============================================================================
// Handlers
// ============================================================================

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    info!("Registering new user: {}", req.username);

    let password_hash = hash_password(&req.password)?;

    // Transaction: user creation and session insert are atomic.
    // If the session insert fails, the user row is rolled back so the client
    // does not end up locked out of an account they never successfully created.
    let mut tx = state.pool.begin().await?;

    // INSERT directly — the DB UNIQUE constraint handles duplicates.
    // From<sqlx::Error> maps PG error 23505 → AppError::Conflict (409).
    let user = sqlx::query_as::<_, User>(
        r#"
        INSERT INTO users (username, email, password_hash, status)
        VALUES ($1, $2, $3, 'offline')
        RETURNING *
        "#,
    )
    .bind(&req.username)
    .bind(&req.email)
    .bind(&password_hash)
    .fetch_one(&mut *tx)
    .await?;

    info!("User created: {} ({})", user.username, user.id);

    let access_token = create_access_token(user.id, user.username.clone(), &state.jwt_secret)?;
    let refresh_token = create_refresh_token(user.id, user.username.clone(), &state.jwt_secret)?;

    // SHA-256 hash — deterministic, so sessions can be looked up by token hash.
    let refresh_token_hash = hash_refresh_token(&refresh_token);

    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '7 days')
        "#,
    )
    .bind(user.id)
    .bind(&refresh_token_hash)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            access_token,
            refresh_token,
            user: user.into(),
        }),
    ))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    info!("Login attempt for user: {}", req.username);

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
        .bind(&req.username)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Auth("Invalid username or password".into()))?;

    let valid = verify_password(&req.password, &user.password_hash)?;
    if !valid {
        return Err(AppError::Auth("Invalid username or password".into()));
    }

    info!("Login successful: {} ({})", user.username, user.id);

    let access_token = create_access_token(user.id, user.username.clone(), &state.jwt_secret)?;
    let refresh_token = create_refresh_token(user.id, user.username.clone(), &state.jwt_secret)?;
    let refresh_token_hash = hash_refresh_token(&refresh_token);

    // Transaction: session insert and status update are atomic.
    let mut tx = state.pool.begin().await?;

    // Remove expired sessions for this user before inserting a new one to
    // prevent unbounded session table growth.
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < NOW()")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;

    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '7 days')
        "#,
    )
    .bind(user.id)
    .bind(&refresh_token_hash)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE users SET status = 'online', updated_at = NOW() WHERE id = $1")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: user.into(),
    }))
}

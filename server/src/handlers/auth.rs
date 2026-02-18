use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::info;
use validator::Validate;

use crate::{
    auth::{create_access_token, create_refresh_token, hash_password, verify_password},
    error::{AppError, AppResult},
    models::User,
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
    #[validate(length(min = 8))]
    pub password: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserResponse,
}

#[derive(Debug, Serialize)]
pub struct UserResponse {
    pub id: String,
    pub username: String,
    pub email: Option<String>,
}

// ============================================================================
// Handlers
// ============================================================================

pub async fn register(
    State(pool): State<PgPool>,
    Json(req): Json<RegisterRequest>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    // Validate request
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    info!("Registering new user: {}", req.username);

    // Check if username already exists
    let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
        .bind(&req.username)
        .fetch_optional(&pool)
        .await?;

    if existing.is_some() {
        return Err(AppError::Conflict("Username already taken".into()));
    }

    // Check if email already exists (if provided)
    if let Some(ref email) = req.email {
        let existing = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(&pool)
            .await?;

        if existing.is_some() {
            return Err(AppError::Conflict("Email already registered".into()));
        }
    }

    // Hash password
    let password_hash = hash_password(&req.password)?;

    // Create user
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
    .fetch_one(&pool)
    .await?;

    info!("User created: {} ({})", user.username, user.id);

    // Generate tokens
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "dev_secret_change_in_production".to_string());

    let access_token = create_access_token(user.id, user.username.clone(), &jwt_secret)?;
    let refresh_token = create_refresh_token(user.id, user.username.clone(), &jwt_secret)?;

    // Store refresh token hash in sessions
    let refresh_token_hash = hash_password(&refresh_token)?;
    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '7 days')
        "#,
    )
    .bind(user.id)
    .bind(&refresh_token_hash)
    .execute(&pool)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            access_token,
            refresh_token,
            user: UserResponse {
                id: user.id.to_string(),
                username: user.username,
                email: user.email,
            },
        }),
    ))
}

pub async fn login(
    State(pool): State<PgPool>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    // Validate request
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    info!("Login attempt for user: {}", req.username);

    // Find user by username
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE username = $1")
        .bind(&req.username)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| AppError::Auth("Invalid username or password".into()))?;

    // Verify password
    let valid = verify_password(&req.password, &user.password_hash)?;
    if !valid {
        return Err(AppError::Auth("Invalid username or password".into()));
    }

    info!("Login successful: {} ({})", user.username, user.id);

    // Generate tokens
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "dev_secret_change_in_production".to_string());

    let access_token = create_access_token(user.id, user.username.clone(), &jwt_secret)?;
    let refresh_token = create_refresh_token(user.id, user.username.clone(), &jwt_secret)?;

    // Store refresh token hash in sessions
    let refresh_token_hash = hash_password(&refresh_token)?;
    sqlx::query(
        r#"
        INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '7 days')
        "#,
    )
    .bind(user.id)
    .bind(&refresh_token_hash)
    .execute(&pool)
    .await?;

    // Update user status to online
    sqlx::query("UPDATE users SET status = 'online', updated_at = NOW() WHERE id = $1")
        .bind(user.id)
        .execute(&pool)
        .await?;

    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user: UserResponse {
            id: user.id.to_string(),
            username: user.username,
            email: user.email,
        },
    }))
}

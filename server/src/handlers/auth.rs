use axum::{extract::State, http::StatusCode, Json};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tracing::info;
use uuid::Uuid;
use validator::Validate;

use serde_json::json;

use crate::{
    auth::{
        create_access_token, create_refresh_token, hash_password, hash_refresh_token,
        validate_token, verify_password, AuthUser, TokenType,
    },
    error::{AppError, AppResult},
    models::{User, UserDto},
    state::AppState,
};

/// Usernames must be alphanumeric or underscore, 2–32 characters.
static USERNAME_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z0-9_]+$").unwrap());

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(length(min = 2, max = 32), regex(path = *USERNAME_REGEX))]
    pub username: String,
    #[validate(email)]
    pub email: Option<String>,
    /// max = 128 prevents bcrypt's 72-byte truncation from becoming a DoS vector
    #[validate(length(min = 8, max = 128))]
    pub password: String,
    /// Required when instance registration mode is "invite_only".
    pub invite_code: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct RefreshRequest {
    #[validate(length(min = 1, max = 2048))]
    pub refresh_token: String,
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

    // ── Registration policy check ──────────────────────────────────────────
    let registration_mode: String =
        sqlx::query_scalar("SELECT registration_mode FROM instance_settings WHERE id = 1")
            .fetch_one(&state.pool)
            .await?;

    match registration_mode.as_str() {
        "closed" => {
            return Err(AppError::Forbidden(
                "Registration is currently closed".into(),
            ));
        }
        "invite_only" => {
            let code = req.invite_code.as_deref().unwrap_or("").trim();
            if code.is_empty() {
                return Err(AppError::Validation(
                    "An invite code is required to register".into(),
                ));
            }

            // Validate invite: exists, not expired, not maxed out.
            let valid: bool = sqlx::query_scalar(
                "SELECT EXISTS(
                     SELECT 1 FROM server_invites
                     WHERE code = $1
                       AND (expires_at IS NULL OR expires_at > NOW())
                       AND (max_uses IS NULL OR uses < max_uses)
                 )",
            )
            .bind(code)
            .fetch_one(&state.pool)
            .await?;

            if !valid {
                return Err(AppError::Validation(
                    "Invalid or expired invite code".into(),
                ));
            }

            // Increment uses atomically (race-safe).
            sqlx::query(
                "UPDATE server_invites SET uses = uses + 1
                 WHERE code = $1
                   AND (expires_at IS NULL OR expires_at > NOW())
                   AND (max_uses IS NULL OR uses < max_uses)",
            )
            .bind(code)
            .execute(&state.pool)
            .await?;
        }
        _ => { /* "open" — proceed normally */ }
    }

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

/// GET /instance/registration-mode — Public endpoint (no auth required).
///
/// Returns the current registration mode so the login page can show/hide
/// the register button and invite code field.
pub async fn get_registration_mode(
    State(state): State<AppState>,
) -> AppResult<Json<serde_json::Value>> {
    let registration_mode: String =
        sqlx::query_scalar("SELECT registration_mode FROM instance_settings WHERE id = 1")
            .fetch_one(&state.pool)
            .await?;

    Ok(Json(json!({ "registration_mode": registration_mode })))
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

    if user.disabled {
        return Err(AppError::Forbidden(
            "Your account has been disabled by an administrator".into(),
        ));
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

    // Cap active sessions at 10 per user — delete the oldest sessions beyond the limit.
    sqlx::query(
        "DELETE FROM sessions WHERE user_id = $1 AND id NOT IN (
             SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10
         )",
    )
    .bind(user.id)
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

pub async fn refresh_token(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> AppResult<Json<AuthResponse>> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Validate JWT signature and expiry
    let claims = validate_token(&req.refresh_token, &state.jwt_secret).map_err(|e| {
        tracing::warn!("Refresh token JWT validation failed: {:?}", e);
        AppError::Auth("Invalid or expired refresh token".into())
    })?;

    if claims.token_type != TokenType::Refresh {
        return Err(AppError::Auth("Not a refresh token".into()));
    }

    let token_hash = hash_refresh_token(&req.refresh_token);

    // Confirm the session exists and hasn't expired in the DB.
    // Using query_as instead of query! avoids updating the sqlx offline cache.
    let row = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT id, user_id FROM sessions WHERE refresh_token_hash = $1 AND expires_at > NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| {
        tracing::warn!("Refresh attempted with unknown or expired session");
        AppError::Auth("Session not found or expired".into())
    })?;

    let (session_id, user_id) = row;

    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::Auth("User not found".into()))?;

    if user.disabled {
        return Err(AppError::Forbidden(
            "Your account has been disabled by an administrator".into(),
        ));
    }

    info!("Token refresh for user: {} ({})", user.username, user.id);

    // Rotate the refresh token: generate a new one, hash it, and update the session row.
    // This ensures a stolen refresh token can only be used once.
    let access_token = create_access_token(user.id, user.username.clone(), &state.jwt_secret)?;
    let new_refresh_token =
        create_refresh_token(user.id, user.username.clone(), &state.jwt_secret)?;
    let new_hash = hash_refresh_token(&new_refresh_token);

    // Compare-and-swap: only update if the current hash still matches,
    // preventing concurrent refresh races from both succeeding.
    let result = sqlx::query(
        "UPDATE sessions SET refresh_token_hash = $1 WHERE id = $2 AND refresh_token_hash = $3",
    )
    .bind(&new_hash)
    .bind(session_id)
    .bind(&token_hash)
    .execute(&state.pool)
    .await?;

    if result.rows_affected() != 1 {
        return Err(AppError::Auth(
            "Session not found, expired, or token already rotated".into(),
        ));
    }

    Ok(Json(AuthResponse {
        access_token,
        refresh_token: new_refresh_token,
        user: user.into(),
    }))
}

// ============================================================================
// Password Reset
// ============================================================================

#[derive(Debug, Deserialize, Validate)]
pub struct ForgotPasswordRequest {
    #[validate(email)]
    pub email: String,
}

#[derive(Debug, Deserialize, Validate)]
pub struct ResetPasswordRequest {
    pub token: String,
    #[validate(length(min = 8, max = 128))]
    pub new_password: String,
}

/// POST /auth/forgot-password — Generate a password reset token for a user.
///
/// Admin-only endpoint. Returns the reset token in the response body for
/// manual delivery (e.g., admin sharing with user out-of-band).
pub async fn forgot_password(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<ForgotPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Admin-only endpoint — verify via DB lookup
    let is_admin: bool = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
        .bind(auth_user.user_id())
        .fetch_one(&state.pool)
        .await?;

    if !is_admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }

    // Find user by email — return 404 since this is admin-only (no enumeration risk)
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("No user found with email: {}", req.email)))?;

    // Generate a secure reset token (32 bytes, base64url encoded)
    let reset_token = {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        let bytes: [u8; 32] = rand::random();
        URL_SAFE_NO_PAD.encode(bytes)
    };

    // Hash the token for storage (same pattern as refresh tokens)
    let token_hash = hash_refresh_token(&reset_token);

    // Delete any existing reset tokens for this user
    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user.id)
        .execute(&state.pool)
        .await?;

    // Insert new token (expires in 1 hour)
    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) \
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')",
    )
    .bind(user.id)
    .bind(&token_hash)
    .execute(&state.pool)
    .await?;

    info!(
        "Password reset token created for user: {} ({})",
        user.username, user.id
    );

    Ok(Json(serde_json::json!({
        "message": "Password reset token generated",
        "token": reset_token,
        "expires_in_seconds": 3600,
        "note": "Share this token with the user to reset their password"
    })))
}

/// POST /auth/reset-password — Reset password using token.
///
/// Validates the reset token and updates the user's password.
/// Token is single-use and expires after 1 hour.
pub async fn reset_password(
    State(state): State<AppState>,
    Json(req): Json<ResetPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    let token_hash = hash_refresh_token(&req.token);

    // Find valid, unused token
    let token_row = sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW() AND used_at IS NULL"
    )
    .bind(&token_hash)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::Auth("Invalid or expired reset token".into()))?;

    let (token_id, user_id) = token_row;

    // Hash new password
    let password_hash = hash_password(&req.new_password)?;

    // Update password and mark token as used (in transaction)
    let mut tx = state.pool.begin().await?;

    sqlx::query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1")
        .bind(token_id)
        .execute(&mut *tx)
        .await?;

    // Also invalidate all existing sessions for security
    sqlx::query("DELETE FROM sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    info!("Password reset completed for user: {}", user_id);

    Ok(Json(serde_json::json!({
        "message": "Password has been reset successfully"
    })))
}

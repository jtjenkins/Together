use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    RequestPartsExt,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

// ============================================================================
// JWT Claims
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      // Subject (user ID)
    pub exp: i64,         // Expiration time
    pub iat: i64,         // Issued at
    pub username: String, // Username for convenience
}

impl Claims {
    pub fn new(user_id: Uuid, username: String, expiration_minutes: i64) -> Self {
        let now = Utc::now();
        let exp = now + Duration::minutes(expiration_minutes);

        Claims {
            sub: user_id.to_string(),
            exp: exp.timestamp(),
            iat: now.timestamp(),
            username,
        }
    }

    pub fn user_id(&self) -> AppResult<Uuid> {
        Uuid::parse_str(&self.sub).map_err(|_| AppError::Auth("Invalid user ID in token".into()))
    }
}

// ============================================================================
// JWT Operations
// ============================================================================

pub fn create_access_token(user_id: Uuid, username: String, secret: &str) -> AppResult<String> {
    let claims = Claims::new(user_id, username, 15); // 15 minute expiration

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| {
        tracing::error!("Failed to create JWT: {:?}", e);
        AppError::Auth("Failed to create token".into())
    })
}

pub fn create_refresh_token(user_id: Uuid, username: String, secret: &str) -> AppResult<String> {
    let claims = Claims::new(user_id, username, 10080); // 7 days expiration

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| {
        tracing::error!("Failed to create refresh token: {:?}", e);
        AppError::Auth("Failed to create refresh token".into())
    })
}

pub fn validate_token(token: &str, secret: &str) -> AppResult<Claims> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|e| {
        tracing::debug!("Token validation failed: {:?}", e);
        AppError::Auth("Invalid or expired token".into())
    })
}

// ============================================================================
// Password Hashing
// ============================================================================

pub fn hash_password(password: &str) -> AppResult<String> {
    bcrypt::hash(password, 12).map_err(|e| {
        tracing::error!("Failed to hash password: {:?}", e);
        AppError::Internal
    })
}

pub fn verify_password(password: &str, hash: &str) -> AppResult<bool> {
    bcrypt::verify(password, hash).map_err(|e| {
        tracing::error!("Failed to verify password: {:?}", e);
        AppError::Internal
    })
}

// ============================================================================
// Auth Middleware
// ============================================================================

pub struct AuthUser {
    pub user_id: Uuid,
    pub username: String,
}

#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Extract Authorization header
        let TypedHeader(Authorization(bearer)) = parts
            .extract::<TypedHeader<Authorization<Bearer>>>()
            .await
            .map_err(|_| {
                (
                    StatusCode::UNAUTHORIZED,
                    "Missing or invalid Authorization header".to_string(),
                )
            })?;

        // Get JWT secret from environment
        let secret = std::env::var("JWT_SECRET")
            .unwrap_or_else(|_| "dev_secret_change_in_production".to_string());

        // Validate token
        let claims = validate_token(bearer.token(), &secret).map_err(|e| {
            (
                StatusCode::UNAUTHORIZED,
                format!("Invalid token: {}", e),
            )
        })?;

        // Extract user ID
        let user_id = claims.user_id().map_err(|e| {
            (
                StatusCode::UNAUTHORIZED,
                format!("Invalid user ID: {}", e),
            )
        })?;

        Ok(AuthUser {
            user_id,
            username: claims.username,
        })
    }
}

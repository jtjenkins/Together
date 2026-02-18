use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    Json, RequestPartsExt,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

// ============================================================================
// JWT Claims
// ============================================================================

#[derive(Debug, Serialize, Deserialize, PartialEq, Clone)]
#[serde(rename_all = "lowercase")]
pub enum TokenType {
    Access,
    Refresh,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: i64,
    pub iat: i64,
    pub username: String,
    /// Distinguishes access tokens (short-lived) from refresh tokens (long-lived).
    /// AuthUser rejects refresh tokens so they cannot be used as bearer tokens.
    pub token_type: TokenType,
}

impl Claims {
    fn new(user_id: Uuid, username: String, expiration_minutes: i64, token_type: TokenType) -> Self {
        let now = Utc::now();
        let exp = now + Duration::minutes(expiration_minutes);

        Claims {
            sub: user_id.to_string(),
            exp: exp.timestamp(),
            iat: now.timestamp(),
            username,
            token_type,
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
    let claims = Claims::new(user_id, username, 15, TokenType::Access);

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| {
        tracing::error!("Failed to create access token: {:?}", e);
        AppError::Auth("Failed to create token".into())
    })
}

pub fn create_refresh_token(user_id: Uuid, username: String, secret: &str) -> AppResult<String> {
    let claims = Claims::new(user_id, username, 10080, TokenType::Refresh); // 7 days

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
        tracing::warn!("Token validation failed: {:?}", e);
        AppError::Auth("Invalid or expired token".into())
    })
}

// ============================================================================
// Refresh Token Hashing
// ============================================================================

/// Hash a refresh token with SHA-256 for deterministic storage and lookup.
/// bcrypt is intentionally NOT used here because it is non-deterministic —
/// the same input produces different hashes on every call, making DB lookups
/// by hash impossible without scanning all rows.
pub fn hash_refresh_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
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

/// Authenticated user extracted from a valid access-token bearer header.
///
/// Fields are private: the only valid constructor is the `FromRequestParts`
/// impl, preventing callers from forging an `AuthUser` via struct literal.
pub struct AuthUser {
    user_id: Uuid,
    username: String,
}

impl AuthUser {
    pub fn user_id(&self) -> Uuid {
        self.user_id
    }

    pub fn username(&self) -> &str {
        &self.username
    }
}

type AuthRejection = (StatusCode, Json<serde_json::Value>);

fn auth_error(message: &str) -> AuthRejection {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": message })),
    )
}

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AuthRejection;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let TypedHeader(Authorization(bearer)) = parts
            .extract::<TypedHeader<Authorization<Bearer>>>()
            .await
            .map_err(|_| auth_error("Missing or invalid Authorization header"))?;

        let claims = validate_token(bearer.token(), &state.jwt_secret)
            .map_err(|_| auth_error("Invalid or expired token"))?;

        // Reject refresh tokens used as access tokens — they have a 7-day
        // expiry and must never be accepted on protected API endpoints.
        if claims.token_type != TokenType::Access {
            return Err(auth_error("Invalid token type"));
        }

        let user_id = claims
            .user_id()
            .map_err(|_| auth_error("Invalid token subject"))?;

        Ok(AuthUser {
            user_id,
            username: claims.username,
        })
    }
}

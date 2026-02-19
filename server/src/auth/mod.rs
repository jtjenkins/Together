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
    fn new(
        user_id: Uuid,
        username: String,
        expiration_minutes: i64,
        token_type: TokenType,
    ) -> Self {
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
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": message })))
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET: &str = "test-secret-min-32-characters-long!!";

    // ------------------------------------------------------------------------
    // hash_refresh_token
    // ------------------------------------------------------------------------

    #[test]
    fn hash_refresh_token_is_64_char_hex() {
        let hash = hash_refresh_token("some-random-token");
        assert_eq!(hash.len(), 64, "SHA-256 hex output must be 64 characters");
        assert!(
            hash.chars().all(|c| c.is_ascii_hexdigit()),
            "Output must be lowercase hex"
        );
    }

    #[test]
    fn hash_refresh_token_is_deterministic() {
        let token = "deterministic-test-token";
        let h1 = hash_refresh_token(token);
        let h2 = hash_refresh_token(token);
        assert_eq!(h1, h2, "Same input must always produce the same hash");
    }

    #[test]
    fn hash_refresh_token_differs_on_different_inputs() {
        let h1 = hash_refresh_token("token-alpha");
        let h2 = hash_refresh_token("token-beta");
        assert_ne!(h1, h2, "Different inputs must produce different hashes");
    }

    // ------------------------------------------------------------------------
    // create_access_token / validate_token
    // ------------------------------------------------------------------------

    #[test]
    fn access_token_roundtrip_happy_path() {
        let user_id = Uuid::new_v4();
        let username = "alice".to_string();

        let token = create_access_token(user_id, username.clone(), TEST_SECRET)
            .expect("create_access_token should succeed");

        let claims = validate_token(&token, TEST_SECRET)
            .expect("validate_token should succeed for a fresh access token");

        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.username, username);
        assert_eq!(claims.token_type, TokenType::Access);
    }

    // ------------------------------------------------------------------------
    // create_refresh_token
    // ------------------------------------------------------------------------

    #[test]
    fn refresh_token_roundtrip_happy_path() {
        let user_id = Uuid::new_v4();
        let username = "bob".to_string();

        let token = create_refresh_token(user_id, username.clone(), TEST_SECRET)
            .expect("create_refresh_token should succeed");

        let claims = validate_token(&token, TEST_SECRET)
            .expect("validate_token should succeed for a fresh refresh token");

        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.username, username);
        assert_eq!(claims.token_type, TokenType::Refresh);
    }

    // ------------------------------------------------------------------------
    // Access vs Refresh tokens are distinguishable by token_type
    // ------------------------------------------------------------------------

    #[test]
    fn access_and_refresh_tokens_are_distinguishable() {
        let user_id = Uuid::new_v4();
        let username = "carol".to_string();

        let access_token = create_access_token(user_id, username.clone(), TEST_SECRET)
            .expect("create_access_token should succeed");
        let refresh_token = create_refresh_token(user_id, username, TEST_SECRET)
            .expect("create_refresh_token should succeed");

        let access_claims = validate_token(&access_token, TEST_SECRET)
            .expect("access token validation should succeed");
        let refresh_claims = validate_token(&refresh_token, TEST_SECRET)
            .expect("refresh token validation should succeed");

        assert_eq!(access_claims.token_type, TokenType::Access);
        assert_eq!(refresh_claims.token_type, TokenType::Refresh);
        assert_ne!(access_claims.token_type, refresh_claims.token_type);
    }

    // ------------------------------------------------------------------------
    // validate_token rejects wrong secret
    // ------------------------------------------------------------------------

    #[test]
    fn validate_token_rejects_wrong_secret() {
        let user_id = Uuid::new_v4();
        let token = create_access_token(user_id, "dave".to_string(), TEST_SECRET)
            .expect("create_access_token should succeed");

        let result = validate_token(&token, "completely-different-secret-value!!");
        assert!(
            result.is_err(),
            "validate_token must reject a token signed with a different secret"
        );
    }

    // ------------------------------------------------------------------------
    // validate_token rejects malformed string
    // ------------------------------------------------------------------------

    #[test]
    fn validate_token_rejects_malformed_string() {
        let result = validate_token("this.is.not.a.valid.jwt", TEST_SECRET);
        assert!(
            result.is_err(),
            "validate_token must reject a malformed token string"
        );
    }

    #[test]
    fn validate_token_rejects_empty_string() {
        let result = validate_token("", TEST_SECRET);
        assert!(
            result.is_err(),
            "validate_token must reject an empty string"
        );
    }

    // ------------------------------------------------------------------------
    // hash_password + verify_password roundtrip
    // ------------------------------------------------------------------------

    #[test]
    fn password_hash_verify_roundtrip_correct_password() {
        let password = "super-secure-password-123!";
        let hash = hash_password(password).expect("hash_password should succeed");

        let is_valid = verify_password(password, &hash)
            .expect("verify_password should not error on a valid hash");
        assert!(is_valid, "Correct password must verify against its hash");
    }

    #[test]
    fn password_hash_verify_roundtrip_wrong_password() {
        let password = "correct-password";
        let hash = hash_password(password).expect("hash_password should succeed");

        let is_valid = verify_password("wrong-password", &hash)
            .expect("verify_password should not error on a valid hash");
        assert!(
            !is_valid,
            "Wrong password must not verify against a different password's hash"
        );
    }

    // ------------------------------------------------------------------------
    // Claims::user_id() parses UUID correctly
    // ------------------------------------------------------------------------

    #[test]
    fn claims_user_id_parses_valid_uuid() {
        let expected_id = Uuid::new_v4();
        let token = create_access_token(expected_id, "eve".to_string(), TEST_SECRET)
            .expect("create_access_token should succeed");

        let claims = validate_token(&token, TEST_SECRET).expect("validate_token should succeed");

        let parsed_id = claims
            .user_id()
            .expect("user_id() should parse the UUID without error");
        assert_eq!(
            parsed_id, expected_id,
            "Parsed UUID must match the original user ID"
        );
    }

    #[test]
    fn claims_user_id_rejects_invalid_sub() {
        // Manually construct a Claims with a non-UUID sub to test the error path.
        let claims = Claims {
            sub: "not-a-uuid".to_string(),
            exp: 9999999999,
            iat: 0,
            username: "frank".to_string(),
            token_type: TokenType::Access,
        };

        let result = claims.user_id();
        assert!(
            result.is_err(),
            "user_id() must return an error when sub is not a valid UUID"
        );
    }
}

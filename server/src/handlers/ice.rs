//! ICE server handler for WebRTC NAT traversal.
//!
//! Provides STUN/TURN server credentials for WebRTC peer connections.
//! TURN credentials are generated using HMAC-SHA1 time-limited tokens.

use axum::{extract::State, Json};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::{Hmac, Mac};
use sha1::Sha1;

use crate::{auth::AuthUser, error::AppResult, state::AppState};

// HMAC-SHA1 type alias for TURN credential generation
type HmacSha1 = Hmac<Sha1>;

// ============================================================================
// Configuration
// ============================================================================

/// Default STUN servers (public Google STUN servers).
/// These are used for NAT traversal without requiring authentication.
const DEFAULT_STUN_SERVERS: &[&str] = &[
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
];

/// Credential TTL in seconds (24 hours).
const CREDENTIAL_TTL_SECS: u64 = 86400;

// ============================================================================
// Types
// ============================================================================

/// ICE server configuration for WebRTC.
#[derive(serde::Serialize)]
pub struct IceServer {
    urls: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    credential: Option<String>,
}

/// Response containing ICE servers with time-limited TURN credentials.
#[derive(serde::Serialize)]
pub struct IceServersResponse {
    ice_servers: Vec<IceServer>,
    /// Time-to-live for the credentials in seconds.
    ttl: u64,
}

// ============================================================================
// Handler
// ============================================================================

/// GET /ice-servers — returns STUN/TURN server configurations.
///
/// Always returns public STUN servers. If TURN servers are configured,
/// generates time-limited credentials using HMAC-SHA1.
///
/// Authorization: Requires authentication (user must be logged in).
pub async fn get_ice_servers(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<IceServersResponse>> {
    let mut servers: Vec<IceServer> = DEFAULT_STUN_SERVERS
        .iter()
        .map(|url| IceServer {
            urls: (*url).to_string(),
            username: None,
            credential: None,
        })
        .collect();

    // Add TURN servers if configured
    if let Some(turn_config) = &state.config.turn {
        // Use the authenticated user's identity so each user gets distinct credentials,
        // enabling per-user revocation at the TURN server level.
        let username = generate_turn_username(CREDENTIAL_TTL_SECS, auth.username());
        let credential = generate_turn_credential(&username, &turn_config.secret);

        servers.push(IceServer {
            urls: turn_config.url.clone(),
            username: Some(username),
            credential: Some(credential),
        });
    }

    tracing::debug!(server_count = servers.len(), "Returning ICE servers");

    Ok(Json(IceServersResponse {
        ice_servers: servers,
        ttl: CREDENTIAL_TTL_SECS,
    }))
}

// ============================================================================
// TURN Credential Generation
// ============================================================================

/// Generate a time-limited username for TURN authentication.
///
/// Format: `{timestamp}:{username}` where timestamp is UNIX epoch seconds
/// at expiry. Using the authenticated user's identity enables per-user
/// credential revocation at the TURN server level.
fn generate_turn_username(ttl_secs: u64, username: &str) -> String {
    let timestamp = chrono::Utc::now().timestamp() as u64 + ttl_secs;
    format!("{}:{}", timestamp, username)
}

/// Generate a TURN credential using HMAC-SHA1.
///
/// The credential is derived from the username and shared secret,
/// allowing the TURN server to verify without storing state.
fn generate_turn_credential(username: &str, secret: &str) -> String {
    let mut mac =
        HmacSha1::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(username.as_bytes());
    let result = mac.finalize();
    BASE64.encode(result.into_bytes())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_turn_credential_generation() {
        let username = "1234567890:alice";
        let secret = "test-secret-key";
        let credential = generate_turn_credential(username, secret);

        // Credential should be non-empty base64
        assert!(!credential.is_empty());
        assert!(BASE64.decode(&credential).is_ok());
    }

    #[test]
    fn test_username_format() {
        let username = generate_turn_username(3600, "alice");
        assert!(username.ends_with(":alice"));
        assert!(username.split(':').next().unwrap().parse::<u64>().is_ok());
    }
}

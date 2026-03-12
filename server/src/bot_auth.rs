use sha2::{Digest, Sha256};
use uuid::Uuid;

// ============================================================================
// Token Generation
// ============================================================================

/// Generate a cryptographically random 64-character hex-encoded bot token.
///
/// Uses two UUIDv4 values (each seeded with OS entropy via the uuid crate's
/// random source) concatenated and SHA-256 hashed. This produces 32 bytes
/// (64 hex chars) of effectively random output without requiring additional
/// dependencies.
///
/// The plaintext token is shown to the bot owner exactly once at registration
/// or regeneration time. Only the SHA-256 hash is stored in the database.
pub fn generate_bot_token() -> String {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    let mut hasher = Sha256::new();
    hasher.update(a.as_bytes());
    hasher.update(b.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Hash a plaintext bot token with SHA-256 for deterministic DB storage.
///
/// bcrypt is intentionally NOT used here — it is non-deterministic, making
/// DB lookups by hash impossible without full table scans. SHA-256 matches
/// the approach used for refresh token storage in auth/mod.rs.
pub fn hash_bot_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_bot_token_is_64_chars() {
        let token = generate_bot_token();
        assert_eq!(token.len(), 64, "token must be 32 bytes hex-encoded = 64 chars");
        assert!(
            token.chars().all(|c| c.is_ascii_hexdigit()),
            "token must be lowercase hex"
        );
    }

    #[test]
    fn generate_bot_token_is_unique() {
        let t1 = generate_bot_token();
        let t2 = generate_bot_token();
        assert_ne!(t1, t2, "tokens must be unique");
    }

    #[test]
    fn hash_bot_token_is_deterministic_and_64_chars() {
        let token = "some-test-token-value";
        let h1 = hash_bot_token(token);
        let h2 = hash_bot_token(token);
        assert_eq!(h1, h2, "same input must produce same hash");
        assert_eq!(h1.len(), 64);
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hash_bot_token_differs_for_different_inputs() {
        let h1 = hash_bot_token("token-alpha");
        let h2 = hash_bot_token("token-beta");
        assert_ne!(h1, h2);
    }

    #[test]
    fn generate_and_hash_roundtrip() {
        let token = generate_bot_token();
        let h1 = hash_bot_token(&token);
        let h2 = hash_bot_token(&token);
        assert_eq!(h1, h2, "hashing the same generated token must be deterministic");
        assert_eq!(h1.len(), 64);
    }
}

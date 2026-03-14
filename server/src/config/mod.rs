use std::env;
use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;

/// TURN server configuration for WebRTC NAT traversal.
#[derive(Clone, Debug)]
pub struct TurnConfig {
    pub url: String,
    pub secret: String,
}

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: Arc<str>,
    pub server_host: String,
    pub server_port: u16,
    /// true when APP_ENV != "production"
    pub is_dev: bool,
    /// Root directory for uploaded files (from UPLOAD_DIR, default: ./data/uploads).
    pub upload_dir: PathBuf,
    /// Allowed CORS origins in production (parsed from ALLOWED_ORIGINS, comma-separated).
    /// Empty means no cross-origin requests are allowed.
    pub allowed_origins: Vec<String>,
    /// Optional TURN server configuration for WebRTC.
    pub turn: Option<TurnConfig>,
    // Push Notifications — VAPID (Web Push)
    pub vapid_private_key: Option<String>,
    pub vapid_public_key: Option<String>,
    pub vapid_subject: String,
    // FCM (optional - Android)
    pub fcm_service_account_json: Option<String>,
    pub fcm_project_id: Option<String>,
    // APNs (optional - iOS)
    pub apns_key_pem: Option<String>,
    pub apns_key_id: Option<String>,
    pub apns_team_id: Option<String>,
    pub apns_bundle_id: Option<String>,
    pub apns_sandbox: bool,
}

/// Manual Debug impl — never prints jwt_secret, database credentials, or API keys in plaintext.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"[redacted]")
            .field("jwt_secret", &"[redacted]")
            .field("server_host", &self.server_host)
            .field("server_port", &self.server_port)
            .field("is_dev", &self.is_dev)
            .field("upload_dir", &self.upload_dir)
            .field("turn", &self.turn)
            .field("vapid_private_key", &"[redacted]")
            .field("vapid_public_key", &"[redacted]")
            .field("vapid_subject", &self.vapid_subject)
            .field("fcm_service_account_json", &"[redacted]")
            .field("fcm_project_id", &self.fcm_project_id)
            .field("apns_key_pem", &"[redacted]")
            .field("apns_key_id", &self.apns_key_id)
            .field("apns_team_id", &self.apns_team_id)
            .field("apns_bundle_id", &self.apns_bundle_id)
            .field("apns_sandbox", &self.apns_sandbox)
            .finish()
    }
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        dotenvy::dotenv().ok();

        // JWT_SECRET is required and fatal if missing — a missing secret must never
        // silently fall back to a publicly-known default value.
        let jwt_secret = env::var("JWT_SECRET")
            .map_err(|_| "JWT_SECRET environment variable is required".to_string())?;

        if jwt_secret.len() < 32 {
            return Err("JWT_SECRET must be at least 32 characters".to_string());
        }

        let database_url = env::var("DATABASE_URL")
            .map_err(|_| "DATABASE_URL environment variable is required".to_string())?;

        Ok(Config {
            database_url,
            jwt_secret: jwt_secret.into(),
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .unwrap_or(8080),
            is_dev: env::var("APP_ENV")
                .map(|v| v != "production")
                .unwrap_or(true),
            upload_dir: PathBuf::from(
                env::var("UPLOAD_DIR").unwrap_or_else(|_| "./data/uploads".to_string()),
            ),
            allowed_origins: env::var("ALLOWED_ORIGINS")
                .map(|s| {
                    s.split(',')
                        .map(|o| o.trim().to_string())
                        .filter(|o| !o.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            turn: match (env::var("TURN_URL").ok(), env::var("TURN_SECRET").ok()) {
                (Some(url), Some(secret)) => {
                    if secret.len() < 32 {
                        return Err("TURN_SECRET must be at least 32 characters".to_string());
                    }
                    Some(TurnConfig { url, secret })
                }
                _ => None,
            },
            vapid_private_key: env::var("VAPID_PRIVATE_KEY").ok(),
            vapid_public_key: env::var("VAPID_PUBLIC_KEY").ok(),
            vapid_subject: env::var("VAPID_SUBJECT")
                .unwrap_or_else(|_| "mailto:admin@example.com".to_string()),
            fcm_service_account_json: env::var("FCM_SERVICE_ACCOUNT_JSON").ok(),
            fcm_project_id: env::var("FCM_PROJECT_ID").ok(),
            apns_key_pem: env::var("APNS_KEY_PEM").ok(),
            apns_key_id: env::var("APNS_KEY_ID").ok(),
            apns_team_id: env::var("APNS_TEAM_ID").ok(),
            apns_bundle_id: env::var("APNS_BUNDLE_ID").ok(),
            apns_sandbox: env::var("APNS_SANDBOX")
                .map(|v| v == "true")
                .unwrap_or(false),
        })
    }

    pub fn server_addr(&self) -> String {
        format!("{}:{}", self.server_host, self.server_port)
    }
}

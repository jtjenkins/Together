use std::env;
use std::fmt;
use std::sync::Arc;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: Arc<str>,
    pub server_host: String,
    pub server_port: u16,
    /// true when APP_ENV != "production"
    pub is_dev: bool,
}

/// Manual Debug impl — never prints jwt_secret or database credentials in plaintext.
impl fmt::Debug for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Config")
            .field("database_url", &"[redacted]")
            .field("jwt_secret", &"[redacted]")
            .field("server_host", &self.server_host)
            .field("server_port", &self.server_port)
            .field("is_dev", &self.is_dev)
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
        })
    }

    pub fn server_addr(&self) -> String {
        format!("{}:{}", self.server_host, self.server_port)
    }
}

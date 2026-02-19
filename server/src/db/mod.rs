use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;
use tracing::info;

use crate::error::{AppError, AppResult};

pub async fn create_pool(database_url: &str) -> AppResult<PgPool> {
    info!("🔌 Connecting to database...");

    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
        .map_err(|e| {
            tracing::error!("Failed to connect to database: {:?}", e);
            AppError::Database(e)
        })?;

    info!("✅ Database connection pool created");
    Ok(pool)
}

pub async fn health_check(pool: &PgPool) -> AppResult<()> {
    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(AppError::Database)?;

    Ok(())
}

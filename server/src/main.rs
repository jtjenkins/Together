use tracing::info;

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter("together_server=debug,tower_http=debug")
        .init();

    info!("🚀 Together Server starting...");
    info!("📝 Phase 1: Database Foundation - Schema and Migrations");

    // Server will be implemented in Phase 2
    info!("✅ Basic server structure initialized");
    info!("🔧 Next: Run migrations with `sqlx migrate run`");
}

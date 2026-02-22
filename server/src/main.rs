use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, patch, post},
    Router,
};
use axum_prometheus::PrometheusMetricLayer;
use tower_http::cors::CorsLayer;
use tracing::info;
use tracing_subscriber::EnvFilter;

use together_server::config::Config;
use together_server::state::AppState;
use together_server::websocket::ConnectionManager;
use together_server::{db, handlers, websocket};

#[tokio::main]
async fn main() {
    // Initialize tracing — JSON in production, human-readable in dev.
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        "together_server=info,tower_http=info,sqlx=warn"
            .parse()
            .unwrap()
    });

    if std::env::var("APP_ENV").as_deref() == Ok("production") {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(filter)
            .init();
    } else {
        tracing_subscriber::fmt().with_env_filter(filter).init();
    }

    info!("🚀 Together Server starting...");

    // Load configuration — fatal if JWT_SECRET is missing or too short.
    let config = Config::from_env().expect("Failed to load configuration");
    info!("📝 Configuration loaded");

    // Create database connection pool
    let pool = db::create_pool(&config.database_url)
        .await
        .expect("Failed to create database pool");

    // Auto-run pending migrations on startup.
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("Failed to run database migrations");
    info!("✅ Database migrations applied");

    // Run health check
    db::health_check(&pool)
        .await
        .expect("Database health check failed");
    info!("✅ Database health check passed");

    // CORS: permissive in dev, restrictive in production.
    // Set APP_ENV=production to switch modes; configure ALLOWED_ORIGINS for
    // cross-origin access in production (see .env.example).
    let cors = if config.is_dev {
        info!("🔓 CORS: permissive (dev mode)");
        CorsLayer::permissive()
    } else {
        tracing::warn!(
            "🔒 CORS: restrictive (production mode). \
             Cross-origin requests will be denied. \
             Set ALLOWED_ORIGINS to allow specific origins."
        );
        CorsLayer::new()
    };

    let addr = config.server_addr();

    // Create upload directory if it doesn't exist yet.
    tokio::fs::create_dir_all(&config.upload_dir)
        .await
        .expect("Failed to create upload directory");
    info!("📂 Upload directory: {}", config.upload_dir.display());

    let app_state = AppState {
        pool,
        jwt_secret: config.jwt_secret,
        connections: ConnectionManager::new(),
        upload_dir: config.upload_dir.clone(),
    };

    // Prometheus metrics layer
    let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

    // Build router
    let app = Router::new()
        // Health check + metrics
        .route("/health", get(handlers::health_check))
        .route(
            "/metrics",
            get(move || async move { metric_handle.render() }),
        )
        // Auth routes
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        // User routes (protected)
        .route("/users/@me", get(handlers::users::get_current_user))
        .route("/users/@me", patch(handlers::users::update_current_user))
        // Server routes (protected)
        .route("/servers", post(handlers::servers::create_server))
        .route("/servers", get(handlers::servers::list_servers))
        .route("/servers/:id", get(handlers::servers::get_server))
        .route("/servers/:id", patch(handlers::servers::update_server))
        .route("/servers/:id", delete(handlers::servers::delete_server))
        .route("/servers/:id/join", post(handlers::servers::join_server))
        .route(
            "/servers/:id/leave",
            delete(handlers::servers::leave_server),
        )
        .route("/servers/:id/members", get(handlers::servers::list_members))
        // Channel routes (protected, nested under server)
        .route(
            "/servers/:id/channels",
            post(handlers::channels::create_channel),
        )
        .route(
            "/servers/:id/channels",
            get(handlers::channels::list_channels),
        )
        .route(
            "/servers/:id/channels/:channel_id",
            get(handlers::channels::get_channel),
        )
        .route(
            "/servers/:id/channels/:channel_id",
            patch(handlers::channels::update_channel),
        )
        .route(
            "/servers/:id/channels/:channel_id",
            delete(handlers::channels::delete_channel),
        )
        // Message routes (protected, nested under channel)
        .route(
            "/channels/:channel_id/messages",
            post(handlers::messages::create_message),
        )
        .route(
            "/channels/:channel_id/messages",
            get(handlers::messages::list_messages),
        )
        .route(
            "/messages/:message_id",
            patch(handlers::messages::update_message),
        )
        .route(
            "/messages/:message_id",
            delete(handlers::messages::delete_message),
        )
        // Attachment routes (protected, nested under message)
        .route(
            "/messages/:message_id/attachments",
            post(handlers::attachments::upload_attachments)
                .layer(DefaultBodyLimit::max(52_428_800 + 65_536)), // 50 MB + multipart overhead
        )
        .route(
            "/messages/:message_id/attachments",
            get(handlers::attachments::list_attachments),
        )
        // Authenticated file serving (auth + membership checked before serving)
        .route(
            "/files/:message_id/*filepath",
            get(handlers::attachments::serve_file),
        )
        // Voice routes (protected, nested under channel)
        .route(
            "/channels/:channel_id/voice",
            post(handlers::voice::join_voice_channel),
        )
        .route(
            "/channels/:channel_id/voice",
            delete(handlers::voice::leave_voice_channel),
        )
        .route(
            "/channels/:channel_id/voice",
            patch(handlers::voice::update_voice_state),
        )
        .route(
            "/channels/:channel_id/voice",
            get(handlers::voice::list_voice_participants),
        )
        // WebSocket gateway
        .route("/ws", get(websocket::websocket_handler))
        // Middleware
        .layer(prometheus_layer)
        .layer(cors)
        .with_state(app_state);

    // Start server
    info!("🎧 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");

    axum::serve(listener, app)
        .await
        .expect("Server failed to start");
}

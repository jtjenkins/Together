use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderValue, Method},
    routing::{delete, get, patch, post},
    Router,
};
use axum_prometheus::PrometheusMetricLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
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

    // CORS: permissive in dev, origin-restricted in production.
    // Set APP_ENV=production and ALLOWED_ORIGINS=https://your-domain.com (see .env.example).
    let cors = if config.is_dev {
        info!("🔓 CORS: permissive (dev mode)");
        CorsLayer::permissive()
    } else {
        let origins: Vec<HeaderValue> = config
            .allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        if origins.is_empty() {
            tracing::warn!(
                "🔒 CORS: no ALLOWED_ORIGINS configured — all cross-origin requests will be denied"
            );
        } else {
            info!(
                "🔒 CORS: production mode, allowing origins: {:?}",
                config.allowed_origins
            );
        }
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins))
            .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
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
        // NOTE: /servers/browse must be registered before /servers/:id so the literal
        // path segment "browse" is not consumed by the :id parameter capture.
        .route("/servers/browse", get(handlers::servers::browse_servers))
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
        // Thread routes (protected, nested under channel message)
        .route(
            "/channels/:channel_id/messages/:message_id/thread",
            get(handlers::messages::list_thread_replies),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/thread",
            post(handlers::messages::create_thread_reply),
        )
        // Reaction routes (protected, nested under channel message)
        .route(
            "/channels/:channel_id/messages/:message_id/reactions",
            get(handlers::reactions::list_reactions),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/reactions/:emoji",
            axum::routing::put(handlers::reactions::add_reaction),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/reactions/:emoji",
            delete(handlers::reactions::remove_reaction),
        )
        // Read-state / ack routes
        .route(
            "/channels/:channel_id/ack",
            post(handlers::read_states::ack_channel),
        )
        // DM routes (protected, user-scoped)
        .route("/dm-channels", post(handlers::dm::open_dm_channel))
        .route("/dm-channels", get(handlers::dm::list_dm_channels))
        .route(
            "/dm-channels/:id/messages",
            post(handlers::dm::send_dm_message),
        )
        .route(
            "/dm-channels/:id/messages",
            get(handlers::dm::list_dm_messages),
        )
        .route(
            "/dm-channels/:id/ack",
            post(handlers::read_states::ack_dm_channel),
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

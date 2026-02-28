use axum::{
    extract::ConnectInfo,
    http::{header, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Router,
};
use axum_prometheus::PrometheusMetricLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tracing::info;
use tracing_subscriber::EnvFilter;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use tokio::sync::RwLock;

use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};

use together_server::config::Config;
use together_server::state::AppState;
use together_server::websocket::ConnectionManager;
use together_server::{db, handlers, websocket};

/// Middleware that restricts access to the metrics endpoint to loopback connections only.
///
/// When `ConnectInfo` is not available (e.g. in direct oneshot tests), access is
/// denied — the metrics route is not registered in the test app anyway, so this
/// branch is unreachable in practice.
async fn require_loopback(
    connect_info: Option<ConnectInfo<SocketAddr>>,
    req: Request<axum::body::Body>,
    next: Next,
) -> Response {
    match connect_info {
        Some(ConnectInfo(addr)) if addr.ip().is_loopback() => next.run(req).await,
        Some(_) => StatusCode::NOT_FOUND.into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

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

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP client");

    let giphy_api_key = std::env::var("GIPHY_API_KEY")
        .ok()
        .map(|k| Arc::from(k.as_str()));

    let app_state = AppState {
        pool,
        jwt_secret: config.jwt_secret,
        connections: ConnectionManager::new(),
        upload_dir: config.upload_dir.clone(),
        link_preview_cache: Arc::new(RwLock::new(HashMap::new())),
        http_client,
        giphy_api_key,
    };

    // Prometheus metrics layer
    let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

    // ── Rate limiting ─────────────────────────────────────────────────────────
    // Global limit: 10 requests/second per IP, burst of 20.
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(10)
            .burst_size(20)
            .finish()
            .expect("Invalid global governor configuration"),
    );

    // Stricter limit for authentication endpoints: 2 requests/second per IP, burst of 5.
    // Nested into a sub-router so that `.route_layer()` applies only to these three routes.
    let auth_governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(2)
            .burst_size(5)
            .finish()
            .expect("Invalid auth governor configuration"),
    );

    let auth_router = Router::new()
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/refresh", post(handlers::auth::refresh_token))
        .route_layer(GovernorLayer {
            config: auth_governor_conf,
        });

    // Build router
    let app = Router::new()
        // Health check + metrics
        .route("/health", get(handlers::health_check))
        .route(
            "/link-preview",
            get(handlers::link_preview::get_link_preview),
        )
        .route("/giphy/search", get(handlers::giphy::search_giphy))
        .route(
            "/metrics",
            get(move || async move { metric_handle.render() })
                .route_layer(middleware::from_fn(require_loopback)),
        )
        // Auth routes (stricter per-IP rate limit, nested via sub-router)
        .merge(auth_router)
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
                .layer(axum::extract::DefaultBodyLimit::max(52_428_800 + 65_536)), // 50 MB + multipart overhead
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
        // Poll routes (protected, nested under channel)
        .route(
            "/channels/:channel_id/polls",
            post(handlers::polls::create_poll),
        )
        .route("/polls/:poll_id", get(handlers::polls::get_poll))
        .route("/polls/:poll_id/vote", post(handlers::polls::cast_vote))
        // Event routes (protected, nested under channel or server)
        .route(
            "/channels/:channel_id/events",
            post(handlers::events::create_event),
        )
        .route("/servers/:id/events", get(handlers::events::list_events))
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
        // ── Global rate limit (10 req/s per IP, burst 20) ──────────────────
        .layer(GovernorLayer {
            config: governor_conf,
        })
        // ── Security response headers ──────────────────────────────────────
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        // ── Prometheus + CORS ──────────────────────────────────────────────
        .layer(prometheus_layer)
        .layer(cors)
        .with_state(app_state);

    // Start server
    info!("🎧 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");

    // `into_make_service_with_connect_info` populates `ConnectInfo<SocketAddr>` in
    // request extensions, needed by:
    //  - GovernorLayer's PeerIpKeyExtractor (per-IP rate limiting)
    //  - require_loopback middleware on /metrics
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("Server failed to start");
}

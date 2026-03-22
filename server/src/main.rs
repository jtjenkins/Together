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
use together_server::webhook_delivery;
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

    // Initialize uptime tracking for health endpoint
    handlers::health::init_uptime();

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

    // On Unix, set upload directory permissions to prevent execution.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) =
            tokio::fs::set_permissions(&config.upload_dir, PermissionsExt::from_mode(0o755)).await
        {
            tracing::warn!(error = ?e, "Failed to set upload directory permissions");
        }
    }

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP client");

    let giphy_api_key = std::env::var("GIPHY_API_KEY")
        .ok()
        .map(|k| Arc::from(k.as_str()));

    // Start the webhook delivery background worker.
    let webhook_queue = webhook_delivery::start_worker(pool.clone(), http_client.clone());
    info!("📬 Webhook delivery worker started");

    let app_state = AppState {
        pool,
        jwt_secret: config.jwt_secret.clone(),
        connections: ConnectionManager::new(),
        upload_dir: config.upload_dir.clone(),
        link_preview_cache: Arc::new(RwLock::new(HashMap::new())),
        http_client,
        giphy_api_key,
        config: Arc::new(config.clone()),
        bot_rate_limiter: AppState::new_bot_rate_limiter(),
        go_live_sessions: Arc::new(RwLock::new(HashMap::new())),
        webhook_queue,
    };

    // Prometheus metrics layer
    let (prometheus_layer, metric_handle) = PrometheusMetricLayer::pair();

    // ── Rate limiting ─────────────────────────────────────────────────────────
    // NOTE: GovernorConfigBuilder::per_second(n) sets the REPLENISHMENT PERIOD
    // in seconds (interval between tokens), NOT the rate. To get R req/s, use
    // per_millisecond(1000 / R). Examples:
    //   10 req/s  → per_millisecond(100)   (1 token per 100ms)
    //    2 req/s  → per_millisecond(500)   (1 token per 500ms)
    //  100 req/s  → per_millisecond(10)    (1 token per 10ms)
    //
    // Production: 10 req/s per IP (burst 20); auth routes: 2/s (burst 5).
    // Dev mode: relaxed (1 req/ms = ~1000 req/s) to allow load testing from a
    // single IP without flooding the per-IP buckets (same policy as permissive
    // CORS in dev).
    let governor_conf = Arc::new(if config.is_dev {
        GovernorConfigBuilder::default()
            .per_millisecond(1) // 1 token per 1ms ≈ 1000 req/s
            .burst_size(5_000)
            .finish()
            .expect("Invalid global governor configuration (dev)")
    } else {
        GovernorConfigBuilder::default()
            .per_millisecond(100) // 1 token per 100ms = 10 req/s
            .burst_size(20)
            .finish()
            .expect("Invalid global governor configuration (prod)")
    });

    // Stricter limit for authentication endpoints.
    let auth_governor_conf = Arc::new(if config.is_dev {
        GovernorConfigBuilder::default()
            .per_millisecond(10) // 1 token per 10ms = 100 req/s for auth in dev
            .burst_size(5_000) // large burst so all 500 load-test VUs can register at once
            .finish()
            .expect("Invalid auth governor configuration (dev)")
    } else {
        GovernorConfigBuilder::default()
            .per_millisecond(500) // 1 token per 500ms = 2 req/s
            .burst_size(5)
            .finish()
            .expect("Invalid auth governor configuration (prod)")
    });

    let auth_router = Router::new()
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/refresh", post(handlers::auth::refresh_token))
        .route(
            "/auth/forgot-password",
            post(handlers::auth::forgot_password),
        )
        .route("/auth/reset-password", post(handlers::auth::reset_password))
        .route_layer(GovernorLayer {
            config: auth_governor_conf,
        });

    // Health check routes are intentionally outside the rate-limit layer so
    // that monitoring and orchestration probes are never throttled.
    let health_router = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/health/ready", get(handlers::readiness_check))
        .route("/health/live", get(handlers::liveness_check))
        .with_state(app_state.clone());

    // Build router
    let app = Router::new()
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
        // Moderation routes (permission-gated)
        .route(
            "/servers/:id/members/:user_id/kick",
            post(handlers::moderation::kick_member),
        )
        .route(
            "/servers/:id/members/:user_id/ban",
            post(handlers::moderation::ban_member),
        )
        .route(
            "/servers/:id/members/:user_id/timeout",
            post(handlers::moderation::timeout_member).delete(handlers::moderation::remove_timeout),
        )
        // Server data export (owner only)
        .route("/servers/:id/export", get(handlers::export::export_server))
        // Audit logs (owner only)
        .route(
            "/servers/:id/audit-logs",
            get(handlers::audit::list_audit_logs),
        )
        // Automod routes (owner only)
        .route(
            "/servers/:id/automod",
            get(handlers::automod::get_automod_config)
                .patch(handlers::automod::update_automod_config),
        )
        .route(
            "/servers/:id/automod/words",
            get(handlers::automod::list_word_filters).post(handlers::automod::add_word_filter),
        )
        .route(
            "/servers/:id/automod/words/:word",
            delete(handlers::automod::remove_word_filter),
        )
        .route(
            "/servers/:id/automod/logs",
            get(handlers::automod::list_automod_logs),
        )
        .route("/servers/:id/bans", get(handlers::automod::list_bans))
        .route(
            "/servers/:id/bans/:user_id",
            delete(handlers::automod::remove_ban),
        )
        // Search routes (protected, server-scoped)
        .route(
            "/servers/:id/search",
            get(handlers::search::search_messages),
        )
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
        // Single message fetch (needed for reply-bar preview when target is off-screen)
        .route(
            "/channels/:channel_id/messages/:message_id",
            get(handlers::messages::get_message),
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
        // Pin routes (protected, requires MANAGE_MESSAGES permission)
        .route(
            "/channels/:channel_id/pinned-messages",
            get(handlers::pins::list_pinned_messages),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/pin",
            post(handlers::pins::pin_message),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/pin",
            delete(handlers::pins::unpin_message),
        )
        // Read-state / ack routes
        .route(
            "/channels/:channel_id/ack",
            post(handlers::read_states::ack_channel),
        )
        // Bot management routes (user-scoped, protected)
        .route("/bots", post(handlers::bots::create_bot))
        .route("/bots", get(handlers::bots::list_bots))
        // NOTE: /bots/connect must be registered before /bots/:id so the literal
        // path segment "connect" is not consumed by the :id parameter capture.
        .route("/bots/connect", post(handlers::bots::bot_connect))
        .route("/bots/:id", get(handlers::bots::get_bot))
        .route("/bots/:id", patch(handlers::bots::update_bot))
        .route("/bots/:id", delete(handlers::bots::revoke_bot))
        .route("/bots/:id/logs", get(handlers::bots::bot_logs))
        .route(
            "/bots/:id/token/regenerate",
            post(handlers::bots::regenerate_bot_token),
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
        // Custom emoji routes (protected, nested under server)
        .route(
            "/servers/:id/emojis",
            get(handlers::custom_emojis::list_custom_emojis)
                .post(handlers::custom_emojis::upload_custom_emoji),
        )
        .route(
            "/servers/:id/emojis/:emoji_id",
            delete(handlers::custom_emojis::delete_custom_emoji),
        )
        .route(
            "/emojis/:emoji_id",
            get(handlers::custom_emojis::serve_custom_emoji_image),
        )
        // Webhook routes (protected, admin/owner only)
        .route(
            "/servers/:id/webhooks",
            get(handlers::webhooks::list_webhooks).post(handlers::webhooks::create_webhook),
        )
        .route(
            "/servers/:id/webhooks/:webhook_id",
            get(handlers::webhooks::get_webhook)
                .patch(handlers::webhooks::update_webhook)
                .delete(handlers::webhooks::delete_webhook),
        )
        .route(
            "/servers/:id/webhooks/:webhook_id/test",
            post(handlers::webhooks::test_webhook),
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
        // Go Live routes (protected, nested under channel)
        .route(
            "/channels/:channel_id/go-live",
            post(handlers::go_live::start_go_live),
        )
        .route(
            "/channels/:channel_id/go-live",
            delete(handlers::go_live::stop_go_live),
        )
        .route(
            "/channels/:channel_id/go-live",
            get(handlers::go_live::get_go_live),
        )
        // ICE servers for WebRTC (protected, returns TURN credentials)
        .route("/ice-servers", get(handlers::ice::get_ice_servers))
        // WebSocket gateway
        .route("/ws", get(websocket::websocket_handler))
        // ── Global rate limit ──────────────────────────────────────────────
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
        // Content-Security-Policy: defense-in-depth against XSS/injection.
        // Restrictive policy for API server (returns JSON, not HTML).
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(
                "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            ),
        ))
        // Strict-Transport-Security: force HTTPS (1 year, include subdomains).
        // Browsers ignore this header over HTTP, so it's safe to send in all environments.
        .layer(SetResponseHeaderLayer::if_not_present(
            header::HeaderName::from_static("strict-transport-security"),
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        ))
        // ── Prometheus + CORS ──────────────────────────────────────────────
        .layer(prometheus_layer)
        .layer(cors)
        .with_state(app_state)
        // Merge health routes after all middleware so they are not subject
        // to rate limiting or other API-only layers.
        .merge(health_router);

    // Start server
    info!("🎧 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");

    // `into_make_service_with_connect_info` populates `ConnectInfo<SocketAddr>` in
    // request extensions, needed by:
    //  - GovernorLayer's PeerIpKeyExtractor (per-IP rate limiting)
    //  - require_loopback middleware on /metrics
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal());

    server.await.expect("Server failed to start");
}

#[cfg(unix)]
async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("failed to install SIGTERM handler");
    tokio::select! {
        _ = ctrl_c => { tracing::info!("Received SIGINT, starting graceful shutdown"); }
        _ = sigterm.recv() => { tracing::info!("Received SIGTERM, starting graceful shutdown"); }
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() {
    tokio::signal::ctrl_c()
        .await
        .expect("failed to install Ctrl+C handler");
    tracing::info!("Received SIGINT, starting graceful shutdown");
}

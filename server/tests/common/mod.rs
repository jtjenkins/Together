// Each integration test file is a separate binary; helpers not used in every
// binary would otherwise trigger dead_code warnings from clippy.
#![allow(dead_code)]

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
    routing::{delete, get, patch, post, put},
    Router,
};
use http_body_util::BodyExt;
use serde_json::Value;
use sqlx::PgPool;
use std::path::PathBuf;
use std::sync::Arc;
use tower::ServiceExt;

use together_server::{
    handlers,
    state::AppState,
    websocket::{websocket_handler, ConnectionManager},
};

pub const TEST_JWT_SECRET: &str = "test-secret-min-32-characters-long!!";

/// Shared upload directory for all integration tests.
///
/// Files are organized by message UUID, so parallel tests using different
/// messages don't conflict with each other.
pub fn test_upload_dir() -> PathBuf {
    std::env::temp_dir().join("together_test_uploads")
}

/// Connect to the test database specified by DATABASE_URL.
///
/// Each test that calls this gets its own pool. Tests use UUID-based usernames
/// so they don't conflict with each other or with data from previous runs.
pub async fn test_pool() -> PgPool {
    let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
        "postgresql://together:together_dev_password@localhost:5432/together_dev".to_string()
    });
    PgPool::connect(&url)
        .await
        .expect("Failed to connect to test database — is DATABASE_URL set?")
}

/// Build the full application router wired to a test database pool.
pub fn create_test_app(pool: PgPool) -> Router {
    let state = AppState {
        pool,
        jwt_secret: Arc::from(TEST_JWT_SECRET),
        connections: ConnectionManager::new(),
        upload_dir: test_upload_dir(),
    };
    Router::new()
        .route("/health", get(handlers::health_check))
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/refresh", post(handlers::auth::refresh_token))
        .route("/users/@me", get(handlers::users::get_current_user))
        .route("/users/@me", patch(handlers::users::update_current_user))
        // Server routes
        .route("/servers", post(handlers::servers::create_server))
        .route("/servers", get(handlers::servers::list_servers))
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
        // Channel routes
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
        // Message routes
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
        // Thread routes
        .route(
            "/channels/:channel_id/messages/:message_id/thread",
            get(handlers::messages::list_thread_replies),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/thread",
            post(handlers::messages::create_thread_reply),
        )
        // Attachment routes
        .route(
            "/messages/:message_id/attachments",
            post(handlers::attachments::upload_attachments),
        )
        .route(
            "/messages/:message_id/attachments",
            get(handlers::attachments::list_attachments),
        )
        .route(
            "/files/:message_id/*filepath",
            get(handlers::attachments::serve_file),
        )
        // Reaction routes
        .route(
            "/channels/:channel_id/messages/:message_id/reactions",
            get(handlers::reactions::list_reactions),
        )
        .route(
            "/channels/:channel_id/messages/:message_id/reactions/:emoji",
            put(handlers::reactions::add_reaction),
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
        // DM routes
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
        // Voice routes
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
        .route("/ws", get(websocket_handler))
        .with_state(state)
}

/// Generate a username that is unique per test invocation.
pub fn unique_username() -> String {
    format!("u{}", &uuid::Uuid::new_v4().simple().to_string()[..12])
}

// ── Request helpers ──────────────────────────────────────────────────────────

pub async fn post_json(app: Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    send(app, req).await
}

pub async fn post_json_authed(
    app: Router,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    send(app, req).await
}

pub async fn get_authed(app: Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    send(app, req).await
}

pub async fn patch_json_authed(
    app: Router,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::PATCH)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    send(app, req).await
}

pub async fn put_authed(app: Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::PUT)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    send(app, req).await
}

pub async fn delete_authed(app: Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::DELETE)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    send(app, req).await
}

pub async fn get_no_auth(app: Router, uri: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    send(app, req).await
}

pub async fn patch_no_auth(app: Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::PATCH)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    send(app, req).await
}

pub async fn delete_no_auth(app: Router, uri: &str) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(Method::DELETE)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    send(app, req).await
}

async fn send(app: Router, req: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// GET a URL with auth and return the raw response bytes (for binary/file responses).
pub async fn get_raw_authed(app: Router, uri: &str, token: &str) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, bytes.to_vec())
}

/// GET a URL without auth and return the raw response bytes.
pub async fn get_raw_no_auth(app: Router, uri: &str) -> (StatusCode, Vec<u8>) {
    let req = Request::builder()
        .method(Method::GET)
        .uri(uri)
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, bytes.to_vec())
}

// ── Scenario helpers ─────────────────────────────────────────────────────────

/// Register a fresh user and return the full response body.
pub async fn register_user(app: Router, username: &str, password: &str) -> Value {
    let (status, body) = post_json(
        app,
        "/auth/register",
        serde_json::json!({ "username": username, "password": password }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "setup register failed: {body}");
    body
}

/// Register a user and return just their access token.
pub async fn register_and_get_token(app: Router, username: &str, password: &str) -> String {
    let body = register_user(app, username, password).await;
    body["access_token"].as_str().unwrap().to_owned()
}

/// Create a server and return the full response body.
pub async fn create_server(app: Router, token: &str, name: &str) -> Value {
    let (status, body) =
        post_json_authed(app, "/servers", token, serde_json::json!({ "name": name })).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup create_server failed: {body}"
    );
    body
}

/// Make a server public via PATCH (owner token required).
pub async fn make_server_public(app: Router, token: &str, server_id: &str) {
    let (status, body) = patch_json_authed(
        app,
        &format!("/servers/{server_id}"),
        token,
        serde_json::json!({ "is_public": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "make_server_public failed: {body}");
}

/// Create a text channel in a server and return the full response body.
pub async fn create_channel(app: Router, token: &str, server_id: &str, name: &str) -> Value {
    let uri = format!("/servers/{server_id}/channels");
    let (status, body) = post_json_authed(
        app,
        &uri,
        token,
        serde_json::json!({ "name": name, "type": "text" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup create_channel failed: {body}"
    );
    body
}

/// Send a message to a channel and return the full response body.
pub async fn create_message(app: Router, token: &str, channel_id: &str, content: &str) -> Value {
    let uri = format!("/channels/{channel_id}/messages");
    let (status, body) =
        post_json_authed(app, &uri, token, serde_json::json!({ "content": content })).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup create_message failed: {body}"
    );
    body
}

/// Open (or retrieve) a DM channel between the authenticated user and `target_user_id`.
/// Returns the full response body.
pub async fn open_dm_channel(app: Router, token: &str, target_user_id: &str) -> Value {
    let (status, body) = post_json_authed(
        app,
        "/dm-channels",
        token,
        serde_json::json!({ "user_id": target_user_id }),
    )
    .await;
    assert!(
        status == StatusCode::CREATED || status == StatusCode::OK,
        "setup open_dm_channel failed ({status}): {body}"
    );
    body
}

/// Send a DM message to a channel and return the full response body.
pub async fn send_dm_message(app: Router, token: &str, channel_id: &str, content: &str) -> Value {
    let uri = format!("/dm-channels/{channel_id}/messages");
    let (status, body) =
        post_json_authed(app, &uri, token, serde_json::json!({ "content": content })).await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup send_dm_message failed: {body}"
    );
    body
}

// ── Multipart helpers ─────────────────────────────────────────────────────────

/// A single file in a multipart upload.
pub struct MultipartFile<'a> {
    pub field_name: &'a str,
    pub filename: &'a str,
    pub content_type: &'a str,
    pub data: &'a [u8],
}

/// Build a `multipart/form-data` body from the provided files.
///
/// Returns `(body_bytes, content_type_header_value)` where the content-type
/// includes the boundary parameter.
pub fn build_multipart(files: &[MultipartFile<'_>]) -> (Vec<u8>, String) {
    let boundary = "----TogetherTestBoundary1234567890";
    let mut body: Vec<u8> = Vec::new();

    for f in files {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\n",
                f.field_name, f.filename
            )
            .as_bytes(),
        );
        body.extend_from_slice(format!("Content-Type: {}\r\n\r\n", f.content_type).as_bytes());
        body.extend_from_slice(f.data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let content_type = format!("multipart/form-data; boundary={boundary}");
    (body, content_type)
}

/// POST a multipart upload to the given URI with auth.
pub async fn post_multipart_authed(
    app: Router,
    uri: &str,
    token: &str,
    files: &[MultipartFile<'_>],
) -> (StatusCode, Value) {
    let (body_bytes, content_type) = build_multipart(files);
    let req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(body_bytes))
        .unwrap();
    send(app, req).await
}

/// POST a multipart upload to the given URI without auth.
pub async fn post_multipart_no_auth(
    app: Router,
    uri: &str,
    files: &[MultipartFile<'_>],
) -> (StatusCode, Value) {
    let (body_bytes, content_type) = build_multipart(files);
    let req = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(body_bytes))
        .unwrap();
    send(app, req).await
}

mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// register_success
// ============================================================================

#[tokio::test]
async fn register_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "securepassword123" }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    assert!(body["access_token"].is_string());
    assert!(body["refresh_token"].is_string());
    assert_eq!(body["user"]["username"], username.as_str());
}

// ============================================================================
// register_duplicate_username
// ============================================================================

#[tokio::test]
async fn register_duplicate_username() {
    let pool = common::test_pool().await;
    let username = common::unique_username();

    // First registration should succeed.
    let app = common::create_test_app(pool.clone());
    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "securepassword123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Second registration with the same username must fail with 409.
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "anotherpassword123" }),
    )
    .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert!(
        body["error"].is_string(),
        "expected 'error' key in body: {body}"
    );
}

// ============================================================================
// register_validates_short_password
// ============================================================================

#[tokio::test]
async fn register_validates_short_password() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    // Password is exactly 7 characters — one below the 8-character minimum.
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "short12" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
}

// ============================================================================
// register_validates_short_username
// ============================================================================

#[tokio::test]
async fn register_validates_short_username() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    // Username is exactly 1 character — one below the 2-character minimum.
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": "a", "password": "securepassword123" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
}

// ============================================================================
// register_validates_long_password
// ============================================================================

#[tokio::test]
async fn register_validates_long_password() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    // 129 characters — one above the 128-character maximum (bcrypt DoS guard).
    let long_password = "a".repeat(129);

    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": long_password }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST, "body: {body}");
}

// ============================================================================
// register_with_email
// ============================================================================

#[tokio::test]
async fn register_with_email() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();
    let email = format!("{}@example.com", username);

    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": username,
            "password": "securepassword123",
            "email": email
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    assert!(body["access_token"].is_string());
    assert!(body["refresh_token"].is_string());
    assert_eq!(
        body["user"]["email"].as_str().unwrap_or(""),
        email.as_str(),
        "email field missing or incorrect in response: {body}"
    );
}

// ============================================================================
// login_success
// ============================================================================

#[tokio::test]
async fn login_success() {
    let pool = common::test_pool().await;
    let username = common::unique_username();
    let password = "securepassword123";

    // Register the user first.
    let app = common::create_test_app(pool.clone());
    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": password }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Login with the same credentials.
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json(
        app,
        "/auth/login",
        json!({ "username": username, "password": password }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert!(
        body["access_token"].is_string(),
        "missing access_token: {body}"
    );
    assert!(
        body["refresh_token"].is_string(),
        "missing refresh_token: {body}"
    );
    assert!(body["user"].is_object(), "missing user: {body}");
    assert_eq!(body["user"]["username"], username.as_str());
}

// ============================================================================
// login_wrong_password
// ============================================================================

#[tokio::test]
async fn login_wrong_password() {
    let pool = common::test_pool().await;
    let username = common::unique_username();

    // Register the user first.
    let app = common::create_test_app(pool.clone());
    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "correctpassword123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Attempt login with the wrong password.
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json(
        app,
        "/auth/login",
        json!({ "username": username, "password": "wrongpassword999" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED, "body: {body}");
    assert!(
        body["error"].is_string(),
        "expected 'error' key in body: {body}"
    );
}

// ============================================================================
// login_unknown_user
// ============================================================================

#[tokio::test]
async fn login_unknown_user() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::post_json(
        app,
        "/auth/login",
        json!({ "username": "nonexistentuser999", "password": "somepassword123" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED, "body: {body}");
    assert!(
        body["error"].is_string(),
        "expected 'error' key in body: {body}"
    );
}

// ============================================================================
// login_returns_access_token
// ============================================================================

#[tokio::test]
async fn login_returns_access_token() {
    let pool = common::test_pool().await;
    let username = common::unique_username();
    let password = "securepassword123";

    // Register the user.
    let app = common::create_test_app(pool.clone());
    let (status, _) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": password }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Login and capture the access_token.
    let app = common::create_test_app(pool.clone());
    let (status, body) = common::post_json(
        app,
        "/auth/login",
        json!({ "username": username, "password": password }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login failed: {body}");

    let access_token = body["access_token"].as_str().unwrap().to_owned();

    // Validate the token by calling a protected endpoint.
    let app = common::create_test_app(pool);
    let (status, me_body) = common::get_authed(app, "/users/@me", &access_token).await;

    assert_eq!(
        status,
        StatusCode::OK,
        "access_token from login was rejected: {me_body}"
    );
}

// ============================================================================
// refresh_token_rejected_as_bearer
// ============================================================================

#[tokio::test]
async fn refresh_token_rejected_as_bearer() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let username = common::unique_username();

    // Register and capture the refresh_token.
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "securepassword123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "register failed: {body}");

    let refresh_token = body["refresh_token"].as_str().unwrap().to_owned();

    // Attempt to use the refresh_token as a bearer token on a protected endpoint.
    let app = common::create_test_app(pool);
    let (status, body) = common::get_authed(app, "/users/@me", &refresh_token).await;

    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "refresh token should be rejected at API level, but got: {body}"
    );
}

// ============================================================================
// register_returns_different_tokens_each_call
// ============================================================================

#[tokio::test]
async fn register_returns_different_tokens_each_call() {
    let pool = common::test_pool().await;

    let username_a = common::unique_username();
    let username_b = common::unique_username();

    // Register the first user.
    let app = common::create_test_app(pool.clone());
    let (status, body_a) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username_a, "password": "securepassword123" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "first register failed: {body_a}"
    );

    // Register the second user.
    let app = common::create_test_app(pool);
    let (status, body_b) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username_b, "password": "securepassword123" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "second register failed: {body_b}"
    );

    let token_a = body_a["access_token"].as_str().unwrap();
    let token_b = body_b["access_token"].as_str().unwrap();

    assert_ne!(
        token_a, token_b,
        "two distinct users received identical access_tokens"
    );
}

// ============================================================================
// refresh_token_happy_path
// ============================================================================

#[tokio::test]
async fn refresh_token_happy_path() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let username = common::unique_username();

    // Register to obtain a refresh token.
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "securepassword123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "register failed: {body}");
    let refresh_token = body["refresh_token"].as_str().unwrap().to_owned();

    // Exchange refresh token for a new access token.
    let app = common::create_test_app(pool.clone());
    let (status, body) = common::post_json(
        app,
        "/auth/refresh",
        json!({ "refresh_token": refresh_token }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "token refresh failed: {body}");
    assert!(
        body["access_token"].is_string(),
        "missing access_token: {body}"
    );
    assert!(
        body["refresh_token"].is_string(),
        "missing refresh_token: {body}"
    );
    assert_eq!(body["user"]["username"], username.as_str());

    // The new access token must work on a protected endpoint.
    let new_access = body["access_token"].as_str().unwrap().to_owned();
    let app = common::create_test_app(pool);
    let (status, me) = common::get_authed(app, "/users/@me", &new_access).await;
    assert_eq!(status, StatusCode::OK, "new access token rejected: {me}");
}

// ============================================================================
// refresh_token_rejects_access_token
// ============================================================================

#[tokio::test]
async fn refresh_token_rejects_access_token() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let username = common::unique_username();

    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({ "username": username, "password": "securepassword123" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "register failed: {body}");
    let access_token = body["access_token"].as_str().unwrap().to_owned();

    // Attempting to use an access token as a refresh token must fail.
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json(
        app,
        "/auth/refresh",
        json!({ "refresh_token": access_token }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "access token should be rejected at /auth/refresh: {body}"
    );
}

// ============================================================================
// refresh_token_rejects_invalid_token
// ============================================================================

#[tokio::test]
async fn refresh_token_rejects_invalid_token() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::post_json(
        app,
        "/auth/refresh",
        json!({ "refresh_token": "this.is.not.a.valid.jwt" }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "malformed token should be rejected: {body}"
    );
}

// ============================================================================
// refresh_token_requires_auth_field
// ============================================================================

#[tokio::test]
async fn refresh_token_requires_auth_field() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    // Empty refresh_token string should fail validation.
    let (status, _) = common::post_json(app, "/auth/refresh", json!({ "refresh_token": "" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// register_username_with_special_chars_rejected
// ============================================================================

#[tokio::test]
async fn register_username_with_special_chars_rejected() {
    // Usernames containing characters outside the allowed set (alphanumeric +
    // underscore) must be rejected with 400 BAD_REQUEST.
    let bad_usernames = ["user name", "user<script>", "hello@world"];
    for username in &bad_usernames {
        let pool = common::test_pool().await;
        let app = common::create_test_app(pool);
        let (status, body) = common::post_json(
            app,
            "/auth/register",
            json!({
                "username": username,
                "password": "password123"
            }),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "Expected 400 for username '{}', got {}: {body}",
            username,
            status
        );
    }
}

// ============================================================================
// register_username_at_boundaries
// ============================================================================

#[tokio::test]
async fn register_username_at_boundaries() {
    // Exactly 2 chars (minimum) — should pass length validation.
    // Accept CREATED or CONFLICT — both confirm the 2-char name passed
    // the length/regex check (CONFLICT means name taken from a prior run).
    let min_name = format!("a{}", &uuid::Uuid::new_v4().simple().to_string()[..1]);
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": min_name,
            "password": "password123"
        }),
    )
    .await;
    assert!(
        status == StatusCode::CREATED || status == StatusCode::CONFLICT,
        "2-char username should pass validation (got {status}): {body}"
    );

    // 33 chars (one over the 32-char maximum) — should fail.
    let long_name = "a".repeat(33);
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (status, body) = common::post_json(
        app,
        "/auth/register",
        json!({
            "username": long_name,
            "password": "password123"
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "33-char username should be rejected: {body}"
    );
}

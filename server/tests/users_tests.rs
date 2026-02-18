mod common;

use axum::http::StatusCode;
use serde_json::json;

// ── Test 1: GET /users/@me — authenticated success ───────────────────────────

#[tokio::test]
async fn get_current_user_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let token = common::register_and_get_token(app.clone(), &username, "password123").await;
    let (status, body) = common::get_authed(app, "/users/@me", &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["username"], username.as_str());
    assert!(body["id"].is_string(), "response should contain 'id' field");
    assert!(body["status"].is_string(), "response should contain 'status' field");
    assert!(
        body.get("password_hash").is_none(),
        "response must NOT expose password_hash"
    );
}

// ── Test 2: GET /users/@me — no Authorization header → 401 ──────────────────

#[tokio::test]
async fn get_current_user_no_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::get_no_auth(app, "/users/@me").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        body.get("error").is_some(),
        "response body should contain 'error' key, got: {body}"
    );
}

// ── Test 3: GET /users/@me — malformed token → 401 ──────────────────────────

#[tokio::test]
async fn get_current_user_invalid_token() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, body) = common::get_authed(app, "/users/@me", "garbage").await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        body.get("error").is_some(),
        "response body should contain 'error' key, got: {body}"
    );
}

// ── Test 4: GET /users/@me — JWT signed with wrong secret → 401 ─────────────

#[tokio::test]
async fn get_current_user_wrong_secret() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    use jsonwebtoken::{encode, EncodingKey, Header};

    let fake_token = encode(
        &Header::default(),
        &json!({
            "sub": "00000000-0000-0000-0000-000000000000",
            "exp": 9999999999i64,
            "iat": 0,
            "username": "x",
            "token_type": "access"
        }),
        &EncodingKey::from_secret(b"wrong-secret-wrong-secret-wrong!!"),
    )
    .unwrap();

    let (status, body) = common::get_authed(app, "/users/@me", &fake_token).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(
        body.get("error").is_some(),
        "response body should contain 'error' key, got: {body}"
    );
}

// ── Test 5: PATCH /users/@me — update avatar_url ────────────────────────────

#[tokio::test]
async fn update_user_avatar_url() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let token = common::register_and_get_token(app.clone(), &username, "password123").await;
    let (status, body) = common::patch_json_authed(
        app,
        "/users/@me",
        &token,
        json!({ "avatar_url": "https://example.com/avatar.png" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["avatar_url"], "https://example.com/avatar.png");
}

// ── Test 6: PATCH /users/@me — update status to "away" ──────────────────────

#[tokio::test]
async fn update_user_status_valid() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let token = common::register_and_get_token(app.clone(), &username, "password123").await;
    let (status, body) = common::patch_json_authed(
        app,
        "/users/@me",
        &token,
        json!({ "status": "away" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "away");
}

// ── Test 7: PATCH /users/@me — invalid status → 400 ─────────────────────────

#[tokio::test]
async fn update_user_status_invalid() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let token = common::register_and_get_token(app.clone(), &username, "password123").await;
    let (status, body) = common::patch_json_authed(
        app,
        "/users/@me",
        &token,
        json!({ "status": "invisible" }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body.get("error").is_some(),
        "response body should contain 'error' key, got: {body}"
    );
}

// ── Test 8: PATCH /users/@me — COALESCE preserves custom_status ─────────────

#[tokio::test]
async fn update_user_custom_status_preserved_when_not_sent() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    // First PATCH: set custom_status
    let (status, _) = common::patch_json_authed(
        app.clone(),
        "/users/@me",
        &token,
        json!({ "custom_status": "In a meeting" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Second PATCH: update avatar_url only — custom_status must be preserved
    let (status, body) = common::patch_json_authed(
        app,
        "/users/@me",
        &token,
        json!({ "avatar_url": "https://example.com/new.png" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["custom_status"], "In a meeting",
        "custom_status should be preserved when not included in PATCH body"
    );
}

// ── Test 9: PATCH /users/@me — partial fields, others preserved ──────────────

#[tokio::test]
async fn update_user_partial_fields() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let username = common::unique_username();

    let token = common::register_and_get_token(app.clone(), &username, "password123").await;

    // Fetch current user to capture baseline values
    let (_, initial_body) = common::get_authed(app.clone(), "/users/@me", &token).await;
    let initial_username = initial_body["username"].clone();

    // PATCH with only status — avatar_url and custom_status should be unchanged
    let (status, body) = common::patch_json_authed(
        app,
        "/users/@me",
        &token,
        json!({ "status": "dnd" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "dnd", "status should be updated to 'dnd'");
    assert_eq!(
        body["username"], initial_username,
        "username should not change after partial PATCH"
    );
    // avatar_url was null at registration, should remain null
    assert!(
        body["avatar_url"].is_null(),
        "avatar_url should remain null when not included in PATCH body"
    );
}

mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn link_preview_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (status, _) = common::get_no_auth(app, "/link-preview?url=https://example.com").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn link_preview_rejects_non_http_scheme() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token =
        common::register_and_get_token(app, &common::unique_username(), "password123").await;

    let app = common::create_test_app(pool);
    let (status, body) =
        common::get_authed(app, "/link-preview?url=ftp%3A%2F%2Fexample.com", &token).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "expected 400, got {status}: {body}"
    );
}

#[tokio::test]
async fn link_preview_rejects_private_ip() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token =
        common::register_and_get_token(app, &common::unique_username(), "password123").await;

    let app = common::create_test_app(pool);
    // localhost always resolves to 127.0.0.1 which is private
    let (status, body) =
        common::get_authed(app, "/link-preview?url=http%3A%2F%2F127.0.0.1%2F", &token).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "expected 400, got {status}: {body}"
    );
}

#[tokio::test]
async fn link_preview_rejects_invalid_url() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token =
        common::register_and_get_token(app, &common::unique_username(), "password123").await;

    let app = common::create_test_app(pool);
    let (status, body) = common::get_authed(app, "/link-preview?url=not-a-url", &token).await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "expected 400, got {status}: {body}"
    );
}

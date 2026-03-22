mod common;

use axum::http::StatusCode;

// ============================================================================
// GET /giphy/search — requires auth + GIPHY_API_KEY
// ============================================================================

#[tokio::test]
async fn giphy_search_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::get_no_auth(app, "/giphy/search?q=cats").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn giphy_search_returns_500_when_api_key_missing() {
    // The test app sets giphy_api_key = None, so the handler should return
    // an internal server error (500) when the key is not configured.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app, &common::unique_username(), "pass1234").await;

    let app = common::create_test_app(pool);
    let (status, _) = common::get_authed(app, "/giphy/search?q=cats", &token).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn giphy_search_returns_500_with_limit_param() {
    // Even with a valid limit parameter, the handler still fails because
    // giphy_api_key is None in the test environment.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app, &common::unique_username(), "pass1234").await;

    let app = common::create_test_app(pool);
    let (status, _) = common::get_authed(app, "/giphy/search?q=dogs&limit=5", &token).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn giphy_search_missing_query_param_returns_400() {
    // The `q` parameter is required by GiphySearchParams; omitting it should
    // produce a 400 from the query-string deserialization layer.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app, &common::unique_username(), "pass1234").await;

    let app = common::create_test_app(pool);
    let (status, _) = common::get_authed(app, "/giphy/search", &token).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn giphy_search_limit_capped_at_25_still_hits_api_key_guard() {
    // Verify the handler runs with a limit > 25 (capped internally).
    // Since the test env has no API key, it errors before reaching the HTTP call.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app, &common::unique_username(), "pass1234").await;

    let app = common::create_test_app(pool);
    let (status, _) = common::get_authed(app, "/giphy/search?q=meme&limit=100", &token).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

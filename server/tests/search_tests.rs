mod common;

use axum::http::StatusCode;
use common::{
    create_channel, create_message, create_server, get_authed, get_no_auth,
    register_and_get_token, unique_username,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Search a server and return (status, body).
async fn search(
    app: axum::Router,
    token: &str,
    server_id: &str,
    query: &str,
) -> (StatusCode, serde_json::Value) {
    get_authed(
        app,
        &format!(
            "/servers/{server_id}/search?q={}",
            urlencoding::encode(query)
        ),
        token,
    )
    .await
}

/// Search a specific channel.
async fn search_channel(
    app: axum::Router,
    token: &str,
    server_id: &str,
    channel_id: &str,
    query: &str,
) -> (StatusCode, serde_json::Value) {
    get_authed(
        app,
        &format!(
            "/servers/{server_id}/search?q={}&channel_id={channel_id}",
            urlencoding::encode(query)
        ),
        token,
    )
    .await
}

// ── Auth tests ────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_search_requires_auth(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());
    let token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &token, "auth-test-server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _) = get_no_auth(app, &format!("/servers/{server_id}/search?q=hello")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn test_search_non_member_gets_not_found(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());

    // Owner creates a server
    let owner_token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &owner_token, "private-server").await;
    let server_id = server["id"].as_str().unwrap();

    // Outsider registers but never joins
    let outsider_token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;

    let (status, _) = search(app, &outsider_token, server_id, "hello").await;
    // Returns 404 to avoid leaking server existence
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── Basic search ──────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_search_returns_matching_messages(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());
    let token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &token, "search-server").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    create_message(app.clone(), &token, channel_id, "hello world unique phrase").await;
    create_message(app.clone(), &token, channel_id, "unrelated content here").await;

    let (status, body) = search(app, &token, server_id, "unique phrase").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = body["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0]["content"]
        .as_str()
        .unwrap()
        .contains("unique phrase"));
    // Highlight should contain <mark> tags
    assert!(results[0]["highlight"].as_str().unwrap().contains("<mark>"));
    assert!(body["total"].as_i64().unwrap() >= 1);
}

#[sqlx::test]
async fn test_search_excludes_deleted_messages(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());
    let token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &token, "del-server").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    let msg = create_message(app.clone(), &token, channel_id, "deletedterm xyzzy").await;
    let msg_id = msg["id"].as_str().unwrap();

    // Soft-delete the message
    let (del_status, _) =
        common::delete_authed(app.clone(), &format!("/messages/{msg_id}"), &token).await;
    assert_eq!(del_status, StatusCode::NO_CONTENT);

    let (status, body) = search(app, &token, server_id, "deletedterm").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = body["results"].as_array().unwrap();
    assert_eq!(
        results.len(),
        0,
        "deleted message should not appear in search"
    );
}

// ── Channel-scoped search ─────────────────────────────────────────────────────

#[sqlx::test]
async fn test_channel_search_scopes_to_correct_channel(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());
    let token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &token, "scope-server").await;
    let server_id = server["id"].as_str().unwrap();
    let ch_a = create_channel(app.clone(), &token, server_id, "alpha").await;
    let ch_b = create_channel(app.clone(), &token, server_id, "beta").await;
    let ch_a_id = ch_a["id"].as_str().unwrap();
    let ch_b_id = ch_b["id"].as_str().unwrap();

    create_message(app.clone(), &token, ch_a_id, "scopeterm in alpha channel").await;
    create_message(app.clone(), &token, ch_b_id, "scopeterm in beta channel").await;

    // Search channel A — should only see alpha's message
    let (status, body) = search_channel(app.clone(), &token, server_id, ch_a_id, "scopeterm").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let results = body["results"].as_array().unwrap();
    assert_eq!(results.len(), 1);
    assert!(results[0]["content"].as_str().unwrap().contains("alpha"));
    assert_eq!(results[0]["channel_id"].as_str().unwrap(), ch_a_id);
}

// ── Cross-server isolation ────────────────────────────────────────────────────

#[sqlx::test]
async fn test_channel_search_rejects_cross_server_channel(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());

    // User A owns Server A
    let token_a = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server_a = create_server(app.clone(), &token_a, "server-a").await;
    let server_a_id = server_a["id"].as_str().unwrap();
    let ch_a = create_channel(app.clone(), &token_a, server_a_id, "general").await;
    let _ch_a_id = ch_a["id"].as_str().unwrap();

    // User B owns Server B and posts a secret message
    let token_b = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server_b = create_server(app.clone(), &token_b, "server-b").await;
    let server_b_id = server_b["id"].as_str().unwrap();
    let ch_b = create_channel(app.clone(), &token_b, server_b_id, "secret").await;
    let ch_b_id = ch_b["id"].as_str().unwrap();
    create_message(
        app.clone(),
        &token_b,
        ch_b_id,
        "crossserversecret message content",
    )
    .await;

    // User A (member of Server A only) searches Server A but supplies Server B's channel_id
    let (status, body) = search_channel(
        app.clone(),
        &token_a,
        server_a_id,
        ch_b_id,
        "crossserversecret",
    )
    .await;

    // Must return either no results (channel not in server) or 404/403 — never Server B's content
    if status == StatusCode::OK {
        let results = body["results"].as_array().unwrap();
        assert_eq!(
            results.len(),
            0,
            "cross-server channel search must return 0 results, got: {body}"
        );
    } else {
        assert!(
            status == StatusCode::NOT_FOUND || status == StatusCode::FORBIDDEN,
            "expected 404/403, got {status}"
        );
    }

    // Also verify: User A cannot search Server B at all (not a member)
    let (status_b, _) = search(app, &token_a, server_b_id, "crossserversecret").await;
    assert_eq!(status_b, StatusCode::NOT_FOUND);
}

// ── Validation ────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_search_rejects_query_too_short(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());
    let token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &token, "val-server").await;
    let server_id = server["id"].as_str().unwrap();

    let (status, _) = get_authed(app, &format!("/servers/{server_id}/search?q=x"), &token).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Pagination ────────────────────────────────────────────────────────────────

#[sqlx::test]
async fn test_search_pagination_has_more_and_cursor(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool.clone());
    let token = register_and_get_token(app.clone(), &unique_username(), "pw123456").await;
    let server = create_server(app.clone(), &token, "page-server").await;
    let server_id = server["id"].as_str().unwrap();
    let channel = create_channel(app.clone(), &token, server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap();

    // Insert 5 messages all containing "pagterm"
    for i in 0..5 {
        create_message(
            app.clone(),
            &token,
            channel_id,
            &format!("pagterm message number {i}"),
        )
        .await;
    }

    // Fetch first page of 3
    let (status, body) = get_authed(
        app.clone(),
        &format!("/servers/{server_id}/search?q=pagterm&limit=3"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"].as_array().unwrap().len(), 3);
    assert!(body["has_more"].as_bool().unwrap());
    assert!(body["next_cursor"].is_string());

    let cursor = body["next_cursor"].as_str().unwrap();

    // Fetch second page using cursor
    let (status2, body2) = get_authed(
        app,
        &format!("/servers/{server_id}/search?q=pagterm&limit=3&before={cursor}"),
        &token,
    )
    .await;
    assert_eq!(status2, StatusCode::OK, "{body2}");
    let page2 = body2["results"].as_array().unwrap();
    assert_eq!(
        page2.len(),
        2,
        "second page should have remaining 2 results"
    );
    assert!(!body2["has_more"].as_bool().unwrap());
    assert!(body2["next_cursor"].is_null());
}

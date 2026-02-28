mod common;

use axum::http::StatusCode;
use serde_json::json;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// Set up a server + channel owned by a fresh user; return (token, server_id, channel_id).
async fn setup_server_and_channel(app: axum::Router) -> (String, String, String) {
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;
    let server = common::create_server(app.clone(), &token, "Event Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "announcements").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    (token, sid, cid)
}

/// POST to create an event; asserts 201 and returns the response body.
async fn create_event(
    app: axum::Router,
    token: &str,
    channel_id: &str,
    name: &str,
    starts_at: &str,
) -> serde_json::Value {
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/events"),
        token,
        json!({
            "name": name,
            "starts_at": starts_at
        }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup create_event failed: {body}"
    );
    body
}

// ============================================================================
// POST /channels/:channel_id/events — create event
// ============================================================================

#[tokio::test]
async fn test_create_event_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/events"),
        &token,
        json!({
            "name": "Game Night",
            "description": "Play games together!",
            "starts_at": "2099-06-15T20:00:00Z"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    // The response is a MessageDto that embeds the event.
    assert!(body["id"].is_string(), "message id should be present");
    assert_eq!(body["channel_id"], cid);
    let event = &body["event"];
    assert!(event.is_object(), "event field should be present");
    assert_eq!(event["name"], "Game Night");
    assert_eq!(event["description"], "Play games together!");
    assert!(event["id"].is_string());
    assert!(event["starts_at"].is_string());
}

#[tokio::test]
async fn test_create_event_empty_name_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/events"),
        &token,
        json!({
            "name": "",
            "starts_at": "2099-07-01T18:00:00Z"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// GET /servers/:id/events — list events for server
// ============================================================================

#[tokio::test]
async fn test_list_events_in_server() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, sid, cid) = setup_server_and_channel(app.clone()).await;

    // Create two future events.
    create_event(
        app.clone(),
        &token,
        &cid,
        "Movie Night",
        "2099-08-01T19:00:00Z",
    )
    .await;
    create_event(
        app.clone(),
        &token,
        &cid,
        "Trivia Night",
        "2099-09-01T20:00:00Z",
    )
    .await;

    let (status, body) =
        common::get_authed(app, &format!("/servers/{sid}/events"), &token).await;

    assert_eq!(status, StatusCode::OK);
    let events = body.as_array().unwrap();
    assert_eq!(events.len(), 2);
    // Events are returned in ascending starts_at order.
    assert_eq!(events[0]["name"], "Movie Night");
    assert_eq!(events[1]["name"], "Trivia Night");
}

#[tokio::test]
async fn test_event_forbidden_non_member() {
    // A non-member of the server should get 404 when listing events.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_token, sid, _) = setup_server_and_channel(app.clone()).await;

    // Register a second user who never joins the server.
    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) =
        common::get_authed(app, &format!("/servers/{sid}/events"), &outsider).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_create_event_non_member_rejected() {
    // A non-member should not be able to create an event in a channel they
    // don't belong to.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (_token, _, cid) = setup_server_and_channel(app.clone()).await;

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/events"),
        &outsider,
        json!({
            "name": "Sneaky Event",
            "starts_at": "2099-10-01T10:00:00Z"
        }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

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
    let server = common::create_server(app.clone(), &token, "Poll Guild").await;
    let sid = server["id"].as_str().unwrap().to_owned();
    let channel = common::create_channel(app.clone(), &token, &sid, "general").await;
    let cid = channel["id"].as_str().unwrap().to_owned();
    (token, sid, cid)
}

/// Create a poll in a channel; return the response body (MessageDto with poll field).
async fn create_poll(
    app: axum::Router,
    token: &str,
    channel_id: &str,
    question: &str,
    options: &[&str],
) -> serde_json::Value {
    let opts: Vec<serde_json::Value> = options.iter().map(|o| json!(o)).collect();
    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{channel_id}/polls"),
        token,
        json!({ "question": question, "options": opts }),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "setup create_poll failed: {body}"
    );
    body
}

// ============================================================================
// POST /channels/:channel_id/polls — create poll
// ============================================================================

#[tokio::test]
async fn test_create_poll_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let (status, body) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/polls"),
        &token,
        json!({
            "question": "What is your favourite colour?",
            "options": ["Red", "Blue", "Green"]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::CREATED);
    // Response is a MessageDto with a nested poll.
    assert!(body["id"].is_string(), "message id should be present");
    assert_eq!(body["channel_id"], cid);
    let poll = &body["poll"];
    assert!(poll.is_object(), "poll field should be present");
    assert_eq!(poll["question"], "What is your favourite colour?");
    let opts = poll["options"].as_array().unwrap();
    assert_eq!(opts.len(), 3);
    assert_eq!(poll["total_votes"], 0);
}

#[tokio::test]
async fn test_create_poll_too_few_options_rejected() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    // Only one option — should fail validation (min 2).
    let (status, _) = common::post_json_authed(
        app,
        &format!("/channels/{cid}/polls"),
        &token,
        json!({ "question": "One option?", "options": ["Only"] }),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// POST /polls/:poll_id/vote — cast vote
// ============================================================================

#[tokio::test]
async fn test_cast_vote_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let msg = create_poll(app.clone(), &token, &cid, "Best language?", &["Rust", "Go"]).await;

    let poll_id = msg["poll"]["id"].as_str().unwrap();
    // Pick the first option id.
    let option_id = msg["poll"]["options"][0]["id"].as_str().unwrap();

    let (status, body) = common::post_json_authed(
        app,
        &format!("/polls/{poll_id}/vote"),
        &token,
        json!({ "option_id": option_id }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["total_votes"], 1);
    assert_eq!(body["user_vote"], option_id);
}

#[tokio::test]
async fn test_cast_vote_twice_upserts() {
    // The API uses ON CONFLICT … DO UPDATE so voting twice simply changes the
    // selection; it should never return 4xx.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let msg = create_poll(
        app.clone(),
        &token,
        &cid,
        "Favourite drink?",
        &["Coffee", "Tea"],
    )
    .await;

    let poll_id = msg["poll"]["id"].as_str().unwrap();
    let opt_a = msg["poll"]["options"][0]["id"].as_str().unwrap();
    let opt_b = msg["poll"]["options"][1]["id"].as_str().unwrap();

    // First vote: option A.
    let (s1, _) = common::post_json_authed(
        app.clone(),
        &format!("/polls/{poll_id}/vote"),
        &token,
        json!({ "option_id": opt_a }),
    )
    .await;
    assert_eq!(s1, StatusCode::OK);

    // Second vote: switch to option B.
    let (s2, body2) = common::post_json_authed(
        app,
        &format!("/polls/{poll_id}/vote"),
        &token,
        json!({ "option_id": opt_b }),
    )
    .await;
    assert_eq!(s2, StatusCode::OK);
    // After the upsert there is still only 1 total vote.
    assert_eq!(body2["total_votes"], 1);
    assert_eq!(body2["user_vote"], opt_b);
}

// ============================================================================
// GET /polls/:poll_id — get poll
// ============================================================================

#[tokio::test]
async fn test_get_poll_success() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let msg = create_poll(
        app.clone(),
        &token,
        &cid,
        "Best pizza topping?",
        &["Cheese", "Pepperoni", "Mushroom"],
    )
    .await;
    let poll_id = msg["poll"]["id"].as_str().unwrap();

    let (status, body) = common::get_authed(app, &format!("/polls/{poll_id}"), &token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], poll_id);
    assert_eq!(body["question"], "Best pizza topping?");
    assert_eq!(body["options"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn test_get_poll_forbidden_non_member() {
    // A user who is not a member of the server should get 404.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let msg = create_poll(app.clone(), &token, &cid, "Private poll?", &["Yes", "No"]).await;
    let poll_id = msg["poll"]["id"].as_str().unwrap();

    // Register a second user who has NOT joined the server.
    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::get_authed(app, &format!("/polls/{poll_id}"), &outsider).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_cast_vote_forbidden_non_member() {
    // A non-member trying to vote should also get 404.
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (token, _, cid) = setup_server_and_channel(app.clone()).await;

    let msg = create_poll(app.clone(), &token, &cid, "Members only?", &["Yes", "No"]).await;
    let poll_id = msg["poll"]["id"].as_str().unwrap();
    let opt_id = msg["poll"]["options"][0]["id"].as_str().unwrap();

    let outsider =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, _) = common::post_json_authed(
        app,
        &format!("/polls/{poll_id}/vote"),
        &outsider,
        json!({ "option_id": opt_id }),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

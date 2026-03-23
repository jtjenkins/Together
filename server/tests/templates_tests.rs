mod common;

use axum::http::StatusCode;
use serde_json::json;

#[tokio::test]
async fn list_templates_returns_builtin_templates() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) = common::get_authed(app.clone(), "/server-templates", &token).await;

    assert_eq!(status, StatusCode::OK);
    let templates = body.as_array().expect("expected array");
    assert!(!templates.is_empty(), "should return at least the seeded templates");
    for t in templates {
        assert!(t["id"].is_string());
        assert!(t["name"].is_string());
        assert!(t["description"].is_string());
        assert!(t["category"].is_string());
        assert!(t["channels"].is_array());
        assert!(t["is_builtin"].is_boolean());
    }
}

#[tokio::test]
async fn list_templates_unauthenticated_returns_401() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let (status, _) = common::get_no_auth(app, "/server-templates").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_server_with_template_creates_channels() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (_, templates_body) = common::get_authed(app.clone(), "/server-templates", &token).await;
    let templates = templates_body.as_array().unwrap();
    let template_id = templates[0]["id"].as_str().unwrap().to_owned();
    let expected_channel_count = templates[0]["channels"].as_array().unwrap().len();

    let (status, server_body) = common::post_json_authed(
        app.clone(),
        "/servers",
        &token,
        json!({ "name": "TemplatedServer", "template_id": template_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let server_id = server_body["id"].as_str().unwrap();
    let (ch_status, ch_body) =
        common::get_authed(app.clone(), &format!("/servers/{server_id}/channels"), &token).await;
    assert_eq!(ch_status, StatusCode::OK);
    let channels = ch_body.as_array().unwrap();
    assert_eq!(
        channels.len(),
        expected_channel_count,
        "template channel count mismatch"
    );
}

#[tokio::test]
async fn create_server_without_template_creates_no_channels() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, server_body) = common::post_json_authed(
        app.clone(),
        "/servers",
        &token,
        json!({ "name": "BlankServer" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let server_id = server_body["id"].as_str().unwrap();
    let (ch_status, ch_body) =
        common::get_authed(app.clone(), &format!("/servers/{server_id}/channels"), &token).await;
    assert_eq!(ch_status, StatusCode::OK);
    assert_eq!(ch_body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn create_server_with_invalid_template_id_returns_400() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::post_json_authed(
        app.clone(),
        "/servers",
        &token,
        json!({ "name": "Bad", "template_id": fake_id }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

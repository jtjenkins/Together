mod common;

use axum::http::StatusCode;
use serde_json::json;

#[sqlx::test]
async fn list_templates_returns_builtin_templates(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let (status, body) = common::get_authed(app.clone(), "/server-templates", &token).await;

    assert_eq!(status, StatusCode::OK);
    let templates = body.as_array().expect("expected array");
    assert!(
        !templates.is_empty(),
        "should return at least the seeded templates"
    );
    for t in templates {
        assert!(t["id"].is_string());
        assert!(t["name"].is_string());
        assert!(t["description"].is_string());
        assert!(t["category"].is_string());
        assert!(t["channels"].is_array());
        assert!(t["is_builtin"].is_boolean());
    }
}

#[sqlx::test]
async fn list_templates_unauthenticated_returns_401(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let (status, _) = common::get_no_auth(app, "/server-templates").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn create_server_with_template_creates_channels(pool: sqlx::PgPool) {
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    // Find the Gaming template specifically (5 channels: 3 text + 2 voice).
    let (_, templates_body) = common::get_authed(app.clone(), "/server-templates", &token).await;
    let templates = templates_body.as_array().unwrap();
    let gaming = templates
        .iter()
        .find(|t| t["name"].as_str() == Some("Gaming"))
        .expect("Gaming template should be seeded");
    let template_id = gaming["id"].as_str().unwrap().to_owned();
    let expected_count = gaming["channels"].as_array().unwrap().len(); // 5

    let (status, server_body) = common::post_json_authed(
        app.clone(),
        "/servers",
        &token,
        json!({ "name": "TemplatedServer", "template_id": template_id }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let server_id = server_body["id"].as_str().unwrap();
    let (ch_status, ch_body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/channels"),
        &token,
    )
    .await;
    assert_eq!(ch_status, StatusCode::OK);
    let channels = ch_body.as_array().unwrap();
    assert_eq!(
        channels.len(),
        expected_count,
        "template channel count mismatch"
    );

    // Verify channel types were faithfully propagated from the template data.
    let voice_count = channels
        .iter()
        .filter(|c| c["type"].as_str() == Some("voice"))
        .count();
    let text_count = channels
        .iter()
        .filter(|c| c["type"].as_str() == Some("text"))
        .count();
    assert_eq!(
        voice_count, 2,
        "Gaming template should have 2 voice channels"
    );
    assert_eq!(text_count, 3, "Gaming template should have 3 text channels");

    // Verify at least one known channel name was created.
    let has_announcements = channels
        .iter()
        .any(|c| c["name"].as_str() == Some("announcements"));
    assert!(
        has_announcements,
        "Gaming template should include 'announcements' channel"
    );
}

#[sqlx::test]
async fn create_server_without_template_creates_no_channels(pool: sqlx::PgPool) {
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
    let (ch_status, ch_body) = common::get_authed(
        app.clone(),
        &format!("/servers/{server_id}/channels"),
        &token,
    )
    .await;
    assert_eq!(ch_status, StatusCode::OK);
    assert_eq!(ch_body.as_array().unwrap().len(), 0);
}

#[sqlx::test]
async fn create_server_with_invalid_template_id_returns_400(pool: sqlx::PgPool) {
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

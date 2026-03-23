mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn get_user_profile_returns_public_fields() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    // Register two users; viewer looks up target.
    let target_name = common::unique_username();
    let target_body = common::register_user(app.clone(), &target_name, "pass1234").await;
    let target_id = target_body["user"]["id"].as_str().unwrap().to_owned();

    let viewer_token = common::register_and_get_token(
        app.clone(),
        &common::unique_username(),
        "pass1234",
    )
    .await;

    let (status, body) =
        common::get_authed(app.clone(), &format!("/users/{target_id}"), &viewer_token).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["id"], target_id);
    assert_eq!(body["username"], target_name.as_str());
    // Private fields must NOT be present.
    assert!(body["email"].is_null());
    assert!(body["password_hash"].is_null());
    assert!(body.get("is_admin").is_none());
}

#[tokio::test]
async fn get_user_profile_unknown_id_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let token =
        common::register_and_get_token(app.clone(), &common::unique_username(), "pass1234").await;

    let fake_id = uuid::Uuid::new_v4();
    let (status, _) =
        common::get_authed(app.clone(), &format!("/users/{fake_id}"), &token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_disabled_user_profile_returns_404() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool.clone());

    // Register the target user, then disable them directly via SQL.
    let target_name = common::unique_username();
    let target_body = common::register_user(app.clone(), &target_name, "pass1234").await;
    let target_id = target_body["user"]["id"].as_str().unwrap().to_owned();

    sqlx::query("UPDATE users SET disabled = TRUE WHERE id = $1")
        .bind(uuid::Uuid::parse_str(&target_id).unwrap())
        .execute(&pool)
        .await
        .unwrap();

    let viewer_token = common::register_and_get_token(
        app.clone(),
        &common::unique_username(),
        "pass1234",
    )
    .await;

    let (status, _) =
        common::get_authed(app.clone(), &format!("/users/{target_id}"), &viewer_token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_user_profile_unauthenticated_returns_401() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);
    let fake_id = uuid::Uuid::new_v4();
    let (status, _) = common::get_no_auth(app, &format!("/users/{fake_id}")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

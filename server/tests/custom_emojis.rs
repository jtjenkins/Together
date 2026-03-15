mod common;

use axum::http::StatusCode;
use common::*;

// ============================================================================
// Test fixture helpers
// ============================================================================

/// A 1×1 transparent PNG with valid PNG magic bytes so `infer` detects it as
/// `image/png`.
fn tiny_png() -> Vec<u8> {
    vec![
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
        0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
        0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x08,
        0xd7, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]
}

/// Register a user, create a server, and return `(token, server_id)`.
async fn setup_server(app: axum::Router) -> (String, String) {
    let token = register_and_get_token(app.clone(), &unique_username(), "pass1234").await;
    let server = create_server(app.clone(), &token, "Emoji Guild").await;
    let server_id = server["id"].as_str().unwrap().to_owned();
    (token, server_id)
}

/// Upload a custom emoji to `server_id` with `name` and return the full
/// response `(StatusCode, Value)`.
async fn upload_emoji(
    app: axum::Router,
    token: &str,
    server_id: &str,
    name: &str,
) -> (StatusCode, serde_json::Value) {
    let png = tiny_png();
    let files = [
        MultipartFile {
            field_name: "name",
            filename: "",
            content_type: "text/plain",
            data: name.as_bytes(),
        },
        MultipartFile {
            field_name: "image",
            filename: "emoji.png",
            content_type: "image/png",
            data: &png,
        },
    ];
    post_multipart_authed(app, &format!("/servers/{server_id}/emojis"), token, &files).await
}

// ============================================================================
// POST + GET /servers/:id/emojis — upload and list
// ============================================================================

#[tokio::test]
async fn upload_and_list() {
    let pool = test_pool().await;
    let app = create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    // Upload an emoji.
    let (status, body) = upload_emoji(app.clone(), &token, &sid, "cool_emoji").await;
    assert_eq!(status, StatusCode::CREATED, "upload failed: {body}");
    assert_eq!(body["name"], "cool_emoji");
    assert_eq!(body["server_id"], sid);

    // List emojis — should contain the one we just uploaded.
    let (status, list) =
        get_authed(app.clone(), &format!("/servers/{sid}/emojis"), &token).await;
    assert_eq!(status, StatusCode::OK);
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "cool_emoji");
}

// ============================================================================
// POST /servers/:id/emojis — duplicate name rejected
// ============================================================================

#[tokio::test]
async fn duplicate_name_rejected() {
    let pool = test_pool().await;
    let app = create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    // First upload should succeed.
    let (status, body) = upload_emoji(app.clone(), &token, &sid, "my_emoji").await;
    assert_eq!(status, StatusCode::CREATED, "first upload failed: {body}");

    // Second upload with the same name must be rejected.
    let (status, _) = upload_emoji(app.clone(), &token, &sid, "my_emoji").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ============================================================================
// DELETE /servers/:id/emojis/:emoji_id — upload then delete
// ============================================================================

#[tokio::test]
async fn delete_emoji() {
    let pool = test_pool().await;
    let app = create_test_app(pool);
    let (token, sid) = setup_server(app.clone()).await;

    // Upload an emoji.
    let (status, body) = upload_emoji(app.clone(), &token, &sid, "bye_emoji").await;
    assert_eq!(status, StatusCode::CREATED, "upload failed: {body}");
    let emoji_id = body["id"].as_str().unwrap();

    // Delete it.
    let (status, _) = delete_authed(
        app.clone(),
        &format!("/servers/{sid}/emojis/{emoji_id}"),
        &token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // List should now be empty.
    let (status, list) = get_authed(app.clone(), &format!("/servers/{sid}/emojis"), &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list.as_array().unwrap().len(), 0);
}

// ============================================================================
// GET /servers/:id/emojis — non-member cannot list
// ============================================================================

#[tokio::test]
async fn non_member_cannot_list() {
    let pool = test_pool().await;
    let app = create_test_app(pool);
    let (_token, sid) = setup_server(app.clone()).await;

    // Register a user who has never joined the server.
    let outsider =
        register_and_get_token(app.clone(), &unique_username(), "pass1234").await;

    let (status, _) =
        get_authed(app.clone(), &format!("/servers/{sid}/emojis"), &outsider).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

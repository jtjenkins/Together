mod common;

use axum::http::StatusCode;
use common::*;

// ── Setup helper ──────────────────────────────────────────────────────────────

/// Create a server with one channel, post a message, and return all the IDs.
struct Fixture {
    /// Token of the server owner / message author.
    owner_token: String,
    /// Token of a plain member (joined the server but didn't send the message).
    member_token: String,
    /// Token of a user who is NOT a server member.
    outsider_token: String,
    #[allow(dead_code)]
    server_id: String,
    #[allow(dead_code)]
    channel_id: String,
    message_id: String,
}

async fn setup() -> Fixture {
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let owner = unique_username();
    let member_name = unique_username();
    let outsider_name = unique_username();

    let owner_token = register_and_get_token(app.clone(), &owner, "password123").await;
    let member_token = register_and_get_token(app.clone(), &member_name, "password123").await;
    let outsider_token = register_and_get_token(app.clone(), &outsider_name, "password123").await;

    let server = create_server(app.clone(), &owner_token, &unique_username()).await;
    let server_id = server["id"].as_str().unwrap().to_string();

    let channel = create_channel(app.clone(), &owner_token, &server_id, "general").await;
    let channel_id = channel["id"].as_str().unwrap().to_string();

    // Make the server public so the member can join, then have them join.
    make_server_public(app.clone(), &owner_token, &server_id).await;
    let (status, _) = post_json_authed(
        app.clone(),
        &format!("/servers/{server_id}/join"),
        &member_token,
        serde_json::json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "member join failed");

    let msg = create_message(app.clone(), &owner_token, &channel_id, "hello").await;
    let message_id = msg["id"].as_str().unwrap().to_string();

    Fixture {
        owner_token,
        member_token,
        outsider_token,
        server_id,
        channel_id,
        message_id,
    }
}

fn txt_file<'a>(name: &'a str, data: &'a [u8]) -> MultipartFile<'a> {
    MultipartFile {
        field_name: "files",
        filename: name,
        content_type: "text/plain",
        data,
    }
}

/// Minimal 1×1 PNG (67 bytes). Magic bytes let `infer` detect it as `image/png`.
/// Use this instead of plain-text fixtures wherever the upload must succeed
/// (plain ASCII has no magic bytes and is rejected as `application/octet-stream`).
fn png_file(name: &'static str) -> MultipartFile<'static> {
    // 1×1 transparent PNG, hex-encoded.
    static PNG_1X1: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth, color type, ...
        0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT length + type
        0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, // IDAT data
        0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, // IDAT data cont.
        0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND length + type
        0x44, 0xAE, 0x42, 0x60, 0x82, // IEND data
    ];
    MultipartFile {
        field_name: "files",
        filename: name,
        content_type: "image/png",
        data: PNG_1X1,
    }
}

// ── POST /messages/:message_id/attachments ────────────────────────────────────

#[tokio::test]
async fn upload_single_file_returns_201() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let file = png_file("hello.png");
    let file_size = file.data.len() as i64;
    let (status, body) = post_multipart_authed(app, &uri, &f.owner_token, &[file]).await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
    let attachments = body.as_array().unwrap();
    assert_eq!(attachments.len(), 1);

    let att = &attachments[0];
    assert_eq!(att["filename"], "hello.png");
    assert_eq!(att["file_size"], file_size);
    assert_eq!(att["mime_type"], "image/png");
    assert!(att["url"].as_str().unwrap().starts_with("/files/"));
    assert!(att["id"].as_str().is_some());
    assert!(att["message_id"].as_str().is_some());
}

#[tokio::test]
async fn upload_multiple_files_returns_all() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, body) = post_multipart_authed(
        app,
        &uri,
        &f.owner_token,
        &[png_file("file1.png"), png_file("file2.png")],
    )
    .await;

    assert_eq!(status, StatusCode::CREATED, "{body}");
    let attachments = body.as_array().unwrap();
    assert_eq!(attachments.len(), 2);
    // Filenames may come back in upload order
    let names: Vec<&str> = attachments
        .iter()
        .map(|a| a["filename"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"file1.png"), "{names:?}");
    assert!(names.contains(&"file2.png"), "{names:?}");
}

#[tokio::test]
async fn upload_requires_auth() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = post_multipart_no_auth(app, &uri, &[txt_file("f.txt", b"data")]).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn upload_requires_server_membership() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) =
        post_multipart_authed(app, &uri, &f.outsider_token, &[txt_file("f.txt", b"data")]).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn upload_requires_message_authorship() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = post_multipart_authed(
        app,
        &uri,
        &f.member_token, // member, but not the message author
        &[txt_file("f.txt", b"data")],
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn upload_with_no_files_returns_400() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Send a multipart body with a field that has a different name.
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = post_multipart_authed(
        app,
        &uri,
        &f.owner_token,
        &[MultipartFile {
            field_name: "not_files", // wrong field name
            filename: "x.txt",
            content_type: "text/plain",
            data: b"some data",
        }],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn upload_empty_file_returns_400() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) =
        post_multipart_authed(app, &uri, &f.owner_token, &[txt_file("empty.txt", b"")]).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn upload_oversized_file_returns_400() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // One byte over the 50 MB limit (52_428_800 bytes).
    let big_data = vec![0u8; 52_428_801];
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = post_multipart_authed(
        app,
        &uri,
        &f.owner_token,
        &[MultipartFile {
            field_name: "files",
            filename: "big.bin",
            content_type: "application/octet-stream",
            data: &big_data,
        }],
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// Uploading to a message that already has the maximum number of attachments
/// must be rejected without writing any files.
#[tokio::test]
async fn upload_exceeding_attachment_cap_returns_400() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);

    // Fill the message to exactly 10 attachments (5 + 5).
    for batch in 0..2 {
        let files: Vec<_> = (0..5)
            .map(|i| {
                let name = format!("batch{batch}_file{i}.png");
                MultipartFile {
                    field_name: "files",
                    filename: Box::leak(name.into_boxed_str()),
                    content_type: "image/png",
                    data: png_file("_").data,
                }
            })
            .collect();
        let (status, body) = post_multipart_authed(app.clone(), &uri, &f.owner_token, &files).await;
        assert_eq!(status, StatusCode::CREATED, "batch {batch} failed: {body}");
    }

    // A message now has 10 attachments — one more should be rejected.
    let (status, _) =
        post_multipart_authed(app, &uri, &f.owner_token, &[png_file("one_too_many.png")]).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn upload_to_nonexistent_message_returns_404() {
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Register a user so we have a valid token.
    let token = register_and_get_token(app.clone(), &unique_username(), "password123").await;
    let fake_id = uuid::Uuid::new_v4();

    let uri = format!("/messages/{fake_id}/attachments");
    let (status, _) = post_multipart_authed(app, &uri, &token, &[txt_file("f.txt", b"data")]).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn upload_to_deleted_message_returns_404() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Delete the message first.
    let (status, _) = delete_authed(
        app.clone(),
        &format!("/messages/{}", f.message_id),
        &f.owner_token,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "delete failed");

    // Now try to attach a file.
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) =
        post_multipart_authed(app, &uri, &f.owner_token, &[txt_file("f.txt", b"data")]).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── GET /messages/:message_id/attachments ─────────────────────────────────────

#[tokio::test]
async fn list_attachments_returns_200_with_empty_array() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, body) = get_authed(app, &uri, &f.owner_token).await;

    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn list_attachments_returns_uploaded_files() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Upload two files.
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = post_multipart_authed(
        app.clone(),
        &uri,
        &f.owner_token,
        &[png_file("a.png"), png_file("b.png")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    // Then list them.
    let (status, body) = get_authed(app, &uri, &f.owner_token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let list = body.as_array().unwrap();
    assert_eq!(list.len(), 2);
}

#[tokio::test]
async fn list_attachments_requires_auth() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = get_no_auth(app, &uri).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_attachments_requires_server_membership() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) = get_authed(app, &uri, &f.outsider_token).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn list_attachments_member_can_view() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Upload a file as the owner.
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, _) =
        post_multipart_authed(app.clone(), &uri, &f.owner_token, &[png_file("shared.png")]).await;
    assert_eq!(status, StatusCode::CREATED);

    // A plain member (not the author) should be able to list.
    let (status, body) = get_authed(app, &uri, &f.member_token).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body.as_array().unwrap().len(), 1);
}

// ── GET /files/:message_id/*filepath ─────────────────────────────────────────

/// Upload a file, then fetch it back and verify the body matches.
#[tokio::test]
async fn serve_file_returns_file_contents() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let file = png_file("serve.png");
    let expected_bytes = file.data;
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, body) = post_multipart_authed(app.clone(), &uri, &f.owner_token, &[file]).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");

    // The URL is returned in the attachment JSON.
    let url = body[0]["url"].as_str().unwrap().to_owned();

    let (status, bytes) = get_raw_authed(app, &url, &f.owner_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, expected_bytes);
}

/// A server member who did NOT author the message can still download files.
#[tokio::test]
async fn serve_file_member_can_download() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let file = png_file("member.png");
    let expected_bytes = file.data;
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, body) = post_multipart_authed(app.clone(), &uri, &f.owner_token, &[file]).await;
    assert_eq!(status, StatusCode::CREATED);

    let url = body[0]["url"].as_str().unwrap().to_owned();
    let (status, bytes) = get_raw_authed(app, &url, &f.member_token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, expected_bytes);
}

/// An unauthenticated request to /files must be rejected.
#[tokio::test]
async fn serve_file_requires_auth() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Upload a file so we have a real URL to attempt.
    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, body) = post_multipart_authed(
        app.clone(),
        &uri,
        &f.owner_token,
        &[png_file("auth_check.png")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    let url = body[0]["url"].as_str().unwrap().to_owned();
    let (status, _) = get_raw_no_auth(app, &url).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// A non-member cannot download files even with a valid token.
#[tokio::test]
async fn serve_file_requires_server_membership() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    let uri = format!("/messages/{}/attachments", f.message_id);
    let (status, body) =
        post_multipart_authed(app.clone(), &uri, &f.owner_token, &[png_file("secret.png")]).await;
    assert_eq!(status, StatusCode::CREATED);

    let url = body[0]["url"].as_str().unwrap().to_owned();
    let (status, _) = get_raw_authed(app, &url, &f.outsider_token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// A URL that has no matching DB record returns 404.
#[tokio::test]
async fn serve_file_not_in_db_returns_404() {
    let f = setup().await;
    let pool = test_pool().await;
    let app = create_test_app(pool);

    // Construct a plausible but non-existent file URL.
    let fake_url = format!("/files/{}/00000000doesnotexist.txt", f.message_id);
    let (status, _) = get_raw_authed(app, &fake_url, &f.owner_token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

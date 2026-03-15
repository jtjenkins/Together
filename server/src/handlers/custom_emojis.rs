use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use std::path::PathBuf;
use tokio::fs::File;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::shared::{fetch_server, require_manage_emojis, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{CustomEmoji, CustomEmojiDto},
    state::AppState,
    websocket::{
        broadcast_to_server,
        events::{EVENT_CUSTOM_EMOJI_CREATE, EVENT_CUSTOM_EMOJI_DELETE},
    },
};

// ============================================================================
// Constants
// ============================================================================

/// Maximum number of custom emojis allowed per server.
const MAX_EMOJIS_PER_SERVER: i64 = 50;

/// Maximum image size in bytes (256 KB).
const MAX_EMOJI_IMAGE_SIZE: usize = 262_144;

/// Allowed MIME types for emoji images.
const ALLOWED_EMOJI_MIME_TYPES: &[&str] =
    &["image/jpeg", "image/png", "image/gif", "image/webp"];

// ============================================================================
// Handlers
// ============================================================================

/// GET /servers/:server_id/emojis — list all custom emojis for a server.
///
/// Authorization: caller must be a member of the server.
pub async fn list_custom_emojis(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<CustomEmojiDto>>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let rows = sqlx::query_as::<_, CustomEmoji>(
        "SELECT id, server_id, created_by, name, filename, content_type, file_size, created_at
         FROM custom_emojis
         WHERE server_id = $1
         ORDER BY created_at ASC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    let dtos: Vec<CustomEmojiDto> = rows.into_iter().map(CustomEmojiDto::from_row).collect();
    Ok(Json(dtos))
}

/// POST /servers/:server_id/emojis — upload a custom emoji image.
///
/// Authorization: caller must have the MANAGE_EMOJIS permission (or be the owner).
///
/// Expects a `multipart/form-data` body with:
/// - `name`  — text field: emoji name (1–32 chars, `[a-z0-9_-]` only)
/// - `image` — file field: image bytes (JPEG / PNG / GIF / WebP, ≤ 256 KB)
///
/// On success returns `201 Created` with the created emoji DTO.
pub async fn upload_custom_emoji(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<CustomEmojiDto>)> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_manage_emojis(&state.pool, server.id, auth.user_id()).await?;

    // Check the server hasn't already hit the emoji cap.
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM custom_emojis WHERE server_id = $1")
            .bind(server_id)
            .fetch_one(&state.pool)
            .await?;

    if count >= MAX_EMOJIS_PER_SERVER {
        return Err(AppError::Validation(format!(
            "Servers may not have more than {MAX_EMOJIS_PER_SERVER} custom emojis"
        )));
    }

    // ── Parse multipart fields ────────────────────────────────────────────────

    let mut emoji_name: Option<String> = None;
    let mut image_bytes: Option<bytes::Bytes> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(error = ?e, "Failed to read multipart field");
        AppError::Validation("Invalid multipart data".into())
    })? {
        match field.name().unwrap_or("") {
            "name" => {
                let text = field.text().await.map_err(|e| {
                    tracing::warn!(error = ?e, "Failed to read name field");
                    AppError::Validation("Failed to read name field".into())
                })?;
                emoji_name = Some(text);
            }
            "image" => {
                let data = field.bytes().await.map_err(|e| {
                    tracing::warn!(error = ?e, "Failed to read image field bytes");
                    AppError::Validation("Failed to read image data".into())
                })?;
                image_bytes = Some(data);
            }
            _ => {}
        }
    }

    // ── Validate name ─────────────────────────────────────────────────────────

    let name = emoji_name.ok_or_else(|| AppError::Validation("Missing 'name' field".into()))?;

    if name.is_empty() || name.len() > 32 {
        return Err(AppError::Validation(
            "Emoji name must be between 1 and 32 characters".into(),
        ));
    }

    if !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(AppError::Validation(
            "Emoji name may only contain lowercase letters, digits, underscores, and hyphens"
                .into(),
        ));
    }

    // ── Validate image ────────────────────────────────────────────────────────

    let data =
        image_bytes.ok_or_else(|| AppError::Validation("Missing 'image' field".into()))?;

    if data.is_empty() {
        return Err(AppError::Validation("Image must not be empty".into()));
    }

    if data.len() > MAX_EMOJI_IMAGE_SIZE {
        return Err(AppError::Validation(
            "Image size exceeds the 256 KB limit".into(),
        ));
    }

    let mime_type = match infer::get(&data) {
        Some(t) if ALLOWED_EMOJI_MIME_TYPES.contains(&t.mime_type()) => {
            t.mime_type().to_string()
        }
        Some(t) => {
            return Err(AppError::Validation(format!(
                "Image type '{}' is not allowed. Use JPEG, PNG, GIF, or WebP.",
                t.mime_type()
            )));
        }
        None => {
            return Err(AppError::Validation(
                "Image type could not be determined. Use JPEG, PNG, GIF, or WebP.".into(),
            ));
        }
    };

    let ext = match mime_type.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    };

    // ── Write file to disk ────────────────────────────────────────────────────

    let emoji_id = Uuid::new_v4();
    let stored_filename = format!("{}.{}", Uuid::new_v4().simple(), ext);

    let dir = state
        .upload_dir
        .join("custom_emojis")
        .join(emoji_id.to_string());

    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?dir, "Failed to create emoji upload directory");
        AppError::Internal
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o755);
        if let Err(e) = tokio::fs::set_permissions(&dir, perms).await {
            tracing::warn!(error = ?e, path = ?dir, "Failed to set emoji directory permissions");
        }
    }

    let file_path = dir.join(&stored_filename);
    if let Err(e) = tokio::fs::write(&file_path, &data).await {
        tracing::error!(error = ?e, path = ?file_path, "Failed to write emoji image file");
        if let Err(e) = tokio::fs::remove_file(&file_path).await {
            tracing::warn!(error = ?e, "Failed to cleanup emoji file");
        }
        if let Err(e) = tokio::fs::remove_dir(&dir).await {
            tracing::warn!(error = ?e, "Failed to cleanup emoji dir");
        }
        return Err(AppError::Internal);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o644);
        if let Err(e) = tokio::fs::set_permissions(&file_path, perms).await {
            tracing::warn!(error = ?e, path = ?file_path, "Failed to set emoji file permissions");
        }
    }

    // ── Insert into the database ──────────────────────────────────────────────

    let file_size = data.len() as i64;

    let row = match sqlx::query_as::<_, CustomEmoji>(
        "INSERT INTO custom_emojis (id, server_id, created_by, name, filename, content_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, server_id, created_by, name, filename, content_type, file_size, created_at",
    )
    .bind(emoji_id)
    .bind(server_id)
    .bind(auth.user_id())
    .bind(&name)
    .bind(&stored_filename)
    .bind(&mime_type)
    .bind(file_size)
    .fetch_one(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            // On unique constraint violation for (server_id, name) report a friendly 400.
            if let sqlx::Error::Database(ref db_err) = e {
                let constraint = db_err.constraint().unwrap_or("");
                if constraint == "custom_emojis_server_name_unique" {
                    return Err(AppError::Validation(format!(
                        "An emoji named '{name}' already exists in this server"
                    )));
                }
            }
            // For any other DB error clean up the written file first.
            cleanup_files(&[file_path]).await;
            return Err(AppError::from(e));
        }
    };

    let dto = CustomEmojiDto::from_row(row);

    broadcast_to_server(
        &state,
        server_id,
        EVENT_CUSTOM_EMOJI_CREATE,
        serde_json::to_value(&dto).unwrap_or_else(|e| {
            tracing::error!(error = ?e, "Failed to serialize CustomEmojiDto for broadcast");
            serde_json::Value::Null
        }),
    )
    .await;

    Ok((StatusCode::CREATED, Json(dto)))
}

/// DELETE /servers/:server_id/emojis/:emoji_id — delete a custom emoji.
///
/// Authorization: caller must have the MANAGE_EMOJIS permission (or be the owner).
/// Returns `204 No Content` on success.
pub async fn delete_custom_emoji(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, emoji_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    let server = fetch_server(&state.pool, server_id).await?;
    require_manage_emojis(&state.pool, server.id, auth.user_id()).await?;

    let row = sqlx::query_as::<_, CustomEmoji>(
        "DELETE FROM custom_emojis WHERE id = $1 AND server_id = $2
         RETURNING id, server_id, created_by, name, filename, content_type, file_size, created_at",
    )
    .bind(emoji_id)
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Emoji not found".into()))?;

    // Best-effort file cleanup — log a warning on failure but do not fail the response.
    let dir = state
        .upload_dir
        .join("custom_emojis")
        .join(row.id.to_string());
    let file_path = dir.join(&row.filename);
    if let Err(e) = tokio::fs::remove_file(&file_path).await {
        tracing::warn!(error = ?e, path = ?file_path, "Failed to delete custom emoji file");
    }
    if let Err(e) = tokio::fs::remove_dir(&dir).await {
        tracing::warn!(error = ?e, path = ?dir, "Failed to remove custom emoji dir");
    }

    broadcast_to_server(
        &state,
        server_id,
        EVENT_CUSTOM_EMOJI_DELETE,
        serde_json::json!({
            "server_id": server_id,
            "emoji_id": emoji_id,
        }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /emojis/:emoji_id — serve a custom emoji image (public, no auth required).
///
/// Responds with the raw image bytes and appropriate `Content-Type`.
/// Sets `Cache-Control: public, max-age=86400` (24 h) since emoji images are
/// immutable once uploaded (delete and re-upload creates a new ID).
pub async fn serve_custom_emoji_image(
    State(state): State<AppState>,
    Path(emoji_id): Path<Uuid>,
) -> AppResult<Response> {
    let row = sqlx::query_as::<_, CustomEmoji>(
        "SELECT id, server_id, created_by, name, filename, content_type, file_size, created_at
         FROM custom_emojis WHERE id = $1",
    )
    .bind(emoji_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Emoji not found".into()))?;

    let file_path = state
        .upload_dir
        .join("custom_emojis")
        .join(row.id.to_string())
        .join(&row.filename);

    let file = File::open(&file_path).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?file_path, "Failed to open emoji image file");
        AppError::Internal
    })?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, row.content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(body)
        .map_err(|_| AppError::Internal)?;

    Ok(response)
}

// ============================================================================
// Private helpers
// ============================================================================

/// Delete all paths in `paths`, logging any errors but not propagating them.
async fn cleanup_files(paths: &[PathBuf]) {
    for p in paths {
        if let Err(e) = tokio::fs::remove_file(p).await {
            tracing::warn!(error = ?e, path = ?p, "Failed to clean up orphaned emoji file");
        }
    }
}

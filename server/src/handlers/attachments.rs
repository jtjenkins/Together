use axum::{
    extract::{Multipart, Path, State},
    http::StatusCode,
    Json,
};
use uuid::Uuid;

use super::shared::{fetch_channel_by_id, fetch_message, require_member};
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Attachment,
    state::AppState,
};

// ============================================================================
// Constants
// ============================================================================

/// Maximum number of attachments allowed per message (Discord-compatible).
const MAX_ATTACHMENTS_PER_MESSAGE: i64 = 10;

/// Maximum file size in bytes (50 MB, matches the DB check constraint).
const MAX_FILE_SIZE: usize = 52_428_800;

// ============================================================================
// Handlers
// ============================================================================

/// POST /messages/:message_id/attachments — upload one or more files (author only).
///
/// Expects a `multipart/form-data` body with one or more file fields named `files`.
/// Each file is written to `{upload_dir}/{message_id}/{uuid}_{filename}` on disk
/// and returned with a URL of `/files/{message_id}/{uuid}_{filename}`.
///
/// Authorization rules:
/// - Caller must be authenticated.
/// - Caller must be a member of the server that owns the channel.
/// - Caller must be the message author.
///
/// Validation:
/// - Each file must be non-empty and ≤ 50 MB.
/// - The combined attachment count for the message cannot exceed 10.
pub async fn upload_attachments(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<Vec<Attachment>>)> {
    let message = fetch_message(&state.pool, message_id).await?;
    let channel = fetch_channel_by_id(&state.pool, message.channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    if message.author_id != Some(auth.user_id()) {
        return Err(AppError::Forbidden(
            "Only the message author can add attachments".into(),
        ));
    }

    let existing_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM attachments WHERE message_id = $1")
            .bind(message_id)
            .fetch_one(&state.pool)
            .await?;

    let mut slot_count = existing_count;
    let mut created: Vec<Attachment> = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(error = ?e, "Failed to read multipart field");
        AppError::Validation("Invalid multipart data".into())
    })? {
        if field.name().unwrap_or("") != "files" {
            continue;
        }

        if slot_count >= MAX_ATTACHMENTS_PER_MESSAGE {
            return Err(AppError::Validation(format!(
                "Messages may not have more than {MAX_ATTACHMENTS_PER_MESSAGE} attachments"
            )));
        }

        let filename = field.file_name().unwrap_or("unknown").to_string();

        let mime_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        let data = field.bytes().await.map_err(|e| {
            tracing::warn!(error = ?e, "Failed to read multipart field bytes");
            AppError::Validation("Failed to read file data".into())
        })?;

        if data.is_empty() {
            return Err(AppError::Validation("Files must not be empty".into()));
        }

        if data.len() > MAX_FILE_SIZE {
            return Err(AppError::Validation(
                "File size exceeds the 50 MB limit".into(),
            ));
        }

        let stored_name = format!(
            "{}_{}",
            Uuid::new_v4().simple(),
            sanitize_filename(&filename)
        );
        let dir = state.upload_dir.join(message_id.to_string());

        tokio::fs::create_dir_all(&dir).await.map_err(|e| {
            tracing::error!(error = ?e, path = ?dir, "Failed to create upload directory");
            AppError::Internal
        })?;

        let file_path = dir.join(&stored_name);
        tokio::fs::write(&file_path, &data).await.map_err(|e| {
            tracing::error!(error = ?e, path = ?file_path, "Failed to write uploaded file");
            AppError::Internal
        })?;

        let url = format!("/files/{message_id}/{stored_name}");

        let attachment = sqlx::query_as::<_, Attachment>(
            "INSERT INTO attachments (message_id, filename, file_size, mime_type, url)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, message_id, filename, file_size, mime_type, url, width, height, created_at",
        )
        .bind(message_id)
        .bind(&filename)
        .bind(data.len() as i64)
        .bind(&mime_type)
        .bind(&url)
        .fetch_one(&state.pool)
        .await?;

        created.push(attachment);
        slot_count += 1;
    }

    if created.is_empty() {
        return Err(AppError::Validation(
            "No files provided — include at least one field named \"files\"".into(),
        ));
    }

    Ok((StatusCode::CREATED, Json(created)))
}

/// GET /messages/:message_id/attachments — list attachments for a message (members only).
pub async fn list_attachments(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(message_id): Path<Uuid>,
) -> AppResult<Json<Vec<Attachment>>> {
    let message = fetch_message(&state.pool, message_id).await?;
    let channel = fetch_channel_by_id(&state.pool, message.channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let attachments = sqlx::query_as::<_, Attachment>(
        "SELECT id, message_id, filename, file_size, mime_type, url, width, height, created_at
         FROM attachments WHERE message_id = $1
         ORDER BY created_at ASC",
    )
    .bind(message_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(attachments))
}

// ============================================================================
// Private helpers
// ============================================================================

/// Replace any character that is not alphanumeric, dot, underscore, or hyphen
/// with an underscore, and cap the result at 128 characters to prevent
/// excessively long file paths.
fn sanitize_filename(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();

    match sanitized.len() {
        0 => "file".to_string(),
        n if n > 128 => sanitized[..128].to_string(),
        _ => sanitized,
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_unsafe_characters() {
        assert_eq!(sanitize_filename("hello world.txt"), "hello_world.txt");
        // '/' maps to '_'; '.' is kept as-is → "../../etc/passwd" → ".._.._etc_passwd"
        assert_eq!(sanitize_filename("../../etc/passwd"), ".._.._etc_passwd");
        assert_eq!(sanitize_filename("file (1).pdf"), "file__1_.pdf");
        assert_eq!(
            sanitize_filename("normal-file_name.tar.gz"),
            "normal-file_name.tar.gz"
        );
    }

    #[test]
    fn sanitize_handles_edge_cases() {
        assert_eq!(sanitize_filename(""), "file");
        assert_eq!(sanitize_filename("   "), "___");
        // Verify length cap
        let long = "a".repeat(200);
        assert_eq!(sanitize_filename(&long).len(), 128);
    }
}

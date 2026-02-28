use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
use bytes::Bytes;
use serde::Deserialize;
use std::path::PathBuf;
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

/// Allowlist of MIME types accepted for uploaded files.
/// The MIME type is detected from magic bytes, not from the client-supplied
/// Content-Type header, so this list is authoritative.
const ALLOWED_MIME_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
    "audio/mpeg",
    "audio/ogg",
    "audio/webm",
    "application/pdf",
    "text/plain",
];

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
///
/// The upload is atomic: all validation happens before any file is written to disk.
/// If a disk write or database insert fails, any files already written are removed
/// and the database transaction is rolled back.
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

    // ── Pass 1: validate all fields before touching disk or the database ──────

    let mut pending: Vec<PendingFile> = Vec::new();
    let mut slot_count = existing_count;

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

        // Detect MIME type from magic bytes, ignoring the client-supplied
        // Content-Type header to prevent stored-XSS via disguised HTML uploads.
        let mime_type = infer::get(&data)
            .map(|t| t.mime_type())
            .unwrap_or("application/octet-stream")
            .to_string();

        if !ALLOWED_MIME_TYPES.contains(&mime_type.as_str()) {
            return Err(AppError::Validation(format!(
                "File type '{}' is not allowed",
                mime_type
            )));
        }

        let stored_name = format!(
            "{}_{}",
            Uuid::new_v4().simple(),
            sanitize_filename(&filename)
        );
        let url = format!("/files/{message_id}/{stored_name}");

        pending.push(PendingFile {
            filename,
            mime_type,
            data,
            stored_name,
            url,
        });
        slot_count += 1;
    }

    if pending.is_empty() {
        return Err(AppError::Validation(
            "No files provided — include at least one field named \"files\"".into(),
        ));
    }

    // ── Pass 2: write all files to disk ───────────────────────────────────────

    let dir = state.upload_dir.join(message_id.to_string());

    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?dir, "Failed to create upload directory");
        AppError::Internal
    })?;

    let mut written_paths: Vec<PathBuf> = Vec::new();

    for p in &pending {
        let file_path = dir.join(&p.stored_name);
        if let Err(e) = tokio::fs::write(&file_path, &p.data).await {
            tracing::error!(error = ?e, path = ?file_path, "Failed to write uploaded file");
            cleanup_files(&written_paths).await;
            return Err(AppError::Internal);
        }
        written_paths.push(file_path);
    }

    // ── Pass 3: insert all rows in a single transaction ───────────────────────

    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error = ?e, "Failed to begin upload transaction");
            cleanup_files(&written_paths).await;
            return Err(AppError::from(e));
        }
    };

    let mut created: Vec<Attachment> = Vec::new();

    for p in &pending {
        match sqlx::query_as::<_, Attachment>(
            "INSERT INTO attachments (message_id, filename, file_size, mime_type, url)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, message_id, filename, file_size, mime_type, url, width, height, created_at",
        )
        .bind(message_id)
        .bind(&p.filename)
        .bind(p.data.len() as i64)
        .bind(&p.mime_type)
        .bind(&p.url)
        .fetch_one(&mut *tx)
        .await
        {
            Ok(att) => created.push(att),
            Err(e) => {
                tracing::error!(error = ?e, "Failed to insert attachment row; rolling back");
                let _ = tx.rollback().await;
                cleanup_files(&written_paths).await;
                return Err(AppError::from(e));
            }
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::error!(error = ?e, "Failed to commit upload transaction; cleaning up files");
        cleanup_files(&written_paths).await;
        return Err(AppError::from(e));
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

/// GET /files/:message_id/*filepath — serve an attachment file (members only).
///
/// Authorization and membership are checked before serving the file.
/// The attachment URL is verified against the database so that only files
/// successfully recorded in the DB are accessible.
pub async fn serve_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(params): Path<FileParams>,
) -> AppResult<Response> {
    let message_id = params.message_id;
    let filepath = params.filepath;

    // Path traversal guard: our stored filenames never contain '/', so any
    // sub-path in the URL is either a crafted request or a bug.
    if filepath.contains('/') {
        return Err(AppError::NotFound("Attachment not found".into()));
    }

    let message = fetch_message(&state.pool, message_id).await?;
    let channel = fetch_channel_by_id(&state.pool, message.channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    // Verify the attachment is registered in the DB — prevents serving orphan
    // files that might exist on disk if a previous upload partially failed.
    let url = format!("/files/{message_id}/{filepath}");
    let attachment = sqlx::query_as::<_, Attachment>(
        "SELECT id, message_id, filename, file_size, mime_type, url, width, height, created_at
         FROM attachments WHERE message_id = $1 AND url = $2",
    )
    .bind(message_id)
    .bind(&url)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Attachment not found".into()))?;

    let file_path = state
        .upload_dir
        .join(message_id.to_string())
        .join(&filepath);

    let data = tokio::fs::read(&file_path).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?file_path, "Failed to read attachment file");
        AppError::Internal
    })?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, attachment.mime_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("inline; filename=\"{}\"", attachment.filename),
        )
        .body(Body::from(data))
        .map_err(|_| AppError::Internal)?;

    Ok(response)
}

// ============================================================================
// Private helpers
// ============================================================================

/// Intermediate representation of a multipart field parsed and validated but
/// not yet written to disk or the database.
struct PendingFile {
    filename: String,
    mime_type: String,
    data: Bytes,
    stored_name: String,
    url: String,
}

/// Path parameters for the file-serving route.
#[derive(Deserialize)]
pub struct FileParams {
    pub message_id: Uuid,
    pub filepath: String,
}

/// Delete all paths in `paths`, logging any errors but not propagating them.
async fn cleanup_files(paths: &[PathBuf]) {
    for p in paths {
        if let Err(e) = tokio::fs::remove_file(p).await {
            tracing::warn!(error = ?e, path = ?p, "Failed to clean up orphaned upload file");
        }
    }
}

/// Replace any character that is not alphanumeric, dot, underscore, or hyphen
/// with an underscore, and cap the result at 128 **characters** (not bytes) to
/// prevent excessively long file paths and avoid panicking on multi-byte UTF-8.
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
        .take(128)
        .collect();

    if sanitized.is_empty() {
        "file".to_string()
    } else {
        sanitized
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
        // Verify length cap in characters (not bytes)
        let long_ascii = "a".repeat(200);
        assert_eq!(sanitize_filename(&long_ascii).len(), 128);
        // Multi-byte chars: 200 × '文' = 600 bytes, but only 128 chars
        let long_cjk: String = "文".repeat(200);
        let result = sanitize_filename(&long_cjk);
        assert_eq!(result.chars().count(), 128);
        assert_eq!(result, "文".repeat(128));
    }
}

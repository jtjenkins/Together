use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::FromRow;
use std::io::{Cursor, Write};
use uuid::Uuid;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::CompressionMethod;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::AppState,
};

// ============================================================================
// Local export-only DTOs (no password_hash or other sensitive internal fields)
// ============================================================================

#[derive(Serialize, FromRow)]
struct ExportServer {
    id: Uuid,
    name: String,
    owner_id: Uuid,
    icon_url: Option<String>,
    is_public: bool,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
struct ExportChannel {
    id: Uuid,
    name: String,
    #[sqlx(rename = "type")]
    channel_type: String,
    position: i32,
    category: Option<String>,
    topic: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
struct ExportMember {
    user_id: Uuid,
    username: String,
    nickname: Option<String>,
    joined_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
struct ExportRole {
    id: Uuid,
    name: String,
    permissions: i64,
    color: Option<String>,
    hoist: bool,
    position: i32,
}

#[derive(Serialize, FromRow)]
struct ExportMessage {
    id: Uuid,
    author_id: Option<Uuid>,
    author_username: Option<String>,
    content: String,
    reply_to: Option<Uuid>,
    edited_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize, FromRow)]
struct ExportDmMessage {
    id: Uuid,
    author_id: Option<Uuid>,
    author_username: Option<String>,
    content: String,
    created_at: DateTime<Utc>,
}

#[derive(FromRow)]
struct DmChannelRow {
    id: Uuid,
    partner_username: String,
}

// ============================================================================
// Helper
// ============================================================================

/// Verify the caller is the server owner.  Returns 404 (not 403) to avoid
/// leaking server existence to non-members.
async fn require_owner(pool: &sqlx::PgPool, server_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let is_owner: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)")
            .bind(server_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    if is_owner {
        Ok(())
    } else {
        Err(AppError::NotFound("Server not found".into()))
    }
}

fn to_slug(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

// ============================================================================
// Handler
// ============================================================================

/// GET /servers/:id/export — owner-only.
///
/// Builds a ZIP archive in memory from live DB queries and streams it back as
/// an `application/zip` download.  Nothing is written to disk.
///
/// ZIP layout:
///   {server-slug}-export/
///     server.json                          — server metadata
///     channels.json                        — all channels
///     members.json                         — member list (no credentials)
///     roles.json                           — role definitions
///     messages/{channel-slug}-{id}.jsonl   — newline-delimited JSON per text channel
///     dm_messages/{user-slug}-{id}.jsonl   — requesting user's DMs
pub async fn export_server(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Response<Body>> {
    require_owner(&state.pool, server_id, auth.user_id()).await?;

    // ── Collect data ──────────────────────────────────────────────────────────

    let server = sqlx::query_as::<_, ExportServer>(
        "SELECT id, name, owner_id, icon_url, is_public, created_at
         FROM servers WHERE id = $1",
    )
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))?;

    let channels = sqlx::query_as::<_, ExportChannel>(
        "SELECT id, name, type AS channel_type, position, category, topic, created_at
         FROM channels WHERE server_id = $1 ORDER BY position",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    let members = sqlx::query_as::<_, ExportMember>(
        "SELECT sm.user_id, u.username, sm.nickname, sm.joined_at
         FROM server_members sm
         JOIN users u ON u.id = sm.user_id
         WHERE sm.server_id = $1
         ORDER BY sm.joined_at",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    let roles = sqlx::query_as::<_, ExportRole>(
        "SELECT id, name, permissions, color, hoist, position
         FROM roles WHERE server_id = $1 ORDER BY position",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    // ── Build ZIP in memory ───────────────────────────────────────────────────

    let buf = Cursor::new(Vec::<u8>::new());
    let mut zip = ZipWriter::new(buf);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let dir = format!("{}-export/", to_slug(&server.name));

    macro_rules! add_json {
        ($path:expr, $value:expr) => {{
            zip.start_file($path, opts)
                .map_err(|_| AppError::Internal)?;
            let json = serde_json::to_string_pretty(&$value).map_err(|_| AppError::Internal)?;
            zip.write_all(json.as_bytes())
                .map_err(|_| AppError::Internal)?;
        }};
    }

    add_json!(format!("{dir}server.json"), &server);
    add_json!(format!("{dir}channels.json"), &channels);
    add_json!(format!("{dir}members.json"), &members);
    add_json!(format!("{dir}roles.json"), &roles);

    // ── Per-channel message files ─────────────────────────────────────────────

    for ch in &channels {
        if ch.channel_type != "text" {
            continue;
        }

        let messages = sqlx::query_as::<_, ExportMessage>(
            "SELECT m.id, m.author_id, u.username AS author_username,
                    m.content, m.reply_to, m.edited_at, m.created_at
             FROM messages m
             LEFT JOIN users u ON u.id = m.author_id
             WHERE m.channel_id = $1 AND m.deleted = FALSE
             ORDER BY m.created_at ASC",
        )
        .bind(ch.id)
        .fetch_all(&state.pool)
        .await?;

        if messages.is_empty() {
            continue;
        }

        zip.start_file(
            format!("{dir}messages/{}-{}.jsonl", to_slug(&ch.name), ch.id),
            opts,
        )
        .map_err(|_| AppError::Internal)?;

        for msg in &messages {
            let line = serde_json::to_string(msg).map_err(|_| AppError::Internal)?;
            zip.write_all(line.as_bytes())
                .map_err(|_| AppError::Internal)?;
            zip.write_all(b"\n").map_err(|_| AppError::Internal)?;
        }
    }

    // ── DM message files (requesting user's DMs only) ─────────────────────────

    let dm_channels = sqlx::query_as::<_, DmChannelRow>(
        "SELECT dmc.id,
                COALESCE(u.username, 'unknown') AS partner_username
         FROM direct_message_channels dmc
         JOIN users u ON u.id = CASE
             WHEN dmc.user1_id = $1 THEN dmc.user2_id
             ELSE dmc.user1_id
         END
         WHERE dmc.user1_id = $1 OR dmc.user2_id = $1
         ORDER BY dmc.created_at",
    )
    .bind(auth.user_id())
    .fetch_all(&state.pool)
    .await?;

    for dm in &dm_channels {
        let messages = sqlx::query_as::<_, ExportDmMessage>(
            "SELECT dm.id, dm.author_id, u.username AS author_username,
                    dm.content, dm.created_at
             FROM direct_messages dm
             LEFT JOIN users u ON u.id = dm.author_id
             WHERE dm.channel_id = $1
             ORDER BY dm.created_at ASC",
        )
        .bind(dm.id)
        .fetch_all(&state.pool)
        .await?;

        if messages.is_empty() {
            continue;
        }

        zip.start_file(
            format!(
                "{dir}dm_messages/{}-{}.jsonl",
                to_slug(&dm.partner_username),
                dm.id
            ),
            opts,
        )
        .map_err(|_| AppError::Internal)?;

        for msg in &messages {
            let line = serde_json::to_string(msg).map_err(|_| AppError::Internal)?;
            zip.write_all(line.as_bytes())
                .map_err(|_| AppError::Internal)?;
            zip.write_all(b"\n").map_err(|_| AppError::Internal)?;
        }
    }

    // ── Finalize and respond ─────────────────────────────────────────────────

    let cursor = zip.finish().map_err(|_| AppError::Internal)?;
    let zip_bytes = cursor.into_inner();

    let filename = format!(
        "{}-export-{}.zip",
        to_slug(&server.name),
        Utc::now().format("%Y%m%d")
    );

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/zip")
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .header(header::CONTENT_LENGTH, zip_bytes.len().to_string())
        .body(Body::from(zip_bytes))
        .map_err(|_| AppError::Internal)?;

    Ok(response)
}

# Custom Emojis Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow server members to upload custom image emojis that can be used in messages and reactions within that server.

**Architecture:** Local-only storage under `{upload_dir}/custom_emojis/{emoji_id}/{filename}` (consistent with attachments). Backend exposes CRUD endpoints gated behind membership + admin check. Frontend integrates custom emojis into the existing emoji picker, text autocomplete, message rendering, and reaction display.

**Tech Stack:** Rust/Axum (multipart upload, static file serving), PostgreSQL (`custom_emojis` table), React + Zustand (`customEmojiStore`), TypeScript (extended emoji utils).

---

## File Map

### Created

- `server/migrations/20260314000001_custom_emojis.sql`
- `server/src/handlers/custom_emojis.rs`
- `clients/web/src/stores/customEmojiStore.ts`
- `clients/web/src/components/servers/CustomEmojiManager.tsx`
- `clients/web/src/components/servers/CustomEmojiManager.module.css`
- `clients/web/src/__tests__/customEmojiStore.test.ts`

### Modified

- `server/src/handlers/mod.rs` — add `pub mod custom_emojis;`
- `server/src/handlers/shared.rs` — add `require_manage_emojis`
- `server/src/models/mod.rs` — add `CustomEmoji`, `CustomEmojiDto`
- `server/src/websocket/events.rs` — add `EVENT_CUSTOM_EMOJI_CREATE`, `EVENT_CUSTOM_EMOJI_DELETE`
- `server/src/main.rs` — add 3 routes
- `clients/web/src/types/index.ts` — add `CustomEmoji` interface
- `clients/web/src/api/client.ts` — add `listCustomEmojis`, `uploadCustomEmoji`, `deleteCustomEmoji`
- `clients/web/src/utils/emoji.ts` — extend `EmojiEntry`, add `searchAllEmoji`
- `clients/web/src/components/messages/EmojiPicker.tsx` — add custom tab, `serverId` prop
- `clients/web/src/components/messages/EmojiAutocomplete.tsx` — show custom emojis, `serverId` prop
- `clients/web/src/components/messages/MessageInput.tsx` — pass `serverId` to EmojiAutocomplete
- `clients/web/src/components/messages/MessageItem.tsx` — render `:name:` custom emoji; pass `serverId` to EmojiPicker
- `clients/web/src/components/messages/ReactionBar.tsx` — render `c:{uuid}` custom emoji reactions; `serverId` prop
- `clients/web/src/components/servers/ServerSettingsModal.tsx` — add emoji management section

---

## Implementation Notes

### Custom emoji identifier formats

| Context                 | Format                                           | Example                                  |
| ----------------------- | ------------------------------------------------ | ---------------------------------------- |
| Reaction storage (DB)   | `c:{uuid}`                                       | `c:550e8400-e29b-41d4-a716-446655440000` |
| Message text (DB)       | `:name:`                                         | `:thinking_face:`                        |
| Emoji picker `onSelect` | `c:{uuid}` for custom, unicode char for standard |                                          |
| Autocomplete insert     | `:name:` for custom, unicode char for standard   |                                          |

Existing `validate_emoji` in `reactions.rs` accepts up to 64 bytes; `c:{uuid}` = 38 bytes — no change needed.

### File storage layout

```
{upload_dir}/
  custom_emojis/
    {emoji_uuid}/
      {uuid_simple}.{ext}
```

---

## Chunk 1: Backend

### Task 1: Database migration

**Files:**

- Create: `server/migrations/20260314000001_custom_emojis.sql`

- [ ] **Step 1: Write migration**

```sql
-- server/migrations/20260314000001_custom_emojis.sql
CREATE TABLE custom_emojis (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id    UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL
                             CONSTRAINT custom_emoji_name_format
                             CHECK (name ~ '^[a-z0-9_-]{1,32}$'),
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    file_size    BIGINT      NOT NULL
                             CONSTRAINT custom_emoji_max_size CHECK (file_size <= 262144),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT custom_emojis_server_name_unique UNIQUE (server_id, name)
);

CREATE INDEX custom_emojis_server_idx ON custom_emojis (server_id);
```

- [ ] **Step 2: Apply migration**

```bash
cd server && sqlx migrate run
```

Expected: `Applied 20260314000001/migrate custom_emojis`

- [ ] **Step 3: Commit**

```bash
git add server/migrations/20260314000001_custom_emojis.sql
git commit -m "feat(db): add custom_emojis table"
```

---

### Task 2: Backend models

**Files:**

- Modify: `server/src/models/mod.rs`

- [ ] **Step 1: Add after the `Attachment` struct block**

```rust
// ── Custom Emojis ────────────────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct CustomEmoji {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    pub filename: String,
    pub content_type: String,
    pub file_size: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, serde::Serialize)]
pub struct CustomEmojiDto {
    pub id: Uuid,
    pub server_id: Uuid,
    pub created_by: Uuid,
    pub name: String,
    /// URL to fetch the image: `/emojis/{id}`
    pub url: String,
    pub content_type: String,
    pub file_size: i64,
    pub created_at: DateTime<Utc>,
}

impl CustomEmojiDto {
    pub fn from_row(row: CustomEmoji) -> Self {
        let url = format!("/emojis/{}", row.id);
        Self {
            url,
            id: row.id,
            server_id: row.server_id,
            created_by: row.created_by,
            name: row.name,
            filename: row.filename,
            content_type: row.content_type,
            file_size: row.file_size,
            created_at: row.created_at,
        }
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd server && cargo check 2>&1 | grep "^error"
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add server/src/models/mod.rs
git commit -m "feat(models): add CustomEmoji and CustomEmojiDto"
```

---

### Task 3: Permission helper

**Files:**

- Modify: `server/src/handlers/shared.rs`

- [ ] **Step 1: Append `require_manage_emojis` at bottom of shared.rs**

```rust
/// Verify the user can manage custom emojis for the server.
///
/// Grants access if the user is the server owner, or if any of their roles
/// carry the ADMINISTRATOR (bit 13) permission.
pub async fn require_manage_emojis(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    let is_owner: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)")
            .bind(server_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    if is_owner {
        return Ok(());
    }

    let has_perm: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.user_id = $1
               AND mr.server_id = $2
               AND (r.permissions & $3 != 0)
         )",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(PERMISSION_ADMINISTRATOR)
    .fetch_one(pool)
    .await?;

    if has_perm {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "You need the Administrator permission to manage custom emojis".into(),
        ))
    }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd server && cargo check 2>&1 | grep "^error"
```

- [ ] **Step 3: Commit**

```bash
git add server/src/handlers/shared.rs
git commit -m "feat(auth): add require_manage_emojis permission helper"
```

---

### Task 4: WebSocket event constants

**Files:**

- Modify: `server/src/websocket/events.rs`

- [ ] **Step 1: Add two constants after `EVENT_MESSAGE_UNPIN`**

```rust
pub const EVENT_CUSTOM_EMOJI_CREATE: &str = "CUSTOM_EMOJI_CREATE";
pub const EVENT_CUSTOM_EMOJI_DELETE: &str = "CUSTOM_EMOJI_DELETE";
```

- [ ] **Step 2: Verify + commit**

```bash
cd server && cargo check 2>&1 | grep "^error"
git add server/src/websocket/events.rs
git commit -m "feat(ws): add CUSTOM_EMOJI_CREATE and CUSTOM_EMOJI_DELETE event constants"
```

---

### Task 5: Custom emoji handler

**Files:**

- Create: `server/src/handlers/custom_emojis.rs`

- [ ] **Step 1: Write the full handler file**

```rust
use axum::{
    body::Body,
    extract::{Multipart, Path, State},
    http::{header, StatusCode},
    response::Response,
    Json,
};
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

const MAX_EMOJI_SIZE: usize = 262_144; // 256 KB
const MAX_EMOJIS_PER_SERVER: i64 = 50;
const ALLOWED_EMOJI_MIME_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
];

fn validate_emoji_name(name: &str) -> AppResult<()> {
    if name.is_empty() || name.len() > 32 {
        return Err(AppError::Validation("Emoji name must be 1-32 characters".into()));
    }
    if !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-') {
        return Err(AppError::Validation(
            "Emoji name may only contain lowercase letters, digits, underscores, and hyphens".into(),
        ));
    }
    Ok(())
}

/// GET /servers/:server_id/emojis
pub async fn list_custom_emojis(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
) -> AppResult<Json<Vec<CustomEmojiDto>>> {
    require_member(&state.pool, server_id, auth.user_id()).await?;

    let rows = sqlx::query_as::<_, CustomEmoji>(
        "SELECT id, server_id, created_by, name, filename, content_type, file_size, created_at
         FROM custom_emojis WHERE server_id = $1 ORDER BY created_at ASC",
    )
    .bind(server_id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(rows.into_iter().map(CustomEmojiDto::from_row).collect()))
}

/// POST /servers/:server_id/emojis
/// Multipart fields: `name` (text) + `image` (file).
pub async fn upload_custom_emoji(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(server_id): Path<Uuid>,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<CustomEmojiDto>)> {
    fetch_server(&state.pool, server_id).await?;
    require_manage_emojis(&state.pool, server_id, auth.user_id()).await?;

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

    let mut name_field: Option<String> = None;
    let mut image_data: Option<Vec<u8>> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(error = ?e, "Failed to read multipart field");
        AppError::Validation("Invalid multipart data".into())
    })? {
        match field.name().unwrap_or("") {
            "name" => {
                let text = field
                    .text()
                    .await
                    .map_err(|_| AppError::Validation("Failed to read name field".into()))?;
                name_field = Some(text);
            }
            "image" => {
                let data = field
                    .bytes()
                    .await
                    .map_err(|_| AppError::Validation("Failed to read image field".into()))?;
                image_data = Some(data.to_vec());
            }
            _ => {}
        }
    }

    let name =
        name_field.ok_or_else(|| AppError::Validation("Missing 'name' field".into()))?;
    let data =
        image_data.ok_or_else(|| AppError::Validation("Missing 'image' field".into()))?;

    validate_emoji_name(&name)?;

    if data.is_empty() {
        return Err(AppError::Validation("Image must not be empty".into()));
    }
    if data.len() > MAX_EMOJI_SIZE {
        return Err(AppError::Validation(
            "Custom emoji image must be 256 KB or smaller".into(),
        ));
    }

    let mime_type = match infer::get(&data) {
        Some(t) => t.mime_type().to_string(),
        None => {
            return Err(AppError::Validation(
                "Could not determine file type. Upload a JPEG, PNG, GIF, or WebP image.".into(),
            ));
        }
    };

    if !ALLOWED_EMOJI_MIME_TYPES.contains(&mime_type.as_str()) {
        return Err(AppError::Validation(
            "Custom emojis must be JPEG, PNG, GIF, or WebP images".into(),
        ));
    }

    let ext = match mime_type.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    };

    let emoji_id = Uuid::new_v4();
    let stored_filename = format!("{}.{}", Uuid::new_v4().simple(), ext);

    let dir = state
        .upload_dir
        .join("custom_emojis")
        .join(emoji_id.to_string());

    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?dir, "Failed to create custom_emojis dir");
        AppError::Internal
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).await;
    }

    let file_path = dir.join(&stored_filename);
    tokio::fs::write(&file_path, &data).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?file_path, "Failed to write custom emoji file");
        AppError::Internal
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ =
            tokio::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o644)).await;
    }

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
    .bind(data.len() as i64)
    .fetch_one(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            let _ = tokio::fs::remove_file(&file_path).await;
            let _ = tokio::fs::remove_dir(&dir).await;
            if let Some(db_err) = e.as_database_error() {
                if db_err.constraint() == Some("custom_emojis_server_name_unique") {
                    return Err(AppError::Validation(format!(
                        "An emoji named '{}' already exists in this server",
                        name
                    )));
                }
            }
            return Err(AppError::from(e));
        }
    };

    let dto = CustomEmojiDto::from_row(row);

    broadcast_to_server(
        &state,
        server_id,
        EVENT_CUSTOM_EMOJI_CREATE,
        serde_json::to_value(&dto).unwrap_or_default(),
    )
    .await;

    Ok((StatusCode::CREATED, Json(dto)))
}

/// DELETE /servers/:server_id/emojis/:emoji_id
pub async fn delete_custom_emoji(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((server_id, emoji_id)): Path<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    fetch_server(&state.pool, server_id).await?;
    require_manage_emojis(&state.pool, server_id, auth.user_id()).await?;

    let row = sqlx::query_as::<_, CustomEmoji>(
        "DELETE FROM custom_emojis
         WHERE id = $1 AND server_id = $2
         RETURNING id, server_id, created_by, name, filename, content_type, file_size, created_at",
    )
    .bind(emoji_id)
    .bind(server_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Custom emoji not found".into()))?;

    let dir = state
        .upload_dir
        .join("custom_emojis")
        .join(row.id.to_string());
    if let Err(e) = tokio::fs::remove_file(dir.join(&row.filename)).await {
        tracing::warn!(error = ?e, "Failed to delete custom emoji file");
    }
    if let Err(e) = tokio::fs::remove_dir(&dir).await {
        tracing::warn!(error = ?e, "Failed to remove custom emoji dir");
    }

    broadcast_to_server(
        &state,
        server_id,
        EVENT_CUSTOM_EMOJI_DELETE,
        serde_json::json!({ "server_id": server_id, "emoji_id": emoji_id }),
    )
    .await;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /emojis/:emoji_id — serve image, no auth required.
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
    .ok_or_else(|| AppError::NotFound("Custom emoji not found".into()))?;

    let file_path = state
        .upload_dir
        .join("custom_emojis")
        .join(row.id.to_string())
        .join(&row.filename);

    let file = File::open(&file_path).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?file_path, "Failed to open custom emoji file");
        AppError::NotFound("Custom emoji image not found".into())
    })?;

    let body = Body::from_stream(ReaderStream::new(file));

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, row.content_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(body)
        .expect("infallible"))
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd server && cargo check 2>&1 | grep "^error"
```

Expected: no errors (`infer` crate is already a dependency via attachments.rs)

---

### Task 6: Wire backend routes + module

**Files:**

- Modify: `server/src/handlers/mod.rs`
- Modify: `server/src/main.rs`

- [ ] **Step 1: Add module declaration to handlers/mod.rs** (after `pub mod channels;`)

```rust
pub mod custom_emojis;
```

- [ ] **Step 2: Add routes to main.rs** (after the `/servers/:id/events` route)

```rust
.route(
    "/servers/:id/emojis",
    get(handlers::custom_emojis::list_custom_emojis)
        .post(handlers::custom_emojis::upload_custom_emoji),
)
.route(
    "/servers/:id/emojis/:emoji_id",
    delete(handlers::custom_emojis::delete_custom_emoji),
)
.route(
    "/emojis/:emoji_id",
    get(handlers::custom_emojis::serve_custom_emoji_image),
)
```

- [ ] **Step 3: Full compile + lint check**

```bash
cd server && cargo clippy -- -D warnings 2>&1 | grep "^error"
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add server/src/handlers/mod.rs server/src/handlers/custom_emojis.rs server/src/main.rs
git commit -m "feat(api): add custom emoji CRUD endpoints and image serving"
```

---

### Task 7: Backend integration tests

**Files:**

- Create: `server/tests/custom_emojis.rs`

Check `ls server/tests/` first. If common helpers (`register_and_get_token`, `create_server`) exist, use them; otherwise adapt tests to match the actual helper API.

- [ ] **Step 1: Write tests**

```rust
mod common;

use axum::http::StatusCode;
use common::{create_server, register_and_get_token, unique_username};

/// 1x1 transparent PNG for testing — real magic bytes so infer detects "image/png".
fn tiny_png() -> Vec<u8> {
    vec![
        0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,
        0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
        0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
        0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
        0x89,0x00,0x00,0x00,0x0b,0x49,0x44,0x41,
        0x54,0x08,0xd7,0x63,0x60,0x00,0x00,0x00,
        0x02,0x00,0x01,0xe2,0x21,0xbc,0x33,0x00,
        0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,
        0x42,0x60,0x82,
    ]
}

#[sqlx::test(migrations = "migrations")]
async fn upload_and_list(pool: sqlx::PgPool) {
    let app = common::build_app(pool).await;
    let token = register_and_get_token(&app, &unique_username()).await;
    let server_id = create_server(&app, &token, "Test").await;

    let form = reqwest::multipart::Form::new()
        .text("name", "my_emoji")
        .part(
            "image",
            reqwest::multipart::Part::bytes(tiny_png())
                .file_name("e.png")
                .mime_str("image/png")
                .unwrap(),
        );

    let resp = app
        .post(&format!("/servers/{server_id}/emojis"))
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await;
    assert_eq!(resp.status(), StatusCode::CREATED);
    let body: serde_json::Value = resp.json().await;
    assert_eq!(body["name"], "my_emoji");
    assert!(body["url"].as_str().unwrap().starts_with("/emojis/"));

    let list: Vec<serde_json::Value> = app
        .get(&format!("/servers/{server_id}/emojis"))
        .bearer_auth(&token)
        .send()
        .await
        .json()
        .await;
    assert_eq!(list.len(), 1);
}

#[sqlx::test(migrations = "migrations")]
async fn duplicate_name_rejected(pool: sqlx::PgPool) {
    let app = common::build_app(pool).await;
    let token = register_and_get_token(&app, &unique_username()).await;
    let server_id = create_server(&app, &token, "Test").await;

    let upload = || {
        let form = reqwest::multipart::Form::new()
            .text("name", "dupe")
            .part(
                "image",
                reqwest::multipart::Part::bytes(tiny_png())
                    .file_name("e.png")
                    .mime_str("image/png")
                    .unwrap(),
            );
        app.post(&format!("/servers/{server_id}/emojis"))
            .bearer_auth(&token)
            .multipart(form)
            .send()
    };

    assert_eq!(upload().await.status(), StatusCode::CREATED);
    assert_eq!(upload().await.status(), StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "migrations")]
async fn delete_emoji(pool: sqlx::PgPool) {
    let app = common::build_app(pool).await;
    let token = register_and_get_token(&app, &unique_username()).await;
    let server_id = create_server(&app, &token, "Test").await;

    let form = reqwest::multipart::Form::new()
        .text("name", "todelete")
        .part(
            "image",
            reqwest::multipart::Part::bytes(tiny_png())
                .file_name("e.png")
                .mime_str("image/png")
                .unwrap(),
        );
    let body: serde_json::Value = app
        .post(&format!("/servers/{server_id}/emojis"))
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await
        .json()
        .await;
    let emoji_id = body["id"].as_str().unwrap();

    let del = app
        .delete(&format!("/servers/{server_id}/emojis/{emoji_id}"))
        .bearer_auth(&token)
        .send()
        .await;
    assert_eq!(del.status(), StatusCode::NO_CONTENT);

    let list: Vec<serde_json::Value> = app
        .get(&format!("/servers/{server_id}/emojis"))
        .bearer_auth(&token)
        .send()
        .await
        .json()
        .await;
    assert!(list.is_empty());
}

#[sqlx::test(migrations = "migrations")]
async fn non_member_cannot_list(pool: sqlx::PgPool) {
    let app = common::build_app(pool).await;
    let owner_token = register_and_get_token(&app, &unique_username()).await;
    let outsider_token = register_and_get_token(&app, &unique_username()).await;
    let server_id = create_server(&app, &owner_token, "Private").await;

    let resp = app
        .get(&format!("/servers/{server_id}/emojis"))
        .bearer_auth(&outsider_token)
        .send()
        .await;
    // require_member returns 404 to avoid leaking server existence
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}
```

- [ ] **Step 2: Run tests** (requires `TEST_DATABASE_URL`)

```bash
cd server && cargo test custom_emojis 2>&1 | tail -20
```

Expected: 4 tests pass

- [ ] **Step 3: Commit**

```bash
git add server/tests/custom_emojis.rs
git commit -m "test(api): add custom emoji integration tests"
```

---

## Chunk 2: Frontend Store + API

### Task 8: TypeScript type + API client

**Files:**

- Modify: `clients/web/src/types/index.ts`
- Modify: `clients/web/src/api/client.ts`

- [ ] **Step 1: Add interface to types/index.ts** (after `ReactionCount`)

```typescript
export interface CustomEmoji {
  id: string;
  server_id: string;
  created_by: string;
  name: string;
  /** Absolute path served by the API: /emojis/{id} */
  url: string;
  content_type: string;
  file_size: number;
  created_at: string;
}
```

- [ ] **Step 2: Add API methods to api/client.ts**

Before the `addReaction` method, add:

```typescript
// ── Custom Emojis ────────────────────────────────────────────────────────────

async listCustomEmojis(serverId: string): Promise<CustomEmoji[]> {
  const res = await this.fetch(`/servers/${serverId}/emojis`);
  if (!res.ok) throw new Error("Failed to list custom emojis");
  return res.json();
}

async uploadCustomEmoji(
  serverId: string,
  name: string,
  file: File,
): Promise<CustomEmoji> {
  const form = new FormData();
  form.append("name", name);
  form.append("image", file);
  // Do NOT set Content-Type header — browser sets it with the multipart boundary.
  const res = await this.fetch(`/servers/${serverId}/emojis`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Upload failed" }));
    throw new Error((err as { message?: string }).message ?? "Upload failed");
  }
  return res.json();
}

async deleteCustomEmoji(serverId: string, emojiId: string): Promise<void> {
  const res = await this.fetch(`/servers/${serverId}/emojis/${emojiId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete custom emoji");
}
```

- [ ] **Step 3: Add `CustomEmoji` to import in api/client.ts** if types are imported at the top.

- [ ] **Step 4: TypeScript check**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
```

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/types/index.ts clients/web/src/api/client.ts
git commit -m "feat(api): add CustomEmoji type and client methods"
```

---

### Task 9: customEmojiStore

**Files:**

- Create: `clients/web/src/stores/customEmojiStore.ts`

- [ ] **Step 1: Write store**

```typescript
import { create } from "zustand";
import { api } from "../api/client";
import type { CustomEmoji } from "../types";

interface CustomEmojiState {
  /** Map from server_id to emoji list */
  emojis: Record<string, CustomEmoji[]>;
  getEmojis: (serverId: string) => CustomEmoji[];
  /** Load emojis for a server (no-op if already loaded). */
  loadEmojis: (serverId: string) => Promise<void>;
  /** Force re-fetch. Used after upload/delete. */
  refreshEmojis: (serverId: string) => Promise<void>;
  /** Called from WS CUSTOM_EMOJI_CREATE. */
  addEmoji: (emoji: CustomEmoji) => void;
  /** Called from WS CUSTOM_EMOJI_DELETE. */
  removeEmoji: (serverId: string, emojiId: string) => void;
}

export const useCustomEmojiStore = create<CustomEmojiState>((set, get) => ({
  emojis: {},

  getEmojis: (serverId) => get().emojis[serverId] ?? [],

  loadEmojis: async (serverId) => {
    if (get().emojis[serverId] !== undefined) return;
    await get().refreshEmojis(serverId);
  },

  refreshEmojis: async (serverId) => {
    try {
      const list = await api.listCustomEmojis(serverId);
      set((s) => ({ emojis: { ...s.emojis, [serverId]: list } }));
    } catch (e) {
      console.warn("[customEmojiStore] Failed to load emojis for", serverId, e);
    }
  },

  addEmoji: (emoji) => {
    set((s) => {
      const current = s.emojis[emoji.server_id] ?? [];
      if (current.some((e) => e.id === emoji.id)) return s;
      return {
        emojis: { ...s.emojis, [emoji.server_id]: [...current, emoji] },
      };
    });
  },

  removeEmoji: (serverId, emojiId) => {
    set((s) => {
      const current = s.emojis[serverId];
      if (!current) return s;
      return {
        emojis: {
          ...s.emojis,
          [serverId]: current.filter((e) => e.id !== emojiId),
        },
      };
    });
  },
}));
```

- [ ] **Step 2: Wire WS events**

Find the WebSocket message handler (search for `REACTION_ADD` handling in `clients/web/src/`). In the same dispatch block, add:

```typescript
case "CUSTOM_EMOJI_CREATE": {
  useCustomEmojiStore.getState().addEmoji(data.d as CustomEmoji);
  break;
}
case "CUSTOM_EMOJI_DELETE": {
  const { server_id, emoji_id } = data.d as { server_id: string; emoji_id: string };
  useCustomEmojiStore.getState().removeEmoji(server_id, emoji_id);
  break;
}
```

Add imports at top: `import { useCustomEmojiStore } from "../stores/customEmojiStore";` and `import type { CustomEmoji } from "../types";`.

- [ ] **Step 3: Load emojis on server select**

Find where `activeServerId` changes (likely a `useEffect` in `App.tsx` or `ChannelLayout.tsx`) and add:

```typescript
import { useCustomEmojiStore } from "./stores/customEmojiStore";
// ...
useEffect(() => {
  if (activeServerId) {
    useCustomEmojiStore.getState().loadEmojis(activeServerId);
  }
}, [activeServerId]);
```

- [ ] **Step 4: TypeScript check + commit**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
git add clients/web/src/stores/customEmojiStore.ts
git commit -m "feat(store): add customEmojiStore with WS event handling"
```

---

## Chunk 3: Frontend Components

### Task 10: Extend emoji utils

**Files:**

- Modify: `clients/web/src/utils/emoji.ts`

- [ ] **Step 1: Extend `EmojiEntry` interface** (edit the existing definition at the top of emoji.ts)

```typescript
export interface EmojiEntry {
  /** Unicode char for standard emojis. ':name:' literal for custom emojis. */
  emoji: string;
  name: string;
  aliases?: string[];
  /** Set for custom emojis — image URL for display. */
  imageUrl?: string;
  /** Set for custom emojis — UUID used in reaction storage format `c:{uuid}`. */
  customEmojiId?: string;
}
```

- [ ] **Step 2: Add `searchAllEmoji` after `searchEmoji`**

```typescript
/**
 * Search custom + standard emojis combined. Custom emojis appear first.
 *
 * Custom emoji EmojiEntry: emoji=':name:', imageUrl=url, customEmojiId=uuid.
 * Standard emoji EmojiEntry: emoji=unicode char (unchanged).
 */
export function searchAllEmoji(
  query: string,
  customEmojis: { id: string; name: string; url: string }[],
  limit = 20,
): EmojiEntry[] {
  const q = query.toLowerCase();
  const results: EmojiEntry[] = [];

  for (const ce of customEmojis) {
    if (ce.name.includes(q)) {
      results.push({
        emoji: `:${ce.name}:`,
        name: ce.name,
        imageUrl: ce.url,
        customEmojiId: ce.id,
      });
      if (results.length >= limit) return results;
    }
  }

  const remaining = limit - results.length;
  return [...results, ...searchEmoji(q, remaining)].slice(0, limit);
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
git add clients/web/src/utils/emoji.ts
git commit -m "feat(emoji): extend EmojiEntry for custom emojis, add searchAllEmoji"
```

---

### Task 11: Update EmojiPicker (reactions)

**Files:**

- Modify: `clients/web/src/components/messages/EmojiPicker.tsx`
- Modify: `clients/web/src/components/messages/EmojiPicker.module.css`
- Modify: `clients/web/src/components/messages/ReactionBar.tsx` (add `serverId` prop)
- Modify: `clients/web/src/components/messages/MessageItem.tsx` (pass `serverId`)

When a custom emoji is selected, `onSelect` receives `c:{emoji_id}` — the reaction storage format.

- [ ] **Step 1: Rewrite EmojiPicker.tsx**

```tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { EMOJI_CATEGORIES, searchEmoji } from "../../utils/emoji";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import styles from "./EmojiPicker.module.css";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  serverId?: string;
}

export function EmojiPicker({ onSelect, onClose, serverId }: EmojiPickerProps) {
  const customEmojis = useCustomEmojiStore((s) =>
    serverId ? s.getEmojis(serverId) : [],
  );
  const hasCustom = customEmojis.length > 0;

  // -1 = custom tab; 0+ = standard category index
  const [activeCat, setActiveCat] = useState(() => (hasCustom ? -1 : 0));
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji);
      onClose();
    },
    [onSelect, onClose],
  );

  const searchResults = query.trim() ? searchEmoji(query, 60) : null;
  const customSearchResults = query.trim()
    ? customEmojis.filter((ce) => ce.name.includes(query.toLowerCase()))
    : [];

  const displayCat = activeCat >= 0 ? EMOJI_CATEGORIES[activeCat] : null;

  return (
    <div ref={containerRef} className={styles.picker}>
      <div className={styles.searchRow}>
        <input
          ref={searchRef}
          className={styles.search}
          type="text"
          placeholder="Search emoji…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!searchResults && (
        <div className={styles.tabs}>
          {hasCustom && (
            <button
              className={`${styles.tab} ${activeCat === -1 ? styles.tabActive : ""}`}
              onClick={() => setActiveCat(-1)}
              title="Custom"
            >
              ★
            </button>
          )}
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.label}
              className={`${styles.tab} ${i === activeCat ? styles.tabActive : ""}`}
              onClick={() => setActiveCat(i)}
              title={cat.label}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      <div className={styles.grid}>
        {searchResults ? (
          <>
            {customSearchResults.map((ce) => (
              <button
                key={ce.id}
                className={styles.emojiBtn}
                onClick={() => handleSelect(`c:${ce.id}`)}
                title={`:${ce.name}:`}
              >
                <img
                  src={ce.url}
                  alt={ce.name}
                  className={styles.customEmojiThumb}
                />
              </button>
            ))}
            {searchResults.length > 0 ? (
              searchResults.map((entry) => (
                <button
                  key={entry.emoji + entry.name}
                  className={styles.emojiBtn}
                  onClick={() => handleSelect(entry.emoji)}
                  title={`:${entry.name}:`}
                >
                  {entry.emoji}
                </button>
              ))
            ) : customSearchResults.length === 0 ? (
              <div className={styles.noResults}>No results</div>
            ) : null}
          </>
        ) : activeCat === -1 ? (
          customEmojis.map((ce) => (
            <button
              key={ce.id}
              className={styles.emojiBtn}
              onClick={() => handleSelect(`c:${ce.id}`)}
              title={`:${ce.name}:`}
            >
              <img
                src={ce.url}
                alt={ce.name}
                className={styles.customEmojiThumb}
              />
            </button>
          ))
        ) : displayCat ? (
          displayCat.emojis.map((entry) => (
            <button
              key={entry.emoji + entry.name}
              className={styles.emojiBtn}
              onClick={() => handleSelect(entry.emoji)}
              title={`:${entry.name}:`}
            >
              {entry.emoji}
            </button>
          ))
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to EmojiPicker.module.css**

```css
.customEmojiThumb {
  width: 24px;
  height: 24px;
  object-fit: contain;
  image-rendering: pixelated;
}
```

- [ ] **Step 3: Add `serverId?: string` to ReactionBarProps and thread it to EmojiPicker**

In `ReactionBar.tsx`:

- Add `serverId?: string` to the interface
- Pass `serverId={serverId}` to the `<EmojiPicker>` and `<EmojiDisplay>` components

- [ ] **Step 4: Add `serverId` to the quick-react EmojiPicker in MessageItem.tsx**

Find the `<EmojiPicker onSelect={handleQuickReact}` usage (~line 641) and add `serverId={serverId}`.
`MessageItem` needs to know the `serverId` — check if it already has it via props or a store; pass it in.

- [ ] **Step 5: TypeScript check + commit**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
git add clients/web/src/components/messages/EmojiPicker.tsx \
        clients/web/src/components/messages/EmojiPicker.module.css \
        clients/web/src/components/messages/ReactionBar.tsx \
        clients/web/src/components/messages/MessageItem.tsx
git commit -m "feat(picker): add custom emoji tab to EmojiPicker, thread serverId"
```

---

### Task 12: Update EmojiAutocomplete

**Files:**

- Modify: `clients/web/src/components/messages/EmojiAutocomplete.tsx`
- Modify: `clients/web/src/components/messages/MessageInput.tsx`

When a custom emoji is selected, `applyEmoji` receives `:name:` which gets inserted literally into the message text.

- [ ] **Step 1: Rewrite EmojiAutocomplete.tsx**

```tsx
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import { searchAllEmoji } from "../../utils/emoji";
import styles from "./EmojiAutocomplete.module.css";

interface EmojiAutocompleteProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  activeIndex: number;
  serverId?: string;
}

export function EmojiAutocomplete({
  query,
  onSelect,
  activeIndex,
  serverId,
}: EmojiAutocompleteProps) {
  const customEmojis = useCustomEmojiStore((s) =>
    serverId ? s.getEmojis(serverId) : [],
  );
  const results = searchAllEmoji(query, customEmojis, 8);

  if (results.length === 0) return null;

  return (
    <div
      className={styles.dropdown}
      role="listbox"
      aria-label="Emoji suggestions"
    >
      {results.map((entry, i) => (
        <div
          key={entry.customEmojiId ?? entry.name}
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row} ${i === activeIndex ? styles.active : ""}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entry.emoji); // ':name:' for custom, unicode char for standard
          }}
        >
          {entry.imageUrl ? (
            <img
              src={entry.imageUrl}
              alt={entry.name}
              className={styles.emojiChar}
              style={{ width: 20, height: 20, objectFit: "contain" }}
            />
          ) : (
            <span className={styles.emojiChar}>{entry.emoji}</span>
          )}
          <span className={styles.emojiName}>:{entry.name}:</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Pass `serverId` from MessageInput to EmojiAutocomplete**

In `MessageInput.tsx`, add `serverId?: string` to props and pass it:

```tsx
<EmojiAutocomplete
  query={emojiQuery}
  activeIndex={emojiActiveIdx}
  onSelect={applyEmoji}
  onClose={() => setEmojiQuery(null)}
  serverId={serverId}
/>
```

Find all places that use `<MessageInput>` and ensure `serverId` is passed from the parent.

- [ ] **Step 3: TypeScript check + commit**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
git add clients/web/src/components/messages/EmojiAutocomplete.tsx \
        clients/web/src/components/messages/MessageInput.tsx
git commit -m "feat(autocomplete): show custom emojis in emoji autocomplete"
```

---

### Task 13: Render custom emoji in message text

**Files:**

- Modify: `clients/web/src/components/messages/MessageItem.tsx`

Message text may contain `:name:` patterns. After `parseEmoji` converts known unicode names, any remaining `:name:` patterns that match server custom emojis should render as `<img>`.

- [ ] **Step 1: Add `serverId` prop to MessageItem** (if not already present)

Add to the component's props interface: `serverId?: string;`

- [ ] **Step 2: Import and use customEmojiStore in MessageItem**

```typescript
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
// inside component body:
const customEmojis = useCustomEmojiStore((s) =>
  serverId ? s.getEmojis(serverId) : [],
);
```

- [ ] **Step 3: Add `splitCustomEmoji` helper above `renderTextLeaf`**

```typescript
import type { CustomEmoji } from "../../types";

/**
 * Split a string on :custom_name: patterns, returning React nodes with
 * <img> nodes substituted for matched custom emoji names.
 * Call after parseEmoji() so only unresolved :name: patterns remain.
 */
function splitCustomEmoji(
  text: string,
  customEmojis: CustomEmoji[],
  keyPrefix: string,
): React.ReactNode[] {
  if (customEmojis.length === 0) return [text];
  const nameMap = new Map(customEmojis.map((e) => [e.name, e]));
  const pattern = /:([a-z0-9_-]+):/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = pattern.exec(text)) !== null) {
    const ce = nameMap.get(match[1]);
    if (!ce) continue;
    if (match.index > last) nodes.push(text.slice(last, match.index));
    nodes.push(
      <img
        key={`${keyPrefix}-ce${idx++}`}
        src={ce.url}
        alt={`:${ce.name}:`}
        title={`:${ce.name}:`}
        className={styles.customEmojiInline}
      />,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
```

- [ ] **Step 4: Update `renderTextLeaf` signature to accept `customEmojis`**

Change the signature:

```typescript
function renderTextLeaf(
  text: string,
  members: MemberDto[],
  currentUserId: string | null,
  keyPrefix: string,
  customEmojis: CustomEmoji[] = [],
): React.ReactNode[];
```

Replace the plain `result.push(chunk)` line inside the `@mention` handling with:

```typescript
result.push(...splitCustomEmoji(chunk, customEmojis, `${keyPrefix}-${i}-${j}`));
```

- [ ] **Step 5: Thread `customEmojis` through `renderSegments` and `renderContent`**

`renderSegments` calls `renderTextLeaf` — add `customEmojis` param and pass it through.
`renderContent` calls `renderSegments` — add `customEmojis` param.

- [ ] **Step 6: Pass `customEmojis` to `renderContent` in the `useMemo`**

```typescript
const { nodes: contentNodes, firstLinkUrl } = useMemo(
  () =>
    message.content !== "\u200b"
      ? renderContent(message.content, members, user?.id ?? null, customEmojis)
      : { nodes: [], firstLinkUrl: null },
  [message.content, message.id, user?.id, customEmojis],
);
```

- [ ] **Step 7: Add CSS to MessageItem.module.css**

```css
.customEmojiInline {
  display: inline;
  width: 1.375em;
  height: 1.375em;
  vertical-align: -0.3em;
  object-fit: contain;
}
```

- [ ] **Step 8: TypeScript check**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
```

There will be cascading type errors from the signature changes — fix them all.

- [ ] **Step 9: Commit**

```bash
git add clients/web/src/components/messages/MessageItem.tsx
git commit -m "feat(render): render :name: custom emoji as inline images in messages"
```

---

### Task 14: Render custom emoji reactions

**Files:**

- Modify: `clients/web/src/components/messages/ReactionBar.tsx`
- Modify: `clients/web/src/components/messages/ReactionBar.module.css`

- [ ] **Step 1: Rewrite ReactionBar.tsx**

Replace the `<span className={styles.emoji}>{r.emoji}</span>` rendering with a helper component that checks for the `c:` prefix.

Add `EmojiDisplay` inside the file (or at the top of the component):

```tsx
import { useCustomEmojiStore } from "../../stores/customEmojiStore";

function EmojiDisplay({
  emoji,
  serverId,
}: {
  emoji: string;
  serverId?: string;
}) {
  const customEmojis = useCustomEmojiStore((s) =>
    serverId ? s.getEmojis(serverId) : [],
  );
  if (emoji.startsWith("c:")) {
    const id = emoji.slice(2);
    const ce = customEmojis.find((e) => e.id === id);
    if (ce) {
      return (
        <img
          src={ce.url}
          alt={`:${ce.name}:`}
          title={`:${ce.name}:`}
          className={styles.customEmojiReaction}
        />
      );
    }
    return (
      <span className={styles.emoji} title={emoji}>
        ?
      </span>
    );
  }
  return <span className={styles.emoji}>{emoji}</span>;
}
```

In the button rendering, replace:

```tsx
<span className={styles.emoji}>{r.emoji}</span>
```

with:

```tsx
<EmojiDisplay emoji={r.emoji} serverId={serverId} />
```

- [ ] **Step 2: Add CSS**

```css
.customEmojiReaction {
  width: 18px;
  height: 18px;
  object-fit: contain;
  vertical-align: middle;
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
git add clients/web/src/components/messages/ReactionBar.tsx \
        clients/web/src/components/messages/ReactionBar.module.css
git commit -m "feat(reactions): render custom emoji reactions as images"
```

---

## Chunk 4: Emoji Manager UI

### Task 15: CustomEmojiManager component

**Files:**

- Create: `clients/web/src/components/servers/CustomEmojiManager.tsx`
- Create: `clients/web/src/components/servers/CustomEmojiManager.module.css`

- [ ] **Step 1: Write the component**

```tsx
import { useState, useRef, type FormEvent } from "react";
import { Trash2, Upload } from "lucide-react";
import { api } from "../../api/client";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import type { ServerDto } from "../../types";
import styles from "./CustomEmojiManager.module.css";

interface CustomEmojiManagerProps {
  server: ServerDto;
}

export function CustomEmojiManager({ server }: CustomEmojiManagerProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { getEmojis, refreshEmojis } = useCustomEmojiStore();
  const emojis = getEmojis(server.id);

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setUploading(true);
    setUploadError("");
    try {
      await api.uploadCustomEmoji(server.id, name.trim(), file);
      await refreshEmojis(server.id);
      setName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (emojiId: string) => {
    try {
      await api.deleteCustomEmoji(server.id, emojiId);
      await refreshEmojis(server.id);
    } catch (err) {
      console.error("[CustomEmojiManager] delete failed", err);
    }
  };

  return (
    <div className={styles.manager}>
      <h3 className={styles.heading}>Custom Emojis</h3>
      <p className={styles.hint}>
        JPEG, PNG, GIF, or WebP · max 256 KB · max 50 per server · name:
        lowercase letters, digits, underscores, hyphens
      </p>

      <form onSubmit={handleUpload} className={styles.uploadForm}>
        <input
          className={styles.nameInput}
          type="text"
          placeholder="emoji_name"
          value={name}
          onChange={(e) =>
            setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
          }
          maxLength={32}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className={styles.fileInput}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="submit"
          className={styles.uploadBtn}
          disabled={!file || !name.trim() || uploading}
        >
          <Upload size={14} />
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>
      {uploadError && <div className={styles.error}>{uploadError}</div>}

      {emojis.length === 0 ? (
        <p className={styles.empty}>No custom emojis yet.</p>
      ) : (
        <div className={styles.list}>
          {emojis.map((ce) => (
            <div key={ce.id} className={styles.row}>
              <img src={ce.url} alt={ce.name} className={styles.preview} />
              <span className={styles.emName}>:{ce.name}:</span>
              <button
                className={styles.deleteBtn}
                onClick={() => handleDelete(ce.id)}
                title={`Delete :${ce.name}:`}
                aria-label={`Delete :${ce.name}:`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write CSS module**

```css
.manager {
  margin-top: 20px;
}

.heading {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #72767d);
  margin: 0 0 8px;
}

.hint {
  font-size: 0.8125rem;
  color: var(--text-muted, #72767d);
  margin: 0 0 12px;
}

.uploadForm {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.nameInput {
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid var(--input-border, #202225);
  background: var(--input-bg, #40444b);
  color: var(--text-normal, #dcddde);
  font-size: 0.875rem;
  width: 160px;
}

.fileInput {
  font-size: 0.8125rem;
  color: var(--text-normal, #dcddde);
}

.uploadBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 4px;
  background: var(--brand, #5865f2);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
}
.uploadBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  color: var(--status-danger, #ed4245);
  font-size: 0.8125rem;
  margin-bottom: 8px;
}

.empty {
  color: var(--text-muted, #72767d);
  font-size: 0.875rem;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--bg-secondary, #2f3136);
}

.preview {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.emName {
  flex: 1;
  font-size: 0.875rem;
  color: var(--text-normal, #dcddde);
  font-family: monospace;
}

.deleteBtn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted, #72767d);
  padding: 4px;
  border-radius: 3px;
  display: flex;
  align-items: center;
}
.deleteBtn:hover {
  color: var(--status-danger, #ed4245);
  background: var(--bg-modifier-hover, #36393f);
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
cd clients/web && npm run typecheck 2>&1 | grep "error TS"
git add clients/web/src/components/servers/CustomEmojiManager.tsx \
        clients/web/src/components/servers/CustomEmojiManager.module.css
git commit -m "feat(ui): add CustomEmojiManager component"
```

---

### Task 16: Integrate into ServerSettingsModal

**Files:**

- Modify: `clients/web/src/components/servers/ServerSettingsModal.tsx`

- [ ] **Step 1: Add imports at top of ServerSettingsModal.tsx**

```tsx
import { useEffect } from "react";
import { CustomEmojiManager } from "./CustomEmojiManager";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
```

- [ ] **Step 2: Load emojis when modal opens**

Inside the component body, after the existing state declarations:

```tsx
const { loadEmojis } = useCustomEmojiStore();
useEffect(() => {
  if (open) loadEmojis(server.id);
}, [open, server.id, loadEmojis]);
```

- [ ] **Step 3: Add emoji section after the existing `</form>`**

```tsx
<hr style={{ border: "none", borderTop: "1px solid var(--bg-secondary, #2f3136)", margin: "16px 0" }} />
<CustomEmojiManager server={server} />
```

- [ ] **Step 4: TypeScript check + lint**

```bash
cd clients/web && npm run typecheck && npm run lint 2>&1 | grep -E "^.*error" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/components/servers/ServerSettingsModal.tsx
git commit -m "feat(ui): add custom emoji management to server settings modal"
```

---

## Chunk 5: Tests + Final

### Task 17: Frontend store tests

**Files:**

- Create: `clients/web/src/__tests__/customEmojiStore.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useCustomEmojiStore } from "../stores/customEmojiStore";
import type { CustomEmoji } from "../types";

const mockEmoji: CustomEmoji = {
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  server_id: "server-1",
  created_by: "user-1",
  name: "test_emoji",
  url: "/emojis/aaaaaaaa-0000-0000-0000-000000000001",
  content_type: "image/png",
  file_size: 1024,
  created_at: "2026-03-14T00:00:00Z",
};

beforeEach(() => {
  useCustomEmojiStore.setState({ emojis: {} });
});

describe("customEmojiStore", () => {
  it("addEmoji stores emoji by server_id", () => {
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    const emojis = useCustomEmojiStore.getState().getEmojis("server-1");
    expect(emojis).toHaveLength(1);
    expect(emojis[0].name).toBe("test_emoji");
  });

  it("addEmoji is idempotent", () => {
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    expect(useCustomEmojiStore.getState().getEmojis("server-1")).toHaveLength(
      1,
    );
  });

  it("removeEmoji removes by id", () => {
    useCustomEmojiStore.getState().addEmoji(mockEmoji);
    useCustomEmojiStore.getState().removeEmoji("server-1", mockEmoji.id);
    expect(useCustomEmojiStore.getState().getEmojis("server-1")).toHaveLength(
      0,
    );
  });

  it("getEmojis returns [] for unknown server", () => {
    expect(useCustomEmojiStore.getState().getEmojis("unknown")).toEqual([]);
  });

  it("loadEmojis is a no-op if server already loaded", async () => {
    useCustomEmojiStore.setState({ emojis: { "server-1": [mockEmoji] } });
    const spy = vi.spyOn(useCustomEmojiStore.getState(), "refreshEmojis");
    await useCustomEmojiStore.getState().loadEmojis("server-1");
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd clients/web && npm test -- --run customEmojiStore 2>&1 | tail -20
```

Expected: 5 tests pass

- [ ] **Step 3: Commit**

```bash
git add clients/web/src/__tests__/customEmojiStore.test.ts
git commit -m "test(store): add customEmojiStore unit tests"
```

---

### Task 18: Final verification

- [ ] **Step 1: Full Rust build + lint**

```bash
cd server && cargo clippy -- -D warnings 2>&1 | grep "^error"
```

Expected: no output

- [ ] **Step 2: cargo fmt check**

```bash
cd server && cargo fmt --check
```

If diffs: `cargo fmt && git add -u && git commit -m "chore: rustfmt"`

- [ ] **Step 3: Frontend full check**

```bash
cd clients/web && npm run typecheck && npm run lint && npm test -- --run
```

Expected: no errors, all tests pass

- [ ] **Step 4: Signal completion**

```bash
openclaw system event --text "Done: Custom emojis implemented" --mode now
```

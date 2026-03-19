# User Profiles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bio and pronouns fields to user profiles, enable avatar file uploads, and add a profile view UI — while extending existing settings to edit these fields.

**Architecture:** Add a DB migration for `bio`/`pronouns` columns, extend the Rust `User`/`UserDto` models, add a multipart avatar-upload endpoint (`POST /users/@me/avatar`) and a public profile lookup (`GET /users/:id`), then update the web client types, API client, `UserSettingsModal`, and `MemberSidebar` with a clickable profile card.

**Tech Stack:** Rust/Axum (multipart, sqlx), PostgreSQL migration (sqlx-migrate), React/TypeScript (Zustand, CSS Modules, FileReader API)

---

## Chunk 1: Database + Backend Models + Users Handler

### Task 1: DB migration — add bio and pronouns

**Files:**

- Create: `server/migrations/20240216000016_user_profiles.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration: User Profiles
-- Adds bio and pronouns fields to the users table

ALTER TABLE users
    ADD COLUMN bio TEXT,
    ADD COLUMN pronouns TEXT;

COMMENT ON COLUMN users.bio IS 'Free-form profile bio (up to 500 chars enforced by API)';
COMMENT ON COLUMN users.pronouns IS 'Preferred pronouns display string (up to 64 chars enforced by API)';
```

- [ ] **Step 2: Verify migration file exists and is parseable**

Run: `cd /Volumes/Storage/GitHub/Together/server && cat migrations/20240216000016_user_profiles.sql`
Expected: File content shown without errors.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/20240216000016_user_profiles.sql
git commit -m "feat(db): add bio and pronouns columns to users table"
```

---

### Task 2: Update Rust models for bio + pronouns

**Files:**

- Modify: `server/src/models/mod.rs` — `User`, `UserDto`, `UpdateUserDto`, `MemberDto`

**Context:** `User` is the DB row (not serialized to clients). `UserDto` is the wire format. `UpdateUserDto` is the PATCH body DTO. `MemberDto` is from a JOIN query — skip bio/pronouns there (too verbose for list views).

- [ ] **Step 1: Add fields to `User` struct** (lines 13–24 in models/mod.rs)

Replace:

```rust
#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

With:

```rust
#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Add fields to `UserDto` and its `From<User>` impl**

Replace existing `UserDto` struct and impl (lines 33–57):

```rust
/// Public user shape returned by all API responses.
#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserDto {
    fn from(user: User) -> Self {
        UserDto {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            status: user.status,
            custom_status: user.custom_status,
            bio: user.bio,
            pronouns: user.pronouns,
            created_at: user.created_at,
        }
    }
}
```

- [ ] **Step 3: Add `bio` and `pronouns` to `UpdateUserDto`**

Replace (lines 59–64):

```rust
#[derive(Debug, Deserialize)]
pub struct UpdateUserDto {
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub custom_status: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
}
```

- [ ] **Step 4: Add `PublicProfileDto` (new struct, right after `UpdateUserDto`)**

```rust
/// Public profile for GET /users/:id — omits private fields (email).
#[derive(Debug, Serialize, FromRow)]
pub struct PublicProfileDto {
    pub id: Uuid,
    pub username: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    pub created_at: DateTime<Utc>,
}
```

- [ ] **Step 5: Build to check for compile errors**

Run: `cd /Volumes/Storage/GitHub/Together/server && cargo build 2>&1 | head -40`
Expected: Errors only about models not matching (users handler will need updating — that's next).

- [ ] **Step 6: Commit**

```bash
git add server/src/models/mod.rs
git commit -m "feat(models): add bio, pronouns to User/UserDto/UpdateUserDto; add PublicProfileDto"
```

---

### Task 3: Update users handler — PATCH accepts bio/pronouns, add GET /users/:id

**Files:**

- Modify: `server/src/handlers/users.rs`

- [ ] **Step 1: Add `bio` and `pronouns` to `UpdateUserRequest` validator**

In `handlers/users.rs`, replace `UpdateUserRequest`:

```rust
#[derive(Debug, Deserialize, Validate)]
pub struct UpdateUserRequest {
    /// Must be a valid HTTP(S) URL when provided.
    #[validate(url)]
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    /// Free-form status text; capped at 128 characters.
    #[validate(length(max = 128))]
    pub custom_status: Option<String>,
    /// Profile bio; capped at 500 characters.
    #[validate(length(max = 500))]
    pub bio: Option<String>,
    /// Pronouns display string; capped at 64 characters.
    #[validate(length(max = 64))]
    pub pronouns: Option<String>,
}
```

- [ ] **Step 2: Update `update_current_user` SQL to include bio/pronouns**

Replace the SQL query in `update_current_user`:

```rust
    let user = sqlx::query_as::<_, User>(
        r#"
        UPDATE users
        SET avatar_url    = COALESCE($1, avatar_url),
            status        = COALESCE($2, status),
            custom_status = COALESCE($3, custom_status),
            bio           = COALESCE($4, bio),
            pronouns      = COALESCE($5, pronouns),
            updated_at    = NOW()
        WHERE id = $6
        RETURNING *
        "#,
    )
    .bind(update.avatar_url)
    .bind(update.status)
    .bind(update.custom_status)
    .bind(update.bio)
    .bind(update.pronouns)
    .bind(auth_user.user_id())
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;
```

Also update `UpdateUserDto` construction to include bio/pronouns:

```rust
    let update = UpdateUserDto {
        avatar_url: req.avatar_url,
        status: req.status,
        custom_status: req.custom_status,
        bio: req.bio,
        pronouns: req.pronouns,
    };
```

- [ ] **Step 3: Add `get_user_profile` handler**

Add at the bottom of `handlers/users.rs` (before the closing brace):

```rust
use axum::extract::Path;

pub async fn get_user_profile(
    State(state): State<AppState>,
    _auth_user: AuthUser,
    Path(user_id): Path<Uuid>,
) -> AppResult<Json<PublicProfileDto>> {
    info!("Getting public profile for user: {}", user_id);

    let profile = sqlx::query_as::<_, PublicProfileDto>(
        "SELECT id, username, avatar_url, status, custom_status, bio, pronouns, created_at
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    Ok(Json(profile))
}
```

Also add `PublicProfileDto` to the existing import at top of file:

```rust
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{PublicProfileDto, UpdateUserDto, User, UserDto},
    state::AppState,
};
```

- [ ] **Step 4: Register the new route in main.rs**

In `server/src/main.rs`, after the `/users/@me` PATCH line, add:

```rust
        .route("/users/:id", get(handlers::users::get_user_profile))
```

NOTE: `/users/:id` must come after `/users/@me` so the literal `@me` segment isn't treated as a `:id`. Axum matches literal segments before parameterized ones.

- [ ] **Step 5: Build server**

Run: `cd /Volumes/Storage/GitHub/Together/server && cargo build 2>&1 | tail -20`
Expected: `Finished dev [unoptimized + debuginfo] target(s)`

- [ ] **Step 6: Run existing unit tests**

Run: `cd /Volumes/Storage/GitHub/Together/server && cargo test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/handlers/users.rs server/src/main.rs
git commit -m "feat(api): add bio/pronouns to PATCH /users/@me; add GET /users/:id"
```

---

## Chunk 2: Avatar Upload Backend

### Task 4: Avatar upload endpoint

**Files:**

- Create: `server/src/handlers/avatars.rs`
- Modify: `server/src/handlers/mod.rs`
- Modify: `server/src/main.rs`

**Design decisions:**

- Stored at `{upload_dir}/avatars/{user_id}_{uuid}.{ext}`
- Served at `/avatars/{filename}` (authenticated, no membership check needed)
- Max size: 5 MB
- Allowed types: image/jpeg, image/png, image/gif, image/webp only
- When a user uploads a new avatar, the old file is deleted from disk (best-effort)
- `avatar_url` in DB is updated to `/avatars/{filename}` (relative, resolved by client via `api.fileUrl()`)

- [ ] **Step 1: Create `server/src/handlers/avatars.rs`**

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

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::UserDto,
    state::AppState,
};

/// Maximum avatar file size: 5 MB.
const MAX_AVATAR_SIZE: usize = 5_242_880;

const ALLOWED_AVATAR_TYPES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
];

/// POST /users/@me/avatar — upload a new avatar image (replaces existing).
///
/// Accepts a single file field named "avatar" in a multipart/form-data body.
/// Stores the file at `{upload_dir}/avatars/{user_id}_{uuid}.{ext}`, updates
/// the user's `avatar_url` column, and returns the updated UserDto.
pub async fn upload_avatar(
    State(state): State<AppState>,
    auth: AuthUser,
    mut multipart: Multipart,
) -> AppResult<Json<UserDto>> {
    // Read the "avatar" field from the multipart body.
    let mut avatar_data: Option<(Vec<u8>, String)> = None;

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::warn!(error = ?e, "Failed to read multipart field");
        AppError::Validation("Invalid multipart data".into())
    })? {
        if field.name().unwrap_or("") != "avatar" {
            continue;
        }

        let data = field.bytes().await.map_err(|e| {
            tracing::warn!(error = ?e, "Failed to read avatar bytes");
            AppError::Validation("Failed to read file data".into())
        })?;

        if data.is_empty() {
            return Err(AppError::Validation("Avatar file must not be empty".into()));
        }

        if data.len() > MAX_AVATAR_SIZE {
            return Err(AppError::Validation(
                "Avatar file exceeds the 5 MB limit".into(),
            ));
        }

        let mime_type = match infer::get(&data) {
            Some(t) => t.mime_type().to_string(),
            None => {
                return Err(AppError::Validation(
                    "Avatar file type could not be determined. Please upload a JPEG, PNG, GIF, or WebP image.".into(),
                ));
            }
        };

        if !ALLOWED_AVATAR_TYPES.contains(&mime_type.as_str()) {
            return Err(AppError::Validation(format!(
                "Avatar must be a JPEG, PNG, GIF, or WebP image (got '{mime_type}')"
            )));
        }

        avatar_data = Some((data.to_vec(), mime_type));
        break;
    }

    let (data, mime_type) = avatar_data.ok_or_else(|| {
        AppError::Validation(
            "No avatar file provided — include a field named \"avatar\"".into(),
        )
    })?;

    // Determine file extension from MIME type.
    let ext = match mime_type.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "bin",
    };

    let user_id = auth.user_id();
    let stored_name = format!("{}_{}.{}", user_id.simple(), Uuid::new_v4().simple(), ext);
    let avatar_url = format!("/avatars/{stored_name}");

    // Ensure avatars directory exists.
    let dir = state.upload_dir.join("avatars");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?dir, "Failed to create avatars directory");
        AppError::Internal
    })?;

    let file_path = dir.join(&stored_name);

    // Write new file.
    tokio::fs::write(&file_path, &data).await.map_err(|e| {
        tracing::error!(error = ?e, path = ?file_path, "Failed to write avatar file");
        AppError::Internal
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o644);
        if let Err(e) = tokio::fs::set_permissions(&file_path, perms).await {
            tracing::warn!(error = ?e, "Failed to set avatar file permissions");
        }
    }

    // Fetch old avatar_url before updating, so we can delete it.
    let old_avatar_url: Option<String> =
        sqlx::query_scalar("SELECT avatar_url FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();

    // Update DB with new avatar_url.
    let user = sqlx::query_as::<_, crate::models::User>(
        "UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    )
    .bind(&avatar_url)
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    // Best-effort delete old avatar file (don't fail the request if this errors).
    if let Some(old_url) = old_avatar_url {
        if old_url.starts_with("/avatars/") {
            let old_filename = old_url.trim_start_matches("/avatars/");
            // Reject filenames with path separators to prevent traversal.
            if !old_filename.contains('/') && !old_filename.contains("..") {
                let old_path = state.upload_dir.join("avatars").join(old_filename);
                if let Err(e) = tokio::fs::remove_file(&old_path).await {
                    tracing::warn!(error = ?e, path = ?old_path, "Failed to delete old avatar file");
                }
            }
        }
    }

    tracing::info!(user_id = %user_id, avatar_url = %avatar_url, "Avatar uploaded");
    Ok(Json(user.into()))
}

/// DELETE /users/@me/avatar — remove the current user's avatar.
pub async fn delete_avatar(
    State(state): State<AppState>,
    auth: AuthUser,
) -> AppResult<Json<UserDto>> {
    let user_id = auth.user_id();

    let old_avatar_url: Option<String> =
        sqlx::query_scalar("SELECT avatar_url FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.pool)
            .await?
            .flatten();

    let user = sqlx::query_as::<_, crate::models::User>(
        "UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING *",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".into()))?;

    if let Some(old_url) = old_avatar_url {
        if old_url.starts_with("/avatars/") {
            let old_filename = old_url.trim_start_matches("/avatars/");
            if !old_filename.contains('/') && !old_filename.contains("..") {
                let old_path = state.upload_dir.join("avatars").join(old_filename);
                if let Err(e) = tokio::fs::remove_file(&old_path).await {
                    tracing::warn!(error = ?e, path = ?old_path, "Failed to delete avatar file");
                }
            }
        }
    }

    Ok(Json(user.into()))
}

/// GET /avatars/*filepath — serve an avatar file (authenticated users only).
pub async fn serve_avatar(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(filepath): Path<String>,
) -> AppResult<Response> {
    // Path traversal guard.
    if filepath.contains('/') || filepath.contains("..") {
        return Err(AppError::NotFound("Avatar not found".into()));
    }

    let file_path = state.upload_dir.join("avatars").join(&filepath);

    let mime_type = {
        let ext = std::path::Path::new(&filepath)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        match ext {
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",
            _ => "application/octet-stream",
        }
    };

    let file = File::open(&file_path).await.map_err(|e| {
        tracing::warn!(error = ?e, path = ?file_path, "Avatar file not found");
        AppError::NotFound("Avatar not found".into())
    })?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(body)
        .map_err(|_| AppError::Internal)?;

    Ok(response)
}
```

- [ ] **Step 2: Add `pub mod avatars;` to `server/src/handlers/mod.rs`**

Add after `pub mod attachments;`:

```rust
pub mod avatars;
```

- [ ] **Step 3: Register routes in `server/src/main.rs`**

After the `/users/@me` PATCH route, add:

```rust
        .route(
            "/users/@me/avatar",
            post(handlers::avatars::upload_avatar)
                .layer(axum::extract::DefaultBodyLimit::max(5_242_880 + 65_536)), // 5 MB + multipart overhead
        )
        .route("/users/@me/avatar", delete(handlers::avatars::delete_avatar))
        .route("/avatars/*filepath", get(handlers::avatars::serve_avatar))
```

- [ ] **Step 4: Build**

Run: `cd /Volumes/Storage/GitHub/Together/server && cargo build 2>&1 | tail -20`
Expected: `Finished dev [unoptimized + debuginfo] target(s)`

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/avatars.rs server/src/handlers/mod.rs server/src/main.rs
git commit -m "feat(api): add POST/DELETE /users/@me/avatar and GET /avatars/*filepath"
```

---

## Chunk 3: Frontend Types + API Client

### Task 5: Update TypeScript types

**Files:**

- Modify: `clients/web/src/types/index.ts`

- [ ] **Step 1: Add `bio` and `pronouns` to `UserDto`**

Replace:

```typescript
export interface UserDto {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  status: UserStatus;
  custom_status: string | null;
  created_at: string;
}
```

With:

```typescript
export interface UserDto {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  status: UserStatus;
  custom_status: string | null;
  bio: string | null;
  pronouns: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Add `bio` and `pronouns` to `UpdateUserDto`**

Replace:

```typescript
export interface UpdateUserDto {
  avatar_url?: string | null;
  status?: UserStatus;
  custom_status?: string | null;
}
```

With:

```typescript
export interface UpdateUserDto {
  avatar_url?: string | null;
  status?: UserStatus;
  custom_status?: string | null;
  bio?: string | null;
  pronouns?: string | null;
}
```

- [ ] **Step 3: Add `PublicProfileDto` type (after `UpdateUserDto`)**

```typescript
/** Public profile returned by GET /users/:id. No email field. */
export interface PublicProfileDto {
  id: string;
  username: string;
  avatar_url: string | null;
  status: UserStatus;
  custom_status: string | null;
  bio: string | null;
  pronouns: string | null;
  created_at: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add clients/web/src/types/index.ts
git commit -m "feat(types): add bio/pronouns to UserDto/UpdateUserDto; add PublicProfileDto"
```

---

### Task 6: Update API client

**Files:**

- Modify: `clients/web/src/api/client.ts`

- [ ] **Step 1: Import `PublicProfileDto` at top of file**

Add `PublicProfileDto` to the existing type import block.

- [ ] **Step 2: Add `uploadAvatar`, `deleteAvatar`, `getUserProfile` methods**

After the `updateCurrentUser` method in the `─── Users ─────` section:

```typescript
  uploadAvatar(file: File): Promise<UserDto> {
    const formData = new FormData();
    formData.append("avatar", file);
    return this.request("/users/@me/avatar", {
      method: "POST",
      body: formData,
      skipContentType: true,
    });
  }

  deleteAvatar(): Promise<UserDto> {
    return this.request("/users/@me/avatar", { method: "DELETE" });
  }

  getUserProfile(userId: string): Promise<PublicProfileDto> {
    return this.request(`/users/${userId}`);
  }
```

- [ ] **Step 3: Commit**

```bash
git add clients/web/src/api/client.ts
git commit -m "feat(api-client): add uploadAvatar, deleteAvatar, getUserProfile methods"
```

---

## Chunk 4: Profile Editing UI

### Task 7: Update UserSettingsModal with bio, pronouns, avatar upload

**Files:**

- Modify: `clients/web/src/components/users/UserSettingsModal.tsx`

**Design:** The existing modal has avatar URL input and status/custom_status fields. We will:

1. Replace the avatar URL text input with a clickable avatar preview that triggers a file picker
2. Add a bio textarea (max 500 chars, with live char counter)
3. Add a pronouns text input (max 64 chars)
4. Keep the status and custom_status fields

- [ ] **Step 1: Write the updated `UserSettingsModal.tsx`**

```tsx
import { useState, useRef, type FormEvent, type ChangeEvent } from "react";
import { Modal } from "../common/Modal";
import { useAuthStore } from "../../stores/authStore";
import { api } from "../../api/client";
import type { UserStatus } from "../../types";
import styles from "./UserSettingsModal.module.css";

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "dnd", label: "Do Not Disturb" },
  { value: "offline", label: "Invisible" },
];

const BIO_MAX = 500;
const PRONOUNS_MAX = 64;

export function UserSettingsModal({ open, onClose }: UserSettingsModalProps) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const updatePresence = useAuthStore((s) => s.updatePresence);
  const setUser = useAuthStore((s) => s.setUser);

  const [status, setStatus] = useState<UserStatus>(user?.status || "online");
  const [customStatus, setCustomStatus] = useState(user?.custom_status || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [pronouns, setPronouns] = useState(user?.pronouns || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [error, setError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);

  if (!user) return null;

  const handleAvatarClick = () => {
    avatarInputRef.current?.click();
  };

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingAvatar(true);
    setError("");
    try {
      const updated = await api.uploadAvatar(file);
      setUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Avatar upload failed");
    } finally {
      setIsUploadingAvatar(false);
      // Reset input so re-selecting the same file triggers onChange.
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  const handleRemoveAvatar = async () => {
    setIsUploadingAvatar(true);
    setError("");
    try {
      const updated = await api.deleteAvatar();
      setUser(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove avatar");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      await updateProfile({
        custom_status: customStatus.trim() || null,
        bio: bio.trim() || null,
        pronouns: pronouns.trim() || null,
      });
      if (status !== user.status) {
        updatePresence(status, customStatus.trim() || null);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Profile">
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.avatarSection}>
        <div className={styles.avatarPreview}>
          {user.avatar_url ? (
            <img
              src={api.fileUrl(user.avatar_url)}
              alt=""
              className={styles.avatarImg}
            />
          ) : (
            <div className={styles.avatarFallback}>
              {user.username.charAt(0).toUpperCase()}
            </div>
          )}
          <button
            type="button"
            className={styles.avatarOverlay}
            onClick={handleAvatarClick}
            disabled={isUploadingAvatar}
            aria-label="Upload new avatar"
          >
            {isUploadingAvatar ? "..." : "Change"}
          </button>
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className={styles.hiddenInput}
          onChange={handleAvatarChange}
          aria-hidden="true"
          tabIndex={-1}
        />
        {user.avatar_url && (
          <button
            type="button"
            className={styles.removeAvatarBtn}
            onClick={handleRemoveAvatar}
            disabled={isUploadingAvatar}
          >
            Remove avatar
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Username</label>
          <input
            className={styles.input}
            type="text"
            value={user.username}
            disabled
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-pronouns">
            Pronouns <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="settings-pronouns"
            className={styles.input}
            type="text"
            value={pronouns}
            onChange={(e) => setPronouns(e.target.value.slice(0, PRONOUNS_MAX))}
            placeholder="e.g. they/them, she/her, he/him"
            maxLength={PRONOUNS_MAX}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-bio">
            About Me <span className={styles.optional}>(optional)</span>
          </label>
          <textarea
            id="settings-bio"
            className={styles.textarea}
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, BIO_MAX))}
            placeholder="Tell people a bit about yourself..."
            rows={4}
            maxLength={BIO_MAX}
          />
          <span className={styles.charCount}>
            {bio.length}/{BIO_MAX}
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-status">
            Status
          </label>
          <select
            id="settings-status"
            className={styles.select}
            value={status}
            onChange={(e) => setStatus(e.target.value as UserStatus)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="settings-custom-status">
            Custom Status <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="settings-custom-status"
            className={styles.input}
            type="text"
            value={customStatus}
            onChange={(e) => setCustomStatus(e.target.value)}
            placeholder="What are you up to?"
          />
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Create `UserSettingsModal.module.css`**

```css
.error {
  background: rgba(237, 66, 69, 0.15);
  color: #ed4245;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  margin-bottom: 12px;
}

.avatarSection {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
}

.avatarPreview {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: var(--radius-full);
  overflow: hidden;
  cursor: pointer;
  flex-shrink: 0;
}

.avatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatarFallback {
  width: 100%;
  height: 100%;
  background: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 700;
  color: #fff;
}

.avatarOverlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.15s;
  border-radius: 0;
  width: 100%;
}

.avatarPreview:hover .avatarOverlay {
  opacity: 1;
}

.hiddenInput {
  display: none;
}

.removeAvatarBtn {
  font-size: 12px;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  text-decoration: underline;
  transition: color 0.1s;
}

.removeAvatarBtn:hover {
  color: #ed4245;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.optional {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  font-size: 11px;
}

.input,
.select {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.1s;
  width: 100%;
}

.input:focus,
.select:focus {
  border-color: var(--accent-primary);
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.textarea {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.1s;
  width: 100%;
  resize: vertical;
  font-family: inherit;
  min-height: 80px;
}

.textarea:focus {
  border-color: var(--accent-primary);
}

.charCount {
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}

.cancelBtn {
  background: var(--bg-secondary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.1s;
}

.cancelBtn:hover {
  background: var(--bg-hover);
}

.submitBtn {
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.1s;
}

.submitBtn:hover:not(:disabled) {
  opacity: 0.85;
}

.submitBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Update the import in UserSettingsModal.tsx to use new CSS module**

The component above already uses `import styles from "./UserSettingsModal.module.css"`, so make sure the file is at the correct path. Double check: the old `UserSettingsModal.tsx` imported from `../servers/ServerModals.module.css` — the rewrite changes that to its own module.

- [ ] **Step 4: Build the web client**

Run: `cd /Volumes/Storage/GitHub/Together/clients/web && npm run build 2>&1 | tail -30`
Expected: Build completes with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/components/users/UserSettingsModal.tsx
git add clients/web/src/components/users/UserSettingsModal.module.css
git commit -m "feat(ui): rewrite UserSettingsModal with bio, pronouns, avatar file upload"
```

---

## Chunk 5: User Profile View Card

### Task 8: UserProfileCard component + MemberSidebar integration

**Files:**

- Create: `clients/web/src/components/users/UserProfileCard.tsx`
- Create: `clients/web/src/components/users/UserProfileCard.module.css`
- Modify: `clients/web/src/components/layout/MemberSidebar.tsx`

**Design:** When a user clicks on a member in the sidebar, a profile card popover appears showing avatar, username, pronouns, bio, status, and a "Send Message" button. The card is positioned near the clicked item and dismisses on outside-click or Escape.

- [ ] **Step 1: Create `UserProfileCard.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useDmStore } from "../../stores/dmStore";
import { useServerStore } from "../../stores/serverStore";
import { useAuthStore } from "../../stores/authStore";
import type { PublicProfileDto, UserStatus } from "../../types";
import styles from "./UserProfileCard.module.css";

interface UserProfileCardProps {
  userId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

const STATUS_LABEL: Record<UserStatus, string> = {
  online: "Online",
  away: "Away",
  dnd: "Do Not Disturb",
  offline: "Offline",
};

export function UserProfileCard({
  userId,
  anchorRect,
  onClose,
}: UserProfileCardProps) {
  const [profile, setProfile] = useState<PublicProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const openOrCreateDm = useDmStore((s) => s.openOrCreateDm);
  const setActiveDmChannel = useDmStore((s) => s.setActiveDmChannel);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  useEffect(() => {
    let cancelled = false;
    api
      .getUserProfile(userId)
      .then((p) => {
        if (!cancelled) {
          setProfile(p);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Dismiss on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Dismiss on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Position card to the left of the anchor element.
  const style: React.CSSProperties = {
    top: Math.min(anchorRect.top, window.innerHeight - 320),
    right: window.innerWidth - anchorRect.left + 8,
  };

  const handleMessage = async () => {
    if (!profile) return;
    const channel = await openOrCreateDm(profile.id);
    setActiveDmChannel(channel.id);
    setActiveServer(null);
    onClose();
  };

  return (
    <div
      className={styles.card}
      style={style}
      ref={cardRef}
      role="dialog"
      aria-label="User profile"
    >
      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : !profile ? (
        <div className={styles.loading}>Profile not found</div>
      ) : (
        <>
          <div className={styles.header}>
            <div className={styles.avatarWrapper}>
              {profile.avatar_url ? (
                <img
                  src={api.fileUrl(profile.avatar_url)}
                  alt=""
                  className={styles.avatar}
                />
              ) : (
                <div className={styles.avatarFallback}>
                  {profile.username.charAt(0).toUpperCase()}
                </div>
              )}
              <span
                className={`${styles.statusDot} ${styles[profile.status]}`}
              />
            </div>
          </div>

          <div className={styles.body}>
            <div className={styles.username}>{profile.username}</div>
            {profile.pronouns && (
              <div className={styles.pronouns}>{profile.pronouns}</div>
            )}
            <div className={styles.statusRow}>
              <span
                className={`${styles.statusLabel} ${styles[profile.status]}`}
              >
                {STATUS_LABEL[profile.status]}
              </span>
              {profile.custom_status && (
                <span className={styles.customStatus}>
                  &mdash; {profile.custom_status}
                </span>
              )}
            </div>

            {profile.bio && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>About Me</div>
                <div className={styles.bio}>{profile.bio}</div>
              </div>
            )}
          </div>

          {currentUserId !== profile.id && (
            <div className={styles.footer}>
              <button className={styles.messageBtn} onClick={handleMessage}>
                Send Message
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `UserProfileCard.module.css`**

```css
.card {
  position: fixed;
  z-index: 1000;
  width: 280px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.loading {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.header {
  background: var(--bg-tertiary, var(--bg-primary));
  padding: 16px 16px 0;
  height: 60px;
  position: relative;
}

.avatarWrapper {
  position: absolute;
  bottom: -24px;
  left: 16px;
}

.avatar {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-full);
  object-fit: cover;
  border: 4px solid var(--bg-secondary);
}

.avatarFallback {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-full);
  background: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 700;
  color: #fff;
  border: 4px solid var(--bg-secondary);
}

.statusDot {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  border: 3px solid var(--bg-secondary);
}

.statusDot.online {
  background: var(--status-online);
}
.statusDot.away {
  background: var(--status-away);
}
.statusDot.dnd {
  background: var(--status-dnd);
}
.statusDot.offline {
  background: var(--status-offline);
}

.body {
  padding: 36px 16px 16px;
}

.username {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.pronouns {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.statusRow {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
}

.statusLabel {
  font-weight: 600;
}

.statusLabel.online {
  color: var(--status-online);
}
.statusLabel.away {
  color: var(--status-away);
}
.statusLabel.dnd {
  color: var(--status-dnd);
}
.statusLabel.offline {
  color: var(--text-muted);
}

.customStatus {
  color: var(--text-muted);
}

.section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.sectionTitle {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.bio {
  font-size: 13px;
  color: var(--text-secondary, var(--text-primary));
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.footer {
  padding: 0 16px 16px;
}

.messageBtn {
  width: 100%;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.1s;
}

.messageBtn:hover {
  opacity: 0.85;
}
```

- [ ] **Step 3: Update `MemberSidebar.tsx` to open the profile card on click**

Replace the `MemberItem` component to add onClick + profile card rendering. Key changes:

- Track `activeProfileUserId` and `anchorRect` in `MemberSidebar`
- Pass an `onShowProfile` callback to `MemberItem`
- Render `UserProfileCard` as a portal when a member is clicked

```tsx
import { useState, useCallback } from "react";
import { useAuthStore } from "../../stores/authStore";
import { Mail } from "lucide-react";
import { useServerStore } from "../../stores/serverStore";
import { useDmStore } from "../../stores/dmStore";
import { UserProfileCard } from "../users/UserProfileCard";
import type { MemberDto, UserStatus } from "../../types";
import styles from "./MemberSidebar.module.css";

function StatusIndicator({ status }: { status: UserStatus }) {
  return <span className={`${styles.status} ${styles[status]}`} />;
}

interface MemberItemProps {
  member: MemberDto;
  onShowProfile: (userId: string, rect: DOMRect) => void;
}

function MemberItem({ member, onShowProfile }: MemberItemProps) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const openOrCreateDm = useDmStore((s) => s.openOrCreateDm);
  const setActiveDmChannel = useDmStore((s) => s.setActiveDmChannel);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const handleMessage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const channel = await openOrCreateDm(member.user_id);
    setActiveDmChannel(channel.id);
    setActiveServer(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onShowProfile(member.user_id, rect);
  };

  const displayName = member.nickname || member.username;

  return (
    <div
      className={`${styles.member} ${member.status === "offline" ? styles.offline : ""}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          const rect = e.currentTarget.getBoundingClientRect();
          onShowProfile(member.user_id, rect);
        }
      }}
    >
      <div className={styles.avatarWrapper}>
        {member.avatar_url ? (
          <img src={member.avatar_url} alt="" className={styles.avatar} />
        ) : (
          <div className={styles.avatarFallback}>
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <StatusIndicator status={member.status} />
      </div>
      <div className={styles.info}>
        <span className={styles.username}>{displayName}</span>
        {member.custom_status && (
          <span className={styles.customStatus} title={member.custom_status}>
            {member.custom_status}
          </span>
        )}
      </div>
      {currentUserId !== member.user_id && (
        <button
          className={styles.dmBtn}
          onClick={handleMessage}
          title={`Message ${displayName}`}
          aria-label={`Message ${displayName}`}
        >
          <Mail size={14} />
        </button>
      )}
    </div>
  );
}

export function MemberSidebar() {
  const members = useServerStore((s) => s.members);
  const [activeProfile, setActiveProfile] = useState<{
    userId: string;
    rect: DOMRect;
  } | null>(null);

  const handleShowProfile = useCallback((userId: string, rect: DOMRect) => {
    setActiveProfile({ userId, rect });
  }, []);

  const handleCloseProfile = useCallback(() => {
    setActiveProfile(null);
  }, []);

  const onlineMembers = members.filter((m) => m.status === "online");
  const awayMembers = members.filter(
    (m) => m.status === "away" || m.status === "dnd",
  );
  const offlineMembers = members.filter((m) => m.status === "offline");

  return (
    <div className={styles.sidebar}>
      {onlineMembers.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Online &mdash; {onlineMembers.length}
          </h3>
          {onlineMembers.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              onShowProfile={handleShowProfile}
            />
          ))}
        </div>
      )}
      {awayMembers.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Away &mdash; {awayMembers.length}
          </h3>
          {awayMembers.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              onShowProfile={handleShowProfile}
            />
          ))}
        </div>
      )}
      {offlineMembers.length > 0 && (
        <div className={styles.group}>
          <h3 className={styles.groupTitle}>
            Offline &mdash; {offlineMembers.length}
          </h3>
          {offlineMembers.map((m) => (
            <MemberItem
              key={m.user_id}
              member={m}
              onShowProfile={handleShowProfile}
            />
          ))}
        </div>
      )}
      {members.length === 0 && <div className={styles.empty}>No members</div>}

      {activeProfile && (
        <UserProfileCard
          userId={activeProfile.userId}
          anchorRect={activeProfile.rect}
          onClose={handleCloseProfile}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build the web client**

Run: `cd /Volumes/Storage/GitHub/Together/clients/web && npm run build 2>&1 | tail -30`
Expected: Build completes with no TypeScript errors.

- [ ] **Step 5: Run frontend tests**

Run: `cd /Volumes/Storage/GitHub/Together/clients/web && npm test -- --run 2>&1 | tail -30`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add clients/web/src/components/users/UserProfileCard.tsx
git add clients/web/src/components/users/UserProfileCard.module.css
git add clients/web/src/components/layout/MemberSidebar.tsx
git commit -m "feat(ui): add UserProfileCard popover; make member sidebar items clickable"
```

---

## Chunk 6: Final Integration Test

### Task 9: End-to-end smoke test + final build verification

- [ ] **Step 1: Full server build + test**

Run: `cd /Volumes/Storage/GitHub/Together/server && cargo build --release 2>&1 | tail -10`
Expected: Release build completes.

Run: `cd /Volumes/Storage/GitHub/Together/server && cargo test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 2: Full client build + test**

Run: `cd /Volumes/Storage/GitHub/Together/clients/web && npm run build && npm test -- --run 2>&1 | tail -30`
Expected: Build and all tests pass.

- [ ] **Step 3: Verify avatar upload flow (manual or with a test)**

If a dev server is available:

1. `POST /users/@me/avatar` with a valid JPEG → returns updated `UserDto` with new `avatar_url`
2. `GET /avatars/{filename}` → returns image bytes
3. `DELETE /users/@me/avatar` → returns `UserDto` with `avatar_url: null`

- [ ] **Step 4: Verify bio/pronouns round-trip**

1. `PATCH /users/@me` with `{ bio: "hello", pronouns: "they/them" }` → returns updated `UserDto`
2. `GET /users/:id` → returns `PublicProfileDto` with bio and pronouns populated

- [ ] **Step 5: Final commit + emit system event**

```bash
git add -A
git commit -m "feat(profiles): complete user profiles — bio, pronouns, avatar upload, profile card"
```

Then run:

```bash
openclaw system event --text "Done: User profiles complete - #T016" --mode now
```

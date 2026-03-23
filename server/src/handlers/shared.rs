use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Channel, Message, Server, ServerMember},
};

/// Convert [`validator::ValidationErrors`] into an [`AppError::Validation`] with
/// a human-readable message. Shared across all handler modules to avoid
/// copy-pasting the same boilerplate.
pub fn validation_error(e: validator::ValidationErrors) -> AppError {
    AppError::Validation(
        e.field_errors()
            .values()
            .flat_map(|v| v.iter())
            .filter_map(|e| e.message.as_ref())
            .map(|m| m.to_string())
            .collect::<Vec<_>>()
            .join(", "),
    )
}

/// Validate that a URL uses an allowed scheme (http or https).
///
/// The `validator` crate's `#[validate(url)]` accepts any syntactically valid
/// URI including `javascript:` and `data:` scheme URLs, which are XSS vectors
/// when rendered as `src` or `href` attributes. This helper enforces that only
/// `http://` and `https://` are permitted.
///
/// Call this *after* the struct-level `validate()` check so that the
/// struct-level errors surface first (e.g. "not a URL at all" before
/// "wrong scheme").
pub fn require_http_url(url: &str, field: &str) -> Result<(), AppError> {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "{field} must use http:// or https://"
        )))
    }
}

/// Fetch a non-deleted message by ID, returning 404 if not found or deleted.
pub async fn fetch_message(pool: &sqlx::PgPool, message_id: Uuid) -> AppResult<Message> {
    sqlx::query_as::<_, Message>(
        "SELECT id, channel_id, author_id, content, reply_to,
                mention_user_ids, mention_everyone, thread_id,
                0 AS thread_reply_count, edited_at, deleted, created_at
         FROM messages WHERE id = $1 AND deleted = FALSE",
    )
    .bind(message_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))
}

/// Fetch a message by ID and channel, returning 404 if not found.
/// Unlike `fetch_message`, this returns messages with `deleted = TRUE` so that
/// reply-bar previews can display "original message deleted" for soft-deleted targets.
pub async fn fetch_message_including_deleted(
    pool: &sqlx::PgPool,
    message_id: Uuid,
    channel_id: Uuid,
) -> AppResult<Message> {
    sqlx::query_as::<_, Message>(
        "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to,
                m.mention_user_ids, m.mention_everyone, m.thread_id,
                COALESCE(
                    (SELECT COUNT(*)::int FROM messages r
                     WHERE r.thread_id = m.id AND r.deleted = FALSE),
                    0
                ) AS thread_reply_count,
                m.edited_at, m.deleted, m.created_at, m.pinned, m.pinned_by, m.pinned_at
         FROM messages m
         WHERE m.id = $1 AND m.channel_id = $2",
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))
}

/// Fetch a channel by its ID alone (no server scope), returning 404 if not found.
pub async fn fetch_channel_by_id(pool: &sqlx::PgPool, channel_id: Uuid) -> AppResult<Channel> {
    sqlx::query_as::<_, Channel>(
        "SELECT id, server_id, name, type, position, category, topic, created_at
         FROM channels WHERE id = $1",
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Channel not found".into()))
}

/// Fetch a server row, returning 404 if it does not exist.
pub async fn fetch_server(pool: &sqlx::PgPool, server_id: Uuid) -> AppResult<Server> {
    sqlx::query_as::<_, Server>(
        "SELECT id, name, owner_id, icon_url, is_public, require_invite, created_at, updated_at
         FROM servers WHERE id = $1",
    )
    .bind(server_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))
}

/// Verify the user is a member of the server.
///
/// Returns 404 (not 403) when the user is not a member — this prevents leaking
/// information about server existence to unauthenticated or non-member users.
pub async fn require_member(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<ServerMember> {
    sqlx::query_as::<_, ServerMember>(
        "SELECT user_id, server_id, nickname, joined_at
         FROM server_members WHERE server_id = $1 AND user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Server not found".into()))
}

// Permission bitflag constants (mirrors migrations/20240216000003_roles_and_permissions.sql)
const PERMISSION_MANAGE_MESSAGES: i64 = 4; // bit 2
pub const PERMISSION_ADMINISTRATOR: i64 = 8192; // bit 13
pub const PERMISSION_MUTE_MEMBERS: i64 = 128; // bit 7
pub const PERMISSION_KICK_MEMBERS: i64 = 256; // bit 8
pub const PERMISSION_BAN_MEMBERS: i64 = 512; // bit 9
pub const PERMISSION_MANAGE_ROLES: i64 = 2048; // bit 11
pub const PERMISSION_CREATE_INVITES: i64 = 16384; // bit 14

/// Verify the user has the MANAGE_MESSAGES permission in the given server.
///
/// Grants access if the user is the server owner, or if any of their roles
/// have MANAGE_MESSAGES (bit 2) or ADMINISTRATOR (bit 13) set.
/// Returns 403 Forbidden when the user is a member but lacks the permission.
pub async fn require_manage_messages(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<()> {
    // Server owner always has all permissions.
    let is_owner: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM servers WHERE id = $1 AND owner_id = $2)")
            .bind(server_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?;

    if is_owner {
        return Ok(());
    }

    // Check role-based permissions: MANAGE_MESSAGES or ADMINISTRATOR bit set.
    let has_perm: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.user_id = $1
               AND mr.server_id = $2
               AND (r.permissions & $3 != 0 OR r.permissions & $4 != 0)
         )",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(PERMISSION_MANAGE_MESSAGES)
    .bind(PERMISSION_ADMINISTRATOR)
    .fetch_one(pool)
    .await?;

    if has_perm {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "You need the Manage Messages permission to pin messages".into(),
        ))
    }
}

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

/// Sanitize a filename for safe use inside a `Content-Disposition` header.
/// Replaces `"` with `'` and strips `\r`, `\n`, `\0` to prevent header injection.
pub fn sanitize_header_filename(name: &str) -> String {
    name.chars()
        .filter(|c| !matches!(c, '\r' | '\n' | '\0'))
        .map(|c| if c == '"' { '\'' } else { c })
        .collect()
}

/// Verify the user has a specific permission bit in the given server.
///
/// Grants access if the user is the server owner, or if any of their roles
/// have the specified permission bit or ADMINISTRATOR (bit 13) set.
/// Returns 403 Forbidden with the provided message when the permission is missing.
pub async fn require_permission(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
    permission_bit: i64,
    error_message: &str,
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
               AND (r.permissions & $3 != 0 OR r.permissions & $4 != 0)
         )",
    )
    .bind(user_id)
    .bind(server_id)
    .bind(permission_bit)
    .bind(PERMISSION_ADMINISTRATOR)
    .fetch_one(pool)
    .await?;

    if has_perm {
        Ok(())
    } else {
        Err(AppError::Forbidden(error_message.into()))
    }
}

/// Verify the actor can moderate the target user in the given server.
///
/// Rules:
/// - Cannot target self (400)
/// - Cannot target the server owner (403)
/// - Server owner always passes
/// - Otherwise requires the specified permission bit or ADMINISTRATOR
pub async fn can_moderate(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    actor_id: Uuid,
    target_id: Uuid,
    permission_bit: i64,
) -> AppResult<()> {
    if actor_id == target_id {
        return Err(AppError::Validation("You cannot moderate yourself".into()));
    }

    let owner_id: Uuid = sqlx::query_scalar("SELECT owner_id FROM servers WHERE id = $1")
        .bind(server_id)
        .fetch_one(pool)
        .await?;

    if target_id == owner_id {
        return Err(AppError::Forbidden(
            "Cannot moderate the server owner".into(),
        ));
    }

    if actor_id == owner_id {
        return Ok(());
    }

    let has_perm: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM member_roles mr
             JOIN roles r ON r.id = mr.role_id
             WHERE mr.user_id = $1
               AND mr.server_id = $2
               AND (r.permissions & $3 != 0 OR r.permissions & $4 != 0)
         )",
    )
    .bind(actor_id)
    .bind(server_id)
    .bind(permission_bit)
    .bind(PERMISSION_ADMINISTRATOR)
    .fetch_one(pool)
    .await?;

    if has_perm {
        Ok(())
    } else {
        Err(AppError::Forbidden(
            "You lack the required permission for this action".into(),
        ))
    }
}

/// Return the highest role position held by `user_id` in `server_id`, or 0
/// if the user has no roles.
pub async fn get_user_highest_position(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<i32> {
    let pos: Option<i32> = sqlx::query_scalar(
        "SELECT MAX(r.position)
         FROM member_roles mr
         JOIN roles r ON r.id = mr.role_id
         WHERE mr.server_id = $1 AND mr.user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(pos.unwrap_or(0))
}

/// Return the bitwise OR of all role permissions for `user_id` in `server_id`,
/// or 0 if the user has no roles.
pub async fn get_user_permissions(
    pool: &sqlx::PgPool,
    server_id: Uuid,
    user_id: Uuid,
) -> AppResult<i64> {
    // PostgreSQL BIT_OR aggregate returns NULL when there are no rows.
    let perms: Option<i64> = sqlx::query_scalar(
        "SELECT BIT_OR(r.permissions)
         FROM member_roles mr
         JOIN roles r ON r.id = mr.role_id
         WHERE mr.server_id = $1 AND mr.user_id = $2",
    )
    .bind(server_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(perms.unwrap_or(0))
}

⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/guides/instance-admin).
Please visit the new site for the latest version.

---

# Instance Admin Dashboard

The instance admin dashboard provides instance-level management of users and servers. It is separate from server-scoped moderation (kick, ban, roles) — instance admin operates across the entire Together deployment.

## How Admin Is Assigned

The **first user to register** on a fresh Together instance is automatically granted `is_admin = true`. There is no sign-up flow or config file for the initial admin — just register the first account.

Additional admins can be promoted by any existing admin via the `PATCH /admin/users/:user_id` endpoint.

---

## Authentication

All admin endpoints require a valid Bearer JWT from a user whose `is_admin` column is `true`. The check is performed by the `require_admin` helper, which:

1. Looks up `is_admin` from the `users` table for the requesting user.
2. Returns `401` if the user does not exist.
3. Returns `403 Forbidden` with `"Admin access required"` if `is_admin` is `false`.

```
Authorization: Bearer <token>
```

This is an instance-level check, not a server-membership check.

---

## Endpoints

### GET /admin/stats

Returns aggregate instance statistics.

**Response `200 OK`:**

| Field                   | Type    | Description                                        |
| ----------------------- | ------- | -------------------------------------------------- |
| `total_users`           | integer | Total registered users                             |
| `total_servers`         | integer | Total servers (guilds)                             |
| `total_messages`        | integer | Total messages across all channels                 |
| `total_channels`        | integer | Total channels across all servers                  |
| `active_ws_connections` | integer | Current open WebSocket connections                 |
| `uptime_secs`           | integer | Seconds since server started (null if unavailable) |
| `db_latency_ms`         | integer | Round-trip time for a `SELECT 1` probe (ms)        |
| `storage_bytes`         | integer | Total bytes used by the upload directory           |

**Errors:** `401`, `403`.

---

### GET /admin/users

Paginated user list with search and sorting.

**Query parameters:**

| Parameter  | Default      | Description                                           |
| ---------- | ------------ | ----------------------------------------------------- |
| `page`     | `1`          | Page number (minimum 1)                               |
| `per_page` | `50`         | Results per page (1–100)                              |
| `search`   | _(none)_     | Case-insensitive substring match on username or email |
| `sort_by`  | `created_at` | One of: `username`, `created_at`, `message_count`     |

**Response `200 OK`:**

```json
{
  "users": [
    {
      "id": "uuid",
      "username": "alice",
      "email": "alice@example.com",
      "avatar_url": null,
      "status": "online",
      "is_admin": true,
      "disabled": false,
      "disabled_at": null,
      "created_at": "2026-01-15T10:30:00Z",
      "server_count": 3,
      "message_count": 1842
    }
  ],
  "total": 127,
  "page": 1,
  "per_page": 50
}
```

Sort order: `username` sorts ascending, `created_at` and `message_count` sort descending.

**Errors:** `401`, `403`.

---

### PATCH /admin/users/:user_id

Promote/demote admin status and/or disable/enable a user account. Both fields are optional — omit a field to leave it unchanged.

**Request body:**

```json
{
  "is_admin": true,
  "disabled": false
}
```

| Field      | Type | Description                              |
| ---------- | ---- | ---------------------------------------- |
| `is_admin` | bool | Grant or revoke instance admin privilege |
| `disabled` | bool | Disable or re-enable the user account    |

The request struct uses `deny_unknown_fields` — extra fields cause a `400` error.

**Self-operation guards:**

- Cannot set `is_admin: false` on yourself (prevents admin lockout).
- Cannot set `disabled: true` on yourself.

Both return `400` with a validation message.

**Disable behavior:**

When `disabled` is set to `true`:

1. `disabled` is set to `true` and `disabled_at` is set to `NOW()`.
2. All rows in the `sessions` table for that user are deleted, invalidating every refresh token.
3. Subsequent login attempts are rejected because the account is disabled.

When `disabled` is set to `false`:

1. `disabled` is set to `false` and `disabled_at` is set to `NULL`.
2. The user can log in again normally.

Both operations (admin change + disable change) run in a single database transaction.

**Response:** `200 OK` (no body).

**Errors:** `400` (self-operation or unknown field), `401`, `403`, `404` (user not found).

---

### DELETE /admin/users/:user_id

Permanently delete a user account.

**Self-guard:** Cannot delete yourself — returns `400`.

**Deletion process (single transaction):**

1. All sessions for the user are deleted.
2. Messages authored by the user are **anonymized** — `author_id` is set to `NULL` on both `messages` and `direct_messages`. The message content is preserved to maintain conversation context.
3. The user row is deleted. Foreign keys with `ON DELETE CASCADE` handle server memberships, DM channel participants, and other dependent rows.

**Response:** `204 No Content`.

**Errors:** `400` (self-delete), `401`, `403`, `404` (user not found).

---

### GET /admin/servers

Paginated server list with search and enriched counts.

**Query parameters:**

| Parameter  | Default  | Description                                     |
| ---------- | -------- | ----------------------------------------------- |
| `page`     | `1`      | Page number (minimum 1)                         |
| `per_page` | `50`     | Results per page (1–100)                        |
| `search`   | _(none)_ | Case-insensitive substring match on server name |

Servers are always sorted by `created_at` descending.

**Response `200 OK`:**

```json
{
  "servers": [
    {
      "id": "uuid",
      "name": "Gaming Squad",
      "owner_id": "uuid",
      "owner_username": "alice",
      "icon_url": null,
      "is_public": false,
      "member_count": 42,
      "channel_count": 8,
      "message_count": 15230,
      "created_at": "2026-02-01T14:00:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "per_page": 50
}
```

**Errors:** `401`, `403`.

---

### DELETE /admin/servers/:server_id

Force-delete a server regardless of ownership. This is an admin override — no ownership check is performed.

The server row is deleted directly. Foreign keys with `ON DELETE CASCADE` handle channels, messages, memberships, invites, and all other dependent data.

**Response:** `204 No Content`.

**Errors:** `401`, `403`, `404` (server not found).

---

## Summary

| Method   | Path                        | Description                     | Success |
| -------- | --------------------------- | ------------------------------- | ------- |
| `GET`    | `/admin/stats`              | Instance overview statistics    | `200`   |
| `GET`    | `/admin/users`              | Paginated user list             | `200`   |
| `PATCH`  | `/admin/users/:user_id`     | Promote/demote, disable/enable  | `200`   |
| `DELETE` | `/admin/users/:user_id`     | Delete user, anonymize messages | `204`   |
| `GET`    | `/admin/servers`            | Paginated server list           | `200`   |
| `DELETE` | `/admin/servers/:server_id` | Force-delete a server           | `204`   |

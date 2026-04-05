---
outline: deep
---

# Audit Logging — Admin Guide

Audit logs record administrative actions taken within a server, giving server owners a tamper-evident history of who did what and when.

> **Note:** Audit events are emitted for server operations, channel operations,
> member moderation (kick, ban, unban, timeout, timeout removal), and role
> management (role create, update, delete, member role add/remove).

## Access

Only the **server owner** can read audit logs.

```
GET /servers/:server_id/audit-logs
Authorization: Bearer <token>
```

A non-owner receives `403 Forbidden`.

---

## What Is Logged

Every entry captures the following fields:

| Field         | Description                                                           |
| ------------- | --------------------------------------------------------------------- |
| `id`          | Unique entry UUID                                                     |
| `server_id`   | Server the action occurred in                                         |
| `actor_id`    | User who performed the action (`null` if account deleted)             |
| `action`      | Action type (see table below)                                         |
| `target_type` | Category of the affected entity (`server`, `channel`, `user`, `role`) |
| `target_id`   | UUID of the affected entity                                           |
| `details`     | JSON object with additional context (names, old/new values, reasons)  |
| `ip_address`  | IP address of the actor at the time of the action                     |
| `created_at`  | UTC timestamp                                                         |

### Logged Actions

| Action                  | `target_type` | Triggered When                              |
| ----------------------- | ------------- | ------------------------------------------- |
| `server_create`         | `server`      | A new server is created                     |
| `server_update`         | `server`      | Server name, icon, or settings are changed  |
| `server_delete`         | `server`      | A server is permanently deleted             |
| `channel_create`        | `channel`     | A text or voice channel is created          |
| `channel_update`        | `channel`     | A channel's name, type, or settings change  |
| `channel_delete`        | `channel`     | A channel is deleted                        |
| `member_kick`           | `user`        | A member is kicked from the server          |
| `member_ban`            | `user`        | A member is banned                          |
| `member_unban`          | `user`        | A ban is lifted                             |
| `member_timeout`        | `user`        | A member is timed out                       |
| `member_timeout_remove` | `user`        | A member's timeout is removed early         |
| `member_role_add`       | `user`        | A role is assigned to a member              |
| `member_role_remove`    | `user`        | A role is removed from a member             |
| `role_create`           | `role`        | A new role is created                       |
| `role_update`           | `role`        | A role's name, color, or permissions change |
| `role_delete`           | `role`        | A role is deleted                           |

The `details` JSONB field carries action-specific context. For example, a `member_kick` entry may include `{ "reason": "Spamming" }`, a `member_timeout` entry includes `{ "duration_minutes": 60, "reason": "Cool down" }`, and a `channel_update` entry may include the previous and new channel name.

---

## Filtering and Searching

All filters are optional query parameters and can be combined:

| Parameter     | Type               | Description                                                                          |
| ------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `action`      | string             | Return only entries matching this action type (e.g. `member_ban`)                    |
| `actor_id`    | UUID               | Return only actions performed by this user                                           |
| `target_type` | string             | Return only entries targeting this entity type (`server`, `channel`, `user`, `role`) |
| `before`      | ISO 8601 timestamp | Cursor for pagination — returns entries created before this time                     |
| `limit`       | integer            | Number of entries to return. Default: `50`. Maximum: `100`                           |

### Example Requests

All kicks performed on the server, most recent first:

```
GET /servers/:id/audit-logs?action=member_kick
```

All actions by a specific moderator:

```
GET /servers/:id/audit-logs?actor_id=a8f85e92-3d0b-4b10-a6b9-2e4c9b8e7f3a
```

All channel changes, paginated:

```
GET /servers/:id/audit-logs?target_type=channel&limit=100

# Next page — pass the `created_at` of the last entry as the cursor:
GET /servers/:id/audit-logs?target_type=channel&limit=100&before=2026-03-10T12:00:00Z
```

---

## Pagination

Results are returned in descending chronological order (newest first). To page through results, pass the `created_at` value of the last entry in the current page as the `before` parameter for the next request.

```
Page 1:  GET /servers/:id/audit-logs?limit=50
Page 2:  GET /servers/:id/audit-logs?limit=50&before=<created_at of entry #50>
Page 3:  ...
```

An empty array `[]` indicates there are no more entries.

---

## Retention Policy

Audit logs are retained as long as the server exists. When a server is permanently deleted, all associated audit log entries are deleted via `ON DELETE CASCADE`.

There is no automatic expiry or time-based pruning. For long-lived servers, use the `before` cursor to archive older entries externally before they become unwieldy.

---

## Implementation Notes

- Audit logging is **non-blocking**. If the write to `audit_logs` fails (e.g. transient database issue), the underlying operation (kick, role change, etc.) is not rolled back. Failures are logged server-side as errors.
- `actor_id` may be `null` in historical entries if the acting user's account has since been deleted.
- The `ip_address` field is populated when the server can reliably determine the client IP (proxied deployments may see the proxy's IP unless `X-Forwarded-For` is configured correctly in nginx).

---

## Database Schema Reference

```sql
CREATE TABLE audit_logs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    actor_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT        NOT NULL,
    target_type TEXT,
    target_id   UUID,
    details     JSONB       DEFAULT '{}',
    ip_address  INET,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Indexes on `(server_id, created_at DESC)`, `(actor_id, created_at DESC)`, and `(server_id, action, created_at DESC)` ensure all common query patterns run efficiently.

---
outline: deep
---

# Invite Links

Together supports shareable invite links that allow users to join a server. Each invite has a unique 8-character alphanumeric code, and can optionally be configured with an expiry time and a maximum number of uses.

---

## Overview

- Invite codes are 8 random alphanumeric characters (e.g. `aB3xK9mZ`)
- Codes are unique across the system (retried up to 3 times on collision)
- Invites can optionally expire after 1–720 hours (30 days)
- Invites can optionally have a maximum use count
- An invite with no expiry and no max uses is valid indefinitely
- Creating, listing, and deleting invites requires the `CREATE_INVITES` permission (bit 14, value 16384), or `ADMINISTRATOR`, or server ownership
- Previewing and accepting invites requires only authentication (no server membership)

---

## Data Model

### ServerInvite

| Field        | Type      | Description                                    |
| ------------ | --------- | ---------------------------------------------- |
| `id`         | UUID      | Unique invite identifier                       |
| `server_id`  | UUID      | Server the invite belongs to                   |
| `code`       | string    | 8-character alphanumeric invite code           |
| `created_by` | UUID?     | User who created the invite                    |
| `max_uses`   | integer?  | Maximum number of times the invite can be used |
| `uses`       | integer   | Number of times the invite has been used       |
| `expires_at` | datetime? | UTC expiry timestamp, null for no expiry       |
| `created_at` | datetime  | UTC creation timestamp                         |

### InvitePreviewDto

Returned by the preview endpoint for unauthenticated invite viewing.

| Field             | Type      | Description                              |
| ----------------- | --------- | ---------------------------------------- |
| `code`            | string    | The invite code                          |
| `server_name`     | string    | Name of the server                       |
| `server_icon_url` | string?   | Server icon URL, nullable                |
| `member_count`    | integer   | Current number of members in the server  |
| `expires_at`      | datetime? | UTC expiry timestamp, null for no expiry |

### CreateInviteRequest

| Field              | Type    | Required | Description                               |
| ------------------ | ------- | -------- | ----------------------------------------- |
| `max_uses`         | integer | no       | Must be > 0 if provided                   |
| `expires_in_hours` | integer | no       | Must be 1–720 (up to 30 days) if provided |

The request body uses `deny_unknown_fields` — extra fields cause a deserialization error.

---

## Endpoints

All endpoints require a valid Bearer token unless otherwise noted.

### Create an Invite

```
POST /servers/:server_id/invites
Authorization: Bearer <token>
```

**Request body:**

```json
{
  "max_uses": 10,
  "expires_in_hours": 24
}
```

Both fields are optional. Omitting both creates a permanent, unlimited-use invite.

**Response:** `201 Created` with the full `ServerInvite` object.

**Errors:**

| Condition                         | Status | Message                                    |
| --------------------------------- | ------ | ------------------------------------------ |
| Not a server member               | 404    | Server not found                           |
| Missing CREATE_INVITES permission | 403    | You need the Create Invites permission     |
| `max_uses` is 0 or negative       | 400    | max_uses must be greater than 0            |
| `expires_in_hours` out of range   | 400    | expires_in_hours must be between 1 and 720 |

**Side effects:**

- Audit log entry with action `InviteCreate` (target_type: `invite`, details include `code` and `max_uses`)
- WebSocket `INVITE_CREATE` event broadcast to all server members

---

### List Invites

```
GET /servers/:server_id/invites
Authorization: Bearer <token>
```

Returns all invites for the server (including expired and fully used ones), ordered by `created_at DESC`.

**Response:** `200 OK` with an array of `ServerInvite` objects.

**Errors:**

| Condition                         | Status | Message                                |
| --------------------------------- | ------ | -------------------------------------- |
| Not a server member               | 404    | Server not found                       |
| Missing CREATE_INVITES permission | 403    | You need the Create Invites permission |

---

### Delete an Invite

```
DELETE /servers/:server_id/invites/:invite_id
Authorization: Bearer <token>
```

**Response:** `204 No Content`

**Errors:**

| Condition                         | Status | Message                                |
| --------------------------------- | ------ | -------------------------------------- |
| Not a server member               | 404    | Server not found                       |
| Missing CREATE_INVITES permission | 403    | You need the Create Invites permission |
| Invite not found in this server   | 404    | Invite not found                       |

**Side effects:**

- Audit log entry with action `InviteRevoke` (target_type: `invite`)
- WebSocket `INVITE_DELETE` event broadcast to all server members with `server_id` and `invite_id`

---

### Preview an Invite

```
GET /invites/:code
Authorization: Bearer <token>
```

Any authenticated user can preview an invite to see basic server information before joining. The endpoint filters out expired invites and invites that have reached their maximum uses.

**Response:** `200 OK` with an `InvitePreviewDto` object.

**Errors:**

| Condition                               | Status | Message                         |
| --------------------------------------- | ------ | ------------------------------- |
| Invite not found, expired, or maxed out | 404    | Invite not found or has expired |

---

### Accept an Invite

```
POST /invites/:code/accept
Authorization: Bearer <token>
```

Accepts the invite and joins the server. The use count is incremented atomically inside a database transaction to prevent race conditions.

**Response:** `201 Created`

```json
{
  "message": "Joined server",
  "server_id": "uuid"
}
```

**Errors:**

| Condition                      | Status | Message                                  |
| ------------------------------ | ------ | ---------------------------------------- |
| Invite code not found          | 404    | Invite not found                         |
| Invite has expired             | 400    | This invite has expired                  |
| Invite has reached max uses    | 400    | This invite has reached its maximum uses |
| User is banned from the server | 403    | You are banned from this server          |
| User is already a member       | 409    | Already a member of this server          |

**Atomic uses counter:** The `UPDATE server_invites SET uses = uses + 1 WHERE id = $1 AND (max_uses IS NULL OR uses < max_uses)` query runs inside the same transaction as the member insert. If a concurrent request exhausts the invite between the initial check and the update, the WHERE clause prevents the increment and the transaction is rejected with a 400 error. This prevents the invite from being used more times than `max_uses` even under concurrent requests.

---

## Permission Model

Invite management (create, list, delete) requires the `CREATE_INVITES` permission:

| Bit | Value | Name             |
| --- | ----- | ---------------- |
| 14  | 16384 | `CREATE_INVITES` |

Access is also granted if the user is the **server owner** or has the **ADMINISTRATOR** permission (bit 13, value 8192). This follows the same pattern as all other permission checks in Together.

Previewing and accepting invites does not require any server permission — only a valid authentication token.

---

## WebSocket Events

Both invite events are delivered as `DISPATCH` messages to all members of the server.

### `INVITE_CREATE`

Broadcast when a new invite is created. Payload is the full `ServerInvite` object.

```json
{
  "id": "uuid",
  "server_id": "uuid",
  "code": "aB3xK9mZ",
  "created_by": "uuid",
  "max_uses": 10,
  "uses": 0,
  "expires_at": "2026-03-23T12:00:00Z",
  "created_at": "2026-03-22T12:00:00Z"
}
```

### `INVITE_DELETE`

Broadcast when an invite is revoked.

```json
{
  "server_id": "uuid",
  "invite_id": "uuid"
}
```

---

## Audit Logging

Invite operations write to the audit log. Logging is non-blocking — if the write fails, the operation is not rolled back.

| Action         | `target_type` | `target_id` | `details`                           |
| -------------- | ------------- | ----------- | ----------------------------------- |
| `InviteCreate` | `invite`      | Invite UUID | `{ "code": "...", "max_uses": 10 }` |
| `InviteRevoke` | `invite`      | Invite UUID | `{}`                                |

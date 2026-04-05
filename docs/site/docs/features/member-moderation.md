---
outline: deep
---

# Member Moderation — Kick, Ban, Timeout

Manual member moderation allows server staff to kick, ban, or timeout members. These are human-initiated actions, distinct from auto-moderation rules.

---

## Permission Model

All moderation endpoints use the `can_moderate()` authorization check:

1. **Cannot target yourself** — returns `400 Bad Request`.
2. **Cannot target the server owner** — returns `403 Forbidden`.
3. **Server owner** — always passes, no role check needed.
4. **Role-based** — requires the action-specific permission bit **or** `ADMINISTRATOR` (bit 13).

| Action         | Required Permission | Bit |
| -------------- | ------------------- | --- |
| Kick a member  | `KICK_MEMBERS`      | 8   |
| Ban a member   | `BAN_MEMBERS`       | 9   |
| Timeout/unmute | `MUTE_MEMBERS`      | 7   |

Both the actor and the target must be current members of the server (verified via `require_member()`). Non-members receive `404 Not Found` to avoid leaking server existence.

> **Tip:** Moderation permissions are granted through the role management system. Assign roles with the
> appropriate permission bits (`KICK_MEMBERS`, `BAN_MEMBERS`, `MUTE_MEMBERS`, or `ADMINISTRATOR`) to
> allow trusted members to moderate without being the server owner. See [roles.md](roles.md) for how
> to create and assign roles.

---

## Endpoints

### Kick a Member

```
POST /servers/:server_id/members/:user_id/kick
Authorization: Bearer <token>
```

Removes the target from the server. They can rejoin unless also banned.

**Request body** (optional):

```json
{
  "reason": "Spamming in general chat"
}
```

Both the body and the `reason` field are optional. An empty request body is accepted.

**Response**: `204 No Content`

**Side effects**:

- If the target is in a voice channel, their voice state is deleted and a `VOICE_STATE_UPDATE` event (leave) is broadcast.
- A `MEMBER_KICK` event is broadcast to the server **before** the membership row is removed, so the target receives it.
- The membership row is deleted from `server_members`.
- An audit log entry with action `member_kick` is recorded.

---

### Ban a Member

```
POST /servers/:server_id/members/:user_id/ban
Authorization: Bearer <token>
```

Bans the target from the server — removes membership and prevents rejoin. The target does not need to be a current member (e.g. they may have already left); the `can_moderate()` check still runs against the `servers` table for ownership and permission verification.

**Request body** (optional):

```json
{
  "reason": "Repeated harassment"
}
```

Both the body and the `reason` field are optional.

**Response**: `204 No Content`

**Side effects**:

- Voice state cleanup and `VOICE_STATE_UPDATE` broadcast (same as kick).
- A `MEMBER_BAN` event is broadcast before membership removal.
- A row is upserted into `server_bans`. If the user was already banned, the `banned_by` and `reason` fields are updated.
- The membership row is deleted from `server_members`.
- An audit log entry with action `member_ban` is recorded.

**Ban enforcement**: The `join_server()` handler checks `server_bans` before allowing a user to join. A banned user receives `403 Forbidden`.

---

### Timeout a Member

```
POST /servers/:server_id/members/:user_id/timeout
Authorization: Bearer <token>
```

Applies a timeout to the target member. Timed-out users cannot send messages in the server.

**Request body** (required):

```json
{
  "duration_minutes": 60,
  "reason": "Cool down"
}
```

| Field              | Type    | Required | Constraints          |
| ------------------ | ------- | -------- | -------------------- |
| `duration_minutes` | integer | yes      | 1 to 40320 (28 days) |
| `reason`           | string  | no       | Free-text, nullable  |

Values outside the 1–40320 range return `400 Bad Request`.

**Response**: `200 OK` with the timeout record:

```json
{
  "user_id": "uuid",
  "server_id": "uuid",
  "expires_at": "2026-03-22T12:00:00Z",
  "reason": "Cool down",
  "created_by": "uuid",
  "created_at": "2026-03-21T12:00:00Z"
}
```

**Side effects**:

- A row is upserted into `automod_timeouts`. If the user already has a timeout, it is replaced (new expiry, reason, and actor).
- A `MEMBER_TIMEOUT` event is broadcast to the server.
- An audit log entry with action `member_timeout` is recorded, including `duration_minutes` and `reason` in the details.

**Timeout enforcement**: The `check_timeout()` function is called on message send. If the user has a row in `automod_timeouts` with `expires_at > NOW()`, the message is rejected with `403 Forbidden`. This check applies to both manual and automod-applied timeouts — they share the same table.

---

### Remove a Timeout

```
DELETE /servers/:server_id/members/:user_id/timeout
Authorization: Bearer <token>
```

Removes an active timeout from a member early. Silently succeeds even if the user has no active timeout.

**Request body**: None.

**Response**: `204 No Content`

**Side effects**:

- The timeout row is deleted from `automod_timeouts`.
- A `MEMBER_TIMEOUT_REMOVE` event is broadcast.
- An audit log entry with action `member_timeout_remove` is recorded.

---

### Unban a User (existing endpoint)

```
DELETE /servers/:server_id/bans/:user_id
Authorization: Bearer <token>
```

Removes a ban, allowing the user to rejoin. Requires `BAN_MEMBERS` permission (or server owner / `ADMINISTRATOR`). Silently succeeds even if the user was not banned.

**Response**: `204 No Content`

---

## WebSocket Events

All events are delivered as `DISPATCH` messages to server members.

### `MEMBER_KICK`

Broadcast before the membership row is deleted, so the kicked user's client receives it.

```json
{
  "server_id": "uuid",
  "user_id": "uuid",
  "reason": "Spamming in general chat"
}
```

### `MEMBER_BAN`

Broadcast before the membership row is deleted.

```json
{
  "server_id": "uuid",
  "user_id": "uuid",
  "reason": "Repeated harassment"
}
```

### `MEMBER_TIMEOUT`

```json
{
  "server_id": "uuid",
  "user_id": "uuid",
  "expires_at": "2026-03-22T12:00:00Z",
  "reason": "Cool down"
}
```

### `MEMBER_TIMEOUT_REMOVE`

```json
{
  "server_id": "uuid",
  "user_id": "uuid"
}
```

---

## Audit Logging

Every moderation action writes to `audit_logs` with `target_type: "user"` and `target_id` set to the affected user's UUID.

| Action                  | `details` contents                            |
| ----------------------- | --------------------------------------------- |
| `member_kick`           | `{ "reason": "..." }`                         |
| `member_ban`            | `{ "reason": "..." }`                         |
| `member_timeout`        | `{ "duration_minutes": 60, "reason": "..." }` |
| `member_timeout_remove` | `{}`                                          |
| `member_unban`          | `{}`                                          |

Audit logging is non-blocking — if the write fails, the moderation action is not rolled back.

---

## Error Summary

| Condition                                 | Status | Error message                                            |
| ----------------------------------------- | ------ | -------------------------------------------------------- |
| Missing or invalid token                  | 401    | `Invalid or expired token`                               |
| Actor not a server member                 | 404    | `Server not found`                                       |
| Target not a server member (kick/timeout) | 404    | `Server not found`                                       |
| Actor targets themselves                  | 400    | `You cannot moderate yourself`                           |
| Target is the server owner                | 403    | `Cannot moderate the server owner`                       |
| Actor lacks required permission           | 403    | `You lack the required permission for this action`       |
| Timeout duration out of range             | 400    | `duration_minutes must be between 1 and 40320 (28 days)` |

# Channel Permission Overrides

Together supports Discord-style per-channel permission overrides. Overrides let server administrators fine-tune which roles or users can do what in individual channels, without changing server-wide role permissions.

---

## Overview

Server-level roles define a baseline set of permissions for every channel. Channel permission overrides modify those baseline permissions for a specific channel only. Each override targets either a **role** or a **user** and contains two bitfields:

- **`allow`** — permission bits to explicitly grant in this channel
- **`deny`** — permission bits to explicitly revoke in this channel

The `allow` and `deny` bitfields must not have overlapping bits. Both use the same permission bitflag values documented in [roles.md](roles.md#permission-bitflags).

---

## Override Resolution

Effective permissions for a user in a channel are computed in this order:

1. **Server owner / ADMINISTRATOR bypass** — The server owner and any user with the `ADMINISTRATOR` bit (8192) always have all permissions. Overrides do not apply to them.
2. **Base permissions** — The bitwise OR of all the user's server-level role permissions, combined with the default member permissions.
3. **Role overrides** — All channel overrides targeting roles the user holds are merged: `allow` bits are OR'd together, `deny` bits are OR'd together. Deny clears bits first, then allow sets bits: `perms = (base & ~role_deny) | role_allow`.
4. **User override** — If a user-specific override exists for this channel, it is applied last with the highest priority: `perms = (perms & ~user_deny) | user_allow`.

### Default Member Permissions

All server members receive a baseline set of permissions even if they have no roles assigned:

| Permission      | Value |
| --------------- | ----- |
| `VIEW_CHANNEL`  | 1     |
| `SEND_MESSAGES` | 2     |
| `ATTACH_FILES`  | 8     |
| `ADD_REACTIONS` | 16    |
| `CONNECT_VOICE` | 32    |
| `SPEAK`         | 64    |

Combined value: `123` (bitwise OR of all above).

---

## Data Model

### ChannelPermissionOverride

| Field        | Type    | Description                                   |
| ------------ | ------- | --------------------------------------------- |
| `id`         | UUID    | Unique override identifier                    |
| `channel_id` | UUID    | Channel this override applies to              |
| `role_id`    | UUID?   | Target role (null if this is a user override) |
| `user_id`    | UUID?   | Target user (null if this is a role override) |
| `allow`      | integer | Permission bits to grant (0-32767)            |
| `deny`       | integer | Permission bits to revoke (0-32767)           |

Exactly one of `role_id` or `user_id` is set per override. The pair `(channel_id, role_id, user_id)` is unique — upserting with the same target replaces the existing override.

---

## Endpoints

All endpoints require a valid Bearer token. The caller must be a member of the channel's server.

### List Channel Overrides

```
GET /channels/:channel_id/overrides
Authorization: Bearer <token>
```

Returns all permission overrides for the channel. No special permissions are required beyond server membership.

**Response:** `200 OK` with an array of `ChannelPermissionOverride` objects, ordered by `role_id NULLS LAST, user_id NULLS LAST`.

```json
[
  {
    "id": "uuid",
    "channel_id": "uuid",
    "role_id": "uuid",
    "user_id": null,
    "allow": 0,
    "deny": 2
  },
  {
    "id": "uuid",
    "channel_id": "uuid",
    "role_id": null,
    "user_id": "uuid",
    "allow": 1024,
    "deny": 0
  }
]
```

**Errors:**

| Condition           | Status | Message           |
| ------------------- | ------ | ----------------- |
| Channel not found   | 404    | Channel not found |
| Not a server member | 404    | Server not found  |

---

### Set (Upsert) a Channel Override

```
PUT /channels/:channel_id/overrides
Authorization: Bearer <token>
```

Creates or replaces a permission override for a role or user in this channel. Requires the `MANAGE_CHANNELS` permission (bit 10, value 1024).

**Request body:**

```json
{
  "role_id": "uuid",
  "user_id": null,
  "allow": 0,
  "deny": 2
}
```

| Field     | Type    | Required | Description                                     |
| --------- | ------- | -------- | ----------------------------------------------- |
| `role_id` | UUID?   | no       | Target role (mutually exclusive with `user_id`) |
| `user_id` | UUID?   | no       | Target user (mutually exclusive with `role_id`) |
| `allow`   | integer | yes      | Permission bits to grant (0-32767)              |
| `deny`    | integer | yes      | Permission bits to revoke (0-32767)             |

Exactly one of `role_id` or `user_id` must be provided.

**Response:** `200 OK` with the full `ChannelPermissionOverride` object.

**Errors:**

| Condition                          | Status | Message                                                           |
| ---------------------------------- | ------ | ----------------------------------------------------------------- |
| Channel not found                  | 404    | Channel not found                                                 |
| Not a server member                | 404    | Server not found                                                  |
| Missing MANAGE_CHANNELS permission | 403    | You need the Manage Channels permission to edit channel overrides |
| Neither role_id nor user_id set    | 400    | Either role_id or user_id must be provided                        |
| Both role_id and user_id set       | 400    | Only one of role_id or user_id may be provided                    |
| allow and deny overlap             | 400    | allow and deny must not have overlapping bits                     |
| allow out of range                 | 400    | allow must be between 0 and 32767                                 |
| deny out of range                  | 400    | deny must be between 0 and 32767                                  |

---

### Delete a Channel Override

```
DELETE /channels/:channel_id/overrides/:override_id
Authorization: Bearer <token>
```

Removes a specific permission override. Requires the `MANAGE_CHANNELS` permission (bit 10, value 1024).

**Response:** `204 No Content`

**Errors:**

| Condition                          | Status | Message                                                             |
| ---------------------------------- | ------ | ------------------------------------------------------------------- |
| Channel not found                  | 404    | Channel not found                                                   |
| Not a server member                | 404    | Server not found                                                    |
| Missing MANAGE_CHANNELS permission | 403    | You need the Manage Channels permission to delete channel overrides |
| Override not found                 | 404    | Override not found                                                  |

---

## WebSocket Events

All channel override events are delivered as `DISPATCH` messages to all members of the server.

### `CHANNEL_OVERRIDE_UPDATE`

Broadcast when an override is created or updated.

```json
{
  "id": "uuid",
  "channel_id": "uuid",
  "role_id": "uuid",
  "user_id": null,
  "allow": 0,
  "deny": 2
}
```

### `CHANNEL_OVERRIDE_DELETE`

Broadcast when an override is removed.

```json
{
  "channel_id": "uuid",
  "override_id": "uuid"
}
```

---

## Audit Logging

All mutating operations write to the audit log. Logging is non-blocking — if the write fails, the operation is not rolled back.

| Action                    | `target_type` | `target_id`  | `details`                                                                            |
| ------------------------- | ------------- | ------------ | ------------------------------------------------------------------------------------ |
| `channel_override_update` | `channel`     | Channel UUID | `{ "override_id": "...", "role_id": "...", "user_id": null, "allow": 0, "deny": 2 }` |
| `channel_override_delete` | `channel`     | Channel UUID | `{ "override_id": "..." }`                                                           |

---

## Common Use Cases

### Read-only announcement channel

Deny `SEND_MESSAGES` for a role (e.g. the default "Member" role) so only moderators can post:

```json
{
  "role_id": "<member-role-id>",
  "allow": 0,
  "deny": 2
}
```

### Role-restricted voice channel

Deny `CONNECT_VOICE` and `SPEAK` for a role to block access, then allow for a specific role:

Override for "Member" role:

```json
{ "role_id": "<member-role-id>", "allow": 0, "deny": 96 }
```

Override for "VIP" role:

```json
{ "role_id": "<vip-role-id>", "allow": 96, "deny": 0 }
```

### Hidden admin channel

Deny `VIEW_CHANNEL` for the general member role so only administrators (who bypass overrides) can see it:

```json
{
  "role_id": "<member-role-id>",
  "allow": 0,
  "deny": 1
}
```

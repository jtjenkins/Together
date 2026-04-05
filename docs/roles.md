⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/features/roles-and-permissions).
Please visit the new site for the latest version.

---

# Role Management

Together uses a Discord-compatible role-based permission system. Roles carry a set of permission bitflags and a position in the hierarchy. Higher-position roles outrank lower ones, and non-owner users can only manage roles below their own highest position.

---

## Permission Bitflags

Permissions are stored as a 64-bit integer. Each permission occupies one bit (bits 0-14, maximum value 32767).

| Bit | Value | Name              | Description                            |
| --- | ----- | ----------------- | -------------------------------------- |
| 0   | 1     | `VIEW_CHANNEL`    | View text and voice channels           |
| 1   | 2     | `SEND_MESSAGES`   | Send messages in text channels         |
| 2   | 4     | `MANAGE_MESSAGES` | Delete or pin messages by others       |
| 3   | 8     | `ATTACH_FILES`    | Upload files and images                |
| 4   | 16    | `ADD_REACTIONS`   | Add emoji reactions to messages        |
| 5   | 32    | `CONNECT_VOICE`   | Join voice channels                    |
| 6   | 64    | `SPEAK`           | Speak in voice channels                |
| 7   | 128   | `MUTE_MEMBERS`    | Timeout / mute other members           |
| 8   | 256   | `KICK_MEMBERS`    | Kick members from the server           |
| 9   | 512   | `BAN_MEMBERS`     | Ban members from the server            |
| 10  | 1024  | `MANAGE_CHANNELS` | Create, edit, and delete channels      |
| 11  | 2048  | `MANAGE_ROLES`    | Create, edit, delete, and assign roles |
| 12  | 4096  | `MANAGE_SERVER`   | Edit server name, icon, and settings   |
| 13  | 8192  | `ADMINISTRATOR`   | Grants all permissions implicitly      |
| 14  | 16384 | `CREATE_INVITES`  | Create, list, and delete invite links  |

A role's `permissions` field is the bitwise OR of all granted bits. For example, a "Moderator" role with `MANAGE_MESSAGES`, `MUTE_MEMBERS`, and `KICK_MEMBERS` would have `permissions = 4 | 128 | 256 = 388`.

---

## Hierarchy Rules

1. **Server owner** bypasses all permission and hierarchy checks. The owner can always manage any role, regardless of position.
2. **ADMINISTRATOR** permission grants all other permissions implicitly. Permission checks treat a user with `ADMINISTRATOR` as having every bit set.
3. **MANAGE_ROLES** (bit 11) is required for all role management endpoints (create, update, delete, assign, remove).
4. **Position-based hierarchy**: Non-owner users can only manage roles whose `position` is strictly below their own highest role position. Attempting to create, edit, delete, assign, or remove a role at or above the actor's highest position returns `403 Forbidden`.
5. **Cannot grant permissions you don't have**: When creating or updating a role, a non-owner/non-administrator user cannot set permission bits they don't already possess.
6. **Cannot remove roles from the server owner**: Non-owner users cannot remove roles from the server owner.

---

## Data Model

### Role

| Field         | Type     | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `id`          | UUID     | Unique role identifier                       |
| `server_id`   | UUID     | Server the role belongs to                   |
| `name`        | string   | Display name (1-100 characters)              |
| `permissions` | integer  | Bitflag value (0-16383)                      |
| `color`       | string?  | Hex color code (e.g. `#FF5733`), nullable    |
| `position`    | integer  | Hierarchy position (higher = more authority) |
| `created_at`  | datetime | UTC creation timestamp                       |

### MemberRoleInfo

Lightweight role summary included in member list responses.

| Field      | Type    | Description              |
| ---------- | ------- | ------------------------ |
| `id`       | UUID    | Role identifier          |
| `name`     | string  | Role display name        |
| `color`    | string? | Hex color code, nullable |
| `position` | integer | Hierarchy position       |

---

## Endpoints

All endpoints require a valid Bearer token. The caller must be a member of the server.

### Create a Role

```
POST /servers/:server_id/roles
Authorization: Bearer <token>
```

**Request body:**

```json
{
  "name": "Moderator",
  "permissions": 388,
  "color": "#3498DB",
  "position": 5
}
```

| Field         | Type    | Required | Description                                    |
| ------------- | ------- | -------- | ---------------------------------------------- |
| `name`        | string  | yes      | 1-100 characters                               |
| `permissions` | integer | no       | Defaults to `0`                                |
| `color`       | string  | no       | Hex color code                                 |
| `position`    | integer | no       | Defaults to `MAX(position) + 1` for the server |

**Response:** `201 Created` with the full `Role` object.

**Errors:**

| Condition                            | Status | Message                                                     |
| ------------------------------------ | ------ | ----------------------------------------------------------- |
| Missing MANAGE_ROLES permission      | 403    | You need the Manage Roles permission                        |
| Name empty or > 100 characters       | 400    | Role name must be 1-100 characters                          |
| Permissions out of range             | 400    | Permissions must be between 0 and 16383                     |
| Position at or above actor's highest | 403    | Cannot create a role at or above your highest role position |
| Granting permissions actor lacks     | 403    | Cannot grant permissions you do not have                    |

---

### List Roles

```
GET /servers/:server_id/roles
Authorization: Bearer <token>
```

**Response:** `200 OK` with an array of `Role` objects, ordered by `position DESC`.

No special permissions are required beyond server membership.

---

### Update a Role

```
PATCH /servers/:server_id/roles/:role_id
Authorization: Bearer <token>
```

**Request body** (all fields optional):

```json
{
  "name": "Senior Moderator",
  "permissions": 2436,
  "color": "#E74C3C",
  "position": 8
}
```

| Field         | Type    | Description            |
| ------------- | ------- | ---------------------- |
| `name`        | string  | 1-100 characters       |
| `permissions` | integer | 0-16383                |
| `color`       | string  | Hex color code         |
| `position`    | integer | New hierarchy position |

Only provided fields are updated; omitted fields are left unchanged.

**Response:** `200 OK` with the updated `Role` object.

**Errors:**

| Condition                                 | Status | Message                                                                 |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Missing MANAGE_ROLES permission           | 403    | You need the Manage Roles permission                                    |
| Role not found                            | 404    | Role not found                                                          |
| Name empty or > 100 characters            | 400    | Role name must be 1-100 characters                                      |
| Permissions out of range                  | 400    | Permissions must be between 0 and 16383                                 |
| Role at or above actor's highest position | 403    | Cannot edit a role at or above your highest role position               |
| Moving role to position at or above actor | 403    | Cannot move a role to a position at or above your highest role position |
| Granting permissions actor lacks          | 403    | Cannot grant permissions you do not have                                |

---

### Delete a Role

```
DELETE /servers/:server_id/roles/:role_id
Authorization: Bearer <token>
```

**Response:** `204 No Content`

Deleting a role cascades to `member_roles` — all assignments of that role are removed.

**Errors:**

| Condition                                 | Status | Message                                                     |
| ----------------------------------------- | ------ | ----------------------------------------------------------- |
| Missing MANAGE_ROLES permission           | 403    | You need the Manage Roles permission                        |
| Role not found                            | 404    | Role not found                                              |
| Role at or above actor's highest position | 403    | Cannot delete a role at or above your highest role position |

---

### Assign a Role to a Member

```
PUT /servers/:server_id/members/:user_id/roles/:role_id
Authorization: Bearer <token>
```

**Request body:** None.

**Response:** `204 No Content`

If the member already has the role, the request succeeds silently (idempotent via `ON CONFLICT DO NOTHING`).

**Errors:**

| Condition                                 | Status | Message                                                     |
| ----------------------------------------- | ------ | ----------------------------------------------------------- |
| Missing MANAGE_ROLES permission           | 403    | You need the Manage Roles permission                        |
| Role not found                            | 404    | Role not found                                              |
| Target user not a member                  | 404    | Server not found                                            |
| Role at or above actor's highest position | 403    | Cannot assign a role at or above your highest role position |

---

### Remove a Role from a Member

```
DELETE /servers/:server_id/members/:user_id/roles/:role_id
Authorization: Bearer <token>
```

**Request body:** None.

**Response:** `204 No Content`

**Errors:**

| Condition                                 | Status | Message                                                     |
| ----------------------------------------- | ------ | ----------------------------------------------------------- |
| Missing MANAGE_ROLES permission           | 403    | You need the Manage Roles permission                        |
| Role not found                            | 404    | Role not found                                              |
| Target user not a member                  | 404    | Server not found                                            |
| Target is the server owner (non-owner)    | 403    | Cannot remove roles from the server owner                   |
| Role at or above actor's highest position | 403    | Cannot remove a role at or above your highest role position |

---

## WebSocket Events

All role events are delivered as `DISPATCH` messages to all members of the server.

### `ROLE_CREATE`

Broadcast when a new role is created.

```json
{
  "id": "uuid",
  "server_id": "uuid",
  "name": "Moderator",
  "permissions": 388,
  "color": "#3498DB",
  "position": 5,
  "created_at": "2026-03-22T12:00:00Z"
}
```

### `ROLE_UPDATE`

Broadcast when a role is updated.

```json
{
  "id": "uuid",
  "server_id": "uuid",
  "name": "Senior Moderator",
  "permissions": 2436,
  "color": "#E74C3C",
  "position": 8,
  "created_at": "2026-03-22T12:00:00Z"
}
```

### `ROLE_DELETE`

Broadcast when a role is deleted.

```json
{
  "server_id": "uuid",
  "role_id": "uuid"
}
```

### `MEMBER_ROLE_ADD`

Broadcast when a role is assigned to a member.

```json
{
  "server_id": "uuid",
  "user_id": "uuid",
  "role_id": "uuid",
  "role_name": "Moderator",
  "role_color": "#3498DB"
}
```

### `MEMBER_ROLE_REMOVE`

Broadcast when a role is removed from a member.

```json
{
  "server_id": "uuid",
  "user_id": "uuid",
  "role_id": "uuid",
  "role_name": "Moderator",
  "role_color": "#3498DB"
}
```

---

## Channel Permission Overrides

Role permissions define what a user can do across the entire server. Per-channel permission overrides allow fine-tuning on a channel-by-channel basis without changing the role itself.

- Overrides can target a **role** or a specific **user**.
- Each override carries an `allow` bitfield (grants permissions) and a `deny` bitfield (revokes permissions).
- Role overrides are applied first (merged across all matching roles), then a user-specific override is applied on top with the highest priority.
- **Server owner** and **ADMINISTRATOR** users bypass all channel overrides — they always have full permissions.
- When no overrides exist for a channel, the user's effective permissions are their server-level role permissions combined with the default member permissions.

For full documentation on override resolution, endpoints, and examples, see [channel-permissions.md](channel-permissions.md).

---

## READY Payload

The `READY` event sent on WebSocket connection includes a `server_roles` field. This is an object keyed by server ID, where each value is an array of `Role` objects for that server (ordered by `position DESC`).

```json
{
  "op": "DISPATCH",
  "t": "READY",
  "d": {
    "user": { ... },
    "servers": [ ... ],
    "server_roles": {
      "server-uuid-1": [
        { "id": "role-uuid", "server_id": "server-uuid-1", "name": "Admin", "permissions": 8192, "color": "#E74C3C", "position": 10, "created_at": "..." },
        { "id": "role-uuid", "server_id": "server-uuid-1", "name": "Member", "permissions": 3, "color": null, "position": 1, "created_at": "..." }
      ]
    }
  }
}
```

---

## Member List

The `GET /servers/:id/members` endpoint includes a `roles` array on each member, containing `MemberRoleInfo` objects (id, name, color, position) for all roles assigned to that member. Roles are ordered by `position DESC`.

---

## Audit Logging

All role management operations write to the audit log. Logging is non-blocking — if the write fails, the operation is not rolled back.

| Action               | `target_type` | `target_id`    | `details`                                  |
| -------------------- | ------------- | -------------- | ------------------------------------------ |
| `role_create`        | `role`        | Role UUID      | `{ "name": "...", "permissions": 388 }`    |
| `role_update`        | `role`        | Role UUID      | `{ "name": "...", "permissions": 2436 }`   |
| `role_delete`        | `role`        | Role UUID      | `{ "name": "..." }`                        |
| `member_role_add`    | `user`        | Target user ID | `{ "role_id": "...", "role_name": "..." }` |
| `member_role_remove` | `user`        | Target user ID | `{ "role_id": "...", "role_name": "..." }` |

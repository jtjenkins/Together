# Direct Messages

This guide covers the direct message (DM) system in Together, including how DM channels work, how to send and retrieve messages, read acknowledgement, and real-time events.

---

## Overview

Direct messages allow two users to have a private conversation outside of any server. The system has three components:

- **DM channels** (`direct_message_channels`) — a lightweight container representing a conversation between exactly two users. A channel has no name or metadata beyond its ID and creation timestamp.
- **DM channel members** (`direct_message_members`) — a join table linking each channel to its two participants.
- **DM messages** (`direct_messages`) — individual messages within a channel, each tied to an author and a channel.

DM channels are separate from server channels. They do not belong to any server, have no permission bitflags, and do not support features like threads, reactions, pinning, or polls.

---

## Endpoints

All DM endpoints require authentication via `Authorization: Bearer <token>`. There are no server-level permissions involved — only channel membership is checked.

### Create / Open a DM Channel

```
POST /dm-channels
```

Opens a DM channel with another user. This operation is **idempotent**: if a channel already exists between the two users, it is returned instead of creating a duplicate.

Concurrent requests between the same pair of users are safe. The server acquires a PostgreSQL advisory lock keyed to the sorted pair of user UUIDs, preventing duplicate channel creation under race conditions.

**Request body:**

```json
{
  "user_id": "d290f1ee-6c54-4b01-90e6-d701748f0851"
}
```

**Response (`201 Created` for new, `200 OK` for existing):**

```json
{
  "id": "a1b2c3d4-0000-0000-0000-000000000000",
  "recipient": {
    "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
    "username": "alice",
    "email": null,
    "avatar_url": "https://example.com/avatar.png",
    "bio": "Hello!",
    "pronouns": "she/her",
    "status": "online",
    "custom_status": "Working",
    "activity": null,
    "created_at": "2025-01-15T10:30:00Z",
    "is_admin": false
  },
  "created_at": "2025-06-01T12:00:00Z",
  "last_message_at": null
}
```

The `recipient` field always shows the **other** participant, not the requesting user. The `email` field is always `null` and `is_admin` is always `false` in this context to avoid leaking private information.

**Error cases:**

| Status | Condition |
| ------ | --------- |
| 400    | `user_id` is the requesting user's own ID ("Cannot open a DM channel with yourself") |
| 404    | Target user does not exist |

---

### List DM Channels

```
GET /dm-channels
```

Returns all DM channels the authenticated user participates in, ordered by most recent message first. Channels with no messages sort last.

**Response (`200 OK`):**

```json
[
  {
    "id": "a1b2c3d4-0000-0000-0000-000000000000",
    "recipient": {
      "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
      "username": "alice",
      "email": null,
      "avatar_url": null,
      "bio": null,
      "pronouns": null,
      "status": "offline",
      "custom_status": null,
      "activity": null,
      "created_at": "2025-01-15T10:30:00Z",
      "is_admin": false
    },
    "created_at": "2025-06-01T12:00:00Z",
    "last_message_at": "2025-06-02T09:15:00Z"
  }
]
```

---

### Send a DM Message

```
POST /dm-channels/:id/messages
```

Sends a message to a DM channel. The requesting user must be a member of the channel.

**Request body:**

```json
{
  "content": "Hey, want to play tonight?"
}
```

Content must be between 1 and 4000 characters.

**Response (`201 Created`):**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "channel_id": "a1b2c3d4-0000-0000-0000-000000000000",
  "author_id": "c3d4e5f6-0000-0000-0000-000000000000",
  "content": "Hey, want to play tonight?",
  "edited_at": null,
  "created_at": "2025-06-02T09:15:00Z"
}
```

The `deleted` field exists in the database but is never serialized to clients.

If the author's account is later deleted, `author_id` becomes `null` (the foreign key uses `ON DELETE SET NULL`). Clients should render these as "Deleted User".

**Error cases:**

| Status | Condition |
| ------ | --------- |
| 400    | Content is empty or exceeds 4000 characters |
| 404    | Channel does not exist or requesting user is not a member |

---

### List DM Messages

```
GET /dm-channels/:id/messages
```

Returns messages in a DM channel using cursor-based pagination. Messages are ordered newest first. Soft-deleted messages are filtered out at the database level.

**Query parameters:**

| Parameter | Type   | Default | Description |
| --------- | ------ | ------- | ----------- |
| `before`  | UUID   | (none)  | Return messages older than this message ID (cursor) |
| `limit`   | integer | 50     | Number of messages to return (1-100) |

**Response (`200 OK`):**

```json
[
  {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "channel_id": "a1b2c3d4-0000-0000-0000-000000000000",
    "author_id": "c3d4e5f6-0000-0000-0000-000000000000",
    "content": "Hey, want to play tonight?",
    "edited_at": null,
    "created_at": "2025-06-02T09:15:00Z"
  }
]
```

To paginate, pass the `id` of the last message in the current page as the `before` parameter in the next request.

**Error cases:**

| Status | Condition |
| ------ | --------- |
| 404    | Channel does not exist or requesting user is not a member |

---

## Read Acknowledgement

DM channels share the same read-state mechanism as server channels, using the `channel_read_states` table.

### Acknowledge a DM Channel

```
POST /dm-channels/:id/ack
```

Marks the DM channel as read at the current time. This is an upsert: it creates a read-state row if one does not exist, or updates the existing `last_read_at` timestamp to `NOW()`.

The `channel_read_states` table has no foreign key to either `channels` or `direct_message_channels` — it uses a single `channel_id` column that can reference either type. Application code verifies DM channel membership before upserting.

**Response:** `204 No Content`

**Error cases:**

| Status | Condition |
| ------ | --------- |
| 404    | Channel does not exist or requesting user is not a member |

### Unread Counts

Unread counts for DM channels are included in the `READY` WebSocket event payload when a user connects. The count is the number of messages in the channel created after the user's `last_read_at` timestamp. Channels with no read-state row are omitted entirely from the unread summary.

---

## WebSocket Events

DM events are delivered to participants via the WebSocket gateway as `DISPATCH` operations. Unlike server channel events (which broadcast to all server members), DM events are sent only to the specific participant user IDs.

### DM_CHANNEL_CREATE

Sent to **both** participants when a new DM channel is created. Each user receives a perspective-correct payload where `recipient` is the other participant.

```json
{
  "op": 0,
  "t": "DM_CHANNEL_CREATE",
  "d": {
    "id": "a1b2c3d4-0000-0000-0000-000000000000",
    "recipient": {
      "id": "d290f1ee-6c54-4b01-90e6-d701748f0851",
      "username": "alice",
      "email": null,
      "avatar_url": null,
      "bio": null,
      "pronouns": null,
      "status": "online",
      "custom_status": null,
      "activity": null,
      "created_at": "2025-01-15T10:30:00Z",
      "is_admin": false
    },
    "created_at": "2025-06-01T12:00:00Z",
    "last_message_at": null
  }
}
```

This event is only sent when a channel is newly created. Opening an existing channel returns `200 OK` over HTTP without emitting a WebSocket event.

### DM_MESSAGE_CREATE

Sent to **both** participants (including the sender) when a message is sent in a DM channel.

```json
{
  "op": 0,
  "t": "DM_MESSAGE_CREATE",
  "d": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "channel_id": "a1b2c3d4-0000-0000-0000-000000000000",
    "author_id": "c3d4e5f6-0000-0000-0000-000000000000",
    "content": "Hey, want to play tonight?",
    "edited_at": null,
    "created_at": "2025-06-02T09:15:00Z"
  }
}
```

---

## Relationship to Server Channels

DM channels are a parallel system to server channels. Key differences:

| Aspect | Server channels | DM channels |
| ------ | --------------- | ----------- |
| Table | `channels` | `direct_message_channels` |
| Messages table | `messages` | `direct_messages` |
| Belongs to a server | Yes | No |
| Participants | All server members (permission-gated) | Exactly two users |
| Permission system | Bitflag roles with channel overrides | Membership only |
| Threads | Supported | Not supported |
| Reactions | Supported | Not supported |
| Pinning | Supported | Not supported |
| Polls | Supported | Not supported |
| Full-text search | Supported | Not supported |
| Attachments | Supported | Not supported |
| Read state tracking | `channel_read_states` table | Same `channel_read_states` table |

The `channel_read_states` table is shared between both systems. Its `channel_id` column has no foreign key constraint, allowing it to reference either `channels.id` or `direct_message_channels.id`.

---

## Limitations

- **Two participants only**: DM channels are strictly between two users. Group DMs are not supported.
- **No editing or deleting messages**: The `direct_messages` table has `edited_at` and `deleted` columns, but there are no endpoints to edit or delete DM messages.
- **No attachments**: File uploads are not supported in DM channels.
- **No search**: Full-text search applies to server channel messages only.
- **No typing indicators**: The `TYPING_START` / `TYPING_STOP` events are scoped to server channels.
- **No blocking**: There is no mechanism to block a user from sending DMs.

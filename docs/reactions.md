# Emoji Reactions

This guide covers how emoji reactions work in Together, including available endpoints, permissions, real-time events, and current limitations.

---

## Overview

Reactions let members add emoji responses to messages in server channels. Each reaction is a (message, user, emoji) triple stored in the `message_reactions` table. The API returns aggregated counts per emoji rather than individual reaction rows, along with a `me` flag indicating whether the requesting user has added each emoji.

Reactions are currently supported on server channel messages only. Direct message reactions are not yet implemented.

---

## Permissions

| Who                   | Can react |
| --------------------- | --------- |
| Any server member     | Yes       |
| Non-members           | No        |

There is no special permission required to add or remove reactions. Any authenticated user who is a member of the server that owns the channel can react to messages in that channel. Membership is verified via `require_member` on every request.

---

## Endpoints

All reaction endpoints require authentication (`Authorization: Bearer <token>` or `Authorization: Bot <token>`) and server membership.

### Add Reaction

```
PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji}
```

Adds an emoji reaction from the authenticated user. The `{emoji}` path segment is the emoji string itself (e.g., a Unicode emoji like `%F0%9F%91%8D` for URL-encoded thumbs-up, or a custom emoji identifier).

**Request body:** None.

**Response:** `204 No Content` on success.

**Behaviour:**
- Idempotent. Adding the same emoji to the same message twice is silently ignored (no error, no duplicate row). The database uses `ON CONFLICT (message_id, user_id, emoji) DO NOTHING`.
- Broadcasts a `REACTION_ADD` WebSocket event to all members of the server.

**Error cases:**

| Status | Condition                                               |
| ------ | ------------------------------------------------------- |
| 400    | Emoji is empty or exceeds 64 bytes                      |
| 401    | Not authenticated                                       |
| 403    | User is not a member of the server                      |
| 404    | Channel not found, or message not found in this channel |

### Remove Reaction

```
DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}
```

Removes the authenticated user's reaction for the given emoji from the message.

**Request body:** None.

**Response:** `204 No Content` on success.

**Behaviour:**
- Only removes the requesting user's own reaction. There is no endpoint to remove another user's reaction.
- Broadcasts a `REACTION_REMOVE` WebSocket event to all members of the server.

**Error cases:**

| Status | Condition                                               |
| ------ | ------------------------------------------------------- |
| 400    | Emoji is empty or exceeds 64 bytes                      |
| 401    | Not authenticated                                       |
| 403    | User is not a member of the server                      |
| 404    | Channel not found, message not found, or reaction does not exist |

### List Reactions

```
GET /channels/{channel_id}/messages/{message_id}/reactions
```

Returns aggregated reaction counts for a message.

**Request body:** None.

**Response:** `200 OK` with a JSON array of reaction counts:

```json
[
  {
    "emoji": "\ud83d\udc4d",
    "count": 3,
    "me": true
  },
  {
    "emoji": "\u2764\ufe0f",
    "count": 1,
    "me": false
  }
]
```

| Field   | Type    | Description                                           |
| ------- | ------- | ----------------------------------------------------- |
| `emoji` | string  | The emoji string                                      |
| `count` | integer | Total number of users who added this emoji            |
| `me`    | boolean | Whether the authenticated user has added this reaction |

**Ordering:** Results are ordered by the earliest reaction timestamp per emoji (ascending) — emojis that were first reacted with earlier appear first.

**Error cases:**

| Status | Condition                                               |
| ------ | ------------------------------------------------------- |
| 401    | Not authenticated                                       |
| 403    | User is not a member of the server                      |
| 404    | Channel not found, or message not found in this channel |

---

## Emoji Format

The `emoji` field is a free-form text string with a maximum length of 64 bytes. Both Unicode emoji and custom emoji identifiers are accepted — the server performs no semantic validation on the content beyond the length check.

- **Unicode emoji:** Clients typically send the raw Unicode character(s), URL-encoded in the path segment (e.g., `%F0%9F%91%8D` for a thumbs-up).
- **Custom emoji:** The server stores whatever string the client sends. Custom emoji management (upload, listing) is handled separately via the custom emoji endpoints; the reactions system treats them as opaque strings.

---

## Real-Time Updates

Reaction changes are broadcast instantly over the WebSocket gateway to all members connected to the server:

| Action | Gateway event    | Payload                                              |
| ------ | ---------------- | ---------------------------------------------------- |
| Add    | `REACTION_ADD`   | `{ message_id, channel_id, user_id, emoji }`        |
| Remove | `REACTION_REMOVE`| `{ message_id, channel_id, user_id, emoji }`        |

Both events include the `user_id` of the member who added or removed the reaction. Clients should apply these delta events to keep their local reaction state in sync after the initial `list_reactions` fetch.

---

## Database Schema

Reactions are stored in the `message_reactions` table:

| Column       | Type         | Notes                                           |
| ------------ | ------------ | ----------------------------------------------- |
| `message_id` | UUID         | Foreign key to `messages(id)`, `ON DELETE CASCADE` |
| `user_id`    | UUID         | Foreign key to `users(id)`, `ON DELETE CASCADE`    |
| `emoji`      | TEXT         | The emoji string (max 64 bytes enforced by API)    |
| `created_at` | TIMESTAMPTZ  | Defaults to `NOW()`                                |

**Primary key:** `(message_id, user_id, emoji)` — a user can only add a given emoji to a message once.

**Index:** `reactions_message_idx` on `(message_id)` for fast lookups by message.

---

## Limitations

- **Server channels only:** Reactions on direct messages are not supported.
- **No per-message reaction limit:** There is no cap on how many distinct emoji can be added to a single message, nor on how many users can react with the same emoji.
- **Self-removal only:** Users can only remove their own reactions. There is no moderator endpoint to bulk-remove reactions from a message.
- **Soft-deleted messages:** Reactions on soft-deleted messages remain in the database but are inaccessible — `fetch_message` filters out deleted messages, so all three endpoints return 404 for deleted messages.
- **Hard-deleted messages:** When a message row is hard-deleted, all associated reactions are removed automatically via `ON DELETE CASCADE`.
- **No pagination:** The `list_reactions` endpoint returns all emoji for a message in a single response with no cursor or limit parameter.

---

## Frequently Asked Questions

**Can a user react with multiple different emoji on the same message?**
Yes. The uniqueness constraint is `(message_id, user_id, emoji)`, so a user can add as many different emoji as they want to the same message.

**What happens if I add the same reaction twice?**
Nothing. The request succeeds with `204 No Content` and the duplicate is silently ignored. A `REACTION_ADD` event is still broadcast.

**Are reactions included in the message list response?**
No. Reactions are fetched separately via `GET /channels/{channel_id}/messages/{message_id}/reactions`. The message object itself does not include reaction data.

**Can bots add reactions?**
Yes. Bots authenticating via `Authorization: Bot <token>` can use the reaction endpoints as long as they are a member of the server.

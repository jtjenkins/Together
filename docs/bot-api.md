# Together Bot API

This document describes the Bot API for Together — the interface used to register, manage, and authenticate automated bot users.

## Overview

Bots are automated user accounts that connect to Together via a long-lived token instead of a password. A human user registers a bot through the REST API, receives a plaintext token once, and then uses that token to authenticate all bot connections (REST and WebSocket).

---

## Authentication

### Human users registering/managing bots

All bot management endpoints require a standard user JWT in the `Authorization` header:

```
Authorization: Bearer <jwt_access_token>
```

Bots themselves are explicitly blocked from calling any bot management endpoint.

### Bot authentication for API requests

Once a bot token has been issued, the bot authenticates all API calls using:

```
Authorization: Bot <plaintext_token>
```

The server hashes the provided token with SHA-256 and compares it against the stored hash. If the token is revoked (`revoked_at` is set), requests are rejected with `401 Unauthorized`.

### Bot authentication for WebSocket

Pass the token as a query parameter when opening the WebSocket connection:

```
ws://your-server/ws?bot_token=<plaintext_token>
wss://your-server/ws?bot_token=<plaintext_token>
```

The server validates the token identically to the REST path. On success the bot receives the same real-time event stream as human users.

---

## Rate Limiting

Bot requests share the same rate-limiting infrastructure as human users:

- **50 requests per second** per token (enforced at the gateway level)
- Exceeding the limit returns `429 Too Many Requests`
- The `Retry-After` header indicates when the quota resets

---

## REST Endpoints

Base path: `/api/bots`

All endpoints require a valid human-user JWT unless otherwise noted.

---

### POST /api/bots

Register a new bot under the authenticated user's account.

**Request**

```http
POST /api/bots
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "My Moderation Bot",
  "description": "Handles welcome messages and auto-moderation."
}
```

| Field         | Type   | Required | Constraints          |
|---------------|--------|----------|----------------------|
| `name`        | string | yes      | 1–64 characters      |
| `description` | string | no       | max 512 characters   |

**Response** `201 Created`

```json
{
  "bot": {
    "id": "d4e8a1c2-...",
    "user_id": "f7b3c9e0-...",
    "name": "My Moderation Bot",
    "description": "Handles welcome messages and auto-moderation.",
    "created_by": "a1b2c3d4-...",
    "revoked_at": null,
    "created_at": "2026-03-12T10:00:00Z"
  },
  "token": "4a7f3c9e2b81d6..."
}
```

The `token` field is the plaintext bot token. **Store it securely — it is shown exactly once and cannot be retrieved again.** Only the SHA-256 hash is stored server-side.

**Errors**

| Status | Condition                                  |
|--------|--------------------------------------------|
| `400`  | Name is empty, exceeds 64 chars, or description exceeds 512 chars |
| `403`  | Caller is itself a bot                     |

---

### GET /api/bots

List all bots created by the authenticated user.

**Request**

```http
GET /api/bots
Authorization: Bearer <jwt>
```

**Response** `200 OK`

```json
{
  "bots": [
    {
      "id": "d4e8a1c2-...",
      "user_id": "f7b3c9e0-...",
      "name": "My Moderation Bot",
      "description": "Handles welcome messages and auto-moderation.",
      "created_by": "a1b2c3d4-...",
      "revoked_at": null,
      "created_at": "2026-03-12T10:00:00Z"
    }
  ]
}
```

Token hashes are never included in list or get responses.

**Errors**

| Status | Condition              |
|--------|------------------------|
| `403`  | Caller is itself a bot |

---

### GET /api/bots/:bot_id

Retrieve a single bot by ID. Only the bot's creator can access it.

**Request**

```http
GET /api/bots/d4e8a1c2-...
Authorization: Bearer <jwt>
```

**Response** `200 OK`

```json
{
  "id": "d4e8a1c2-...",
  "user_id": "f7b3c9e0-...",
  "name": "My Moderation Bot",
  "description": "Handles welcome messages and auto-moderation.",
  "created_by": "a1b2c3d4-...",
  "revoked_at": null,
  "created_at": "2026-03-12T10:00:00Z"
}
```

**Errors**

| Status | Condition                                    |
|--------|----------------------------------------------|
| `403`  | Caller is itself a bot                       |
| `404`  | Bot not found or owned by a different user   |

---

### DELETE /api/bots/:bot_id/revoke

Permanently revoke a bot's token. The bot's user account remains but all future authentication attempts with the old token are rejected. Revocation is irreversible — create a new bot if you need a replacement.

**Request**

```http
DELETE /api/bots/d4e8a1c2-.../revoke
Authorization: Bearer <jwt>
```

**Response** `204 No Content`

**Errors**

| Status | Condition                                      |
|--------|------------------------------------------------|
| `403`  | Caller is itself a bot                         |
| `404`  | Bot not found, owned by another user, or already revoked |

---

### POST /api/bots/:bot_id/regenerate-token

Issue a new token for an active (non-revoked) bot. The previous token is immediately invalidated. The new plaintext token is returned once and is not stored.

**Request**

```http
POST /api/bots/d4e8a1c2-.../regenerate-token
Authorization: Bearer <jwt>
```

**Response** `200 OK`

```json
{
  "bot": {
    "id": "d4e8a1c2-...",
    "user_id": "f7b3c9e0-...",
    "name": "My Moderation Bot",
    "description": "Handles welcome messages and auto-moderation.",
    "created_by": "a1b2c3d4-...",
    "revoked_at": null,
    "created_at": "2026-03-12T10:00:00Z"
  },
  "token": "9c1e5f2a7d84b3..."
}
```

**Errors**

| Status | Condition                                      |
|--------|------------------------------------------------|
| `400`  | Bot is revoked — create a new bot instead      |
| `403`  | Caller is itself a bot                         |
| `404`  | Bot not found or owned by a different user     |

---

## WebSocket Event Stream

After connecting with a valid bot token, the bot receives real-time gateway events using the same protocol as human clients.

**Connection**

```
wss://your-server/ws?bot_token=<plaintext_token>
```

**Heartbeat**

Send a heartbeat every 30 seconds to keep the connection alive:

```json
{ "op": "HEARTBEAT" }
```

**Incoming event envelope**

```json
{
  "op": "DISPATCH",
  "t": "MESSAGE_CREATE",
  "d": { ... }
}
```

Common event types a bot will receive:

| Event                  | Description                              |
|------------------------|------------------------------------------|
| `MESSAGE_CREATE`       | A new message was posted in a channel    |
| `MESSAGE_UPDATE`       | An existing message was edited           |
| `MESSAGE_DELETE`       | A message was deleted                    |
| `PRESENCE_UPDATE`      | A user's online status changed           |
| `VOICE_STATE_UPDATE`   | A user joined/left/moved a voice channel |
| `CHANNEL_CREATE`       | A new channel was created                |
| `CHANNEL_DELETE`       | A channel was deleted                    |

**Sending messages via REST while connected over WebSocket**

Bots post messages through the standard REST message endpoint (`POST /api/channels/:channel_id/messages`) using `Authorization: Bot <token>`. The WebSocket connection is receive-only for events.

---

## Token Security Best Practices

1. **Never expose the token in client-side code, logs, or version control.** Treat it with the same care as a database password.
2. **Store the token in an environment variable** or a secrets manager, not in a configuration file committed to source control.
3. **Rotate the token immediately** if you suspect it has been compromised, using the regenerate-token endpoint.
4. **Use HTTPS/WSS** in production. Plain HTTP/WS exposes the token in transit.
5. **Scope bot permissions** by only adding the bot to channels and servers it needs. Bots inherit the permission system the same as human users.
6. **Monitor bot activity.** Unusual message rates or API call patterns may indicate a compromised token.

---

## Token Generation Details

Bot tokens are 64-character lowercase hex strings generated by hashing two independent UUIDv4 values through SHA-256. Only the SHA-256 hash of the token is stored in the database — the plaintext is never persisted. This matches the refresh-token storage pattern used elsewhere in Together and allows O(1) token lookup by hash without bcrypt's non-determinism.

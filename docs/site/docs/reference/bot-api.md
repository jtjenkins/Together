---
outline: deep
---

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

There are two ways to authenticate a bot for WebSocket connections:

**Option 1 — Static token (simpler but exposes the token in server/proxy access logs)**

```
wss://your-server/ws?bot_token=<plaintext_token>
```

**Option 2 — Short-lived JWT via `POST /bots/connect` (recommended)**

First exchange the static token for a JWT (see [POST /bots/connect](#post-botsconnect)), then connect with:

```
wss://your-server/ws?token=<jwt>
```

This avoids exposing the long-lived bot token in URL logs.

Both paths validate the token identically. On success the bot receives the same real-time event stream as human users.

---

## Rate Limiting

Bot REST API requests are rate-limited at **50 requests per second** per bot (keyed by the bot's `user_id`). This is a separate rate-limiting layer from the per-IP limit applied to human users.

- Exceeding the limit returns `429 Too Many Requests` with a JSON body: `{"error": "Bot rate limit exceeded. Max 50 requests/second."}`
- **No `Retry-After` header is included** in the 429 response
- This rate limit does **not** apply to WebSocket connections — WebSocket connections are persistent resources and are bounded by connection limits at the TCP/HTTP level instead

---

## REST Endpoints

Base path: `/bots`

All endpoints require a valid human-user JWT unless otherwise noted.

---

### POST /bots

Register a new bot under the authenticated user's account.

**Request**

```http
POST /bots
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "My Moderation Bot",
  "description": "Handles welcome messages and auto-moderation."
}
```

| Field         | Type   | Required | Constraints        |
| ------------- | ------ | -------- | ------------------ |
| `name`        | string | yes      | 1–64 characters    |
| `description` | string | no       | max 512 characters |

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

> **Note:** The `created_by` field is `Option<Uuid>` and can be `null` in responses (e.g., if the creating user's account has been deleted).

**Errors**

| Status | Condition                                                         |
| ------ | ----------------------------------------------------------------- |
| `400`  | Name is empty, exceeds 64 chars, description exceeds 512 chars, or name contains no alphanumeric characters |
| `403`  | Caller is itself a bot                                                                                      |

---

### GET /bots

List all bots created by the authenticated user.

**Request**

```http
GET /bots
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
| ------ | ---------------------- |
| `403`  | Caller is itself a bot |

---

### GET /bots/:id

Retrieve a single bot by ID. Only the bot's creator can access it.

**Request**

```http
GET /bots/d4e8a1c2-...
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

| Status | Condition                                  |
| ------ | ------------------------------------------ |
| `403`  | Caller is itself a bot                     |
| `404`  | Bot not found or owned by a different user |

---

### DELETE /bots/:id

Permanently revoke a bot's token. The bot's user account remains but all future authentication attempts with the old token are rejected. Revocation is irreversible — create a new bot if you need a replacement.

**Request**

```http
DELETE /bots/d4e8a1c2-...
Authorization: Bearer <jwt>
```

**Response** `204 No Content`

**Errors**

| Status | Condition                                                |
| ------ | -------------------------------------------------------- |
| `403`  | Caller is itself a bot                                   |
| `404`  | Bot not found, owned by another user, or already revoked |

---

### PATCH /bots/:id

Update a bot's name and/or description. Only the bot's creator can update it. Updates are rejected if the bot has been revoked.

**Request**

```http
PATCH /bots/d4e8a1c2-...
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "Renamed Bot",
  "description": "Updated description."
}
```

| Field         | Type            | Required | Constraints        |
| ------------- | --------------- | -------- | ------------------ |
| `name`        | string          | no       | 1–64 characters, must contain at least one alphanumeric character |
| `description` | string \| null  | no       | max 512 characters (pass `null` to clear) |

**Response** `200 OK`

```json
{
  "id": "d4e8a1c2-...",
  "user_id": "f7b3c9e0-...",
  "name": "Renamed Bot",
  "description": "Updated description.",
  "created_by": "a1b2c3d4-...",
  "revoked_at": null,
  "created_at": "2026-03-12T10:00:00Z"
}
```

**Errors**

| Status | Condition                                                             |
| ------ | --------------------------------------------------------------------- |
| `400`  | Name is empty, exceeds 64 chars, has no alphanumeric characters, description exceeds 512 chars, or bot is revoked |
| `403`  | Caller is itself a bot                                                |
| `404`  | Bot not found or owned by a different user                            |

---

### GET /bots/:id/logs

Retrieve synthesized activity logs for a bot. Returns creation, recent messages sent (up to 50), and revocation events, sorted newest-first. Only the bot's creator can access logs.

**Request**

```http
GET /bots/d4e8a1c2-.../logs
Authorization: Bearer <jwt>
```

**Response** `200 OK`

```json
{
  "logs": [
    {
      "timestamp": "2026-03-12T14:30:00Z",
      "event": "message_sent",
      "detail": "[channel f1a2b3c4-...] Hello, welcome to the server!"
    },
    {
      "timestamp": "2026-03-12T10:00:00Z",
      "event": "bot_created",
      "detail": "Bot \"My Moderation Bot\" was created"
    }
  ]
}
```

Each log entry has:

| Field       | Type           | Description                                              |
| ----------- | -------------- | -------------------------------------------------------- |
| `timestamp` | ISO 8601 string | When the event occurred                                  |
| `event`     | string         | One of `bot_created`, `message_sent`, or `bot_revoked`   |
| `detail`    | string \| null | Human-readable description (message previews truncated to 80 chars) |

**Errors**

| Status | Condition                                  |
| ------ | ------------------------------------------ |
| `403`  | Caller is itself a bot                     |
| `404`  | Bot not found or owned by a different user |

---

### POST /bots/:id/token/regenerate

Issue a new token for an active (non-revoked) bot. The previous token is immediately invalidated. The new plaintext token is returned once and is not stored.

**Request**

```http
POST /bots/d4e8a1c2-.../token/regenerate
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

| Status | Condition                                  |
| ------ | ------------------------------------------ |
| `400`  | Bot is revoked — create a new bot instead  |
| `403`  | Caller is itself a bot                     |
| `404`  | Bot not found or owned by a different user |

---

### POST /bots/connect

Exchange a static bot token for a short-lived JWT access token (15 minutes). This is a **bot-only** endpoint — human users receive `403 Forbidden`.

The returned JWT can be used to open a WebSocket connection via `?token=<jwt>`, which avoids exposing the long-lived bot token in server or proxy access logs. This is the recommended authentication method for WebSocket connections.

**Request**

```http
POST /bots/connect
Authorization: Bot <plaintext_token>
```

**Response** `200 OK`

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors**

| Status | Condition                                  |
| ------ | ------------------------------------------ |
| `401`  | Invalid or revoked bot token               |
| `403`  | Caller is a human user (bot-only endpoint) |

---

## WebSocket Event Stream

After connecting with a valid bot token or JWT, the bot receives real-time gateway events using the same protocol as human clients.

**Connection**

```
# Option 1: Static token (simpler, but exposes token in logs)
wss://your-server/ws?bot_token=<plaintext_token>

# Option 2: Short-lived JWT from POST /bots/connect (recommended)
wss://your-server/ws?token=<jwt>
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

| Event                | Description                              |
| -------------------- | ---------------------------------------- |
| `MESSAGE_CREATE`     | A new message was posted in a channel    |
| `MESSAGE_UPDATE`     | An existing message was edited           |
| `MESSAGE_DELETE`     | A message was deleted                    |
| `PRESENCE_UPDATE`    | A user's online status changed           |
| `VOICE_STATE_UPDATE` | A user joined/left/moved a voice channel |
| `CHANNEL_CREATE`     | A new channel was created                |
| `CHANNEL_DELETE`     | A channel was deleted                    |

**Sending messages via REST while connected over WebSocket**

Bots post messages through the standard REST message endpoint (`POST /api/channels/:channel_id/messages`) using `Authorization: Bot <token>`. The WebSocket connection is receive-only for events.

---

## Token Security Best Practices

1. **Never expose the token in client-side code, logs, or version control.** Treat it with the same care as a database password.
2. **Store the token in an environment variable** or a secrets manager, not in a configuration file committed to source control.
3. **Rotate the token immediately** if you suspect it has been compromised, using the POST /bots/:id/token/regenerate endpoint.
4. **Use HTTPS/WSS** in production. Plain HTTP/WS exposes the token in transit.
5. **Scope bot permissions** by only adding the bot to channels and servers it needs. Bots inherit the permission system the same as human users.
6. **Monitor bot activity.** Unusual message rates or API call patterns may indicate a compromised token.

---

## Token Generation Details

Bot tokens are 64-character lowercase hex strings generated by hashing two independent UUIDv4 values through SHA-256. Only the SHA-256 hash of the token is stored in the database — the plaintext is never persisted. This matches the refresh-token storage pattern used elsewhere in Together and allows O(1) token lookup by hash without bcrypt's non-determinism.

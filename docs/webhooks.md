⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/reference/webhooks).
Please visit the new site for the latest version.

---

# Webhooks

This document describes Together's webhook system — outbound HTTP notifications sent to external URLs when events occur in a server.

## Overview

Webhooks allow server administrators to receive real-time HTTP POST callbacks when specific events happen (messages created, members joining, etc.). Each webhook targets a URL, subscribes to one or more event types, and signs every payload with HMAC-SHA256 so recipients can verify authenticity.

Webhooks are scoped to a single server. A server can have up to 10 webhooks. The signing secret is shown exactly once at creation and cannot be retrieved again.

---

## Event Types

Webhooks can subscribe to any combination of these event types:

| Event Type        | Description                        | Currently dispatched |
| ----------------- | ---------------------------------- | -------------------- |
| `message.created` | A new message was posted           | Yes                  |
| `message.updated` | An existing message was edited     | Yes                  |
| `message.deleted` | A message was deleted              | Yes                  |
| `member.joined`   | A user joined the server           | No (not yet wired)   |
| `member.left`     | A user left the server             | No (not yet wired)   |

The `member.joined` and `member.left` types are accepted when creating or updating a webhook but are not yet dispatched from any handler — no deliveries will occur for those events until the server-side dispatch calls are added.

---

## Permissions

All webhook endpoints require the caller to be a **server member** with one of:

- **Server owner** status, or
- A role with the **Administrator** permission (bit 13, value `8192`)

Requests from users who lack these permissions receive `403 Forbidden`.

---

## REST Endpoints

Base path: `/servers/:server_id/webhooks`

All endpoints require a valid user JWT in the `Authorization: Bearer <token>` header.

---

### POST /servers/:server_id/webhooks

Create a new webhook.

**Request**

```http
POST /servers/a1b2c3d4-.../webhooks
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "CI Notifications",
  "url": "https://example.com/hooks/together",
  "event_types": ["message.created", "member.joined"]
}
```

| Field         | Type     | Required | Constraints                                                                  |
| ------------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `name`        | string   | yes      | 1–100 characters (trimmed)                                                   |
| `url`         | string   | yes      | Must start with `http://` or `https://`, max 2000 characters                 |
| `event_types` | string[] | yes      | At least one valid event type (see [Event Types](#event-types))              |

**Response** `201 Created`

```json
{
  "webhook": {
    "id": "d4e8a1c2-...",
    "server_id": "a1b2c3d4-...",
    "created_by": "f7b3c9e0-...",
    "name": "CI Notifications",
    "url": "https://example.com/hooks/together",
    "event_types": ["message.created", "member.joined"],
    "enabled": true,
    "delivery_failures": 0,
    "last_used_at": null,
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z"
  },
  "secret": "a3f8c1d2e9b0..."
}
```

The `secret` field is a 64-character hex string used for HMAC-SHA256 signature verification. **Store it securely — it is shown exactly once and cannot be retrieved again.**

**Errors**

| Status | Condition                                                      |
| ------ | -------------------------------------------------------------- |
| `400`  | Name empty or >100 chars, invalid URL, invalid event types     |
| `400`  | Server already has 10 webhooks                                 |
| `403`  | Caller is not server owner and lacks Administrator permission  |

---

### GET /servers/:server_id/webhooks

List all webhooks for the server, ordered by creation time (oldest first).

**Request**

```http
GET /servers/a1b2c3d4-.../webhooks
Authorization: Bearer <jwt>
```

**Response** `200 OK`

```json
{
  "webhooks": [
    {
      "id": "d4e8a1c2-...",
      "server_id": "a1b2c3d4-...",
      "created_by": "f7b3c9e0-...",
      "name": "CI Notifications",
      "url": "https://example.com/hooks/together",
      "event_types": ["message.created"],
      "enabled": true,
      "delivery_failures": 0,
      "last_used_at": "2026-03-18T14:30:00Z",
      "created_at": "2026-03-18T12:00:00Z",
      "updated_at": "2026-03-18T12:00:00Z"
    }
  ]
}
```

The `secret` field is never included in list or get responses.

**Errors**

| Status | Condition                                                     |
| ------ | ------------------------------------------------------------- |
| `403`  | Caller is not server owner and lacks Administrator permission |

---

### GET /servers/:server_id/webhooks/:webhook_id

Retrieve a single webhook by ID.

**Request**

```http
GET /servers/a1b2c3d4-.../webhooks/d4e8a1c2-...
Authorization: Bearer <jwt>
```

**Response** `200 OK`

Returns a single `WebhookDto` object (same shape as in the list response).

**Errors**

| Status | Condition                                                     |
| ------ | ------------------------------------------------------------- |
| `403`  | Caller is not server owner and lacks Administrator permission |
| `404`  | Webhook not found or does not belong to this server           |

---

### PATCH /servers/:server_id/webhooks/:webhook_id

Update a webhook's name, URL, event types, or enabled state. All fields are optional — only provided fields are changed.

**Request**

```http
PATCH /servers/a1b2c3d4-.../webhooks/d4e8a1c2-...
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "name": "Renamed Hook",
  "enabled": false
}
```

| Field         | Type     | Required | Constraints                                                     |
| ------------- | -------- | -------- | --------------------------------------------------------------- |
| `name`        | string   | no       | 1–100 characters (trimmed)                                      |
| `url`         | string   | no       | Must start with `http://` or `https://`, max 2000 characters    |
| `event_types` | string[] | no       | At least one valid event type                                   |
| `enabled`     | boolean  | no       | Enable or disable the webhook                                   |

**Response** `200 OK`

Returns the updated `WebhookDto` object.

**Errors**

| Status | Condition                                                     |
| ------ | ------------------------------------------------------------- |
| `400`  | Invalid name, URL, or event types                             |
| `403`  | Caller is not server owner and lacks Administrator permission |
| `404`  | Webhook not found or does not belong to this server           |

---

### DELETE /servers/:server_id/webhooks/:webhook_id

Permanently delete a webhook.

**Request**

```http
DELETE /servers/a1b2c3d4-.../webhooks/d4e8a1c2-...
Authorization: Bearer <jwt>
```

**Response** `204 No Content`

**Errors**

| Status | Condition                                                     |
| ------ | ------------------------------------------------------------- |
| `403`  | Caller is not server owner and lacks Administrator permission |
| `404`  | Webhook not found or does not belong to this server           |

---

### POST /servers/:server_id/webhooks/:webhook_id/test

Send a test `ping` event to the webhook URL. The delivery is queued asynchronously — a `202 Accepted` response means the job was enqueued, not that it was delivered successfully.

**Request**

```http
POST /servers/a1b2c3d4-.../webhooks/d4e8a1c2-.../test
Authorization: Bearer <jwt>
```

**Response** `202 Accepted`

The test payload sent to the webhook URL:

```json
{
  "event": "ping",
  "server_id": "a1b2c3d4-...",
  "data": {
    "webhook_id": "d4e8a1c2-...",
    "server_name": "My Gaming Server",
    "message": "This is a test event from Together."
  }
}
```

**Errors**

| Status | Condition                                                     |
| ------ | ------------------------------------------------------------- |
| `403`  | Caller is not server owner and lacks Administrator permission |
| `404`  | Webhook not found or does not belong to this server           |

---

## Payload Format

Every webhook delivery is an HTTP POST with `Content-Type: application/json`. The JSON body follows this envelope structure:

```json
{
  "event": "message.created",
  "server_id": "a1b2c3d4-...",
  "data": { ... }
}
```

| Field       | Type   | Description                                               |
| ----------- | ------ | --------------------------------------------------------- |
| `event`     | string | The event type (e.g. `message.created`, `ping`)           |
| `server_id` | UUID   | The server where the event occurred                       |
| `data`      | object | Event-specific payload (e.g. the full serialized message) |

The `data` field for message events contains the same `MessageDto` object broadcast over the WebSocket gateway.

---

## Signature Verification

Every delivery includes an HMAC-SHA256 signature so recipients can verify the payload was sent by Together and has not been tampered with.

### Headers

| Header                        | Description                                                |
| ----------------------------- | ---------------------------------------------------------- |
| `X-Together-Signature-256`    | `sha256=<lowercase hex HMAC-SHA256 digest>`                |
| `X-Together-Hook-ID`          | UUID of the webhook that triggered this delivery           |
| `X-Together-Delivery-Attempt` | Attempt number (`1`, `2`, or `3`)                          |

### Algorithm

The signature is computed as:

```
HMAC-SHA256(secret, raw_request_body_bytes)
```

The result is hex-encoded and prefixed with `sha256=`. This format matches the GitHub webhook signature scheme, so existing verification libraries work out of the box.

### Verification Example (Node.js)

```javascript
const crypto = require("crypto");

function verifySignature(secret, body, signatureHeader) {
  const expected = "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}

// In your HTTP handler:
const isValid = verifySignature(
  process.env.WEBHOOK_SECRET,
  req.rawBody,            // unparsed request body bytes
  req.headers["x-together-signature-256"]
);
```

### Verification Example (Python)

```python
import hmac
import hashlib

def verify_signature(secret: str, body: bytes, signature_header: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Always use a constant-time comparison function to prevent timing attacks.

---

## Delivery Behavior

### Queue

Deliveries are processed through an in-memory `mpsc` channel with a capacity of 10,000 jobs. Each event handler enqueues jobs non-blockingly — if the queue is full, jobs are dropped (load-shedding) and a warning is logged.

### HTTP Request

Each delivery attempt is an HTTP POST with a **10-second timeout**. A delivery is considered successful if the response status code is in the 2xx range.

### Retries

Failed deliveries are retried up to **3 total attempts** with exponential backoff:

| Attempt | Delay before attempt |
| ------- | -------------------- |
| 1       | Immediate            |
| 2       | 5 seconds            |
| 3       | 15 seconds           |

### Failure Tracking

- On success (any attempt): the webhook's `delivery_failures` counter is reset to `0` and `last_used_at` is updated.
- On failure (all 3 attempts exhausted): `delivery_failures` is incremented by 1.

The `delivery_failures` counter is exposed in the webhook API responses. There is currently no automatic disabling of webhooks after repeated failures.

### Disabled Webhooks

Setting `enabled` to `false` via the PATCH endpoint prevents the webhook from receiving any event deliveries. The `fire_event` query filters on `enabled = TRUE`.

# WebSocket Gateway Protocol

Together uses a WebSocket gateway for all real-time communication: chat messages, presence
updates, and WebRTC voice signaling.

---

## Connection URL

```
GET ws://your-server:8080/ws?token=<access_token>
```

The access token is passed as a query parameter rather than an `Authorization` header because
browsers cannot set custom headers on WebSocket upgrade requests (a fundamental browser limitation).

Use a fresh access token on every connection — access tokens expire after 15 minutes.

---

## Message Envelope

All messages in both directions use the same JSON envelope:

```json
{
  "op": "OPCODE",
  "t":  "EVENT_TYPE",
  "d":  { }
}
```

| Field | Type | Description |
|---|---|---|
| `op` | string | Opcode — identifies the message type |
| `t` | string \| null | Event type — present only on `DISPATCH` messages |
| `d` | object \| null | Payload — shape depends on `op` and `t` |

---

## Opcodes

| Opcode | Direction | Description |
|---|---|---|
| `DISPATCH` | Server → Client | Delivers a named event (`t` field is set) |
| `HEARTBEAT` | Client → Server | Keep-alive ping to prevent connection timeout |
| `HEARTBEAT_ACK` | Server → Client | Pong response to a `HEARTBEAT` |
| `PRESENCE_UPDATE` | Both | Update or receive a user's online status |
| `VOICE_SIGNAL` | Both | WebRTC signaling payload (SDP or ICE candidate) |

---

## Connection Lifecycle

```
1. Client opens WebSocket to /ws?token=<access_token>
2. Server validates the token
   - Invalid/expired token → server closes connection with code 4001
3. Server sends READY event with user profile and server list
4. Client sends HEARTBEAT every 30 seconds to keep the connection alive
5. Server sends HEARTBEAT_ACK in response to each HEARTBEAT
6. Events flow bidirectionally for the session lifetime
7. On disconnect (network drop, token expiry, etc.), client reconnects
   with a fresh access token from /auth/login
```

---

## READY Event

Sent immediately after a successful connection. Contains the authenticated user's profile and
the list of servers they belong to.

```json
{
  "op": "DISPATCH",
  "t":  "READY",
  "d":  {
    "user": {
      "id":         "uuid",
      "username":   "alice",
      "email":      "alice@example.com",
      "avatar_url": null,
      "status":     "online",
      "created_at": "2025-01-01T00:00:00Z"
    },
    "servers": [
      {
        "id":           "uuid",
        "name":         "My Gaming Server",
        "description":  null,
        "owner_id":     "uuid",
        "member_count": 12,
        "created_at":   "2025-01-01T00:00:00Z"
      }
    ]
  }
}
```

---

## Server → Client Events (DISPATCH)

### `MESSAGE_CREATE`

Sent to all clients in a channel when a new message is posted.

```json
{
  "op": "DISPATCH",
  "t":  "MESSAGE_CREATE",
  "d":  {
    "id":         "uuid",
    "channel_id": "uuid",
    "author_id":  "uuid",
    "content":    "Hello, everyone!",
    "created_at": "2025-01-01T12:00:00Z",
    "updated_at": null
  }
}
```

### `MESSAGE_UPDATE`

Sent when a message is edited.

```json
{
  "op": "DISPATCH",
  "t":  "MESSAGE_UPDATE",
  "d":  {
    "id":         "uuid",
    "channel_id": "uuid",
    "author_id":  "uuid",
    "content":    "Edited message content",
    "created_at": "2025-01-01T12:00:00Z",
    "updated_at": "2025-01-01T12:05:00Z"
  }
}
```

### `MESSAGE_DELETE`

Sent when a message is deleted.

```json
{
  "op": "DISPATCH",
  "t":  "MESSAGE_DELETE",
  "d":  {
    "id":         "uuid",
    "channel_id": "uuid"
  }
}
```

### `PRESENCE_UPDATE`

Sent to all members of a shared server when a user changes their online status.

```json
{
  "op": "DISPATCH",
  "t":  "PRESENCE_UPDATE",
  "d":  {
    "user_id": "uuid",
    "status":  "online"
  }
}
```

Status values: `online`, `idle`, `dnd`, `offline`.

### `VOICE_STATE_UPDATE`

Sent to all members of a server when a user joins, leaves, or updates their voice state.

```json
{
  "op": "DISPATCH",
  "t":  "VOICE_STATE_UPDATE",
  "d":  {
    "user_id":    "uuid",
    "channel_id": "uuid",
    "muted":      false,
    "deafened":   false
  }
}
```

When a user leaves a voice channel, `channel_id` is `null`.

### `VOICE_SIGNAL`

Delivers a WebRTC signaling message (SDP offer/answer or ICE candidate) from another user.

```json
{
  "op": "DISPATCH",
  "t":  "VOICE_SIGNAL",
  "d":  {
    "from_user_id": "uuid",
    "signal":       { }
  }
}
```

The `signal` object is an opaque JSON value — the server relays it without interpretation.
Its shape follows the WebRTC standard: `{"type":"offer","sdp":"..."}` or
`{"candidate":"...","sdpMid":"...","sdpMLineIndex":0}`.

---

## Client → Server Messages

### `HEARTBEAT`

Send every ~30 seconds to keep the connection alive.

```json
{
  "op": "HEARTBEAT"
}
```

### `PRESENCE_UPDATE`

Update your own online status.

```json
{
  "op": "PRESENCE_UPDATE",
  "d":  {
    "status": "idle"
  }
}
```

### `VOICE_SIGNAL`

Send a WebRTC signaling message to another participant in your current voice channel.

```json
{
  "op": "VOICE_SIGNAL",
  "d":  {
    "to_user_id": "uuid",
    "signal":     { }
  }
}
```

---

## Voice Signaling Flow

Voice calls use WebRTC peer-to-peer connections with the server acting as a signaling relay.

```
  Alice                    Server (relay)                  Bob
    |                           |                           |
    |-- POST /channels/:id/voice (join) ------------------>|
    |                           |<-- POST /channels/:id/voice (join) --
    |                           |                           |
    |  VOICE_SIGNAL { offer SDP }                           |
    |-------------------------->|                           |
    |                           |---VOICE_SIGNAL offer---->|
    |                           |                           |
    |                           |<--VOICE_SIGNAL answer----|
    |<-VOICE_SIGNAL answer------|                           |
    |                           |                           |
    |  <-- ICE candidates exchanged via VOICE_SIGNAL -->    |
    |<------------------------->|<------------------------->|
    |                           |                           |
    |<======= UDP audio stream (SRTP, direct or via TURN) =|
```

**Step-by-step:**

1. Both clients join the voice channel via `POST /channels/:id/voice`
2. The initiating client creates an `RTCPeerConnection` and generates an SDP offer
3. The offer is sent to the target peer via `VOICE_SIGNAL` through the WebSocket
4. The receiving peer creates an answer and sends it back via `VOICE_SIGNAL`
5. Both sides exchange ICE candidates via `VOICE_SIGNAL`
6. WebRTC establishes a direct peer-to-peer UDP connection (or via TURN if NAT prevents direct)
7. Audio flows over the SRTP-encrypted UDP connection

---

## Reconnection

Access tokens expire after 15 minutes. When your WebSocket connection drops (network interruption,
token expiry, or server restart):

1. Call `POST /auth/login` to obtain a fresh access token
2. Reconnect to `/ws?token=<new_token>`
3. The server will send a `READY` event again — use it to re-sync state

Use exponential backoff for reconnection attempts (start at 1 s, cap at 30 s) to avoid
thundering-herd problems after a server restart.

---

## Error Codes

WebSocket close codes used by Together:

| Code | Meaning |
|---|---|
| 4001 | Authentication failed (missing, invalid, or expired token) |
| 4002 | Invalid message format (malformed JSON or unknown opcode) |
| 1000 | Normal closure |
| 1001 | Server going away (restart/shutdown) |

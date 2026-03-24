# WebSocket Gateway Protocol

Together uses a WebSocket gateway for all real-time communication: chat messages, presence
updates, and WebRTC voice signaling.

---

## Connection URL

```
GET ws://your-server:8080/ws?token=<access_token>
GET ws://your-server:8080/ws?bot_token=<static_token>
```

The access token is passed as a query parameter rather than an `Authorization` header because
browsers cannot set custom headers on WebSocket upgrade requests (a fundamental browser limitation).
An invalid or expired token results in a `401` HTTP response before the upgrade completes.

Use a fresh access token on every connection — access tokens expire after 15 minutes.

**Bot authentication**: Bots can connect using the `bot_token` query parameter with their static
bot token. However, static tokens appear in server and proxy access logs. For production use,
prefer exchanging the bot token for a short-lived JWT via `POST /bots/connect`, then connect
with `?token=<jwt>` instead.

---

## Message Envelope

All messages in both directions use the same JSON envelope:

```json
{
  "op": "OPCODE",
  "t": "EVENT_TYPE",
  "d": {}
}
```

| Field | Type           | Description                                      |
| ----- | -------------- | ------------------------------------------------ |
| `op`  | string         | Opcode — identifies the message type             |
| `t`   | string \| null | Event type — present only on `DISPATCH` messages |
| `d`   | object \| null | Payload — shape depends on `op` and `t`          |

---

## Opcodes

| Opcode            | Direction       | Description                                                                                                |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| `DISPATCH`        | Server → Client | Delivers a named event (`t` field is set)                                                                  |
| `HEARTBEAT`       | Client → Server | Keep-alive ping to prevent connection timeout                                                              |
| `HEARTBEAT_ACK`   | Server → Client | Pong response to a `HEARTBEAT`                                                                             |
| `PRESENCE_UPDATE` | Client → Server | Update the user's online status (server broadcasts via `DISPATCH` with `t: "PRESENCE_UPDATE"`)             |
| `TYPING_START`    | Client → Server | Notify the server that the user started typing (server broadcasts via `DISPATCH` with `t: "TYPING_START"`) |
| `VOICE_SIGNAL`    | Client → Server | WebRTC signaling payload — SDP or ICE candidate (server relays via `DISPATCH` with `t: "VOICE_SIGNAL"`)    |

---

## Operational Limits

| Parameter                 | Value    | Behavior on violation                     |
| ------------------------- | -------- | ----------------------------------------- |
| Idle timeout              | 300 s    | Server closes connection after 5 min idle |
| Max frame size            | 16 KB    | Oversized frames close the connection     |
| Per-connection rate limit | 20 msg/s | Excess messages are silently dropped      |

---

## Connection Lifecycle

```
1. Client opens WebSocket to /ws?token=<access_token>
   (or /ws?bot_token=<static_token> for bots)
2. Server validates the token
   - Invalid/expired token → HTTP 401 before upgrade (connection refused)
3. Server sends READY event with user profile, server list, DM channels, and unread state
4. Client sends HEARTBEAT every 30 seconds to keep the connection alive
5. Server sends HEARTBEAT_ACK in response to each HEARTBEAT
6. Events flow bidirectionally for the session lifetime
7. On disconnect (network drop, token expiry, idle timeout, etc.), client reconnects
   with a fresh access token from /auth/login
```

---

## READY Event

Sent immediately after a successful connection. Contains the authenticated user's profile,
the list of servers they belong to, open DM channels, and per-channel unread/mention counts.

The server list uses the raw server shape (not the REST `ServerDto`) — it does not include
`member_count`. To get a member count, call `GET /servers/:id` after connection.

```json
{
  "op": "DISPATCH",
  "t": "READY",
  "d": {
    "user": {
      "id": "uuid",
      "username": "alice",
      "email": "alice@example.com",
      "avatar_url": null,
      "bio": null,
      "pronouns": null,
      "status": "online",
      "custom_status": null,
      "activity": null,
      "created_at": "2025-01-01T00:00:00Z",
      "is_admin": false
    },
    "servers": [
      {
        "id": "uuid",
        "name": "My Gaming Server",
        "owner_id": "uuid",
        "icon_url": null,
        "is_public": false,
        "created_at": "2025-01-01T00:00:00Z",
        "updated_at": "2025-01-01T00:00:00Z"
      }
    ],
    "dm_channels": [
      {
        "id": "uuid",
        "recipient": {
          "id": "uuid",
          "username": "bob",
          "email": null,
          "avatar_url": null,
          "bio": null,
          "pronouns": null,
          "status": "online",
          "custom_status": null,
          "activity": null,
          "created_at": "2025-01-01T00:00:00Z",
          "is_admin": false
        },
        "created_at": "2025-01-01T00:00:00Z",
        "last_message_at": "2025-01-15T08:30:00Z"
      }
    ],
    "unread_counts": [{ "channel_id": "uuid", "unread_count": 5 }],
    "mention_counts": [{ "channel_id": "uuid", "count": 2 }],
    "server_roles": {
      "server-uuid": [
        {
          "id": "role-uuid",
          "server_id": "server-uuid",
          "name": "Admin",
          "permissions": 8192,
          "color": "#E74C3C",
          "position": 10,
          "created_at": "2025-01-01T00:00:00Z"
        }
      ]
    }
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
  "t": "MESSAGE_CREATE",
  "d": {
    "id": "uuid",
    "channel_id": "uuid",
    "author_id": "uuid",
    "content": "Hello, everyone!",
    "reply_to": null,
    "edited_at": null,
    "deleted": false,
    "created_at": "2025-01-01T12:00:00Z"
  }
}
```

### `MESSAGE_UPDATE`

Sent when a message is edited.

```json
{
  "op": "DISPATCH",
  "t": "MESSAGE_UPDATE",
  "d": {
    "id": "uuid",
    "channel_id": "uuid",
    "author_id": "uuid",
    "content": "Edited message content",
    "reply_to": null,
    "edited_at": "2025-01-01T12:05:00Z",
    "deleted": false,
    "created_at": "2025-01-01T12:00:00Z"
  }
}
```

### `MESSAGE_DELETE`

Sent when a message is deleted.

```json
{
  "op": "DISPATCH",
  "t": "MESSAGE_DELETE",
  "d": {
    "id": "uuid",
    "channel_id": "uuid"
  }
}
```

### `PRESENCE_UPDATE`

Sent to all members of a shared server when a user changes their online status.

```json
{
  "op": "DISPATCH",
  "t": "PRESENCE_UPDATE",
  "d": {
    "user_id": "uuid",
    "status": "online",
    "custom_status": null,
    "activity": null
  }
}
```

Status values: `online`, `away`, `dnd`, `offline`.

### `VOICE_STATE_UPDATE`

Sent to all members of a server when a user joins, leaves, or updates their voice state.
The `username` field is injected by the server on every broadcast.

```json
{
  "op": "DISPATCH",
  "t": "VOICE_STATE_UPDATE",
  "d": {
    "user_id": "uuid",
    "channel_id": "uuid",
    "self_mute": false,
    "self_deaf": false,
    "self_video": false,
    "self_screen": false,
    "server_mute": false,
    "server_deaf": false,
    "joined_at": "2025-01-01T12:00:00Z",
    "username": "alice"
  }
}
```

When a user leaves a voice channel, `channel_id` and `joined_at` are `null`.

### `VOICE_SIGNAL`

Delivers a WebRTC signaling message (SDP offer/answer or ICE candidate) from another user.
The signal fields are at the top level of `d` alongside `from_user_id`.

```json
{
  "op": "DISPATCH",
  "t": "VOICE_SIGNAL",
  "d": {
    "from_user_id": "uuid",
    "type": "offer",
    "sdp": "v=0\r\no=- ...",
    "candidate": null,
    "stream_type": null
  }
}
```

For ICE candidates, `type` is `"candidate"`, `sdp` is `null`, and `candidate` contains the ICE
candidate string. The `stream_type` field is forwarded as-is from the sender (e.g. `"screen"`,
`"camera"`, or `null`).

### Additional Server → Client Events

The following events are dispatched via the same `DISPATCH` envelope. Payload shapes vary by
event — refer to the handler source code for full field details.

| Event                     | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `DM_CHANNEL_CREATE`       | A new DM channel was opened with the connected user        |
| `DM_MESSAGE_CREATE`       | A new message was sent in one of the user's DM channels    |
| `REACTION_ADD`            | A reaction was added to a message in a visible channel     |
| `REACTION_REMOVE`         | A reaction was removed from a message in a visible channel |
| `THREAD_MESSAGE_CREATE`   | A new message was posted in a thread the user can see      |
| `POLL_VOTE`               | A vote was cast on a poll in a visible channel             |
| `TYPING_START`            | A user started typing in a channel (server broadcast)      |
| `TYPING_STOP`             | _(defined but not yet dispatched by the server)_           |
| `MESSAGE_PIN`             | A message was pinned in a channel                          |
| `MESSAGE_UNPIN`           | A message was unpinned from a channel                      |
| `MEMBER_KICK`             | A member was kicked from the server                        |
| `MEMBER_BAN`              | A member was banned from the server                        |
| `MEMBER_TIMEOUT`          | A member was timed out (cannot send messages until expiry) |
| `MEMBER_TIMEOUT_REMOVE`   | A member's timeout was removed early                       |
| `CUSTOM_EMOJI_CREATE`     | A custom emoji was added to a server                       |
| `CUSTOM_EMOJI_DELETE`     | A custom emoji was removed from a server                   |
| `GO_LIVE_START`           | A user started a live stream in a voice channel            |
| `GO_LIVE_STOP`            | A user stopped their live stream in a voice channel        |
| `ROLE_CREATE`             | A new role was created in the server                       |
| `ROLE_UPDATE`             | A role's name, permissions, color, or position was changed |
| `ROLE_DELETE`             | A role was deleted from the server                         |
| `MEMBER_ROLE_ADD`         | A role was assigned to a server member                     |
| `MEMBER_ROLE_REMOVE`      | A role was removed from a server member                    |
| `INVITE_CREATE`           | A new invite link was created for a server                 |
| `INVITE_DELETE`           | An invite link was revoked from a server                   |
| `CHANNEL_OVERRIDE_UPDATE` | A channel permission override was created or updated       |
| `CHANNEL_OVERRIDE_DELETE` | A channel permission override was removed                  |

The server-broadcast `TYPING_START` event payload includes `user_id`, `username`, `channel_id`,
and `timestamp`. Clients should auto-expire the typing indicator after ~10 seconds if no further
`TYPING_START` events are received for that user.

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

Update your own online status. `status` must be one of: `online`, `away`, `dnd`, `offline`.
Messages with unknown status values are silently dropped.

```json
{
  "op": "PRESENCE_UPDATE",
  "d": {
    "status": "away",
    "custom_status": "Playing a game",
    "activity": "Elden Ring"
  }
}
```

All fields in `d` are optional except `status`. `custom_status` and `activity` are free-text
strings (or `null` to clear).

### `TYPING_START`

Notify the server that you started typing in a channel. The server validates channel membership
before broadcasting to other members.

```json
{
  "op": "TYPING_START",
  "d": {
    "channel_id": "uuid"
  }
}
```

### `VOICE_SIGNAL`

Send a WebRTC signaling message to another participant in your current voice channel.
`type` must be one of `"offer"`, `"answer"`, or `"candidate"`. The signal fields are at the
top level of `d` — there is no nested `signal` wrapper object.

```json
{
  "op": "VOICE_SIGNAL",
  "d": {
    "to_user_id": "uuid",
    "type": "offer",
    "sdp": "v=0\r\no=- ...",
    "candidate": null,
    "stream_type": null
  }
}
```

The `stream_type` field is forwarded to the receiving peer as-is (e.g. `"screen"`, `"camera"`,
or `null`).

---

## Voice Signaling Flow

Voice calls use WebRTC peer-to-peer connections with the server acting as a signaling relay.

```
  Alice                    Server (relay)                  Bob
    |                           |                           |
    |-- POST /channels/:id/voice (join) ------------------>|
    |                           |<-- POST /channels/:id/voice (join) --
    |                           |                           |
    |  VOICE_SIGNAL { type:"offer", sdp:"..." }             |
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
3. The offer is sent to the target peer via `VOICE_SIGNAL` (`type: "offer"`) through the WebSocket
4. The receiving peer creates an answer and sends it back via `VOICE_SIGNAL` (`type: "answer"`)
5. Both sides exchange ICE candidates via `VOICE_SIGNAL` (`type: "candidate"`)
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

## Connection Close Codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 1000 | Normal closure (intentional disconnect) |
| 1001 | Server going away (restart/shutdown)    |

Authentication failures result in a `401` HTTP response before the WebSocket upgrade completes,
not a WebSocket close frame. Malformed JSON and unknown opcodes are silently dropped — the
connection remains open. However, oversized frames (>16 KB) cause the server to close the
connection immediately.

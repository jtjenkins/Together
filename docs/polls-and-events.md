# Polls and Server Events

This guide covers creating polls and scheduling server events in Together, including the API endpoints, request/response formats, voting behaviour, and real-time updates.

---

## Polls

Polls let server members pose a question with multiple choices and collect votes. A poll is always attached to a message in a channel.

### Creating a Poll

**Endpoint:** `POST /channels/{channel_id}/polls`

**Authentication:** Bearer token (logged-in user)

**Permission:** The caller must be a member of the server that owns the channel.

**Request body:**

```json
{
  "question": "What game should we play tonight?",
  "options": ["Valorant", "CS2", "Overwatch 2"]
}
```

| Field      | Type       | Rules                                                        |
| ---------- | ---------- | ------------------------------------------------------------ |
| `question` | `string`   | Required. 1--500 characters (trimmed must be non-empty).     |
| `options`  | `string[]` | Required. 2 to 10 items. Each item 1--200 characters (trimmed must be non-empty). |

Option IDs are generated server-side (UUIDv4). You provide text only.

**Response:** `201 Created`

The response is a full `MessageDto` with the `poll` field populated:

```json
{
  "id": "<message-uuid>",
  "channel_id": "<channel-uuid>",
  "author_id": "<user-uuid>",
  "content": "📊 **Poll**: What game should we play tonight?",
  "poll": {
    "id": "<poll-uuid>",
    "question": "What game should we play tonight?",
    "options": [
      { "id": "<option-uuid>", "text": "Valorant", "votes": 0 },
      { "id": "<option-uuid>", "text": "CS2", "votes": 0 },
      { "id": "<option-uuid>", "text": "Overwatch 2", "votes": 0 }
    ],
    "total_votes": 0,
    "user_vote": null
  },
  "created_at": "2026-03-20T12:00:00Z"
}
```

The server inserts a message into the channel (content is auto-generated from the question) and creates the poll record in a single transaction. A `MESSAGE_CREATE` event is broadcast to all server members via the WebSocket gateway.

**Error cases:**

| Condition                               | Status | Error type   |
| --------------------------------------- | ------ | ------------ |
| Fewer than 2 or more than 10 options    | 400    | `Validation` |
| Any option is empty or exceeds 200 chars | 400    | `Validation` |
| Question is empty or exceeds 500 chars  | 400    | `Validation` |
| Channel not found                       | 404    | `NotFound`   |
| Caller is not a server member           | 403    | `Forbidden`  |

---

### Getting a Poll

**Endpoint:** `GET /polls/{poll_id}`

**Authentication:** Bearer token (logged-in user)

**Permission:** The caller must be a member of the server that owns the poll.

**Response:** `200 OK`

```json
{
  "id": "<poll-uuid>",
  "question": "What game should we play tonight?",
  "options": [
    { "id": "<option-uuid>", "text": "Valorant", "votes": 3 },
    { "id": "<option-uuid>", "text": "CS2", "votes": 1 },
    { "id": "<option-uuid>", "text": "Overwatch 2", "votes": 5 }
  ],
  "total_votes": 9,
  "user_vote": "<option-uuid>"
}
```

| Field         | Type          | Description                                                |
| ------------- | ------------- | ---------------------------------------------------------- |
| `id`          | `uuid`        | Poll ID.                                                   |
| `question`    | `string`      | The poll question.                                         |
| `options`     | `object[]`    | Each option has `id` (uuid), `text` (string), `votes` (integer count). |
| `total_votes` | `integer`     | Sum of all option vote counts.                             |
| `user_vote`   | `uuid | null` | The `option_id` the calling user voted for, or `null` if they have not voted. |

**Error cases:**

| Condition                      | Status | Error type |
| ------------------------------ | ------ | ---------- |
| Poll not found                 | 404    | `NotFound` |
| Caller is not a server member  | 403    | `Forbidden` |

---

### Voting on a Poll

**Endpoint:** `POST /polls/{poll_id}/vote`

**Authentication:** Bearer token (logged-in user)

**Permission:** The caller must be a member of the server that owns the poll.

**Request body:**

```json
{
  "option_id": "<option-uuid>"
}
```

**Voting rules:**

- **Single-choice only.** Each user can vote for exactly one option per poll.
- **Vote changing is allowed.** Submitting a new vote replaces the previous one (upsert on `poll_id + user_id`). The `voted_at` timestamp is updated to the current time.
- **No vote removal.** There is no endpoint to retract a vote without casting a different one.

**Response:** `200 OK`

Returns the updated `PollDto` (same shape as the GET response above), reflecting the new vote counts and the caller's current selection in `user_vote`.

**WebSocket event:** A `POLL_VOTE` event is broadcast to all server members:

```json
{
  "op": "DISPATCH",
  "t": "POLL_VOTE",
  "d": {
    "poll_id": "<poll-uuid>",
    "channel_id": "<channel-uuid>",
    "updated_poll": {
      "id": "<poll-uuid>",
      "question": "What game should we play tonight?",
      "options": [
        { "id": "<option-uuid>", "text": "Valorant", "votes": 4 },
        { "id": "<option-uuid>", "text": "CS2", "votes": 1 },
        { "id": "<option-uuid>", "text": "Overwatch 2", "votes": 5 }
      ],
      "total_votes": 10,
      "user_vote": "<option-uuid>"
    }
  }
}
```

**Error cases:**

| Condition                        | Status | Error type   |
| -------------------------------- | ------ | ------------ |
| Poll not found                   | 404    | `NotFound`   |
| `option_id` does not belong to the poll | 400    | `Validation` |
| Caller is not a server member    | 403    | `Forbidden`  |

---

## Server Events

Server events let members schedule activities (game nights, tournaments, meetings) with a name, optional description, and start time.

### Creating an Event

**Endpoint:** `POST /channels/{channel_id}/events`

**Authentication:** Bearer token (logged-in user)

**Permission:** The caller must be a member of the server that owns the channel.

**Request body:**

```json
{
  "name": "Friday Night Valorant",
  "description": "Competitive 5-stack, bring your A game.",
  "starts_at": "2026-03-27T21:00:00Z"
}
```

| Field         | Type             | Rules                                            |
| ------------- | ---------------- | ------------------------------------------------ |
| `name`        | `string`         | Required. 1--200 characters (trimmed must be non-empty). |
| `description` | `string | null`  | Optional. Free-text description of the event.    |
| `starts_at`   | `datetime (UTC)` | Required. ISO 8601 timestamp for when the event starts. |

**Response:** `201 Created`

The response is a full `MessageDto` with the `event` field populated:

```json
{
  "id": "<message-uuid>",
  "channel_id": "<channel-uuid>",
  "author_id": "<user-uuid>",
  "content": "📅 **Event**: Friday Night Valorant — Mar 27, 2026 at 9:00 PM UTC",
  "event": {
    "id": "<event-uuid>",
    "name": "Friday Night Valorant",
    "description": "Competitive 5-stack, bring your A game.",
    "starts_at": "2026-03-27T21:00:00Z",
    "created_by": "<user-uuid>",
    "created_at": "2026-03-20T12:00:00Z"
  },
  "created_at": "2026-03-20T12:00:00Z"
}
```

The server inserts a message into the channel (content is auto-generated with the event name and formatted start time) and creates the event record in a single transaction. A `MESSAGE_CREATE` event is broadcast to all server members via the WebSocket gateway.

**Error cases:**

| Condition                            | Status | Error type   |
| ------------------------------------ | ------ | ------------ |
| Name is empty or exceeds 200 chars   | 400    | `Validation` |
| Channel not found                    | 404    | `NotFound`   |
| Caller is not a server member        | 403    | `Forbidden`  |

---

### Listing Server Events

**Endpoint:** `GET /servers/{server_id}/events`

**Authentication:** Bearer token (logged-in user)

**Permission:** The caller must be a member of the server.

**Response:** `200 OK`

Returns an array of upcoming events (where `starts_at` is in the future), ordered by start time ascending, limited to 50 results.

```json
[
  {
    "id": "<event-uuid>",
    "name": "Friday Night Valorant",
    "description": "Competitive 5-stack, bring your A game.",
    "starts_at": "2026-03-27T21:00:00Z",
    "created_by": "<user-uuid>",
    "created_at": "2026-03-20T12:00:00Z"
  }
]
```

| Field         | Type             | Description                                   |
| ------------- | ---------------- | --------------------------------------------- |
| `id`          | `uuid`           | Event ID.                                     |
| `name`        | `string`         | Event name.                                   |
| `description` | `string | null`  | Optional description.                         |
| `starts_at`   | `datetime (UTC)` | When the event is scheduled to start.         |
| `created_by`  | `uuid | null`    | User ID of the member who created the event.  |
| `created_at`  | `datetime (UTC)` | When the event record was created.            |

Past events (where `starts_at` has already passed) are excluded from the response.

**Error cases:**

| Condition                      | Status | Error type |
| ------------------------------ | ------ | ---------- |
| Caller is not a server member  | 403    | `Forbidden` |

---

## Limitations

- **No poll closing.** Polls remain open indefinitely. There is no endpoint to close a poll or prevent further votes.
- **No vote retraction.** A user cannot remove their vote; they can only change it to a different option.
- **No event editing or deletion.** Once created, server events cannot be updated or removed through the API.
- **No RSVP.** There is no mechanism for members to indicate attendance for an event.
- **Future events only in list.** The `GET /servers/{server_id}/events` endpoint only returns events with a `starts_at` in the future. Past events are not retrievable through this endpoint.
- **50-event cap on listing.** The list endpoint returns at most 50 upcoming events. There is no pagination support.
- **Channel-scoped creation.** Both polls and events are created within a specific channel and produce a message in that channel. They are not standalone server-wide objects.

# Presence and Status System

Together tracks each user's online status and an optional custom status message. Status changes are persisted to the database and broadcast in real time to all server co-members.

## Status Values

| Value     | Display label  | Description                                            |
| --------- | -------------- | ------------------------------------------------------ |
| `online`  | Online         | User has an active WebSocket connection                |
| `away`    | Away           | User is connected but idle or has set away manually    |
| `dnd`     | Do Not Disturb | User is connected and wants to signal unavailability   |
| `offline` | Invisible      | User appears offline to others; functionally connected |

> **Note:** `offline` is the "Invisible" option in the UI. The user receives events normally; other users see them as offline.

---

## Lifecycle

### Automatic transitions

| Event                               | Status set to                               |
| ----------------------------------- | ------------------------------------------- |
| WebSocket connection established    | `online`                                    |
| WebSocket connection closed         | `offline`                                   |
| 5 minutes of client inactivity      | `away` (auto-away, client-initiated)        |
| Tab hidden (page visibility change) | `away` (auto-away, client-initiated)        |
| User returns from auto-away         | Previous status restored (client-initiated) |

Auto-away is managed entirely on the client. The client sends a `PRESENCE_UPDATE` op over the existing WebSocket when inactivity or tab-hide is detected; no separate connection is opened.

### Manual transitions

Users can set any status at any time through the status menu (see [UI](#ui)). A manually set status persists until the user changes it again or the connection closes.

---

## WebSocket Protocol

### Setting status (client → server)

Send a `PRESENCE_UPDATE` op with the desired status and optional custom status text:

```json
{
  "op": "PRESENCE_UPDATE",
  "d": {
    "status": "dnd",
    "custom_status": "In a voice call",
    "activity": "Playing Valorant"
  }
}
```

**Allowed `status` values:** `online`, `away`, `dnd`, `offline`

Sending an unrecognized status value over WebSocket is silently dropped; the same invalid value sent via the REST endpoint (`PATCH /users/me`) returns `400 Bad Request`. Omitting `custom_status` leaves the current value unchanged. Sending `custom_status: null` explicitly clears the custom status.

### Receiving status updates (server → client)

When any user's status changes, the server broadcasts a `PRESENCE_UPDATE` dispatch event to all WebSocket connections belonging to server co-members:

```json
{
  "op": "DISPATCH",
  "t": "PRESENCE_UPDATE",
  "d": {
    "user_id": "uuid",
    "status": "away",
    "custom_status": null,
    "activity": null
  }
}
```

The `READY` payload (received on connection) includes the current status and `custom_status` for all users returned in server member lists.

---

## REST API

Status and custom status are properties of the user object and are included in any endpoint that returns a user:

```json
{
  "id": "uuid",
  "username": "example",
  "status": "online",
  "custom_status": "Building stuff",
  ...
}
```

Status can also be updated via the REST API using `PATCH /users/me`, which accepts `status`, `custom_status`, and `activity` fields in the JSON body. This is useful for bots or integrations that do not maintain a WebSocket connection.

---

## Custom Status

Users can set a free-text custom status message up to 128 characters. Custom status is independent of the base status value — a user can be `dnd` with the custom status `"In a meeting"`.

Custom status is:

- Persisted to the `users` table alongside the base status
- Included in `PRESENCE_UPDATE` broadcast events
- Returned in the `READY` payload and all user-returning REST endpoints
- Cleared by passing `custom_status: null` in a `PRESENCE_UPDATE` op

---

## Auto-Away Behavior

The web and desktop clients implement auto-away detection locally using the `presenceStore`:

1. A 5-minute inactivity timer starts when the page loads or the user last interacted (mouse, keyboard, click, touch).
2. If the timer expires without activity, `presenceStore` records the previous status in memory, then calls `authStore.updatePresence("away")` which sends `PRESENCE_UPDATE` over the WebSocket.
3. If the browser tab is hidden (`visibilitychange` event), auto-away fires immediately without waiting for the timer.
4. When the user returns (any interaction, or the tab becomes visible again), `presenceStore` retrieves the saved status and calls `authStore.updatePresence(savedStatus)` to restore it.

Auto-away only activates if the current status is `online`. If the user has manually set `away`, `dnd`, or `offline`, the inactivity timer does not override it. Similarly, if the user manually changes their status while auto-away is active, the restore step is skipped.

---

## UI

Users access the status menu by clicking their avatar or username in the bottom-left of the sidebar.

**Status options**

| Option         | Sends               |
| -------------- | ------------------- |
| Online         | `status: "online"`  |
| Away           | `status: "away"`    |
| Do Not Disturb | `status: "dnd"`     |
| Invisible      | `status: "offline"` |

The currently active status is indicated with a checkmark.

**Custom status**

Below the status options is a text input for a custom status message (max 128 characters). Pressing Enter or clicking Save sends the update. A Clear button appears when the displayed text matches the saved custom status, and removes the custom status when clicked.

The status menu closes on click-outside or Escape.

---

## Database

Status and custom status are stored directly on the `users` table:

```sql
status        TEXT NOT NULL DEFAULT 'offline'
              CHECK (status IN ('online', 'away', 'dnd', 'offline'))
custom_status TEXT
activity      TEXT
```

The server writes status on every `PRESENCE_UPDATE` op and on WebSocket connect/disconnect. Write failures are non-fatal and logged; the broadcast proceeds regardless so connected clients remain consistent.

# Auto-Moderation Admin Guide

Together's auto-moderation system enforces configurable rules on incoming messages before they are stored. All rule checks run server-side; clients receive an error response when a message is blocked.

## Overview

Auto-moderation is configured per server. The system provides three independent rules:

| Rule                | What it detects                                                  |
| ------------------- | ---------------------------------------------------------------- |
| Spam detection      | A user sending too many messages within a sliding time window    |
| Duplicate detection | The same user posting identical content within 30 seconds        |
| Word filter         | Messages containing any word or phrase on the server's blocklist |

Each rule fires independently. If multiple rules would trigger on the same message, the first matching rule wins (order: spam → duplicate → word filter).

> **Note:** Active timeouts are enforced even when auto-moderation is globally disabled. A moderator cannot accidentally unblock a timed-out user by toggling the master switch off.

---

## Required Permission

`PATCH /servers/:id/automod`, word filter endpoints, and log endpoints require `MANAGE_SERVER` permission. `GET /servers/:id/automod` (read-only config) is accessible to all server members. Members without `MANAGE_SERVER` can read the top-level enabled/disabled state (so the UI can show a notice), but cannot modify settings or view logs.

---

## REST API

Base path: `/servers/:server_id/automod`

All requests require `Authorization: Bearer <jwt>`.

---

### GET /servers/:id/automod

Returns the current configuration. Accessible to all server members.

**Response**

```json
{
  "enabled": true,
  "spam_enabled": true,
  "spam_max_messages": 5,
  "spam_window_secs": 5,
  "spam_action": "timeout",
  "duplicate_enabled": true,
  "word_filter_enabled": false,
  "word_filter_action": "delete",
  "timeout_minutes": 10,
  "updated_at": "2026-03-14T12:00:00Z"
}
```

If no configuration has been saved yet, the server returns all-disabled defaults.

---

### PATCH /servers/:id/automod

Update configuration. Requires `MANAGE_SERVER`. All fields are optional; omitted fields keep their current value.

**Request**

```http
PATCH /servers/:id/automod
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "enabled": true,
  "spam_enabled": true,
  "spam_max_messages": 5,
  "spam_window_secs": 5,
  "spam_action": "timeout",
  "duplicate_enabled": true,
  "word_filter_enabled": true,
  "word_filter_action": "delete",
  "timeout_minutes": 10
}
```

**Field reference**

| Field                 | Type    | Constraints | Default    | Description                                                              |
| --------------------- | ------- | ----------- | ---------- | ------------------------------------------------------------------------ |
| `enabled`             | boolean | —           | `false`    | Master switch. When `false`, no rules run (active timeouts still apply). |
| `spam_enabled`        | boolean | —           | `false`    | Enable spam rate detection.                                              |
| `spam_max_messages`   | integer | 1–50        | `5`        | Maximum messages allowed within the window.                              |
| `spam_window_secs`    | integer | 1–60        | `5`        | Sliding window size in seconds.                                          |
| `spam_action`         | string  | see actions | `"delete"` | Action taken when spam is detected.                                      |
| `duplicate_enabled`   | boolean | —           | `false`    | Block identical messages within 30 seconds.                              |
| `word_filter_enabled` | boolean | —           | `false`    | Enable the word/phrase blocklist.                                        |
| `word_filter_action`  | string  | see actions | `"delete"` | Action taken when a blocked word is matched.                             |
| `timeout_minutes`     | integer | 1–10080     | `10`       | Duration of timeouts issued by any rule (max 7 days).                    |

**Actions**

| Value     | Effect                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| `delete`  | Block the message. No further action.                                                                      |
| `timeout` | Block the message and prevent the user from sending any messages in this server until the timeout expires. |
| `kick`    | Block the message and remove the user from the server. They may rejoin unless banned.                      |
| `ban`     | Block the message, remove the user, and add them to the server ban list.                                   |

**Response:** Updated configuration object (same shape as GET).

**Errors**

| Status | Reason                                             |
| ------ | -------------------------------------------------- |
| 400    | Invalid action value or field out of allowed range |
| 403    | Caller does not have `MANAGE_SERVER` permission    |

---

### GET /servers/:id/automod/words

List all blocked words. Requires `MANAGE_SERVER`.

**Response**

```json
[
  {
    "id": "uuid",
    "server_id": "uuid",
    "word": "badword",
    "created_by": "uuid",
    "created_at": "2026-03-14T12:00:00Z"
  }
]
```

Words are returned in the order they were added.

---

### POST /servers/:id/automod/words

Add a word or phrase to the blocklist. Requires `MANAGE_SERVER`.

Words are normalized to lowercase before storage; matching is also case-insensitive. Substring matching is used — a filter for `"bad"` will match `"badword"`.

**Request**

```http
POST /servers/:id/automod/words
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "word": "example phrase"
}
```

**Response:** `201 Created` with the new word filter object.

**Errors**

| Status | Reason                                 |
| ------ | -------------------------------------- |
| 400    | Word is blank                          |
| 409    | Word already exists in the filter list |

---

### DELETE /servers/:id/automod/words/:word_id

Remove a word from the blocklist. Requires `MANAGE_SERVER`.

**Response:** `204 No Content`

**Errors**

| Status | Reason            |
| ------ | ----------------- |
| 404    | Word ID not found |

---

### GET /servers/:id/automod/logs

Retrieve the auto-moderation audit log. Requires `MANAGE_SERVER`.

**Query parameters**

| Parameter | Type    | Default | Max   | Description                     |
| --------- | ------- | ------- | ----- | ------------------------------- |
| `limit`   | integer | `50`    | `100` | Number of log entries to return |

Results are ordered newest-first.

**Response**

```json
[
  {
    "id": "uuid",
    "server_id": "uuid",
    "channel_id": "uuid",
    "user_id": "uuid",
    "username": "exampleuser",
    "rule_type": "spam",
    "action_taken": "timeout",
    "message_content": "hello hello hello",
    "matched_term": null,
    "created_at": "2026-03-14T12:00:00Z"
  }
]
```

**Log fields**

| Field             | Description                                                                          |
| ----------------- | ------------------------------------------------------------------------------------ |
| `rule_type`       | Which rule fired: `spam`, `duplicate`, or `word_filter`                              |
| `action_taken`    | The action that was applied: `delete`, `timeout`, `kick`, or `ban`                   |
| `message_content` | The original message text that triggered the rule                                    |
| `matched_term`    | The specific blocked word that matched (word filter only; `null` for spam/duplicate) |

---

## WebSocket Event

When a rule fires, the server broadcasts an `AUTOMOD_ACTION` event to all currently connected members of the server. Moderators can use this for real-time notifications without polling the log endpoint.

**Event payload**

```json
{
  "op": 0,
  "t": "AUTOMOD_ACTION",
  "d": {
    "server_id": "uuid",
    "channel_id": "uuid",
    "user_id": "uuid",
    "username": "exampleuser",
    "rule_type": "word_filter",
    "action_taken": "delete",
    "matched_term": "badword"
  }
}
```

---

## Admin UI

The auto-moderation panel is accessible to users with `MANAGE_SERVER` via **Server Settings → Auto-Moderation**. It provides three tabs:

**Overview** — Master enable toggle, spam detection settings (max messages, window, action), duplicate detection toggle, and the shared timeout duration.

**Word Filters** — Enable/disable the word filter, set the action for word filter violations, and manage the blocked word list. Words are matched case-insensitively anywhere in a message.

**Audit Log** — View the 50 most recent auto-moderation actions. Each entry shows the username, rule that fired, action taken, the original message content, and (for word filter violations) the matched term. The log can be refreshed manually.

---

## Rule Behavior Reference

### Spam detection

The server tracks per-user message timestamps in memory using a sliding window. When a user's timestamp count within the configured window reaches `spam_max_messages`, the triggering message is blocked and the configured action is applied. The in-memory tracker resets when the server restarts.

### Duplicate detection

Queries the database for an identical message from the same user in the same channel within the last 30 seconds. The duplicate detection rule uses the same action as the spam rule (`spam_action`).

### Word filter

Loads the server's blocklist from the database on each message. Matches are case-insensitive substring checks. The first matching word wins; the matched term is recorded in the audit log.

### Timeouts

When the `timeout` action fires, an entry is inserted into `automod_timeouts` with an expiry of `timeout_minutes` from now. If the user triggers another rule before their timeout expires, the expiry is extended to whichever is later. Timed-out users receive `403 Forbidden` on any message send attempt, with the message: `"You are currently timed out in this server"`.

Timeouts expire automatically — no manual cleanup is required.

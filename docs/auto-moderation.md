# Auto-Moderation Admin Guide

Together's auto-moderation system enforces configurable rules on incoming messages. All rule checks run server-side; clients receive an error response when a message is blocked.

## Overview

Auto-moderation is configured per server. The system provides three independent rules:

| Rule                | What it detects                                                  |
| ------------------- | ---------------------------------------------------------------- |
| Spam detection      | A user sending too many messages within a sliding time window    |
| Duplicate detection | The same user posting identical content within 30 seconds        |
| Word filter         | Messages containing any word or phrase on the server's blocklist |

Each rule fires independently. If multiple rules would trigger on the same message, the first matching rule wins (order: word filter → duplicate → spam). Word filter and duplicate are pre-insert checks (block before the message is stored), while spam is a post-insert check (soft-deletes the message after storage).

> **Note:** Active timeouts are only enforced when auto-moderation is enabled. Disabling the master switch causes the code to return early before reaching the timeout check.

---

## Required Permission

All automod endpoints — `GET /servers/:id/automod`, `PATCH /servers/:id/automod`, word filter endpoints, and log endpoints — are restricted to the **server owner only**. The code checks `auth.user_id() != server.owner_id` on every endpoint; no permission bitflag is involved.

---

## REST API

Base path: `/servers/:server_id/automod`

All requests require `Authorization: Bearer <jwt>`.

---

### GET /servers/:id/automod

Returns the current configuration. Restricted to the server owner.

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

If no configuration has been saved yet, the server returns `404 Not Found`.

---

### PATCH /servers/:id/automod

Update configuration. Restricted to the server owner. All fields are optional; omitted fields keep their current value.

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
| `enabled`             | boolean | —           | `false`    | Master switch. When `false`, no rules run and timeouts are not enforced. |
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
| 403    | Caller is not the server owner                     |

---

### GET /servers/:id/automod/words

List all blocked words. Restricted to the server owner.

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

Add a word or phrase to the blocklist. Restricted to the server owner.

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

**Response:** `201 Created` with the word filter object. If the word already exists, the endpoint returns `201` idempotently (upsert behavior).

**Errors**

| Status | Reason        |
| ------ | ------------- |
| 400    | Word is blank |

---

### DELETE /servers/:id/automod/words/:word

Remove a word from the blocklist by its text value. Restricted to the server owner. Silently succeeds even if the word does not exist in the list.

**Response:** `204 No Content`

---

### GET /servers/:id/automod/logs

Retrieve the auto-moderation audit log. Restricted to the server owner. Always returns the 100 most recent entries, ordered newest-first.

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

## Rule Behavior Reference

### Spam detection

The server uses database queries (`COUNT(*)` on the messages table) to count a user's recent messages within the configured window. When the count exceeds `spam_max_messages`, the triggering message is soft-deleted and the configured `spam_action` is applied. Because detection is database-backed, message counts survive server restarts. Spam detection is a post-insert check — the message is stored first, then evaluated and soft-deleted if it exceeds the threshold.

### Duplicate detection

Queries the database for an identical message from the same user in the same channel within the last 30 seconds. Duplicate detection always uses the `"delete"` action (blocks the message); it is not configurable via `spam_action`.

### Word filter

Loads the server's blocklist from the database on each message. Matches are case-insensitive substring checks. The first matching word wins; the matched term is recorded in the audit log.

### Timeouts

When the `timeout` action fires, an entry is inserted into `automod_timeouts` with an expiry of `timeout_minutes` from now. If the user triggers another timeout before the current one expires, the new expiry unconditionally overwrites the existing one. Timed-out users receive `403 Forbidden` on any message send attempt, with the message: `"User is timed out"`.

Timeouts expire automatically — no manual cleanup is required.

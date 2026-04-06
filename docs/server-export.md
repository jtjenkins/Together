⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/guides/server-export).
Please visit the new site for the latest version.

---

# Together Server Export

This document describes the server data export feature — a single endpoint that lets a server owner download a complete archive of their server's data.

## Overview

The export endpoint builds a ZIP archive in memory from live database queries and streams it back as a download. Nothing is written to disk on the server.

---

## Endpoint

### GET /servers/:id/export

Download a ZIP archive containing all server data.

**Authentication:** Requires a valid access token (`Authorization: Bearer <jwt>`).

**Authorization:** The authenticated user must be the **server owner** (`servers.owner_id`). Non-owners (including admins and moderators) receive `404 Not Found` — the response intentionally does not reveal whether the server exists, to avoid leaking information to non-members.

**Response** (`200 OK`):

- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="{server-slug}-export-{YYYYMMDD}.zip"`
- `Content-Length: <byte count>`

The filename is derived from the server name (slugified to lowercase alphanumeric and hyphens) and the current date.

---

## ZIP File Structure

```
{server-slug}-export/
├── server.json
├── channels.json
├── members.json
├── roles.json
├── messages/
│   ├── {channel-slug}-{channel-id}.jsonl
│   └── ...
└── dm_messages/
    ├── {partner-slug}-{dm-channel-id}.jsonl
    └── ...
```

### server.json

Server metadata (pretty-printed JSON):

| Field        | Type             | Description                |
|--------------|------------------|----------------------------|
| `id`         | UUID             | Server ID                  |
| `name`       | string           | Server name                |
| `owner_id`   | UUID             | Owner's user ID            |
| `icon_url`   | string \| null   | Server icon URL            |
| `is_public`  | boolean          | Whether the server is public |
| `created_at` | datetime         | Creation timestamp         |

### channels.json

All channels in the server, ordered by position (pretty-printed JSON array):

| Field          | Type           | Description                   |
|----------------|----------------|-------------------------------|
| `id`           | UUID           | Channel ID                    |
| `name`         | string         | Channel name                  |
| `channel_type` | string         | `"text"` or `"voice"`         |
| `position`     | integer        | Display order                 |
| `category`     | string \| null | Category name                 |
| `topic`        | string \| null | Channel topic                 |
| `created_at`   | datetime       | Creation timestamp            |

### members.json

All server members, ordered by join date (pretty-printed JSON array). No credentials or password hashes are included.

| Field       | Type           | Description                |
|-------------|----------------|----------------------------|
| `user_id`   | UUID           | User ID                    |
| `username`  | string         | Username                   |
| `nickname`  | string \| null | Server-specific nickname   |
| `joined_at` | datetime       | When they joined           |

### roles.json

All roles defined in the server, ordered by position (pretty-printed JSON array):

| Field         | Type           | Description                         |
|---------------|----------------|-------------------------------------|
| `id`          | UUID           | Role ID                             |
| `name`        | string         | Role name                           |
| `permissions` | integer        | Permission bitflags (i64)           |
| `color`       | string \| null | Role color                          |
| `hoist`       | boolean        | Whether the role is displayed separately |
| `position`    | integer        | Role hierarchy position             |

### messages/{channel-slug}-{channel-id}.jsonl

One file per text channel that has messages. Voice channels are skipped. Each file uses newline-delimited JSON (one JSON object per line). Only non-deleted messages are included, ordered by creation time ascending.

| Field              | Type           | Description                          |
|--------------------|----------------|--------------------------------------|
| `id`               | UUID           | Message ID                           |
| `author_id`        | UUID \| null   | Author's user ID                     |
| `author_username`  | string \| null | Author's username at export time     |
| `content`          | string         | Message content                      |
| `reply_to`         | UUID \| null   | ID of the message being replied to   |
| `edited_at`        | datetime \| null | Last edit timestamp                |
| `created_at`       | datetime       | Creation timestamp                   |

### dm_messages/{partner-slug}-{dm-channel-id}.jsonl

The requesting user's direct messages, one file per DM conversation. Only included if the DM channel has messages. Each file uses newline-delimited JSON, ordered by creation time ascending.

| Field              | Type           | Description                      |
|--------------------|----------------|----------------------------------|
| `id`               | UUID           | Message ID                       |
| `author_id`        | UUID \| null   | Author's user ID                 |
| `author_username`  | string \| null | Author's username at export time |
| `content`          | string         | Message content                  |
| `created_at`       | datetime       | Creation timestamp               |

---

## Permissions

Only the **server owner** can export. The ownership check queries `servers.owner_id` directly. If the caller is not the owner, the endpoint returns `404 Not Found` (not `403 Forbidden`) to avoid confirming server existence to unauthorized users.

---

## Error Cases

| Status | Condition                                  |
|--------|--------------------------------------------|
| 401    | Missing or invalid access token            |
| 404    | Server not found or caller is not the owner |
| 429    | Rate limit exceeded                        |
| 500    | Internal error during ZIP construction     |

---

## Performance Considerations

- The entire ZIP archive is built **in memory** before being sent. For servers with large message histories, this means the server process will temporarily allocate memory proportional to the total size of all exported messages.
- All message queries fetch the full result set per channel (`fetch_all`), so a single channel with a very large number of messages will result in a correspondingly large allocation.
- ZIP compression uses the Deflate method, which reduces the final download size but adds CPU overhead during construction.
- There is no streaming or pagination — the response is sent only after the complete archive is built. Clients should expect longer response times for servers with extensive histories.
- File attachments and uploaded media are **not** included in the export. Only message text and metadata are exported.

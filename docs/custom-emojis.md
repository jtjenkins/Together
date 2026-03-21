# Custom Emojis

This guide covers how custom server emojis work in Together, including uploading, deleting, display in messages, and the constraints that apply.

---

## Overview

Each server can have its own set of custom emojis. Members upload image files that are then available for use in messages via `:name:` syntax. Custom emojis are scoped to a single server and visible to all members of that server. The emoji images themselves are served from a public endpoint (no authentication required) so that clients can display them without additional token exchanges.

---

## Permissions

| Who                                     | Can upload / delete |
| --------------------------------------- | ------------------- |
| Server owner                            | Yes (always)        |
| Members with `ADMINISTRATOR` permission | Yes                 |
| All other members                       | No — use only       |

> **Note:** The `require_manage_emojis` check grants access to the server owner or any member whose roles carry the `ADMINISTRATOR` bit (bit 13). There is no separate `MANAGE_EMOJIS` permission flag; administrator access is the minimum requirement.

---

## Endpoints

### List emojis

```
GET /servers/:server_id/emojis
```

**Authorization:** Caller must be a member of the server.

Returns a JSON array of all custom emojis for the server, ordered by `created_at ASC`.

**Response shape (each element):**

| Field          | Type   | Description                                 |
| -------------- | ------ | ------------------------------------------- |
| `id`           | UUID   | Unique emoji identifier                     |
| `server_id`    | UUID   | Server the emoji belongs to                 |
| `created_by`   | UUID   | User who uploaded the emoji                 |
| `name`         | string | Emoji name (used in `:name:` syntax)        |
| `url`          | string | Relative URL to fetch the image (`/emojis/{id}`) |
| `content_type` | string | MIME type of the image                      |
| `file_size`    | number | Size in bytes                               |
| `created_at`   | string | ISO 8601 timestamp                          |

---

### Upload emoji

```
POST /servers/:server_id/emojis
```

**Authorization:** Caller must have `ADMINISTRATOR` permission or be the server owner.

**Content-Type:** `multipart/form-data`

**Fields:**

| Field   | Type | Required | Description                              |
| ------- | ---- | -------- | ---------------------------------------- |
| `name`  | text | Yes      | Emoji name (see naming rules below)      |
| `image` | file | Yes      | Image bytes (see format constraints below) |

**On success:** Returns `201 Created` with the emoji DTO.

**Naming rules:**

- 1 to 32 characters long.
- Allowed characters: lowercase ASCII letters (`a-z`), digits (`0-9`), underscores (`_`), and hyphens (`-`).
- Must be unique within the server. Uploading a duplicate name returns a 400 error.

**Image constraints:**

- Maximum file size: **256 KB** (262,144 bytes). Enforced both in application code and by a database `CHECK` constraint.
- Allowed formats: **JPEG**, **PNG**, **GIF**, **WebP**. The server detects the format by inspecting file magic bytes (via the `infer` crate), not the file extension or the `Content-Type` header sent by the client.
- The image must not be empty (zero bytes).

**Server limit:** Each server may have at most **50** custom emojis. Attempting to upload beyond this limit returns a 400 error.

**Storage:** Images are written to disk under `{upload_dir}/custom_emojis/{emoji_id}/{uuid}.{ext}`. The stored filename is a random UUID (not the original upload name). On Unix systems, directory permissions are set to `0755` and file permissions to `0644`.

---

### Delete emoji

```
DELETE /servers/:server_id/emojis/:emoji_id
```

**Authorization:** Caller must have `ADMINISTRATOR` permission or be the server owner.

**On success:** Returns `204 No Content`.

The database row is deleted and the image file and its directory are removed on a best-effort basis. If the file cleanup fails, the server logs a warning but the HTTP response still succeeds.

---

### Serve emoji image

```
GET /emojis/:emoji_id
```

**Authorization:** None. This endpoint is public.

Returns the raw image bytes with the correct `Content-Type` header (e.g., `image/png`). The response includes `Cache-Control: public, max-age=86400` (24 hours) because emoji images are immutable once uploaded — deleting and re-uploading creates a new ID.

If the emoji does not exist, returns 404. If the image file is missing from disk, returns 500.

---

## Using Custom Emojis in Messages

Custom emojis are referenced in message text using colon syntax: `:emoji_name:`.

The client renders custom emojis during message display. The `splitCustomEmoji` function in `MessageItem.tsx` matches `:name:` patterns against the current server's emoji list. When a match is found, the text token is replaced with an inline `<img>` element whose `src` points to the emoji's `/emojis/{id}` URL. Unmatched `:name:` tokens are left as plain text.

The `EmojiAutocomplete` component provides autocomplete suggestions as the user types `:` followed by characters, listing matching custom emojis alongside standard Unicode emojis.

---

## WebSocket Events

### `CUSTOM_EMOJI_CREATE`

Broadcast to all connected members of the server when a new emoji is uploaded.

**Payload:** The full emoji DTO (same shape as the upload response).

### `CUSTOM_EMOJI_DELETE`

Broadcast to all connected members of the server when an emoji is deleted.

**Payload:**

```json
{
  "server_id": "<uuid>",
  "emoji_id": "<uuid>"
}
```

The client's `customEmojiStore` listens for these events and updates its local emoji list without requiring a full refresh.

---

## Database Schema

```sql
CREATE TABLE custom_emojis (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id    UUID        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    created_by   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL
                             CONSTRAINT custom_emoji_name_format
                             CHECK (name ~ '^[a-z0-9_-]{1,32}$'),
    filename     TEXT        NOT NULL,
    content_type TEXT        NOT NULL,
    file_size    BIGINT      NOT NULL
                             CONSTRAINT custom_emoji_max_size CHECK (file_size <= 262144),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT custom_emojis_server_name_unique UNIQUE (server_id, name)
);

CREATE INDEX custom_emojis_server_idx ON custom_emojis (server_id);
```

Key constraints:

- `custom_emojis_server_name_unique` — no two emojis in the same server can share a name.
- `custom_emoji_name_format` — enforces the `^[a-z0-9_-]{1,32}$` pattern at the database level.
- `custom_emoji_max_size` — enforces the 256 KB limit at the database level.
- Cascading deletes: if the server or the uploading user is deleted, associated emojis are removed automatically.

---

## Error Cases

| Scenario                                | HTTP Status | Error Type   |
| --------------------------------------- | ----------- | ------------ |
| Caller is not a server member (list)    | 403         | Forbidden    |
| Caller lacks administrator permission   | 403         | Forbidden    |
| Missing `name` field in multipart       | 400         | Validation   |
| Missing `image` field in multipart      | 400         | Validation   |
| Invalid multipart data                  | 400         | Validation   |
| Name empty or longer than 32 characters | 400         | Validation   |
| Name contains disallowed characters     | 400         | Validation   |
| Duplicate name in the same server       | 400         | Validation   |
| Image is empty (zero bytes)             | 400         | Validation   |
| Image exceeds 256 KB                    | 400         | Validation   |
| Image format not JPEG/PNG/GIF/WebP      | 400         | Validation   |
| Image format could not be detected      | 400         | Validation   |
| Server already has 50 emojis            | 400         | Validation   |
| Emoji not found (delete or serve)       | 404         | NotFound     |
| Disk write or file open failure         | 500         | Internal     |

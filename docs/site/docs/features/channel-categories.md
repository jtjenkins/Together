---
outline: deep
---

# Channel Categories

This guide explains how to use channel categories in Together — including creating, editing, and removing them, how to organize channels within categories, who can manage them, and current limitations.

## Overview

A **category** is a text label that groups related channels together in the channel list. Any channel (text or voice) can be assigned to a category at creation time or at any point afterwards. Channels that share the same category name are displayed together, making it easier to navigate a server with many channels.

Categories are not separate objects — they are a named property on each channel. There is no dedicated "create category" action; a category is created implicitly when the first channel that uses that name is created or updated.

## Permissions

| Who               | Can manage categories                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Server owner      | Yes (full control)                                                                       |
| Administrators    | No — role-based `ADMINISTRATOR` does not grant channel management in the current release |
| All other members | No — view only                                                                           |

> **Note:** Channel management (create, update, delete) is currently restricted to the **server owner** only. This includes assigning or changing category labels. Regular members and administrators can see channels and their categories but cannot modify them.

## Creating a Channel in a Category

To place a new channel into a category, supply the `category` field when creating the channel.

### API

```http
POST /servers/{server_id}/channels
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "announcements",
  "type": "text",
  "category": "INFORMATION",
  "topic": "Server news and updates"
}
```

A successful response returns the full channel object including the `category` field. If `category` is omitted or `null`, the channel is created without a category.

### Desktop / Web

1. Open **Server Settings** or right-click the channel list sidebar.
2. Select **Create Channel**.
3. Enter the channel name and type.
4. In the **Category** field, type the exact name of an existing category or enter a new name to create one.
5. Click **Create**.

### Mobile

1. Long-press the channel list sidebar and tap **Add Channel**, or open the server menu.
2. Follow the same steps as desktop, entering the category name in the provided field.

## Renaming a Category

Because categories are labels on channels, renaming a category means updating the `category` field on every channel that belongs to it.

### API

Update each channel individually:

```http
PATCH /servers/{server_id}/channels/{channel_id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "category": "COMMUNITY"
}
```

Only the fields included in the request body are changed; omitting a field leaves it unchanged.

### Desktop / Web

1. Right-click the channel you want to move, and select **Edit Channel**.
2. Change the **Category** field to the new name.
3. Repeat for every channel in the old category.

> **Tip:** Channels sharing the same category name are grouped automatically. All channels must be updated to the new name for the group to appear correctly.

## Moving a Channel to a Different Category

Moving a channel between categories is the same as renaming — patch the channel with the target category name.

```http
PATCH /servers/{server_id}/channels/{channel_id}
Content-Type: application/json

{
  "category": "VOICE LOUNGE"
}
```

Both text and voice channels can be placed in the same category.

## Removing a Channel from a Category

To remove a channel's category assignment, set `category` to an empty string (`""`):

```http
PATCH /servers/{server_id}/channels/{channel_id}
Content-Type: application/json

{
  "category": ""
}
```

The channel will then appear outside any category group. Sending `null` or omitting the field will **not** clear the category — only an explicit empty string removes it.

## Deleting a Category

There is no dedicated delete operation for categories. To remove a category entirely:

1. Move all channels in that category to another category, or remove their category assignment (set to `""`).
2. Once no channels reference the category name, it no longer appears in the channel list.

Alternatively, delete the channels themselves — a hard delete that also removes all messages in those channels.

## Ordering Channels Within a Category

Channels are sorted by their `position` field (ascending), then by creation time for channels with equal positions. To reorder channels within a category, update their `position` values:

```http
PATCH /servers/{server_id}/channels/{channel_id}
Content-Type: application/json

{
  "position": 2
}
```

Position values are integers ≥ 0. Lower values appear higher in the list. Categories themselves do not have an explicit order — the order in which category groups appear in the sidebar is determined by the lowest `position` value among their member channels.

## API Reference

| Method   | Endpoint                                     | Description                                       | Permission   |
| -------- | -------------------------------------------- | ------------------------------------------------- | ------------ |
| `POST`   | `/servers/{server_id}/channels`              | Create a channel (with optional category)         | Server owner |
| `GET`    | `/servers/{server_id}/channels`              | List all channels with their categories           | Member       |
| `GET`    | `/servers/{server_id}/channels/{channel_id}` | Get a single channel                              | Member       |
| `PATCH`  | `/servers/{server_id}/channels/{channel_id}` | Update channel name, topic, category, or position | Server owner |
| `DELETE` | `/servers/{server_id}/channels/{channel_id}` | Delete a channel (hard delete, cascades messages) | Server owner |

See [openapi.yaml](./openapi.yaml) for full request/response schemas.

## Limitations

- **No dedicated category entity**: Categories are plain text labels on channels. There is no separate category ID, creation timestamp, or metadata. All operations are performed by patching individual channels.
- **Category name length**: Category names must be ≤ 100 characters. Names are stored and compared as-is (case-sensitive). `"General"` and `"GENERAL"` are treated as two different categories.
- **No cross-server categories**: Categories are scoped to a single server. There is no way to share or synchronize category structures across servers.
- **No category-level permissions**: Permissions are set per channel (via `channel_permission_overrides`). There is no way to apply a permission override to all channels in a category in one operation.
- **No collapse state stored server-side**: Whether a category is expanded or collapsed in the sidebar is a client-side UI preference. It is not persisted to the server.
- **Owner-only management**: Only the server owner can create, rename, or delete categories. Role-based `MANAGE_CHANNELS` or `ADMINISTRATOR` permissions do not grant this ability in the current release.
- **Clearing a category requires an explicit empty string**: Passing `null` or omitting the `category` field in a `PATCH` request leaves the existing category unchanged. To remove a channel from its category, you must explicitly send `"category": ""`.
- **No batch category rename**: Renaming a category requires patching each channel in the group individually. There is no bulk update endpoint.

## Frequently Asked Questions

**Can I have both text and voice channels in the same category?**
Yes. Any channel type can be assigned to any category name.

**Do category names have to be uppercase?**
No. Category names are free-form text up to 100 characters. However, the comparison is case-sensitive, so consistent casing is recommended to avoid accidental duplicate groups.

**What happens to channels if I rename a category halfway through?**
Channels still using the old name will remain grouped under the old name. Update all channels to the new name to complete the rename.

**Can bots manage categories?**
Bots authenticate with `Authorization: Bot <token>` and can call the channel create and update endpoints. However, channel management is restricted to the server owner's user ID, so bots cannot modify channels unless the bot's user is the server owner — which is not a typical configuration.

**Is there a limit on how many categories a server can have?**
There is no explicit cap on the number of distinct category names per server. Practical limits are determined by the number of channels a server can contain.

**What happens to a category's channels when the server is deleted?**
All channels are deleted via `ON DELETE CASCADE` on `channels.server_id`. All messages within those channels are also removed via `ON DELETE CASCADE` on `messages.channel_id`.

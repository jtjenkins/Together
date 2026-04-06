⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/features/message-pinning).
Please visit the new site for the latest version.

---

# Message Pinning

This guide covers how to pin and unpin messages in Together, including who can perform each action, where pinned messages appear, and current limitations.

---

## Overview

Pinning a message highlights it as important within a channel. Pinned messages are accessible at any time from a dedicated list, separate from the normal message flow. Any server member can view pinned messages; only members with the right permission can add or remove them.

---

## Permissions

| Who                                       | Can pin / unpin |
| ----------------------------------------- | --------------- |
| Server owner                              | Yes (always)    |
| Members with `ADMINISTRATOR` permission   | Yes             |
| Members with `MANAGE_MESSAGES` permission | Yes             |
| All other members                         | No — view only  |

> **Note:** `MANAGE_MESSAGES` is the minimum permission required to pin or unpin messages. Server owners and administrators inherit this ability through their elevated permissions.

---

## Pinning a Message

### Desktop / web

1. Hover over the message you want to pin. A toolbar appears at the right edge of the message.
2. Click the **more options (⋯)** menu in the toolbar.
3. Select **Pin Message**.
4. Confirm the action when prompted.

### Mobile

1. Long-press the message to open the action menu.
2. Tap **Pin Message** and confirm.

### Behaviour after pinning

- The message is marked as pinned instantly. All connected members receive a real-time `MESSAGE_PIN` event and the pin indicator appears immediately.
- The message remains in its original position in the channel timeline — pinning does not move or duplicate it.
- A record of who pinned the message and when is stored (`pinned_by`, `pinned_at`).
- Pinning an already-pinned message is a no-op — the operation succeeds silently without changing anything.

---

## Unpinning a Message

### Desktop / web

1. Open the **Pinned Messages** list for the channel (see [Viewing Pinned Messages](#viewing-pinned-messages) below).
2. Hover over the message in the list.
3. Click the **unpin (×)** icon next to it and confirm.

Alternatively:

1. Hover over the pinned message in the chat timeline.
2. Open the **more options (⋯)** menu.
3. Select **Unpin Message** and confirm.

### Mobile

1. Long-press the pinned message in the chat.
2. Tap **Unpin Message** and confirm.

### Behaviour after unpinning

- All connected members receive a real-time `MESSAGE_UNPIN` event and the pin indicator is removed immediately.
- The message itself is not deleted or modified — it stays in the channel timeline as a normal message.
- Attempting to unpin a message that is not currently pinned returns a 404 Not Found error.

---

## Viewing Pinned Messages

Any server member can browse the pinned messages for a channel:

1. Open the channel.
2. Click the **pin** icon in the channel header (top-right area of the chat view).
3. The **Pinned Messages** panel slides open, listing all pinned messages ordered by pin time — most recently pinned first.

Each entry in the panel shows the full message content, the original author, and when it was pinned.

---

## Real-Time Updates

Pin and unpin actions are broadcast instantly over the WebSocket gateway to all members currently viewing the server:

| Action | Gateway event   | Payload                                   |
| ------ | --------------- | ----------------------------------------- |
| Pin    | `MESSAGE_PIN`   | `{ message_id, channel_id, pinned_by }`   |
| Unpin  | `MESSAGE_UNPIN` | `{ message_id, channel_id, unpinned_by }` |

Members who are offline see the correct pin state when they next open the channel.

---

## Limitations

- **Channel-scoped**: Pins are per-channel. A message pinned in `#announcements` does not appear in the pinned list for any other channel.
- **No pin limit enforced**: There is currently no hard cap on the number of pinned messages per channel. That said, keeping the list focused (under ~50 messages) makes it more useful.
- **Deleted messages are excluded**: If a pinned message is later deleted, it is automatically excluded from the pinned messages list (`deleted = FALSE` filter). The pin record itself is retained in the database but is never surfaced to users.
- **DMs not supported**: Message pinning applies to server channels only. Direct message conversations do not have a pinning feature.
- **No re-ordering**: Pinned messages are always ordered by pin time (newest first) and cannot be manually reordered.

---

## Frequently Asked Questions

**Can a regular member see who pinned a message?**
Yes. The pinned messages panel shows when each message was pinned. The specific user who performed the pin action is stored internally and may be surfaced in the panel depending on the client version.

**What happens to a pinned message if the channel is deleted?**
If the channel is deleted, all associated messages (including pinned ones) are removed. There is no independent archive of pinned messages.

**Can bots pin messages?**
Yes. Bots authenticating via `Authorization: Bot <token>` can call the pin/unpin endpoints if they have been granted the `MANAGE_MESSAGES` permission in the server.

**Is there an API endpoint to list pinned messages?**
Yes: `GET /channels/{channel_id}/pinned-messages`. Returns an array of full message objects ordered by `pinned_at DESC`. See the [API reference](./openapi.yaml) for the full schema.

⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/features/message-editing-deletion).
Please visit the new site for the latest version.

---

# Message Editing and Deletion

This guide covers how to edit and delete messages in Together, including who can perform each action and what to expect in edge cases.

---

## Editing a Message

### Who can edit

Only the **original author** of a message can edit it. There is no role or permission that grants another user the ability to edit someone else's message.

### How to edit (desktop / web)

1. Hover over the message you want to edit. A toolbar appears at the right edge of the message.
2. Click the **pencil (Edit)** icon.
3. The message text is replaced with an inline text box pre-filled with the current content.
4. Make your changes.
5. Press **Enter** to save, or **Escape** to cancel without saving.

### How to edit (mobile)

1. Long-press the message to open the action menu.
2. Tap **Edit**.
3. Modify the content and confirm.

### Behaviour after editing

- The message is updated in place — no new message is created.
- An **(edited)** label appears next to the timestamp to indicate the message has been changed. The label is visible to all members in the channel.
- `@mentions` are re-parsed from the new content. If you add or remove a mention, notification state updates accordingly.
- If editing fails (e.g. a network error), the edit box stays open so you can retry. No partial save occurs.

### Content limits

| Constraint     | Value            |
| -------------- | ---------------- |
| Minimum length | 1 character      |
| Maximum length | 4,000 characters |

Submitting content outside this range returns a validation error and the message is not updated.

### Limitations

- You cannot edit a message that has already been deleted.
- Editing a message does **not** update its original timestamp or change its position in the message list.
- The edit history (previous versions) is not exposed in the UI or API — only the current content is stored.

---

## Deleting a Message

### Who can delete

| Role                                                   | Can delete                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Message author                                         | Their own messages                                          |
| Server owner                                           | Any message in any channel on that server                   |
| Other members (including roles with `MANAGE_MESSAGES`) | No — deletion is restricted to author and server owner only |

> **Note:** `MANAGE_MESSAGES` permission does not currently grant deletion rights. Only the author or server owner can remove a message.

### How to delete (desktop / web)

1. Hover over the message. A toolbar appears at the right edge.
2. Click the **trash (Delete)** icon.
3. A confirmation prompt asks: _"Delete this message?"_
4. Click **OK** to confirm, or **Cancel** to abort.

### How to delete (mobile)

1. Long-press the message to open the action menu.
2. Tap **Delete** and confirm.

### Behaviour after deletion

- The message is **soft-deleted**: the row is retained in the database with `deleted = true`, but the content is no longer visible to any member.
- All connected members receive a real-time `MESSAGE_DELETE` event and the message is removed from their view immediately.
- If the deleted message was quoted in a reply, the reply bar shows _"Original message deleted"_ rather than the message content.
- Deletion is **permanent from a user perspective** — there is no undo or undelete in the UI.

### Double-delete safety

If two actions attempt to delete the same message simultaneously (e.g. the author and the server owner act at the same moment), only one succeeds. The second request returns a 404 Not Found rather than an error.

---

## Real-Time Updates

Both edits and deletions are broadcast instantly over the WebSocket gateway to all members currently viewing the server:

| Action | Gateway event    | Payload                     |
| ------ | ---------------- | --------------------------- |
| Edit   | `MESSAGE_UPDATE` | Full updated message object |
| Delete | `MESSAGE_DELETE` | `{ id, channel_id }`        |

Members who are offline receive the correct state when they next load the channel — edited content from the database, deleted messages absent from the list.

---

## Frequently Asked Questions

**Can I edit a message in a DM conversation?**
DM messages follow the same rules: only the author can edit their own messages, with the same 4,000-character limit.

**Can a moderator delete messages?**
Currently only the server owner (not moderators or members with `MANAGE_MESSAGES`) can delete other users' messages. Moderation workflows that require broader deletion rights should use the [auto-moderation](./auto-moderation.md) system for rule-based removal.

**Is there a time limit on editing or deleting?**
No. You can edit or delete your own messages at any time after sending, as long as they have not already been deleted.

**What happens to reactions and thread replies when a message is deleted?**
The parent message row is soft-deleted, so the `deleted = true` flag propagates. Thread replies remain in the database but their parent message will show as deleted. Reaction counts are retained in the database but are no longer visible since the message itself is hidden.

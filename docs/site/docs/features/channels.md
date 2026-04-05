---
outline: deep
---

# Text Channels & Threads

Together provides familiar text channels with real-time messaging, threading, and rich formatting — everything your community needs for organized conversation.

## Channel Types

Together supports two channel types:

- **Text channels** — Real-time chat with full message history, reactions, pinning, and threading
- **Voice channels** — P2P WebRTC-based voice (and optional screen sharing via Go Live)

Channels are organized within servers and can be grouped into [channel categories](/features/channel-categories) for better structure.

## Messages

Together messages support several content types and interactions:

### Content
- **Plain text** — Standard UTF-8 messages
- **Attachments** — File uploads with configurable size limits
- **Markdown formatting** — Bold, italic, strikethrough, code blocks, lists, and more
- **Reactions** — Add emoji reactions to any message ([learn more](/features/reactions))
- **Mentions** — @user mentions for notifications

### Threading

Threads let you branch off a conversation without cluttering the channel. They're ideal for:
- Extended discussions on a specific topic
- Keeping on-topic conversations organized
- Follow-up questions that don't need their own channel

### Message Lifecycle

Messages can be [edited](/features/message-editing-deletion) and [deleted](/features/message-editing-deletion) by their authors or moderators. Important messages can be [pinned](/features/message-pinning) for quick reference.

## Searching

All messages are indexed with PostgreSQL's built-in full-text search (GIN index). No external search engine required — search is fast, reliable, and always in sync. See [Message Search](/features/message-search) for details.

## Permissions

Channel access is controlled through the [roles and permissions](/features/roles-and-permissions) system. Each channel can have custom [permission overrides](/features/channel-permissions) that grant or deny specific actions to roles.

## Real-Time Delivery

Messages are delivered via the Together WebSocket gateway with typical latency under 50ms. The gateway uses the standard `MESSAGE_CREATE`, `MESSAGE_UPDATE`, and `MESSAGE_DELETE` events for real-time synchronization.

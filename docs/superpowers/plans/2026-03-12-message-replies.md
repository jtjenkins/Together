# Message Replies Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the message reply system so quoted reply previews always display, out-of-pagination reply targets are fetched on demand, and clicking a reply bar scrolls to the original message with a highlight animation.

**Architecture:** The DB, REST create, WebSocket, and TS types for `reply_to` already exist. What's missing is (1) a `GET /channels/:id/messages/:id` endpoint to fetch out-of-range reply targets, (2) a client-side reply-target cache in the store, (3) a reply bar that always renders (not gated on content being available), and (4) click-to-jump scroll behavior with a visual highlight. No migrations are needed.

**Tech Stack:** Rust/Axum (backend), React + Zustand + TypeScript (frontend), CSS Modules

---

## Files Changed

| File                                                         | Change                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `server/src/handlers/messages.rs`                            | Add `get_message` handler                                                                      |
| `server/src/main.rs`                                         | Register `GET /channels/:channel_id/messages/:message_id` route                                |
| `clients/web/src/api/client.ts`                              | Add `getMessage` method                                                                        |
| `clients/web/src/stores/messageStore.ts`                     | Add `replyTargetCache`, `ensureReplyTarget`, `highlightedMessageId`, `setHighlightedMessageId` |
| `clients/web/src/components/messages/MessageList.tsx`        | Look up reply targets from cache; pass `replyIsDeleted`, `onReplyBarClick`                     |
| `clients/web/src/components/messages/MessageItem.tsx`        | Always show reply bar; handle deleted/unknown state; clickable; register DOM ref               |
| `clients/web/src/components/messages/MessageItem.module.css` | Left-border accent, clickable reply bar, highlight animation                                   |
| `clients/web/src/components/messages/ChatArea.tsx`           | `messageRefs` map; `onJumpToMessage`; trigger `ensureReplyTarget` on load                      |

---

## Chunk 1: Backend — single-message fetch endpoint

### Task 1: Add `get_message` handler (Rust)

**Files:**

- Modify: `server/src/handlers/messages.rs`

- [ ] **Step 1: Write the handler function**

Append to the end of the handlers section in `server/src/handlers/messages.rs` (after the `delete_message` handler and before the thread handlers):

```rust
/// GET /channels/:channel_id/messages/:message_id — fetch one message (members only).
///
/// Returns the full MessageDto including deleted messages (deleted flag is set
/// to true) so reply-bar previews can show "original message deleted" state.
pub async fn get_message(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((channel_id, message_id)): Path<(Uuid, Uuid)>,
) -> AppResult<Json<MessageDto>> {
    let channel = fetch_channel_by_id(&state.pool, channel_id).await?;
    require_member(&state.pool, channel.server_id, auth.user_id()).await?;

    let message = sqlx::query_as::<_, Message>(
        "SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to,
                m.mention_user_ids, m.mention_everyone, m.thread_id,
                (SELECT COUNT(*)::int FROM messages r
                 WHERE r.thread_id = m.id AND r.deleted = FALSE) AS thread_reply_count,
                m.edited_at, m.deleted, m.created_at, m.pinned, m.pinned_by, m.pinned_at
         FROM messages m
         WHERE m.id = $1 AND m.channel_id = $2",
    )
    .bind(message_id)
    .bind(channel_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Message not found".into()))?;

    let enriched = enrich_messages(&state.pool, auth.user_id(), vec![message]).await?;
    let dto = enriched
        .into_iter()
        .next()
        .ok_or(AppError::Internal)?;

    Ok(Json(dto))
}
```

- [ ] **Step 2: Register the route in `server/src/main.rs`**

Find the block of message routes (around line 266). Add after the existing `GET /channels/:channel_id/messages` route:

```rust
.route(
    "/channels/:channel_id/messages/:message_id",
    get(handlers::messages::get_message),
)
```

Insert it before the existing thread route `"/channels/:channel_id/messages/:message_id/thread"` to keep routes in logical order.

- [ ] **Step 3: Build the server to verify it compiles**

```bash
cd /Volumes/Storage/GitHub/Together/server && cargo build 2>&1 | tail -20
```

Expected: compilation succeeds with no errors. Fix any type/path errors that arise.

- [ ] **Step 4: Smoke-test the endpoint manually**

Start the server (`cargo run`) and make a test request. If you have a valid channel/message ID from a running dev instance, confirm it returns a 200 with a MessageDto body. If not, the build passing is sufficient — the handler mirrors the exact patterns of `list_messages` and `create_message`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Storage/GitHub/Together && git add server/src/handlers/messages.rs server/src/main.rs
git commit -m "feat(api): add GET /channels/:channel_id/messages/:message_id endpoint"
```

---

## Chunk 2: Frontend store and API client

### Task 2: Add `getMessage` to the API client

**Files:**

- Modify: `clients/web/src/api/client.ts`

- [ ] **Step 1: Locate the message methods section**

In `clients/web/src/api/client.ts`, find the `listMessages` method (around line 260). After `listMessages` and before `updateMessage`, add:

```typescript
getMessage(channelId: string, messageId: string): Promise<Message> {
  return this.request<Message>(`/channels/${channelId}/messages/${messageId}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

### Task 3: Add reply-target cache and jump-highlight state to the store

**Files:**

- Modify: `clients/web/src/stores/messageStore.ts`

- [ ] **Step 1: Add new fields to the `MessageState` interface**

After the `attachmentCache` field declaration, add:

```typescript
/** Messages fetched individually for reply-bar preview (keyed by message ID).
 *  Only populated for messages not in the main `messages` list. */
replyTargetCache: Record<string, Message>;
/** ID of the message currently highlighted by jump-to-reply. Null = none. */
highlightedMessageId: string | null;
```

After the `cacheAttachments` action declaration, add:

```typescript
/** Fetch a reply target and store it in replyTargetCache if not already loaded. */
ensureReplyTarget: (channelId: string, messageId: string) => Promise<void>;
setHighlightedMessageId: (id: string | null) => void;
```

- [ ] **Step 2: Add initial state values**

In the `create<MessageState>((set) => ({` object, after `attachmentCache: {}`, add:

```typescript
replyTargetCache: {},
highlightedMessageId: null,
```

- [ ] **Step 3: Implement `ensureReplyTarget` action**

After the `cacheAttachments` implementation, add:

```typescript
ensureReplyTarget: async (channelId, messageId) => {
  // Skip fetch if message is already in main list or reply cache
  const { messages, replyTargetCache } = useMessageStore.getState();
  if (messages.some((m) => m.id === messageId) || replyTargetCache[messageId]) {
    return;
  }
  try {
    const msg = await api.getMessage(channelId, messageId);
    set((s) => ({
      replyTargetCache: { ...s.replyTargetCache, [messageId]: msg },
    }));
  } catch {
    // Non-fatal: reply bar will show without content preview
  }
},

setHighlightedMessageId: (id) => set({ highlightedMessageId: id }),
```

- [ ] **Step 4: Clear `replyTargetCache` in `clearMessages`**

In the existing `clearMessages` implementation, add `replyTargetCache: {}` to the reset object:

```typescript
clearMessages: () =>
  set({
    messages: [],
    hasMore: true,
    replyingTo: null,
    attachmentCache: {},
    replyTargetCache: {},
    threadCache: {},
    activeThreadId: null,
    highlightedMessageId: null,
  }),
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Storage/GitHub/Together && git add clients/web/src/api/client.ts clients/web/src/stores/messageStore.ts
git commit -m "feat(store): add reply target cache and getMessage API method"
```

---

## Chunk 3: Frontend — MessageList and MessageItem changes

### Task 4: Update MessageList to supply reply target data from cache

**Files:**

- Modify: `clients/web/src/components/messages/MessageList.tsx`

- [ ] **Step 1: Import store additions**

Add `useMessageStore` import (already imported as a whole) and `useEffect`. Change the imports at the top to include `useEffect`:

At the top of MessageList.tsx, the current imports are:

```typescript
import { Fragment } from "react";
```

Change to:

```typescript
import { Fragment, useEffect } from "react";
```

- [ ] **Step 2: Add store subscriptions**

Inside the `MessageList` component function, after the existing store subscriptions, add:

```typescript
const replyTargetCache = useMessageStore((s) => s.replyTargetCache);
const ensureReplyTarget = useMessageStore((s) => s.ensureReplyTarget);
```

- [ ] **Step 3: Fetch missing reply targets as an effect**

After the store subscriptions, add an effect that triggers fetching for any reply targets not already in the message list or cache:

```typescript
useEffect(() => {
  const replyIds = messages
    .filter(
      (m) =>
        m.reply_to !== null &&
        !messages.some((r) => r.id === m.reply_to) &&
        !replyTargetCache[m.reply_to!],
    )
    .map((m) => m.reply_to!);

  // De-duplicate — same target may be referenced by multiple messages
  const unique = [...new Set(replyIds)];
  for (const id of unique) {
    ensureReplyTarget(channelId, id);
  }
}, [messages, replyTargetCache, channelId, ensureReplyTarget]);
```

- [ ] **Step 4: Update the reply prop computation in the render**

Currently, the render passes `replyAuthorName` and `replyContent` derived from the `messages` array only. Extend the lookup to also check `replyTargetCache`, and add a `replyIsDeleted` prop:

Replace the existing prop computation block inside `groupedMessages.map`:

```tsx
// Existing (REMOVE):
replyAuthorName={
  message.reply_to
    ? getAuthorName(
        messages.find((m) => m.id === message.reply_to)
          ?.author_id ?? null,
      )
    : undefined
}
replyContent={
  message.reply_to
    ? messages.find((m) => m.id === message.reply_to)?.content
    : undefined
}

// Replace with:
replyAuthorName={
  message.reply_to
    ? getAuthorName(
        (messages.find((m) => m.id === message.reply_to) ??
          replyTargetCache[message.reply_to] ??
          null)?.author_id ?? null,
      )
    : undefined
}
replyContent={
  message.reply_to
    ? (messages.find((m) => m.id === message.reply_to) ??
        replyTargetCache[message.reply_to] ??
        null)?.content
    : undefined
}
replyIsDeleted={
  message.reply_to
    ? (messages.find((m) => m.id === message.reply_to) ??
        replyTargetCache[message.reply_to] ??
        null)?.deleted === true
    : undefined
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only for the new `replyIsDeleted` prop not yet declared in `MessageItemProps` — fix those in the next task.

### Task 5: Update MessageItem — always-visible reply bar with states

**Files:**

- Modify: `clients/web/src/components/messages/MessageItem.tsx`
- Modify: `clients/web/src/components/messages/MessageItem.module.css`

- [ ] **Step 1: Add new props to `MessageItemProps`**

In the `MessageItemProps` interface, add:

```typescript
replyIsDeleted?: boolean;
/** Called when the user clicks the reply-bar preview to jump to the original message. */
onReplyBarClick?: () => void;
/** Registers/unregisters the root DOM element for scroll-jump targeting. */
onRegisterRef?: (id: string, el: HTMLDivElement | null) => void;
```

- [ ] **Step 2: Destructure the new props**

In the `MessageItem` function signature, add the new props:

```typescript
export function MessageItem({
  message,
  showHeader,
  authorName,
  avatarUrl,
  channelId,
  replyAuthorName,
  replyContent,
  replyIsDeleted,
  onReplyBarClick,
  onRegisterRef,
  onOpenThread,
  canPin = false,
}: MessageItemProps) {
```

- [ ] **Step 3: Subscribe to `highlightedMessageId` from the store**

Inside the function body, after existing store subscriptions, add:

```typescript
const highlightedMessageId = useMessageStore((s) => s.highlightedMessageId);
const isHighlighted = highlightedMessageId === message.id;
```

- [ ] **Step 4: Register the DOM ref on the root element**

Change the outermost `<div>` in the return to attach the registration callback. Find:

```tsx
return (
  <div
    className={`${styles.message} ${isOwnMessage ? styles.own : ""} ${showHeader ? styles.withHeader : styles.compact}`}
    onMouseLeave={() => setShowPicker(false)}
  >
```

Change to:

```tsx
return (
  <div
    ref={(el) => onRegisterRef?.(message.id, el)}
    className={`${styles.message} ${isOwnMessage ? styles.own : ""} ${showHeader ? styles.withHeader : styles.compact} ${isHighlighted ? styles.highlighted : ""}`}
    onMouseLeave={() => setShowPicker(false)}
  >
```

- [ ] **Step 5: Replace the reply bar with the always-visible version**

Find the existing reply bar block:

```tsx
{
  message.reply_to && replyContent && (
    <div className={styles.replyBar}>
      <span className={styles.replyIcon}>
        <CornerDownRight size={12} />
      </span>
      <span className={styles.replyAuthor}>{replyAuthorName}</span>
      <span className={styles.replyText}>{replyContent}</span>
    </div>
  );
}
```

Replace with:

```tsx
{
  message.reply_to && (
    <div
      className={`${styles.replyBar} ${onReplyBarClick ? styles.replyBarClickable : ""}`}
      onClick={onReplyBarClick}
      role={onReplyBarClick ? "button" : undefined}
      tabIndex={onReplyBarClick ? 0 : undefined}
      onKeyDown={
        onReplyBarClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onReplyBarClick();
              }
            }
          : undefined
      }
      aria-label={onReplyBarClick ? "Jump to original message" : undefined}
    >
      <span className={styles.replyIcon}>
        <CornerDownRight size={12} />
      </span>
      {replyAuthorName && (
        <span className={styles.replyAuthor}>{replyAuthorName}</span>
      )}
      {replyIsDeleted ? (
        <span className={styles.replyTextDeleted}>
          (original message deleted)
        </span>
      ) : replyContent ? (
        <span className={styles.replyText}>{replyContent}</span>
      ) : (
        <span className={styles.replyTextMuted}>
          {replyAuthorName ? "view original" : "loading preview…"}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add new CSS classes to `MessageItem.module.css`**

After the existing `.replyText` rule, append:

```css
.replyTextDeleted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-style: italic;
}

.replyTextMuted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
  font-style: italic;
}

.replyBarClickable {
  cursor: pointer;
}

.replyBarClickable:hover {
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}

/* Left-border accent on the reply bar — makes the visual connection clear */
.replyBar {
  border-left: 2px solid var(--border-color-strong);
  margin-left: 56px;
  padding-left: 8px;
}
```

Wait — the existing `.replyBar` rule already exists and sets padding. Instead of appending a new duplicate, **modify the existing `.replyBar` rule** to add the border-left:

Find the existing `.replyBar` rule:

```css
.replyBar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0 4px 56px;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
}
```

Change to:

```css
.replyBar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px 4px 12px;
  margin-left: 52px;
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  border-left: 2px solid var(--border-color-strong, rgba(255, 255, 255, 0.15));
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
```

And the `.own .replyBar` override already exists — update it to match:

```css
.own .replyBar {
  flex-direction: row-reverse;
  margin-left: 0;
  margin-right: 52px;
  padding: 2px 12px 4px 8px;
  border-left: none;
  border-right: 2px solid var(--border-color-strong, rgba(255, 255, 255, 0.15));
  border-radius: var(--radius-sm) 0 0 var(--radius-sm);
}
```

After the existing `.replyText` rule, **append** the new rules:

```css
.replyTextDeleted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}

.replyTextMuted {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  opacity: 0.6;
}

.replyBarClickable {
  cursor: pointer;
  transition: background 0.1s;
}

.replyBarClickable:hover {
  background: var(--bg-message-hover);
}
```

- [ ] **Step 7: Add `highlighted` class and animation to `MessageItem.module.css`**

Append to the CSS file:

```css
/* ── Jump-to-message highlight ───────────────────────────────────────────── */

@keyframes messageHighlight {
  0% {
    background: var(--accent-primary, #7c6af7);
    opacity: 0.18;
  }
  60% {
    background: var(--accent-primary, #7c6af7);
    opacity: 0.18;
  }
  100% {
    background: transparent;
    opacity: 0;
  }
}

.highlighted {
  animation: messageHighlight 2s ease-out forwards;
}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only errors about props not yet passed from MessageList — will be fixed next).

- [ ] **Step 9: Commit**

```bash
cd /Volumes/Storage/GitHub/Together && git add clients/web/src/components/messages/MessageItem.tsx clients/web/src/components/messages/MessageItem.module.css clients/web/src/components/messages/MessageList.tsx
git commit -m "feat(ui): always-visible reply bar with deleted/loading states and visual accent"
```

---

## Chunk 4: Jump-to-message wiring

### Task 6: Wire jump-to-message from ChatArea through MessageList to MessageItem

**Files:**

- Modify: `clients/web/src/components/messages/ChatArea.tsx`
- Modify: `clients/web/src/components/messages/MessageList.tsx`
- Modify: `clients/web/src/components/messages/MessageItem.tsx` (prop threading only)

- [ ] **Step 1: Add `messageRefs` and `onJumpToMessage` to `ChatArea`**

In `ChatArea.tsx`, after existing `useRef` and `useState` declarations, add:

```typescript
const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
const setHighlightedMessageId = useMessageStore(
  (s) => s.setHighlightedMessageId,
);

const handleJumpToMessage = useCallback(
  (messageId: string) => {
    const el = messageRefs.current.get(messageId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(messageId);
      // Clear highlight after animation completes (2s)
      setTimeout(() => setHighlightedMessageId(null), 2100);
    }
  },
  [setHighlightedMessageId],
);

const handleRegisterMessageRef = useCallback(
  (id: string, el: HTMLDivElement | null) => {
    if (el) {
      messageRefs.current.set(id, el);
    } else {
      messageRefs.current.delete(id);
    }
  },
  [],
);
```

- [ ] **Step 2: Pass the new handlers to `MessageList`**

Find the existing `<MessageList ... />` render in ChatArea and add the new props:

```tsx
<MessageList
  messages={messages}
  channelId={channelId}
  onOpenThread={onOpenThread}
  onJumpToMessage={handleJumpToMessage}
  onRegisterMessageRef={handleRegisterMessageRef}
/>
```

- [ ] **Step 3: Add new props to `MessageListProps`**

In `MessageList.tsx`, update the `MessageListProps` interface:

```typescript
interface MessageListProps {
  messages: Message[];
  channelId: string;
  onOpenThread?: (messageId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onRegisterMessageRef?: (id: string, el: HTMLDivElement | null) => void;
}
```

- [ ] **Step 4: Thread `onJumpToMessage` and `onRegisterMessageRef` through MessageList**

In the `MessageList` component function, add the new props to the destructure:

```typescript
export function MessageList({
  messages,
  channelId,
  onOpenThread,
  onJumpToMessage,
  onRegisterMessageRef,
}: MessageListProps) {
```

Pass them to `MessageItem`:

```tsx
<MessageItem
  message={message}
  showHeader={showHeader}
  authorName={getAuthorName(message.author_id)}
  avatarUrl={getAvatarUrl(message.author_id)}
  channelId={channelId}
  replyAuthorName={...}
  replyContent={...}
  replyIsDeleted={...}
  onReplyBarClick={
    message.reply_to && onJumpToMessage
      ? () => onJumpToMessage(message.reply_to!)
      : undefined
  }
  onRegisterRef={onRegisterMessageRef}
  onOpenThread={onOpenThread}
  canPin={canPin ?? false}
/>
```

- [ ] **Step 5: Verify TypeScript compiles with no errors**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Build the web client**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npm run build 2>&1 | tail -20
```

Expected: successful build, no TypeScript or Vite errors.

- [ ] **Step 7: Commit**

```bash
cd /Volumes/Storage/GitHub/Together && git add clients/web/src/components/messages/ChatArea.tsx clients/web/src/components/messages/MessageList.tsx clients/web/src/components/messages/MessageItem.tsx
git commit -m "feat(ui): jump-to-message on reply bar click with scroll and highlight"
```

---

## Chunk 5: Final verification

### Task 7: End-to-end verification

- [ ] **Step 1: Run the full Rust test suite**

```bash
cd /Volumes/Storage/GitHub/Together/server && cargo test 2>&1 | tail -30
```

Expected: all existing tests pass. There are no new backend tests needed — the `get_message` handler is a thin wrapper over the same DB query pattern used by `list_messages` and `create_message`.

- [ ] **Step 2: Run TypeScript type check on the full web client**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npx tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 3: Run the web client linter**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npm run lint 2>&1 | tail -20
```

Expected: no new lint errors. Fix any that appear.

- [ ] **Step 4: Verify the dev build runs cleanly**

```bash
cd /Volumes/Storage/GitHub/Together/clients/web && npm run build 2>&1 | tail -10
```

Expected: `✓ built in Xms` with no errors.

- [ ] **Step 5: Final commit and system event**

```bash
cd /Volumes/Storage/GitHub/Together && git add -u
git commit -m "feat(replies): complete message reply system with fetch, preview, and jump-to"
```

Then run:

```bash
openclaw system event --text "Done: Message replies complete - #T019" --mode now
```

---

## Manual testing checklist (if dev environment available)

- [ ] Reply to a message → reply bar shows above the reply message with author name and content snippet
- [ ] Reply to a message that has since been deleted → reply bar shows "(original message deleted)"
- [ ] Paginate backwards (load older messages) → reply targets for those older messages are automatically fetched
- [ ] Click a reply bar → smooth scroll to original message + 2-second highlight pulse
- [ ] Escape key in message input → clears the "Replying to" indicator in the input
- [ ] Reply bar on own messages (right-aligned bubble) → right-side border accent instead of left

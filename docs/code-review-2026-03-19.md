# Together Codebase Review — 2026-03-19

Comprehensive review across security, stability, test coverage, and code quality.
Target audience: self-hosted, 20-500 user gaming communities.

---

## Summary

| Domain | Health | Key Issue |
|--------|--------|-----------|
| Security | Fair | Webhook secrets plaintext in DB; header injection; no refresh token rotation |
| Backend Stability | Fair | No graceful shutdown; unbounded queues; missing DB indexes |
| Frontend Quality | Fair | No error boundary; no message virtualization; WebSocket reconnect fragile |
| Test Coverage | Poor (~40-45%) | 10 handlers untested; 85% of frontend components untested |

---

## CRITICAL (Fix before any production deployment)

### SEC-1: Webhook secrets stored plaintext in database
**Files:** `server/src/handlers/webhooks.rs:153`, `server/src/webhook_delivery.rs:202`
DB leak or SQL injection exposes all HMAC signing secrets. Encrypt at rest with AES-256-GCM using an app-level key from env vars.

### SEC-2: Content-Disposition header injection
**Files:** `server/src/handlers/attachments.rs:344`, `server/src/handlers/export.rs:304`
User-supplied filenames injected into headers without escaping `"`, `\r`, `\n`. Can enable response splitting/XSS. Sanitize or use RFC 5987 encoding.

### SEC-3: No refresh token rotation
**File:** `server/src/handlers/auth.rs:225-232`
Same refresh token reusable for 7 days. Stolen token = undetected access. Implement rotation: issue new refresh token on each use, invalidate the old one.

### SEC-4: No session limit per user
**File:** `server/src/handlers/auth.rs:151-169`
No cap on active sessions. Attacker can create thousands via repeated login, bloating the sessions table. Cap at ~10 per user.

### BE-1: No graceful shutdown
**File:** `server/src/main.rs:546-554`
No signal handler for SIGTERM/SIGINT. On deploy/restart: WebSocket connections severed without cleanup, in-flight webhook deliveries lost, voice states orphaned.

### BE-2: Unbounded webhook queue
**File:** `server/src/webhook_delivery.rs:72`
`mpsc::unbounded_channel()` with no backpressure. If webhook endpoints are slow, memory grows unbounded. Replace with bounded channel (~10k capacity).

### BE-3: No DB pool idle/lifetime timeouts
**File:** `server/src/db/mod.rs:10-14`
Pool has acquire_timeout but no idle_timeout or max_lifetime. Long-running or leaked connections can starve the pool under load. Add `idle_timeout(600s)`, `max_lifetime(1800s)`.

---

## HIGH (Fix before scaling beyond ~100 users)

### SEC-5: Email/is_admin exposed in UserDto to all users
**File:** `server/src/models/mod.rs:39-51`
Every authenticated user sees other users' email addresses and admin status. Only return email for `/users/@me`; omit `is_admin` from non-admin contexts.

### BE-4: Missing index on voice_states(user_id)
**File:** `server/migrations/20240216000005_voice.sql`
Cleanup and signal relay queries do `WHERE user_id = $1` — full table scan without index. Add `CREATE INDEX idx_voice_states_user ON voice_states(user_id)`.

### BE-5: No WebSocket idle timeout
**File:** `server/src/websocket/handler.rs:191-194`
Hung connections hold resources indefinitely. Slow-client attack vector. Add idle timeout (e.g., 5 minutes with no heartbeat = disconnect).

### BE-6: No WebSocket per-connection rate limit
**File:** `server/src/websocket/handler.rs:163-188`
A single connection can flood TYPING_START/PRESENCE_UPDATE. Add per-connection message rate limit (~10 msg/sec).

### BE-7: Silent error swallowing in webhook delivery
**File:** `server/src/webhook_delivery.rs:123-140`
`let _ = sqlx::query(...)` silently drops DB update failures. Webhook stats become inaccurate. Log errors explicitly.

### BE-8: Voice state race condition on rapid channel switch
**File:** `server/src/handlers/voice.rs`
Join channel A → immediately join channel B can race, causing ghost leave events. Wrap fetch+delete in a transaction.

### FE-1: No error boundary at app root
**File:** `clients/web/src/App.tsx`
Any unhandled component error = white screen crash. Add a React Error Boundary with recovery UI.

### FE-2: Duplicate ICE server caches
**Files:** `clients/web/src/hooks/useWebRTC.ts:28-59`, `clients/web/src/hooks/useGoLive.ts:68-93`
Two separate module-level ICE caches cause redundant API calls and can serve stale TURN credentials. Consolidate into shared utility.

### FE-3: WebSocket reconnect gives up after 5 attempts
**File:** `clients/web/src/api/websocket.ts:253-269`
After 5 failed reconnects (30s cap), it stops trying. Users must manually refresh. Continue retrying indefinitely with long backoff.

---

## MEDIUM (Address for production hardening)

### SEC-6: Link preview response not size-limited at transport
**File:** `server/src/handlers/link_preview.rs:217-231`
`response.bytes().await` downloads entire body into memory. Malicious URL could stream GB of data within timeout. Cap at 1MB during streaming.

### SEC-7: Custom emoji serving unauthenticated
**File:** `server/src/handlers/custom_emojis.rs:332-367`
`GET /emojis/:emoji_id` requires no auth. Private server emojis accessible if UUID is known. Accept as design decision or add auth check.

### SEC-8: Dev mode is the default
**File:** `server/src/main.rs:179-206`
`is_dev` defaults to `true` unless `APP_ENV=production`. Accidental production deploy has ~no rate limiting. Default to `false`.

### BE-9: Unbounded in-memory caches
**Files:** `server/src/state.rs:51` (link_preview_cache), `server/src/state.rs:68` (go_live_sessions)
No eviction policy. Both grow unbounded over time. Add LRU eviction or max-size checks.

### BE-10: N+1 query in polls fetch
**File:** `server/src/handlers/messages.rs:162-169`
Each poll on a message page triggers individual `fetch_poll_dto()`. Batch into single query.

### BE-11: No handler-level observability
Prometheus layer exists but no per-handler metrics (message latency, cache hit rates, connection counts). Operators are blind to degradation.

### FE-4: No message list virtualization
All messages rendered to DOM. With 1000+ messages, scrolling performance degrades. Use `react-window` or similar.

### FE-5: MessageItem not memoized
**File:** `clients/web/src/components/messages/MessageList.tsx`
No `React.memo()` on MessageItem. Every new message re-renders the entire list. Wrap with memo and compare by message ID.

### FE-6: API errors silently swallowed in stores
**Files:** `serverStore.ts:155`, `messageStore.ts:100-120`
Failed member/attachment fetches logged to console only. Users see stale data with no indication. Surface errors in toasts.

### FE-7: window.confirm() for destructive actions
**Files:** `BotManager.tsx:125`, `WebhookManager.tsx:133`
Not keyboard-accessible, not screen-reader friendly. Replace with custom confirmation modal.

### FE-8: DM channel list not re-sorted on new message
**File:** `clients/web/src/stores/dmStore.ts:118-136`
`last_message_at` updated but list not re-sorted. Most-recent conversations don't float to top.

### FE-9: No WebSocket event payload validation
**File:** `clients/web/src/api/websocket.ts:220-231`
Incoming events cast without runtime validation. Malformed server payload = runtime crash. Add schema validation (zod or manual).

---

## LOW (Nice-to-haves and defense-in-depth)

| ID | Finding | File |
|----|---------|------|
| SEC-9 | JWT algorithm not explicitly pinned to HS256 | `auth/mod.rs:99` |
| SEC-10 | Username logged on every login (credential enumeration aid) | `auth.rs:69,132` |
| SEC-11 | No WebSocket frame size limit | `handler.rs:169` |
| SEC-12 | Unbounded WebSocket connections per user | `handler.rs:151` |
| SEC-13 | Search highlights contain raw HTML `<mark>` tags | `search.rs:76` |
| BE-12 | Typing indicator shows "null is typing" on DB error | `handler.rs:867` |
| FE-10 | Modal doesn't set `inert` on background content | `Modal.tsx` |
| FE-11 | Spoiler toggle missing `aria-expanded` | `MessageItem.tsx:45` |
| FE-12 | Emoji upload has no client-side file size validation | `CustomEmojiManager.tsx` |
| FE-13 | BotManager/WebhookManager duplicate code patterns | `BotManager.tsx`, `WebhookManager.tsx` |

---

## Test Coverage Gap Analysis

**Current estimate: ~40-45% overall (target: 90%)**

### Backend: 10 handlers have NO tests
| Handler | LOC | Risk |
|---------|-----|------|
| `bots.rs` | 500 | Auth bypass, rate limit bypass |
| `webhooks.rs` | 406 | Permission bypass, secret leak |
| `webhook_delivery.rs` | 271 | HMAC forgery, retry DOS |
| `go_live.rs` | 189 | Multiple broadcasters, orphaned sessions |
| `pins.rs` | 186 | Permission bypass |
| `export.rs` | 322 | Data leak, permission bypass |
| `audit.rs` | 133 | Compliance gap |
| `ice.rs` | 37 | TURN credential issues |
| `giphy.rs` | — | Crash on API failure |
| `shared.rs` | 123 | Query helper bugs |

### Frontend: ~85% of components untested
- 7/49 components have tests (14%)
- 4/11 stores have tests (36%)
- 2/7 hooks have tests (29%)
- Zero accessibility tests
- Zero WebSocket event simulation tests

### Quick wins (highest ROI, lowest effort)
1. `bots_tests.rs` — 5 tests, 2-3 days, covers critical auth path
2. `pins_tests.rs` — 4 tests, 1-2 days, 100% handler coverage
3. `go_live_tests.rs` — 6 tests, 2-3 days, covers session isolation
4. `webhooks_tests.rs` — 8 tests, 3-4 days, covers HMAC + permissions
5. Error boundary test — 1 test, 1 day, prevents white-screen crashes

---

## Recommended Priority Actions

### Immediate (before any users)
1. Encrypt webhook secrets at rest
2. Sanitize Content-Disposition headers
3. Add graceful shutdown handler
4. Bound the webhook delivery queue
5. Add DB pool timeouts

### Short-term (before 100 users)
1. Implement refresh token rotation
2. Cap sessions per user
3. Strip email/is_admin from other users' profiles
4. Add voice_states(user_id) index
5. Add WebSocket idle timeout + rate limiting
6. Add React Error Boundary
7. Write tests for bots, webhooks, pins, go_live handlers

### Medium-term (before 500 users)
1. Message list virtualization
2. Consolidate ICE caches
3. WebSocket reconnect infinite retry
4. Link preview response size cap
5. Handler-level Prometheus metrics
6. Achieve 70%+ backend test coverage
7. Achieve 50%+ frontend test coverage

### Ongoing
1. Run `cargo audit` and `npm audit` in CI
2. Add coverage gates to PRs (80% minimum)
3. Accessibility audit (WCAG 2.1 AA)

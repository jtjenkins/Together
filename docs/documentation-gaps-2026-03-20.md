# Documentation Gap Analysis — 2026-03-20

## Summary

80+ API endpoints implemented across 25 handler modules. Only 18 (22%) are in `openapi.yaml`.
Feature-specific markdown docs cover most major features, but several handlers have no documentation at all.

## Handlers with NO documentation

| Handler | Endpoints | What it does |
|---------|-----------|-------------|
| reactions.rs | 3 | List/add/remove emoji reactions |
| dm.rs | 5 | Create DM channels, send/list DMs |
| polls.rs | 3 | Create polls, get results, vote |
| events.rs | 2 | Create/list server events |
| webhooks.rs | 6 | CRUD + test webhooks |
| export.rs | 1 | Export server data as ZIP |
| read_states.rs | 2 | Acknowledge channels/DMs (read receipts) |
| link_preview.rs | 1 | Generate link previews |
| giphy.rs | 1 | Search Giphy API |

## Handlers with partial documentation

| Handler | Gap |
|---------|-----|
| auth.rs | Missing: forgot-password, reset-password, refresh token |
| custom_emojis.rs | Only brief mention in other docs, no dedicated doc |
| go_live.rs | Now covered in screen-sharing.md after today's fixes |

## openapi.yaml is severely outdated

62 of 80+ endpoints are missing from the OpenAPI spec. Major missing categories:
- All bot endpoints (8)
- All webhook endpoints (6)
- All DM endpoints (5)
- All custom emoji endpoints (4)
- All reaction endpoints (3)
- All pin endpoints (3)
- All poll endpoints (3)
- All Go Live endpoints (3)
- Auth refresh/reset flows (3)
- Search, export, audit logs, automod, events, giphy, link-preview, ICE servers, read states

## Undocumented client features

Hooks with no documentation:
- useGoLive.ts, useWebRTC.ts, usePushToTalk.ts, useTypingIndicator.ts, useMobileLayout.ts, useFocusTrap.ts

Stores with minimal/no docs:
- customEmojiStore, dmStore, autoModStore, voiceStore, readStateStore, typingStore, voiceSettingsStore

## Recommended new docs to create

1. **docs/reactions.md** — Reaction endpoints, emoji format, limits
2. **docs/direct-messages.md** — DM channels, sending, listing, read receipts
3. **docs/polls-and-events.md** — Polls (create, vote, results) and server events
4. **docs/webhooks.md** — Webhook CRUD, HMAC-SHA256 verification, test endpoint
5. **docs/custom-emojis.md** — Upload, list, delete, rendering
6. **docs/export.md** — Server data export format and contents
7. **docs/authentication.md** — Full auth flow including refresh, forgot/reset password
8. **docs/link-previews-and-giphy.md** — Link preview generation, Giphy integration
9. **Update openapi.yaml** — Add all 62 missing endpoints

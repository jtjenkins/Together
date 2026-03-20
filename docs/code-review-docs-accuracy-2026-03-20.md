# Documentation Accuracy Audit — 2026-03-20

Every docs/ file was verified against the actual codebase by specialized review agents.
Findings are organized by severity, then by file.

---

## Critical Issues (must fix)

### Cross-cutting: TURN environment variables are wrong
**Files**: `.env.example`, `docs/self-hosting.md`, `docker-compose.dev.yml`
The docs instruct users to set `TURN_HOST`, `TURN_PORT`, `TURN_TLS_PORT`, `TURN_REALM`.
The server (`config/mod.rs:83`) reads **`TURN_URL`** and **`TURN_SECRET`** only.
Users following the docs get silently broken TURN.

### architecture.md — Fabricated SFU/Pion voice architecture
Lines 364-431 describe a "WebRTC SFU" using Pion with a detailed SFU diagram.
The system is actually **P2P mesh** — the server only relays signaling.
No Pion dependency exists. The VoiceConfig struct (Opus codec settings) is fabricated.
Line 584 claims "No P2P: All traffic through server (hide user IPs)" — the exact opposite is true.

### architecture.md — Non-existent IDENTIFY opcode and wrong WebSocket path
- Docs show `/gateway` — actual path is `/ws`
- Docs show client sends `IDENTIFY` after upgrade — no such opcode exists; READY is sent automatically
- GatewayMessage shows `s: Option<u64>` sequence field — doesn't exist in the code

### architecture.md — Wrong rate limiting values
- Doc: 100 req/min per user, 10 WS connections/IP, 60s heartbeat timeout
- Code: 10 req/s per IP (burst 20), no WS connection limit, 300s idle timeout

### project-structure.md — Entirely fabricated directory layout
Describes `src/chat/`, `src/users/`, `src/voice/sfu.rs`, `clients/mobile/` (React Native), `tools/cli/` — none exist.
Actual layout is flat `handlers/` module. Mobile is Tauri v2 in `clients/desktop/`.
Migration naming, workflow names, LOC estimates, and dependencies are all wrong.

### auto-moderation.md — Wrong permission model
All 6 references say `MANAGE_SERVER` permission required.
Code enforces **owner-only** on every endpoint (`auth.user_id() != server.owner_id`).

### auto-moderation.md — Multiple behavioral inaccuracies
- Rule evaluation order wrong (doc: spam→duplicate→word; code: word→duplicate→spam)
- GET config returns 404 when no config exists, not defaults
- DELETE word filter uses word text not UUID, silently succeeds (no 404)
- Duplicate detection always uses "delete", not configurable `spam_action`
- Timeout "extend to whichever is later" logic doesn't exist (unconditionally overwrites)
- `AUTOMOD_ACTION` WebSocket event does not exist
- Spam detection uses DB queries, not "in-memory sliding window"
- Timeouts NOT enforced when automod disabled (contrary to doc claim)

### audit-logging.md — `log_action()` is never called
The function exists but no handler calls it. Zero audit events are recorded.
The docs present it as an operational feature.

### bot-api.md — 3 missing endpoints
- `PATCH /bots/:id` (update bot name/description)
- `GET /bots/:id/logs` (activity logs)
- `POST /bots/connect` (token exchange for secure WebSocket JWT)

### bot-api.md — False claim about Retry-After header
Doc says "Retry-After header indicates when quota resets." No such header exists in the code.

### websocket-protocol.md — 13 undocumented event types
Only 6 of 19 dispatch events are documented. Missing: DM_CHANNEL_CREATE, DM_MESSAGE_CREATE,
REACTION_ADD/REMOVE, THREAD_MESSAGE_CREATE, POLL_VOTE, TYPING_START/STOP, MESSAGE_PIN/UNPIN,
CUSTOM_EMOJI_CREATE/DELETE, GO_LIVE_START/STOP.

### websocket-protocol.md — READY payload missing 3 fields
Doc shows `user` and `servers`. Actual READY includes `dm_channels`, `unread_counts`, `mention_counts`.
UserDto missing `bio`, `pronouns`, `activity`, `is_admin` fields.

### self-hosting.md & README.md — Health endpoint response format wrong
Doc shows `"database": "ok"` (flat string). Actual response has nested objects:
`"database": {"status":"ok","latency_ms":2}`, plus `uptime_secs` and `connections`.

### README.md — Cargo.toml license mismatch
Cargo.toml says `AGPL-3.0`. Actual license is **PolyForm Noncommercial 1.0.0** per LICENSE file.

### release-roadmap.md — Lists implemented features as pending
Health checks, audit logging, search, pinning, typing indicators, presence, custom emoji,
bot API, webhooks, server discovery — all implemented but listed as pending/post-1.0.

### presence-status.md — Claims "no REST endpoint for status"
False — `PATCH /users/me` accepts `status` and `custom_status`. Missing `activity` field throughout.

---

## Important Issues (should fix)

### .env.example — BIND_PORT comment and default wrong
Says "Together server port 8080" but controls Nginx web port (default 80).

### .env.example — ALLOWED_ORIGINS comment wrong
Says "leave empty to allow all". Code treats empty as "block all cross-origin requests".

### docker-compose.yml — APP_ENV hardcoded, .env value ignored
Compose hardcodes `APP_ENV: production`. The `.env.example` entry is dead config.

### docker-compose.dev.yml — Deprecated Giphy API key
Default `dc6zaTOxFJmzC` is the old public beta key, no longer functional.

### self-hosting.md — Missing env vars in reference table
`TURN_URL`, `TURN_SECRET`, `TOGETHER_VERSION`, `UPLOAD_DIR`, `SERVER_HOST`, `SERVER_PORT` all missing.

### architecture.md — voice_states PK is user_id only, not (user_id, channel_id)
Doc implies users can be in multiple channels. One-channel-at-a-time is enforced by PK.

### architecture.md — messages.author_id is nullable (ON DELETE SET NULL), doc says NOT NULL

### architecture.md — Incomplete database table listing
Lists 7 tables. Actual schema has 25+ tables.

### websocket-protocol.md — Missing VOICE_SIGNAL stream_type field
Relay payload includes `stream_type` for screen-share discrimination. Undocumented.

### websocket-protocol.md — Bot WebSocket auth undocumented
`?bot_token=` query parameter and `POST /bots/connect` JWT exchange both missing.

### screen-sharing.md — Missing Go Live system
Doesn't mention `go_live.rs` with server-side sessions, quality tiers, one-broadcaster enforcement.

### server-discovery.md — Wrong HTTP status for join (200 vs 201)

### backup-restore.md — Restore procedure has logic error
Step 1 says `docker compose down` but step 2 uses `docker compose exec` which needs running containers.

### backup-restore.md — Doesn't mention `backup-full.sh`

### ios-voice.md — Missing ICE server endpoint details
Doesn't mention `GET /ice-servers`, HMAC-SHA1 credentials, 24h TTL, or per-user generation.

### turn.conf.example — Contradictory logging config
`log-file=stdout` followed by `no-stdout-log` suppresses all logging.

---

## Minor Issues (nice to have)

- README: `npm test` described as "interactive" but `vitest run` is single-pass
- README: `npm run tauri android dev` scripts not defined in package.json
- README: Vite proxy strips `/api` prefix — not mentioned
- self-hosting.md: APP_ENV "default: development" is misleading
- message-search.md: `author_username` can be null (deleted user)
- message-editing-deletion.md: MANAGE_MESSAGES grants pin but not delete — asymmetry undocumented
- channel-categories.md: Empty string category clearing relies on COALESCE — worth documenting
- auto-moderation.md: No server-side validation of numeric field ranges
- auto-moderation.md: Logs endpoint has no `limit` parameter (always returns 100)
- docker-compose.yml: coturn volumes need "create turn.conf first" comment

---

## Files with no significant issues

- **message-pinning.md** — Accurate (permissions, idempotent behavior, events all verified)
- **message-editing-deletion.md** — Core behavior accurate (edit/delete, soft-delete, events)
- **message-search.md** — Search mechanics accurate (validation, ranking, highlighting)
- **backup-restore.md** — backup.sh behavior accurate (minor restore procedure issue)
- **server-discovery.md** — Browse endpoint accurate (minor status code issue)

---

## Summary by file

| File | Critical | Important | Minor |
|------|----------|-----------|-------|
| architecture.md | 10 | 4 | 0 |
| project-structure.md | 5 | 0 | 0 |
| auto-moderation.md | 8 | 0 | 2 |
| websocket-protocol.md | 3 | 3 | 0 |
| audit-logging.md | 2 | 0 | 0 |
| bot-api.md | 2 | 0 | 0 |
| self-hosting.md | 1 | 2 | 1 |
| release-roadmap.md | 2 | 0 | 0 |
| presence-status.md | 2 | 0 | 0 |
| README.md | 2 | 0 | 3 |
| .env.example | 1 | 2 | 0 |
| docker-compose files | 1 | 2 | 1 |
| screen-sharing.md | 0 | 1 | 0 |
| ios-voice.md | 0 | 1 | 0 |
| server-discovery.md | 0 | 1 | 0 |
| backup-restore.md | 0 | 2 | 0 |
| message-pinning.md | 0 | 0 | 0 |
| message-editing-deletion.md | 0 | 0 | 1 |
| message-search.md | 0 | 0 | 1 |
| channel-categories.md | 0 | 0 | 1 |

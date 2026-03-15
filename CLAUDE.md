# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Together is a **private, non-federated Discord alternative** designed for small gaming communities (20-500 users) who want ownership of their communication platform.

### Key Principle

**Start simple, scale when needed.** The architecture is intentionally optimized for small communities with a clear migration path if scaling becomes necessary.

## Architecture Philosophy

### Monolithic Design

- **Single Rust binary** for the backend (not microservices)
- **PostgreSQL only** (no ScyllaDB, Redis, or distributed databases initially)
- **Docker Compose deployment** (not Kubernetes)
- **~10k lines of Rust** server code currently

**Why monolithic**: Faster development, simpler operations, lower costs ($10-40/month vs $400+/month), easier maintenance for small teams.

### Technology Stack

- **Backend**: Rust + Axum web framework + Tokio async runtime
- **Database**: PostgreSQL 16 (handles users, messages, channels, sessions, voice state)
- **WebRTC**: P2P mesh via browser WebRTC APIs; server relays SDP/ICE signaling over WebSocket only — no server-side media forwarding
- **ICE**: STUN (public Google servers) + optional TURN (coturn, HMAC-SHA1 credentials)
- **Desktop**: Tauri + React (shares web client source)
- **Web**: React + Vite
- **Mobile**: Tauri v2 (Android + iOS targets in `clients/desktop/`, same WebView as desktop)

## System Architecture

The backend is a **single Rust binary** with modular organization:

```
Together Server (Rust/Axum)
├── HTTP/WebSocket Handler (entry point)
├── handlers/          — all REST + WebSocket handlers
├── models/            — database models (sqlx::FromRow) and DTOs
├── auth/              — JWT, bcrypt, auth middleware
├── bot_auth.rs        — bot token authentication
├── config/            — app config (env vars, TURN settings)
├── error.rs           — AppError → HTTP status mapping
├── state.rs           — AppState (pool, config, connections, rate limiters)
└── websocket/         — connection manager, event router, gateway protocol
     ↓
PostgreSQL 16 (all data)
```

### Database Schema

- **users**: Authentication, profiles, status
- **servers**: Discord-like "guilds"
- **channels**: Text and voice channels (`type IN ('text', 'voice')`)
- **messages**: Chat messages with full-text search (GIN index, `WHERE deleted = FALSE`)
- **roles**: Permission system (bitflags)
- **sessions**: JWT refresh tokens (stored hashed)
- **voice_states**: Who's in which voice channel (one row per user max)
- **direct_message_channels / direct_messages**: DM system
- **reactions, polls, server_events, pinned_messages**: Feature tables
- **bots**: Bot accounts with API tokens
- **audit_logs**: Server audit trail
- **automod**: Auto-moderation rules

### Real-Time Communication

- **WebSocket gateway** for bidirectional messaging
- **GatewayOp opcodes**: `DISPATCH`, `HEARTBEAT`, `HEARTBEAT_ACK`, `PRESENCE_UPDATE`, `TYPING_START`, `VOICE_SIGNAL`
- **Event types (server → client)**: `READY`, `MESSAGE_CREATE`, `MESSAGE_UPDATE`, `MESSAGE_DELETE`, `PRESENCE_UPDATE`, `VOICE_STATE_UPDATE`, `VOICE_SIGNAL`, `DM_CHANNEL_CREATE`, `DM_MESSAGE_CREATE`, `REACTION_ADD`, `REACTION_REMOVE`, `THREAD_MESSAGE_CREATE`, `POLL_VOTE`, `TYPING_START`, `TYPING_STOP`, `MESSAGE_PIN`, `MESSAGE_UNPIN`
- **Connection management**: In-memory `DashMap` of active WebSocket connections

### Voice Architecture

Voice uses **P2P WebRTC mesh** — the server is purely a signaling relay:

- **Signaling**: `VOICE_SIGNAL` WebSocket op relays SDP offer/answer/ICE candidates between peers
- **Co-membership check**: Server verifies both users are in the same voice channel before forwarding any signal — prevents cross-channel signal leakage
- **Media**: Flows directly browser-to-browser via SRTP/UDP (server never touches audio/video packets)
- **NAT traversal**: STUN (public Google) + optional TURN (coturn) via `GET /ice-servers` endpoint with time-limited HMAC-SHA1 credentials
- **Speaking detection**: Web Audio API on the client, sampling RMS every 100ms

### Permission System

Uses **Discord-compatible bitflags** (u64):

- `VIEW_CHANNEL`, `SEND_MESSAGES`, `MANAGE_MESSAGES`, etc.
- Role-based with channel-level overrides
- Owner always has `ADMINISTRATOR` permission

## Actual Directory Structure

```
Together/
├── server/                      # Rust backend (single binary)
│   ├── Cargo.toml
│   ├── migrations/              # SQL migration files (sqlx-cli), named YYYYMMDDNNNNNN_<name>.sql
│   └── src/
│       ├── main.rs              # Server setup, route configuration
│       ├── lib.rs               # Crate root, module declarations
│       ├── state.rs             # AppState struct
│       ├── bot_auth.rs          # Bot token auth extractor
│       ├── auth/                # JWT, bcrypt, AuthUser extractor
│       ├── config/              # AppConfig from env
│       ├── db/                  # DB pool initialization
│       ├── error/               # AppError, AppResult
│       ├── models/              # All database models and DTOs
│       ├── handlers/            # All HTTP handlers (one file per domain)
│       │   ├── auth.rs, users.rs, servers.rs, channels.rs
│       │   ├── messages.rs, dm.rs, search.rs, voice.rs
│       │   ├── attachments.rs, reactions.rs, pins.rs, polls.rs
│       │   ├── bots.rs, audit.rs, automod.rs, events.rs
│       │   ├── ice.rs, giphy.rs, link_preview.rs, read_states.rs
│       │   ├── health.rs, shared.rs (common query helpers)
│       └── websocket/
│           ├── handler.rs       # WebSocket upgrade, message loop
│           ├── events.rs        # GatewayOp enum, event name constants
│           ├── connection_manager.rs
│           └── mod.rs
│
├── clients/
│   ├── web/                     # React + Vite (browser)
│   │   └── src/
│   │       ├── api/             # ApiClient, WebSocket gateway
│   │       ├── components/      # React components
│   │       ├── hooks/           # useWebRTC, useWebSocket, etc.
│   │       ├── stores/          # Zustand stores
│   │       ├── types/           # TypeScript types (index.ts)
│   │       └── utils/
│   └── desktop/                 # Tauri + React (serves clients/web/src)
│
├── docker-compose.yml           # Production
├── docker-compose.dev.yml       # Dev (PostgreSQL only)
├── Dockerfile / Dockerfile.web
├── nginx.conf
├── load-tests/                  # k6 load test scripts
├── security-scan/               # Security tooling
├── scripts/                     # Utility scripts
└── docs/                        # Architecture docs, design specs
    └── superpowers/specs/       # Feature design specs
```

## Development Commands

### Database Operations

```bash
cd server
sqlx database create
sqlx migrate run                  # Run all pending migrations
sqlx migrate revert               # Rollback one migration
```

### Server Development

```bash
cd server
cargo run                         # Dev server
cargo test                        # Unit + integration tests (requires TEST_DATABASE_URL)
cargo clippy -- -D warnings       # Lint (CI enforces -D warnings)
cargo fmt                         # Format (CI enforces)
cargo build --release             # Production build
```

### Client Development

```bash
# Web client:
cd clients/web
npm run dev                       # Vite dev server
npm run lint                      # ESLint
npm run typecheck                 # tsc --noEmit
npm test                          # Vitest

# Desktop app:
cd clients/desktop
npm run tauri dev

# Mobile (same desktop project, different targets):
npm run tauri android dev
npm run tauri ios dev
```

### Docker Deployment

```bash
docker-compose -f docker-compose.dev.yml up   # Dev (PostgreSQL)
docker-compose up -d                          # Production
```

## Key Implementation Details

### Authentication Flow

1. User registers: password → bcrypt hash (12 rounds)
2. Login returns: JWT access token (15 min) + refresh token (7 days)
3. Access token in `Authorization: Bearer <token>` header
4. Refresh token stored hashed in `sessions` table
5. `AuthUser` extractor validates JWT on protected routes; also supports bot tokens via `bot_auth`

### Message Pagination

- Cursor-based with `before` parameter (message ID)
- Indexed on `(channel_id, created_at DESC)` for fast queries
- Soft deletes: `deleted = true` column (content hidden, row kept)
- Default limit: 50 messages per request

### Message Search

- PostgreSQL full-text search with GIN partial index (`WHERE deleted = FALSE`)
- Queries must include `deleted = FALSE` condition to use the index
- `AppError::Validation` maps to HTTP 400 (not 422)

### WebSocket Gateway Protocol

```rust
GatewayMessage {
    op: GatewayOp,          // DISPATCH | HEARTBEAT | HEARTBEAT_ACK | PRESENCE_UPDATE | TYPING_START | VOICE_SIGNAL
    t: Option<String>,      // Event type for DISPATCH (e.g. "MESSAGE_CREATE")
    d: Option<Value>,       // Event payload
}
```

### Bot System

Bots authenticate via `Authorization: Bot <token>` header. Bot tokens are stored hashed. Per-bot rate limiting uses the `governor` crate (`bot_rate_limiter: Arc<DefaultKeyedRateLimiter<Uuid>>` on `AppState`).

## Important Constraints

### Target Scale

- **20-500 users**: Primary design target
- **<50ms**: Message delivery latency
- **<150ms**: Voice latency end-to-end
- **<200MB**: Server memory usage at target scale

### Scaling Thresholds

- **500+ users**: Consider adding Redis for sessions/presence
- **2000+ users**: Consider horizontal scaling (multiple instances)
- **5000+ users**: Consider migrating to microservices + ScyllaDB

## Design Decisions

### Why PostgreSQL Only?

- Handles 10k writes/sec (100x more than needed)
- Full-text search built-in (no Elasticsearch needed)
- ACID transactions, easy to backup

### Why Monolith?

- Single deployment, no service coordination
- One codebase, one language, easier debugging
- $20/month VPS vs $400+/month infrastructure

### Why Not Redis Initially?

- PostgreSQL connection pooling is fast enough (<5ms queries)
- In-memory DashMap for WebSocket connections is sufficient

### Voice: Why P2P mesh instead of SFU?

- For gaming communities with 3–8 people in a voice channel, P2P mesh is sufficient
- No server-side media infrastructure to maintain
- Server acts purely as a signaling relay — zero media processing cost
- Migration path: if voice channels grow beyond ~10 simultaneous video participants, introduce Livekit or Pion SFU; the signaling relay is already in place

## Testing Strategy

### Backend Integration Tests

Tests in `server/tests/` use real PostgreSQL via `sqlx::test`. The `tests/common/mod.rs` module provides helpers: `register_and_get_token`, `create_server`, `create_channel`, `create_message`, `unique_username`, etc.

Key patterns:

- `assert_eq!(status, StatusCode::BAD_REQUEST)` — not `UNPROCESSABLE_ENTITY` (AppError::Validation → 400)
- `assert!(x)` / `assert!(!x)` — not `assert_eq!(x, true/false)` (Clippy `bool_assert_comparison`)
- All imports must pass `cargo fmt` alignment rules

### Frontend Tests

Vitest in `clients/web/src/__tests__/`. Mock `api` client and WebSocket gateway for store tests.

### Load Testing

k6 scripts in `load-tests/` for message throughput and search at scale (1M messages tested).

## Common Pitfalls

### Rust / Backend

- **`cargo fmt` and `cargo clippy -D warnings`** are enforced in CI — run both before pushing
- **`deny_unknown_fields`** on request structs: adding new fields to the DB/handler without adding them to the struct causes silent deserialization failures
- **Explicit RETURNING clauses**: `sqlx` queries use explicit column lists — adding columns to a model requires updating all `RETURNING` clauses that feed into it
- **Named struct construction**: `VoiceStateDto { field: row.field, ... }` — adding fields to the DTO is a compile error unless all construction sites are updated

### Frontend / TypeScript

- **ESLint `argsIgnorePattern: "^_"`** only applies to function arguments, not destructured variables — use spread+delete instead of destructuring with `_` prefix for unused keys
- **`UpdateVoiceStateRequest satisfies`** pattern in voiceStore — all fields used in toggle actions must be present in the TypeScript interface

### Do Not Prematurely Optimize

- Don't add Redis, ScyllaDB, or microservices until proven necessary
- Don't implement features beyond what's been designed

## Future Scaling Considerations

If growth exceeds 500 users, consider:

1. **Add Redis**: For session storage and presence
2. **PostgreSQL read replicas**: For message history queries
3. **SFU for video**: Livekit or Pion if P2P video becomes a bottleneck
4. **Horizontal scaling**: Multiple backend instances behind load balancer

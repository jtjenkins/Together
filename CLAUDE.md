# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Together is a **private, non-federated Discord alternative** designed for small gaming communities (20-500 users) who want ownership of their communication platform. The project is currently in the **planning phase** with detailed documentation but no code implementation yet.

### Key Principle

**Start simple, scale when needed.** The architecture is intentionally optimized for small communities with a clear migration path if scaling becomes necessary.

## Architecture Philosophy

### Monolithic Design

- **Single Rust binary** for the backend (not microservices)
- **PostgreSQL only** (no ScyllaDB, Redis, or distributed databases initially)
- **Docker Compose deployment** (not Kubernetes)
- **~15k lines of code** target (vs 35k+ for microservices approach)

**Why monolithic**: Faster development (6-8 weeks vs 14+ weeks), simpler operations, lower costs ($10-40/month vs $400+/month), easier maintenance for small teams.

### Technology Stack

- **Backend**: Rust + Axum web framework + Tokio async runtime
- **Database**: PostgreSQL 16 (handles users, messages, channels, sessions, voice state)
- **WebRTC**: Pion library for voice (SFU architecture, not mesh or MCU)
- **Desktop**: Tauri + React
- **Web**: React + Vite
- **Mobile**: Tauri v2 (Android + iOS targets in `clients/desktop/`, same WebView as desktop)

## System Architecture

The backend is a **single Rust binary** with modular organization:

```
Together Server (Rust/Axum)
├── HTTP/WebSocket Handler (entry point)
├── Chat Module (messages, channels, search)
├── Users Module (auth, profiles, friendships)
├── Servers Module (guilds, roles, permissions)
├── Voice Module (WebRTC SFU, signaling)
└── WebSocket Connection Manager (real-time events)
     ↓
PostgreSQL 16 (all data)
```

### Database Schema Organization

- **users**: Authentication, profiles, status
- **servers**: Discord-like "guilds"
- **channels**: Text and voice channels
- **messages**: Chat messages with full-text search indexes
- **roles**: Permission system (bitflags)
- **sessions**: JWT refresh tokens
- **voice_states**: Who's in which voice channel

### Real-Time Communication

- **WebSocket gateway** for bidirectional messaging
- **Event types**: MESSAGE_CREATE, PRESENCE_UPDATE, VOICE_STATE_UPDATE, etc.
- **Connection management**: In-memory HashMap of active connections
- **Broadcasting**: Route messages to users subscribed to channels

### Permission System

Uses **Discord-compatible bitflags** (u64):

- `VIEW_CHANNEL`, `SEND_MESSAGES`, `MANAGE_MESSAGES`, etc.
- Role-based with channel-level overrides
- Owner always has `ADMINISTRATOR` permission

## Development Approach

### Build Order: Back to Front

1. **Database** (Week 1): Schema, migrations, seed data
2. **Backend Core** (Week 2-3): REST API, auth, CRUD operations
3. **Real-Time Backend** (Week 4-5): WebSocket, chat, file uploads
4. **Voice Backend** (Week 6-7): WebRTC SFU implementation
5. **Desktop UI** (Week 8-10): Tauri app
6. **Web UI** (Week 11-12): React web client
7. **Mobile UI** (Week 13-14): Tauri v2 Android + iOS (serve `clients/web/` dist)

**Rationale**: Solid foundation prevents refactoring, complete API enables parallel UI development, each layer independently testable.

## Planned Directory Structure

```
Together/
├── server/                  # Rust backend (single binary)
│   ├── Cargo.toml          # Dependencies: axum, sqlx, tokio, jsonwebtoken, bcrypt, webrtc
│   ├── migrations/          # SQL migration files (sqlx-cli)
│   └── src/
│       ├── main.rs         # Server setup, route configuration
│       ├── auth/           # JWT, bcrypt, auth middleware
│       ├── chat/           # Message handlers, channels, search
│       ├── users/          # User CRUD, login, profiles
│       ├── servers/        # Server management, roles, permissions
│       ├── voice/          # WebRTC SFU, signaling, state tracking
│       ├── websocket/      # Connection manager, event router
│       ├── models/         # Database models (sqlx::FromRow)
│       ├── db/             # Query functions, connection pool
│       └── utils/          # Rate limiting, validation
│
├── clients/
│   ├── shared/             # TypeScript types, API client (shared across UIs)
│   ├── desktop/            # Tauri + React (native desktop)
│   ├── web/                # React + Vite (browser)
│   └── desktop/            # Tauri (macOS/Windows/Linux + Android/iOS mobile targets)
│
└── tools/
    └── discord-bridge/     # Optional: sync messages from Discord
```

## Development Commands (Future)

### Database Operations

```bash
# When migrations are created:
sqlx database create                          # Create database
sqlx migrate run                              # Run all migrations
sqlx migrate revert                           # Rollback one migration
```

### Server Development

```bash
# When server code exists:
cd server
cargo run                                     # Dev server (hot reload via cargo-watch)
cargo test                                    # Unit + integration tests
cargo build --release                         # Production build
```

### Client Development

```bash
# Desktop app:
cd clients/desktop
npm install
npm run tauri dev                             # Dev with hot reload

# Web client:
cd clients/web
npm run dev                                   # Vite dev server

# Mobile (Android + iOS via Tauri v2 — same desktop project, different targets):
cd clients/desktop
npm run tauri android dev                     # Android emulator (requires Android SDK)
npm run tauri ios dev                         # iOS simulator (requires Xcode)
```

### Docker Deployment

```bash
docker-compose -f docker-compose.dev.yml up   # Dev environment (PostgreSQL)
docker-compose up -d                          # Production deployment
```

## Key Implementation Details

### Authentication Flow

1. User registers: password → bcrypt hash (12 rounds)
2. Login returns: JWT access token (15 min) + refresh token (7 days)
3. Access token in `Authorization: Bearer <token>` header
4. Refresh token stored hashed in `sessions` table
5. Auth middleware validates JWT on protected routes

### Message Pagination

- Cursor-based with `before` parameter (timestamp or message ID)
- Indexed on `(channel_id, created_at DESC)` for fast queries
- Soft deletes: `deleted = true` column (keeps message history)
- Default limit: 50 messages per request

### WebSocket Events

```rust
GatewayMessage {
    op: String,        // "DISPATCH", "HEARTBEAT", "IDENTIFY"
    t: Option<String>, // Event type: "MESSAGE_CREATE", etc.
    d: Option<Value>,  // Event data
}
```

### Voice Architecture

- **SFU (Selective Forwarding Unit)**: Server forwards audio packets without mixing
- **Opus codec**: 64kbps, 48kHz sample rate
- **Signaling**: WebSocket for SDP offer/answer exchange
- **Media**: UDP for audio packets (SRTP encrypted)
- **NAT traversal**: STUN/TURN server (coturn) for firewall bypass

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

**For 20 users**: Current architecture is overkill but provides room to grow.

## Documentation References

When implementing features, reference these docs:

- `docs/architecture.md`: Detailed component design, database schema, security model
- `docs/project-plan.md`: Step-by-step implementation guide with code examples
- `docs/project-structure.md`: Module organization and file layout
- `docs/roadmap.md`: Development phases and timeline
- `docs/discord-analysis.md`: Feature priorities (P0/P1/P2)

## Design Decisions

### Why PostgreSQL Only?

- Handles 10k writes/sec (100x more than 20 users need)
- Full-text search built-in (no Elasticsearch needed)
- ACID transactions (no distributed consistency issues)
- Well-understood, easy to backup

### Why Monolith?

- **Faster**: 6-8 weeks to MVP vs 14+ weeks for microservices
- **Simpler**: Single deployment, no service coordination
- **Cheaper**: $20/month VPS vs $400+/month infrastructure
- **Maintainable**: One codebase, one language, easier debugging

### Why Not Redis Initially?

- PostgreSQL connection pooling is fast enough (<5ms queries)
- In-memory HashMap for WebSocket connections is sufficient
- Can add Redis later if sessions become a bottleneck

### Voice: Why SFU not MCU?

- **MCU**: Server mixes audio (expensive CPU, adds latency)
- **SFU**: Server just forwards packets (low CPU, low latency)
- **Mesh**: Each client connects to every other (doesn't scale)

## Testing Strategy

### Database Tests

- Constraint validation (unique usernames, foreign keys)
- Cascading deletes (server deletion removes channels and messages)
- Index performance (EXPLAIN ANALYZE for pagination queries)

### Backend Tests

- Unit tests for auth (JWT validation, bcrypt hashing)
- Integration tests for API endpoints (register, login, send message)
- Permission system tests (role hierarchy, channel overrides)
- WebSocket connection lifecycle tests

### Load Testing

- 100 concurrent users sending messages
- 1M messages in database (pagination performance)
- Voice channel with 10 participants (audio quality)

## Common Pitfalls to Avoid

### Do Not Prematurely Optimize

- Don't add Redis, ScyllaDB, or microservices until proven necessary
- Don't implement features beyond P0/P1 priorities
- Don't over-engineer permission system beyond Discord model

### Build Incrementally

- Phase 1: Get database working before any Rust code
- Phase 2: Get REST API working before WebSocket
- Phase 3: Get chat working before voice
- UI clients last (they depend on stable API)

### Follow Discord's UX

- Server/channel sidebar layout (users know this pattern)
- Permission model (role-based with overrides)
- WebSocket events (MESSAGE_CREATE, etc.)
- Don't reinvent patterns Discord users expect

## Future Scaling Considerations

If growth exceeds 500 users, consider:

1. **Add Redis**: For session storage and presence (reduces DB load)
2. **PostgreSQL read replicas**: For message history queries
3. **Separate voice server**: Dedicated instance per region
4. **Horizontal scaling**: Multiple backend instances behind load balancer

**Migration path is documented** in `docs/architecture-20-users.md`.

---

## Current Status: Planning Phase

**No code has been written yet.** This repository contains:

- Comprehensive architecture documentation
- Detailed implementation plan (Phase 1-7)
- Database schema specifications
- API endpoint specifications
- Development timeline (14 weeks to v1.0)

**Next steps**: Begin Phase 1 (Database Foundation) by creating:

1. `docker-compose.dev.yml` for PostgreSQL
2. `server/Cargo.toml` with dependencies
3. `server/migrations/001_users_and_auth.sql`
4. Seed data script for development

When code implementation begins, update this file with actual commands, gotchas, and patterns discovered during development.

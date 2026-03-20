# Architecture & Technical Design

## Design Philosophy

Together is built with the principle: **Start simple, scale when needed.**

The architecture is optimized for small to medium communities (20-500 users) with a clear path to scale if needed. We prioritize:

- **Simplicity** over premature optimization
- **Maintainability** over theoretical performance
- **Single binary deployment** over distributed complexity
- **PostgreSQL** for everything until proven insufficient

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐         │
│  │   Desktop   │  │    Web      │  │   Mobile        │         │
│  │  (Tauri)    │  │  (React)    │  │  (Tauri)        │         │
│  │  Rust Core  │  │  Browser    │  │  iOS/Android    │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────────┘         │
│         │                │                │                    │
│         └────────────────┴────────────────┘                    │
│                          │                                     │
│                   WebSocket / HTTPS                            │
└──────────────────────────┼─────────────────────────────────────┘
                           │
┌──────────────────────────┼─────────────────────────────────────┐
│                TOGETHER SERVER (Rust)                          │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Axum Web Framework                        │    │
│  │  • HTTP Routes (REST API)                              │    │
│  │  • WebSocket Upgrade Handler                           │    │
│  │  • JWT Authentication Middleware                       │    │
│  │  • Rate Limiting                                       │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                        │
│  ┌────────────────────┼───────────────────────────────────┐    │
│  │         WebSocket Connection Manager                   │    │
│  │  • Active connection registry                          │    │
│  │  • Message routing (user → channels)                   │    │
│  │  • Presence tracking                                   │    │
│  │  • Event broadcasting                                  │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                        │
│       ┌───────────────┼───────────────┐                        │
│       ▼               ▼               ▼                        │
│  ┌────────┐     ┌──────────┐    ┌────────────┐                 │
│  │  Chat  │     │  Users   │    │   Voice    │                 │
│  │ Module │     │  Module  │    │   Module   │                 │
│  │        │     │          │    │  (WebRTC)  │                 │
│  │ • Msgs │     │ • Auth   │    │  • Signal  │                 │
│  │ • Chans│     │ • Roles  │    │  • ICE     │                 │
│  │ • Perms│     │ • Servers│    │  • P2P     │                 │
│  └────┬───┘     └────┬─────┘    └─────┬──────┘                 │
│       │              │                 │                       │
│       └──────────────┴─────────────────┘                       │
│                      │                                         │
└──────────────────────┼─────────────────────────────────────────┘
                       │
                       ▼
         ┌─────────────────────────┐
         │     PostgreSQL 16       │
         │                         │
         │  Key tables (30+):      │
         │  • users, sessions      │
         │  • servers, channels    │
         │  • messages, reactions  │
         │  • roles, voice_states  │
         │  • bots, audit_logs     │
         │  • webhooks, DMs, ...   │
         └─────────────────────────┘
```

---

## Core Components

### 1. Web Server (Axum)

**Purpose**: Single entry point for all client connections

**Why Axum**:

- Built on Tokio (async runtime)
- Type-safe request/response handling
- WebSocket support built-in
- Excellent performance (50k+ req/sec on modest hardware)
- Middleware ecosystem

**Handles**:

```rust
// HTTP REST API
GET  /servers              // List servers
POST /servers              // Create server
GET  /channels/:id/messages // Get message history
POST /channels/:id/messages // Send message

// WebSocket upgrade
GET  /ws?token=jwt         // Upgrade to WebSocket connection

// File uploads
POST /messages/:message_id/attachments  // Upload file (multipart/form-data)
```

**Key Features**:

- JWT validation on all authenticated routes
- Rate limiting: 10 req/s per IP (burst 20) globally, 2 req/s (burst 5) for auth
- CORS for web client
- Graceful shutdown (drain connections on SIGTERM)

### 2. WebSocket Gateway

**Purpose**: Real-time bidirectional communication

**Connection Flow**:

```
Client                          Server
  │                               │
  │ GET /ws?token=jwt             │
  ├──────────────────────────────>│
  │                               │ Validate JWT
  │                               │ Upgrade to WebSocket
  │ 101 Switching Protocols       │
  │<──────────────────────────────┤
  │                               │ Register connection
  │                               │ Load user's servers
  │ {op: "DISPATCH", t: "READY"}  │
  │<──────────────────────────────┤
  │                               │
  │ Heartbeat every 30s           │
  │<─────────────────────────────>│
```

**Message Format**:

```rust
#[derive(Serialize, Deserialize)]
struct GatewayMessage {
    op: GatewayOp,        // Enum serialized as SCREAMING_SNAKE_CASE
                          // DISPATCH, HEARTBEAT, HEARTBEAT_ACK,
                          // PRESENCE_UPDATE, TYPING_START, VOICE_SIGNAL
    t: Option<String>,    // Event type (for DISPATCH)
    d: Option<Value>,     // Event data
}

// Example: New message event
{
  "op": "DISPATCH",
  "t": "MESSAGE_CREATE",
  "d": {
    "id": "uuid",
    "channel_id": "uuid",
    "author": {...},
    "content": "Hello!",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Event Types** (21 total):

- `READY` - Initial state sent on connection
- `MESSAGE_CREATE/UPDATE/DELETE` - Chat messages
- `PRESENCE_UPDATE` - User status changed
- `VOICE_STATE_UPDATE` - User joined/left/muted in voice
- `VOICE_SIGNAL` - WebRTC SDP/ICE relay between peers
- `DM_CHANNEL_CREATE` / `DM_MESSAGE_CREATE` - Direct messages
- `REACTION_ADD/REMOVE` - Message reactions
- `THREAD_MESSAGE_CREATE` - Thread replies
- `POLL_VOTE` - Poll vote cast
- `TYPING_START/STOP` - Typing indicators
- `MESSAGE_PIN/UNPIN` - Pin changes
- `CUSTOM_EMOJI_CREATE/DELETE` - Custom emoji management
- `GO_LIVE_START/STOP` - Screen sharing / go-live sessions

**Performance**:

- Each WebSocket connection uses ~4KB memory
- 10,000 concurrent connections = ~40MB
- Message routing is O(1) per recipient (HashMap lookup)

### 3. Chat Module

**Purpose**: Message handling and channel management

**Database Schema**:

```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    edited_at TIMESTAMPTZ,
    deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Indexing for pagination
    CONSTRAINT messages_channel_time_idx
        CHECK (created_at IS NOT NULL)
);

CREATE INDEX idx_messages_channel_time
    ON messages(channel_id, created_at DESC)
    WHERE deleted = FALSE;

-- Full-text search
CREATE INDEX idx_messages_search
    ON messages USING GIN(to_tsvector('english', content))
    WHERE deleted = FALSE;
```

**Message Operations**:

```rust
// Send message
POST /channels/:id/messages
{
  "content": "Hello world!",
  "reply_to": "optional_message_id"
}

// Get history (cursor-based pagination)
GET /channels/:id/messages?before=message_id&limit=50

// Edit message
PATCH /channels/:id/messages/:msg_id
{
  "content": "Updated content"
}

// Delete message (soft delete)
DELETE /channels/:id/messages/:msg_id
```

**Search Implementation**:

```sql
-- Simple full-text search
SELECT * FROM messages
WHERE to_tsvector('english', content) @@ plainto_tsquery('search query')
  AND channel_id = :channel_id
  AND deleted = FALSE
ORDER BY created_at DESC
LIMIT 50;
```

**Performance**: PostgreSQL handles 10k+ writes/sec, 100k+ reads/sec - far exceeding needs for 20-500 users.

### 4. User Module

**Purpose**: Authentication, authorization, user management

**Schema**:

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL, -- bcrypt
    avatar_url TEXT,
    status TEXT DEFAULT 'offline', -- online/away/dnd/offline
    custom_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id),
    icon_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE server_members (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    nickname TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    permissions BIGINT NOT NULL, -- Bitfield
    color TEXT, -- Hex color
    position INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE member_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, server_id, role_id)
);
```

**Authentication Flow**:

```rust
// Login
POST /auth/login
{
  "username": "user",
  "password": "pass"
}
Response:
{
  "access_token": "jwt_token",
  "refresh_token": "refresh_token",
  "user": {...}
}

// JWT contains:
{
  "sub": "user_id",
  "exp": 1704067200, // 15 min expiry
  "iat": 1704066300
}

// Refresh
POST /auth/refresh
{
  "refresh_token": "..."
}
```

**Permission System** (Discord-compatible):

```rust
bitflags! {
    pub struct Permissions: u64 {
        const VIEW_CHANNEL = 1 << 0;
        const SEND_MESSAGES = 1 << 1;
        const MANAGE_MESSAGES = 1 << 2;
        const ATTACH_FILES = 1 << 3;
        const ADD_REACTIONS = 1 << 4;
        const CONNECT_VOICE = 1 << 5;
        const SPEAK = 1 << 6;
        const MUTE_MEMBERS = 1 << 7;
        const KICK_MEMBERS = 1 << 8;
        const BAN_MEMBERS = 1 << 9;
        const MANAGE_CHANNELS = 1 << 10;
        const MANAGE_SERVER = 1 << 11;
        const ADMINISTRATOR = 1 << 12;
    }
}

// Permission check
async fn can_send_message(user_id: Uuid, channel_id: Uuid) -> Result<bool> {
    let perms = calculate_permissions(user_id, channel_id).await?;
    Ok(perms.contains(Permissions::SEND_MESSAGES))
}
```

### 5. Voice Module (P2P WebRTC Mesh)

**Purpose**: Low-latency voice/video chat via peer-to-peer connections

**Why P2P mesh (not SFU or MCU)**:

- For gaming communities with 3-8 people per voice channel, P2P mesh is sufficient
- **Zero server-side media infrastructure** - the server is purely a signaling relay
- No Pion, no SFU, no server-side media processing or forwarding
- Migration path: if channels grow beyond ~10 simultaneous video participants, introduce an SFU; the signaling relay is already in place

**Architecture**:

```
┌─────────────────────────────────────────────────────┐
│              Voice Signaling (Server)                │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │         WebSocket VOICE_SIGNAL relay         │     │
│  │  • Relay SDP offer/answer between peers     │     │
│  │  • Relay ICE candidates between peers       │     │
│  │  • Co-membership check before forwarding    │     │
│  │  • Voice state management (DB)              │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│  Server NEVER touches audio/video packets.           │
└──────────────────────────────────────────────────────┘

           P2P Media (browser ↔ browser)

    User A ◄──── SRTP/UDP ────► User B
       │                           │
       └──── SRTP/UDP ────► User C ┘
```

**Connection Flow**:

```
1. Client → Server: Join voice channel (REST + WS VOICE_STATE_UPDATE)
2. Server: Insert voice_states row, broadcast VOICE_STATE_UPDATE to channel
3. Client A → Server: VOICE_SIGNAL {target: userB, sdp: offer}
4. Server: Verify A and B are in the same voice channel, then forward
5. Client B → Server: VOICE_SIGNAL {target: userA, sdp: answer}
6. ICE candidates exchanged via VOICE_SIGNAL relay (STUN/TURN for NAT traversal)
7. DTLS handshake directly between peers
8. Audio/video flows peer-to-peer via SRTP/UDP (server not involved)
```

**NAT Traversal**:

- **STUN**: Public Google servers for most connections
- **TURN**: Optional coturn with HMAC-SHA1 time-limited credentials via `GET /ice-servers`
- Required for iOS cellular and restrictive corporate firewalls

**Speaking Detection**: Client-side Web Audio API, sampling RMS every 100ms.

**Database Schema**:

```sql
CREATE TABLE voice_states (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    self_mute BOOLEAN NOT NULL DEFAULT FALSE,
    self_deaf BOOLEAN NOT NULL DEFAULT FALSE,
    server_mute BOOLEAN NOT NULL DEFAULT FALSE,
    server_deaf BOOLEAN NOT NULL DEFAULT FALSE,
    self_video BOOLEAN NOT NULL DEFAULT FALSE,
    self_screen BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- PRIMARY KEY is user_id alone: a user can only be in ONE voice channel at a time
```

---

## Data Flow Examples

### 1. Sending a Message

```
User A (Desktop)
    │
    │ POST /channels/123/messages
    │ { content: "Hello!" }
    │
    ▼
┌───────────────┐
│ Axum Handler  │
│ 1. Auth check │
│ 2. Rate limit │
│ 3. Perms check│
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  Chat Module  │
│ 1. Validate   │
│ 2. Store in DB│
│ 3. Get msg ID │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Database    │
│ INSERT message│
└───────┬───────┘
        │
        ▼
┌───────────────────┐
│ WebSocket Manager │
│ Broadcast to all  │
│ users in channel  │
└─────────┬─────────┘
          │
    ┌─────┴─────┬─────────┐
    ▼           ▼         ▼
User A      User B    User C
(echo)     (receive) (receive)
```

### 2. Joining Voice Channel

```
User A
  │
  │ WS: {"op": "VOICE_STATE_UPDATE", "d": {"channel_id": "..."}}
  │
  ▼
┌───────────────────┐
│ Voice Handler     │
│ 1. Upsert voice   │
│    state in DB    │
│ 2. Broadcast      │
│    VOICE_STATE_   │
│    UPDATE to chan  │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐     P2P WebRTC
│ Existing peers    │     (browser ↔ browser)
│ receive update,   │────────────────────┐
│ initiate WebRTC   │                    │
│ via VOICE_SIGNAL  │◄───────────────────┘
└───────────────────┘
  Server only relays SDP/ICE signals.
  Media flows directly between peers.
```

---

## Performance Characteristics

### Message Throughput

| Operation          | Latency (P50) | Latency (P99) | Throughput |
| ------------------ | ------------- | ------------- | ---------- |
| Send message       | 5-10ms        | 20ms          | 10k/sec    |
| Get history (50)   | 2-5ms         | 10ms          | 50k/sec    |
| WebSocket delivery | 1-3ms         | 10ms          | 100k/sec   |
| Full-text search   | 10-20ms       | 50ms          | 5k/sec     |

### Resource Usage (20 users)

| Metric   | Typical | Peak            |
| -------- | ------- | --------------- |
| CPU      | <5%     | <20%            |
| Memory   | ~100MB  | ~200MB          |
| Disk I/O | <1MB/s  | <10MB/s         |
| Network  | <1Mbps  | ~10Mbps (voice) |

### Scaling Limits (Single Server)

| Metric             | Conservative    | Optimistic        |
| ------------------ | --------------- | ----------------- |
| Concurrent users   | 500             | 2000              |
| Messages/sec       | 100             | 1000              |
| Voice participants | 50 (5 channels) | 200 (20 channels) |
| Database size      | Unlimited       | TB+               |

---

## Security

### Authentication

- **Password hashing**: bcrypt with 12 rounds
- **JWT**: HS256, 15-minute expiry for access tokens
- **Refresh tokens**: Random 256-bit, 7-day expiry, stored hashed
- **Session management**: Can revoke all sessions per user

### Authorization

- **Permission checks** on every operation
- **Channel-level permissions** with role overrides
- **Server ownership** validation for destructive operations

### WebSocket Security

- **JWT validation** on upgrade (token passed as query parameter)
- **Rate limiting**: 20 messages/sec per WebSocket connection
- **Idle timeout**: 300 seconds (disconnect inactive connections)
- **Heartbeat**: Client sends HEARTBEAT, server replies HEARTBEAT_ACK

### Voice Security

- **DTLS**: Standard WebRTC encryption for key exchange (peer-to-peer)
- **SRTP**: Encrypted media streams (peer-to-peer)
- **P2P mesh**: Media flows directly between browsers; peer IP addresses are visible to other participants unless TURN relay is used
- **Co-membership check**: Server verifies both users are in the same voice channel before relaying any VOICE_SIGNAL, preventing cross-channel signal leakage

### File Uploads

- **Size limits**: 50MB max
- **Type validation**: MIME type checking
- **Storage**: Local filesystem (configurable upload directory)

---

## Deployment

### Docker Compose (Production)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  coturn:
    image: coturn/coturn:latest
    network_mode: host
    volumes:
      - ./turn.conf:/etc/turnserver.conf:ro
      - ./certs:/etc/ssl:ro
    restart: unless-stopped

  server:
    image: jtjenkins/together-server:${TOGETHER_VERSION:-latest}
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
      JWT_SECRET: ${JWT_SECRET}
      APP_ENV: production
      SERVER_HOST: 0.0.0.0
      SERVER_PORT: 8080
      RUST_LOG: ${RUST_LOG:-together_server=info,tower_http=info,sqlx=warn}
      UPLOAD_DIR: /app/uploads
    volumes:
      - uploads_data:/app/uploads
    restart: unless-stopped
    # Server port is NOT exposed — traffic flows through the web/Nginx service

  web:
    image: jtjenkins/together-web:${TOGETHER_VERSION:-latest}
    depends_on:
      - server
    ports:
      - "${BIND_PORT:-80}:80"
    restart: unless-stopped

volumes:
  postgres_data:
  uploads_data:
```

### System Requirements

**Minimum (20-50 users)**:

- CPU: 2 vCPU
- RAM: 2GB
- Storage: 20GB SSD
- Network: 100Mbps
- Cost: ~$10-15/month (Hetzner, DigitalOcean)

**Recommended (100-500 users)**:

- CPU: 4 vCPU
- RAM: 8GB
- Storage: 100GB SSD
- Network: 1Gbps
- Cost: ~$20-40/month

---

## Monitoring

### Metrics (Prometheus format)

Metrics are provided by `axum_prometheus` and exposed at `GET /metrics` (restricted to loopback connections only).

Standard metrics include HTTP request duration histograms and request counters broken down by method, path, and status code. These are the default `axum_prometheus` metric names (e.g., `axum_http_requests_total`, `axum_http_requests_duration_seconds`), not custom application metrics.

### Logging

Structured JSON logs with levels: ERROR, WARN, INFO, DEBUG

```rust
info!(
    user_id = %user.id,
    channel_id = %channel.id,
    "User sent message"
);
```

### Health Checks

```
GET /health
Response:
{
  "status": "healthy",
  "service": "together-server",
  "version": "0.1.0",
  "uptime_secs": 86400,
  "database": {
    "status": "healthy",
    "latency_ms": 2
  },
  "connections": {
    "websocket": 45
  }
}

GET /health/ready   — Readiness check (200 when ready, 503 when not)
GET /health/live    — Liveness check (always 200 if process is alive)
```

---

## Migration Path

If you outgrow a single server:

### Stage 1: Vertical Scaling (500-2000 users)

- Upgrade to 8-16 vCPU, 16-32GB RAM
- Add PostgreSQL read replicas
- Enable Redis for sessions/presence
- Cost: ~$100-200/month

### Stage 2: Horizontal Scaling (2000+ users)

- Multiple server instances behind load balancer
- Separate voice servers per region
- ScyllaDB for message storage
- Cost: ~$500+/month

**For 20 users**: You'll never need Stage 1 or 2.

---

## Conclusion

This architecture provides:

- ✅ **Simple deployment**: One command (`docker-compose up`)
- ✅ **Low cost**: $10-20/month for 20-100 users
- ✅ **Easy maintenance**: Single codebase, single language
- ✅ **Good performance**: <10ms message latency, <100ms voice latency
- ✅ **Clear upgrade path**: Can scale to thousands when needed

**Remember**: Premature optimization is the root of all evil. Build for today, scale for tomorrow.

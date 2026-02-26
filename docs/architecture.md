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
│                         CLIENT LAYER                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐        │
│  │   Desktop   │  │    Web      │  │   Mobile        │        │
│  │  (Tauri)    │  │  (React)    │  │(React Native)   │        │
│  │  Rust Core  │  │  Browser    │  │  iOS/Android    │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────────┘        │
│         │                │                │                    │
│         └────────────────┴────────────────┘                    │
│                          │                                      │
│                   WebSocket / HTTPS                             │
└──────────────────────────┼─────────────────────────────────────┘
                           │
┌──────────────────────────┼─────────────────────────────────────┐
│                TOGETHER SERVER (Rust)                           │
│  ┌────────────────────────────────────────────────────────┐    │
│  │              Axum Web Framework                         │    │
│  │  • HTTP Routes (REST API)                               │    │
│  │  • WebSocket Upgrade Handler                            │    │
│  │  • JWT Authentication Middleware                        │    │
│  │  • Rate Limiting                                        │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                         │
│  ┌────────────────────┼───────────────────────────────────┐    │
│  │         WebSocket Connection Manager                     │    │
│  │  • Active connection registry                            │    │
│  │  • Message routing (user → channels)                     │    │
│  │  • Presence tracking                                     │    │
│  │  • Event broadcasting                                    │    │
│  └────────────────────┬───────────────────────────────────┘    │
│                       │                                         │
│       ┌───────────────┼───────────────┐                        │
│       ▼               ▼               ▼                        │
│  ┌────────┐     ┌──────────┐    ┌────────────┐               │
│  │  Chat  │     │  Users   │    │   Voice    │               │
│  │ Module │     │  Module  │    │   Module   │               │
│  │        │     │          │    │  (WebRTC)  │               │
│  │ • Msgs │     │ • Auth   │    │  • SFU     │               │
│  │ • Chans│     │ • Roles  │    │  • ICE     │               │
│  │ • Perms│     │ • Servers│    │  • DTLS    │               │
│  └────┬───┘     └────┬─────┘    └─────┬──────┘               │
│       │              │                 │                       │
│       └──────────────┴─────────────────┘                       │
│                      │                                         │
└──────────────────────┼─────────────────────────────────────────┘
                       │
                       ▼
         ┌─────────────────────────┐
         │     PostgreSQL 16       │
         │                         │
         │  Tables:                │
         │  • users                │
         │  • servers              │
         │  • channels             │
         │  • messages             │
         │  • roles                │
         │  • sessions             │
         │  • voice_state          │
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
GET  /api/servers              // List servers
POST /api/servers              // Create server
GET  /api/channels/:id/messages // Get message history
POST /api/channels/:id/messages // Send message

// WebSocket upgrade
GET  /gateway?token=jwt        // Upgrade to WebSocket connection

// File uploads
POST /api/attachments          // Upload file (multipart/form-data)
```

**Key Features**:

- JWT validation on all authenticated routes
- Rate limiting: 100 req/min per user, 10 WebSocket connections per IP
- CORS for web client
- Graceful shutdown (drain connections on SIGTERM)

### 2. WebSocket Gateway

**Purpose**: Real-time bidirectional communication

**Connection Flow**:

```
Client                          Server
  │                               │
  │ GET /gateway?token=jwt        │
  ├──────────────────────────────>│
  │                               │ Validate JWT
  │                               │ Upgrade to WebSocket
  │ 101 Switching Protocols       │
  │<──────────────────────────────┤
  │                               │
  │ {op: "IDENTIFY"}              │
  ├──────────────────────────────>│
  │                               │ Register connection
  │                               │ Load user's servers
  │ {op: "READY", data: {...}}    │
  │<──────────────────────────────┤
  │                               │
  │ Heartbeat every 30s           │
  │<─────────────────────────────>│
```

**Message Format**:

```rust
#[derive(Serialize, Deserialize)]
struct GatewayMessage {
    op: String,           // Operation: DISPATCH, HEARTBEAT, IDENTIFY, etc.
    s: Option<u64>,       // Sequence number (for resume)
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

**Event Types**:

- `READY` - Initial state after identify
- `MESSAGE_CREATE/UPDATE/DELETE` - Chat messages
- `CHANNEL_CREATE/UPDATE/DELETE` - Channel changes
- `VOICE_STATE_UPDATE` - User joined/left/muted in voice
- `PRESENCE_UPDATE` - User status changed
- `TYPING_START` - User typing indicator

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
    author_id UUID NOT NULL REFERENCES users(id),
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
POST /api/channels/:id/messages
{
  "content": "Hello world!",
  "reply_to": "optional_message_id"
}

// Get history (cursor-based pagination)
GET /api/channels/:id/messages?before=timestamp&limit=50

// Edit message
PATCH /api/channels/:id/messages/:msg_id
{
  "content": "Updated content"
}

// Delete message (soft delete)
DELETE /api/channels/:id/messages/:msg_id
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
POST /api/auth/login
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
POST /api/auth/refresh
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

### 5. Voice Module (WebRTC SFU)

**Purpose**: Low-latency voice chat using Selective Forwarding Unit

**Why SFU (not mesh or MCU)**:

- **Mesh**: Each client connects to every other (N² connections) - doesn't scale
- **MCU**: Server mixes audio (expensive CPU, adds latency)
- **SFU**: Server forwards packets without processing - perfect balance

**Architecture**:

```
┌─────────────────────────────────────────────────────┐
│              Voice Service                           │
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │         Signaling (WebSocket)               │   │
│  │  • SDP offer/answer exchange                │   │
│  │  • ICE candidate gathering                  │   │
│  │  • Voice state management                   │   │
│  └─────────────────┬───────────────────────────┘   │
│                    │                                │
│  ┌─────────────────▼───────────────────────────┐   │
│  │          WebRTC SFU (Pion)                  │   │
│  │                                              │   │
│  │   User A ──► [Router] ──► User B            │   │
│  │             (forward)                        │   │
│  │   User B ──►   ▲   ▼  ──► User C            │   │
│  │                │                             │   │
│  │            No mixing,                        │   │
│  │         just forwarding                      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Connection Flow**:

```
1. Client → Server: "Join voice channel X"
2. Server: Create PeerConnection for user
3. Server → Client: SDP offer
4. Client → Server: SDP answer
5. ICE candidates exchanged (STUN/TURN for NAT traversal)
6. DTLS handshake (encryption)
7. Audio flows via UDP (SRTP encrypted)
```

**Voice Configuration**:

```rust
VoiceConfig {
    codec: Opus,
    sample_rate: 48000,
    channels: 2, // Stereo
    bitrate: 64000, // 64kbps per user

    // Voice Activity Detection
    vad_enabled: true,
    vad_threshold: -30, // dB

    // Jitter buffer
    jitter_buffer_ms: 100,

    // Limits
    max_users_per_channel: 100,
}
```

**Database Schema**:

```sql
CREATE TABLE voice_states (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    self_mute BOOLEAN DEFAULT FALSE,
    self_deaf BOOLEAN DEFAULT FALSE,
    server_mute BOOLEAN DEFAULT FALSE,
    server_deaf BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);
```

---

## Data Flow Examples

### 1. Sending a Message

```
User A (Desktop)
    │
    │ POST /api/channels/123/messages
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
User
  │
  │ WS: {"op": "VOICE_STATE_UPDATE", "channel_id": "..."}
  │
  ▼
┌──────────────┐
│ Voice Module │
│ 1. Create    │
│    peer conn │
│ 2. Generate  │
│    SDP offer │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Database   │
│ INSERT voice │
│ state        │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ Broadcast to all │
│ in voice channel │
└──────────────────┘
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

- **JWT validation** on upgrade
- **Rate limiting**: 100 messages/min per connection
- **Connection limits**: 10 per IP address
- **Heartbeat timeout**: 60 seconds (detect dead connections)

### Voice Security

- **DTLS**: Standard WebRTC encryption for key exchange
- **SRTP**: Encrypted media streams
- **No P2P**: All traffic through server (hide user IPs)

### File Uploads

- **Size limits**: 50MB max
- **Type validation**: MIME type checking
- **Virus scanning**: Optional ClamAV integration
- **Storage**: Separate from database (filesystem or S3)

---

## Deployment

### Docker Compose (Production)

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: together
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  server:
    build: ./server
    ports:
      - "8080:8080" # HTTP/WebSocket
      - "7880-8000:7880-8000/udp" # WebRTC UDP range
    environment:
      DATABASE_URL: postgres://postgres:${DB_PASSWORD}@postgres/together
      JWT_SECRET: ${JWT_SECRET}
      RUST_LOG: info
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - app_data:/data # File attachments

volumes:
  postgres_data:
  app_data:
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

```rust
// Connection metrics
together_websocket_connections_total
together_websocket_messages_sent_total
together_websocket_messages_received_total

// HTTP metrics
together_http_requests_total{method, endpoint, status}
together_http_request_duration_seconds{method, endpoint}

// Voice metrics
together_voice_participants_total
together_voice_bitrate_bps

// Database metrics
together_db_query_duration_seconds{query_type}
together_db_connections_active
```

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
  "database": "connected",
  "websockets": 45,
  "voice_participants": 8,
  "uptime_seconds": 86400
}
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

# Right-Sized Architecture for 20 Users

## Executive Summary

This document proposes a simplified architecture appropriate for small groups (20-100 users), maintaining the core Together vision while eliminating unnecessary complexity.

**Key Changes**:
- Monolithic application instead of microservices
- Single database (PostgreSQL) instead of three systems
- Single programming language (Rust or Go)
- Docker Compose deployment instead of Kubernetes
- Total infrastructure cost: $10-20/month instead of $500+/month

---

## Simplified Architecture

```
┌─────────────────────────────────────────────────────┐
│            CLIENT LAYER                              │
├──────────────┬──────────────┬──────────────────────┤
│   Desktop    │    Web       │   Mobile             │
│  (Tauri)     │  (React)     │(React Native)        │
└──────┬───────┴──────┬───────┴──────┬───────────────┘
       │              │              │
       └──────────────┴──────────────┘
                      │
           WebSocket / HTTPS
                      │
┌─────────────────────────────────────────────────────┐
│          MONOLITHIC SERVER (Rust/Go)                 │
│                                                      │
│  ┌────────────────────────────────────────────┐    │
│  │  HTTP/WebSocket Handler                     │    │
│  │  - Auth (JWT)                               │    │
│  │  - Rate limiting                            │    │
│  │  - WebSocket connections                    │    │
│  └──────────────────┬─────────────────────────┘    │
│                     │                               │
│  ┌──────────────────┼────────────────────────┐     │
│  │                  │                         │     │
│  ▼                  ▼                         ▼     │
│  ┌────────┐   ┌─────────┐   ┌──────────────┐      │
│  │  Chat  │   │  User   │   │  Voice (SFU) │      │
│  │ Module │   │ Module  │   │   Module      │      │
│  └────┬───┘   └────┬────┘   └──────┬───────┘      │
│       │            │               │               │
│       └────────────┴───────────────┘               │
│                    │                               │
└────────────────────┼───────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │   PostgreSQL          │
         │                       │
         │  - Users/auth         │
         │  - Messages           │
         │  - Channels/servers   │
         │  - Sessions (in DB)   │
         └───────────────────────┘
```

---

## Technology Stack Comparison

| Component | Original Plan | Right-Sized | Justification |
|-----------|--------------|-------------|---------------|
| **Backend** | 3 services (Rust) + 1 (Go) | Single Rust app | Simpler deployment, easier to maintain |
| **Messages DB** | ScyllaDB cluster | PostgreSQL | PostgreSQL handles 10k writes/sec easily |
| **Sessions** | Redis cluster | PostgreSQL | Built-in sessions table, no extra service |
| **Search** | Elasticsearch | PostgreSQL FTS | pg_trgm + ts_vector sufficient for 20 users |
| **Cache** | Redis | None initially | PostgreSQL is fast enough at this scale |
| **Voice** | Separate Go service | Embedded in monolith | Reduce service count |
| **Queue** | NATS/RabbitMQ | None | Async tasks in-process (tokio) |
| **Storage** | MinIO/S3 | Local filesystem | 50GB local storage = years of attachments |
| **Deployment** | Kubernetes | Docker Compose | Simple single-server deploy |
| **Monitoring** | Prometheus + Grafana | Logs + simple metrics | Over-monitoring adds noise |

---

## Database Schema (PostgreSQL Only)

### Users & Auth
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    status TEXT DEFAULT 'offline',
    custom_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_active TIMESTAMPTZ DEFAULT NOW()
);
```

### Servers & Channels
```sql
CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'text' or 'voice'
    category TEXT,
    position INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Messages
```sql
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    content TEXT NOT NULL,
    edited_at TIMESTAMPTZ,
    deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing for fast history pagination
CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC)
    WHERE deleted = FALSE;

-- Full-text search
CREATE INDEX idx_messages_search ON messages USING GIN(to_tsvector('english', content))
    WHERE deleted = FALSE;
```

### Roles & Permissions
```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    permissions BIGINT NOT NULL, -- Bitfield
    color TEXT,
    position INT
);

CREATE TABLE member_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, server_id, role_id)
);
```

**Performance**: PostgreSQL easily handles 10k writes/sec and millions of rows. For 20 users, this is overkill.

---

## Simplified Rust Backend Structure

```
together/
├── Cargo.toml
├── src/
│   ├── main.rs                    # Entry point, server setup
│   ├── config.rs                  # Configuration
│   ├── auth/
│   │   ├── mod.rs
│   │   ├── jwt.rs                 # JWT handling
│   │   └── middleware.rs          # Auth middleware
│   ├── websocket/
│   │   ├── mod.rs
│   │   ├── connection.rs          # WebSocket handling
│   │   └── events.rs              # Event types
│   ├── handlers/
│   │   ├── mod.rs
│   │   ├── users.rs               # User endpoints
│   │   ├── servers.rs             # Server endpoints
│   │   ├── channels.rs            # Channel endpoints
│   │   └── messages.rs            # Message endpoints
│   ├── voice/
│   │   ├── mod.rs
│   │   ├── webrtc.rs              # WebRTC SFU logic
│   │   └── signaling.rs           # SDP negotiation
│   ├── models/
│   │   ├── mod.rs
│   │   ├── user.rs
│   │   ├── message.rs
│   │   └── channel.rs
│   ├── db/
│   │   ├── mod.rs
│   │   └── postgres.rs            # Database operations
│   └── utils/
│       └── permissions.rs         # Permission checking
```

**Lines of Code Estimate**: 8,000-12,000 LOC vs. 30,000+ for microservices

---

## Deployment

### Docker Compose (Single File)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: together
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  app:
    build: .
    ports:
      - "8080:8080"       # HTTP/WebSocket
      - "7880-8000:7880-8000/udp"  # WebRTC
    environment:
      DATABASE_URL: postgres://postgres:${DB_PASSWORD}@postgres/together
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      - postgres
    restart: unless-stopped
    volumes:
      - app_data:/data    # File attachments

volumes:
  postgres_data:
  app_data:
```

**Deployment Steps**:
```bash
# Initial setup (5 minutes)
git clone https://github.com/yourorg/together
cd together
cp .env.example .env
# Edit .env with passwords
docker-compose up -d

# Create first admin user
docker-compose exec app together-cli create-admin

# Done! Access at https://your-domain.com
```

---

## Cost Comparison

### Original Architecture (Kubernetes, Microservices)
| Service | Cost/Month |
|---------|------------|
| Gateway servers (2x) | $40 |
| Chat service (2x) | $40 |
| User service (2x) | $40 |
| Voice servers (2x) | $80 |
| ScyllaDB (3-node) | $120 |
| PostgreSQL | $20 |
| Redis cluster | $40 |
| Object storage | $10 |
| Load balancer | $20 |
| **Total** | **$410/month** |

### Right-Sized Architecture
| Service | Cost/Month |
|---------|------------|
| Single VPS (4 vCPU, 8GB) | $20 |
| PostgreSQL (included) | $0 |
| Storage (included) | $0 |
| **Total** | **$20/month** |

**Savings**: $390/month = $4,680/year for 20 users

---

## Performance Targets for 20 Users

| Metric | Target | Reality at 20 Users |
|--------|--------|---------------------|
| Message delivery | < 100ms | ~10-20ms (same region) |
| Voice latency | < 200ms | ~50-100ms (WebRTC) |
| Message history load | < 50ms | ~5ms (PostgreSQL index scan) |
| Concurrent voice users | 20 | Easily handled by single server |
| Message storage | Infinite | 1M messages = ~500MB |
| File storage | 50GB+ | Years of screenshots |
| Uptime | 99%+ | VPS reliability is 99.9% |

**The math**:
- 20 users × 100 messages/day = 2,000 messages/day = 730k/year
- At 500 bytes/message = 365MB/year storage
- A $20/month VPS has 250GB+ storage

---

## Migration Path (If You Grow)

If your community grows beyond 100 users, THEN consider:

1. **100-500 users**: Add Redis for sessions/presence
2. **500-2000 users**: Separate voice service (dedicated server)
3. **2000+ users**: Split into microservices, add ScyllaDB

**Don't prematurely optimize** - You can migrate when needed.

---

## Development Timeline Comparison

| Phase | Microservices | Monolithic | Time Saved |
|-------|---------------|------------|------------|
| Setup | 2 weeks | 3 days | 11 days |
| Auth | 2 weeks | 1 week | 1 week |
| Text chat | 4 weeks | 2 weeks | 2 weeks |
| Voice | 6 weeks | 4 weeks | 2 weeks |
| **Total MVP** | **14 weeks** | **7-8 weeks** | **6 weeks** |

**Why faster**:
- No service coordination overhead
- Single codebase, single language
- Simpler deployment testing
- No Docker orchestration complexity

---

## Recommended Tech Stack for 20 Users

| Component | Choice | Why |
|-----------|--------|-----|
| **Backend** | Rust (Axum) | Best of both worlds - performance + safety |
| **Alternative** | Go (Gin) | Easier to learn, still great performance |
| **Database** | PostgreSQL 16 | Battle-tested, feature-rich, handles scale |
| **Desktop** | Tauri + React | Keep original plan - excellent choice |
| **Mobile** | React Native | Keep original plan |
| **Voice** | Pion (embedded) | Great WebRTC library, no separate service |
| **Deployment** | Docker Compose | Simple, reliable, version-controlled |
| **Hosting** | Hetzner/DigitalOcean VPS | $20/month, reliable, easy |

---

## When to Scale Up

Only move to the original architecture when:

1. **User count** > 500 active users
2. **Message volume** > 100k messages/day
3. **Voice channels** need multiple regions
4. **Storage** exceeds single-server capacity (multiple TB)
5. **Uptime requirements** demand redundancy (99.99%+)

For a 20-person group, **you'll never hit these limits**.

---

## Conclusion

The original architecture is technically sound but **economically and operationally inappropriate** for 20 users. It's like buying a semi-truck to drive to the grocery store.

**Recommendation**: Build the simplified monolithic version first. If you grow to 500+ users and have real scale problems, THEN migrate to microservices with confidence and data to guide the transition.

This approach:
- ✅ Saves 6 weeks of development time
- ✅ Reduces hosting costs by 95% ($20 vs $410/month)
- ✅ Eliminates operational complexity
- ✅ Still provides all core features
- ✅ Maintains upgrade path if needed

**Remember**: Discord started as a monolith too. They scaled to millions THEN refactored to microservices. Build for your current needs, not your fantasy scale.

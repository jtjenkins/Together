# Together Project Structure

## Monorepo Layout

```
Together/
├── README.md                   # Project overview
├── LICENSE                     # AGPL-3.0
├── docker-compose.yml          # Production deployment
├── docker-compose.dev.yml      # Development setup
├── .env.example                # Environment template
├── Makefile                    # Common tasks
│
├── .github/
│   └── workflows/
│       ├── server.yml          # Server CI/CD
│       ├── desktop.yml         # Desktop app builds
│       └── mobile.yml          # Mobile app builds
│
├── docs/                       # Documentation
│   ├── README.md               # Docs index
│   ├── architecture.md         # System design
│   ├── roadmap.md              # Implementation phases
│   ├── api/                    # API documentation
│   │   ├── rest.md             # REST API spec
│   │   └── websocket.md        # WebSocket protocol
│   └── deployment/             # Deployment guides
│       ├── docker.md           # Docker Compose guide
│       ├── systemd.md          # systemd service
│       └── nginx.md            # Reverse proxy setup
│
├── server/                     # Rust backend (single binary)
│   ├── Cargo.toml              # Rust dependencies
│   ├── Cargo.lock
│   ├── Dockerfile              # Production container
│   ├── .env.example            # Server config template
│   │
│   ├── migrations/             # SQL migrations (diesel/sqlx)
│   │   ├── 001_users.sql
│   │   ├── 002_servers.sql
│   │   ├── 003_channels.sql
│   │   └── 004_messages.sql
│   │
│   ├── src/
│   │   ├── main.rs             # Entry point, server setup
│   │   ├── config.rs           # Configuration loading
│   │   │
│   │   ├── auth/               # Authentication module
│   │   │   ├── mod.rs
│   │   │   ├── jwt.rs          # JWT creation/validation
│   │   │   ├── password.rs     # bcrypt hashing
│   │   │   └── middleware.rs   # Auth middleware
│   │   │
│   │   ├── websocket/          # WebSocket gateway
│   │   │   ├── mod.rs
│   │   │   ├── connection.rs   # Connection management
│   │   │   ├── events.rs       # Event types
│   │   │   └── router.rs       # Message routing
│   │   │
│   │   ├── chat/               # Chat functionality
│   │   │   ├── mod.rs
│   │   │   ├── handlers.rs     # REST handlers
│   │   │   ├── messages.rs     # Message logic
│   │   │   ├── channels.rs     # Channel management
│   │   │   └── search.rs       # Full-text search
│   │   │
│   │   ├── users/              # User management
│   │   │   ├── mod.rs
│   │   │   ├── handlers.rs     # REST handlers
│   │   │   ├── auth.rs         # Login/register
│   │   │   ├── profile.rs      # User profiles
│   │   │   └── friendships.rs  # Friend system
│   │   │
│   │   ├── servers/            # Server management
│   │   │   ├── mod.rs
│   │   │   ├── handlers.rs     # REST handlers
│   │   │   ├── crud.rs         # Server CRUD
│   │   │   ├── roles.rs        # Role system
│   │   │   └── permissions.rs  # Permission checks
│   │   │
│   │   ├── voice/              # WebRTC voice
│   │   │   ├── mod.rs
│   │   │   ├── sfu.rs          # SFU implementation
│   │   │   ├── signaling.rs    # SDP exchange
│   │   │   └── state.rs        # Voice state tracking
│   │   │
│   │   ├── models/             # Database models
│   │   │   ├── mod.rs
│   │   │   ├── user.rs
│   │   │   ├── server.rs
│   │   │   ├── channel.rs
│   │   │   ├── message.rs
│   │   │   └── role.rs
│   │   │
│   │   ├── db/                 # Database operations
│   │   │   ├── mod.rs
│   │   │   ├── pool.rs         # Connection pooling
│   │   │   └── queries.rs      # SQL queries
│   │   │
│   │   └── utils/              # Utilities
│   │       ├── mod.rs
│   │       ├── rate_limit.rs   # Rate limiting
│   │       └── validation.rs   # Input validation
│   │
│   └── tests/                  # Integration tests
│       ├── auth_test.rs
│       ├── messages_test.rs
│       └── permissions_test.rs
│
├── clients/                    # Client applications
│   │
│   ├── shared/                 # Shared TypeScript code
│   │   ├── types/              # Type definitions
│   │   │   ├── user.ts
│   │   │   ├── message.ts
│   │   │   ├── channel.ts
│   │   │   └── websocket.ts
│   │   ├── api/                # API client
│   │   │   ├── rest.ts         # REST client
│   │   │   └── websocket.ts    # WebSocket client
│   │   └── utils/              # Shared utilities
│   │
│   ├── desktop/                # Tauri desktop app
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   │
│   │   ├── src-tauri/          # Rust backend for Tauri
│   │   │   ├── Cargo.toml
│   │   │   ├── tauri.conf.json
│   │   │   └── src/
│   │   │       ├── main.rs     # Tauri commands
│   │   │       └── tray.rs     # System tray
│   │   │
│   │   ├── src/                # React frontend
│   │   │   ├── main.tsx        # Entry point
│   │   │   ├── App.tsx         # Root component
│   │   │   │
│   │   │   ├── components/     # UI components
│   │   │   │   ├── Layout/
│   │   │   │   │   ├── Sidebar.tsx
│   │   │   │   │   ├── TopBar.tsx
│   │   │   │   │   └── MemberList.tsx
│   │   │   │   ├── ServerList/
│   │   │   │   │   ├── ServerIcon.tsx
│   │   │   │   │   └── ServerList.tsx
│   │   │   │   ├── ChannelList/
│   │   │   │   │   ├── ChannelItem.tsx
│   │   │   │   │   └── Category.tsx
│   │   │   │   ├── Chat/
│   │   │   │   │   ├── MessageList.tsx
│   │   │   │   │   ├── Message.tsx
│   │   │   │   │   ├── MessageInput.tsx
│   │   │   │   │   └── TypingIndicator.tsx
│   │   │   │   ├── Voice/
│   │   │   │   │   ├── VoicePanel.tsx
│   │   │   │   │   ├── VoiceUser.tsx
│   │   │   │   │   └── VoiceControls.tsx
│   │   │   │   └── Settings/
│   │   │   │       ├── UserSettings.tsx
│   │   │   │       └── ServerSettings.tsx
│   │   │   │
│   │   │   ├── stores/         # State management (Zustand)
│   │   │   │   ├── useAuth.ts
│   │   │   │   ├── useServers.ts
│   │   │   │   ├── useChannels.ts
│   │   │   │   ├── useMessages.ts
│   │   │   │   └── useVoice.ts
│   │   │   │
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   │   ├── useWebSocket.ts
│   │   │   │   ├── useVoice.ts
│   │   │   │   ├── useMessages.ts
│   │   │   │   └── usePermissions.ts
│   │   │   │
│   │   │   └── lib/            # Utilities
│   │   │       ├── api.ts      # API wrapper
│   │   │       └── voice.ts    # WebRTC wrapper
│   │   │
│   │   └── public/             # Static assets
│   │
│   ├── web/                    # Web client (similar to desktop)
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── src/
│   │   │   └── (similar structure to desktop)
│   │   └── public/
│   │
│   └── mobile/                 # React Native app
│       ├── package.json
│       ├── metro.config.js
│       │
│       ├── ios/                # iOS project
│       │   └── Together/
│       │
│       ├── android/            # Android project
│       │   └── app/
│       │
│       └── src/
│           ├── App.tsx
│           │
│           ├── navigation/     # React Navigation
│           │   └── RootNavigator.tsx
│           │
│           ├── screens/        # Mobile screens
│           │   ├── ServerListScreen.tsx
│           │   ├── ChannelListScreen.tsx
│           │   ├── ChatScreen.tsx
│           │   ├── VoiceScreen.tsx
│           │   └── SettingsScreen.tsx
│           │
│           ├── components/     # Mobile UI components
│           │   ├── ServerIcon.tsx
│           │   ├── Message.tsx
│           │   └── VoiceUser.tsx
│           │
│           └── services/       # API clients
│               ├── api.ts
│               ├── websocket.ts
│               └── voice.ts
│
└── tools/                      # Utilities
    ├── cli/                    # Admin CLI
    │   └── src/
    │       └── main.rs         # Server management commands
    │
    └── discord-bridge/         # Discord sync tool
        ├── package.json
        └── src/
            ├── bot.ts          # Discord bot
            └── sync.ts         # Message sync logic
```

---

## Key Design Decisions

### 1. Monolithic Backend

**Why**: Simplicity, maintainability, easier debugging

**Structure**:

- Single Rust binary
- Modules for different domains (chat, users, voice)
- All share same database connection pool
- No inter-service communication overhead

### 2. Shared Client Code

**Why**: Type safety, consistency, reduced duplication

**Shared**:

- TypeScript type definitions
- API client code
- WebSocket event handlers
- Utility functions

**Platform-specific**:

- UI components (Tauri vs React vs React Native)
- Platform APIs (notifications, system tray)
- Navigation patterns

### 3. Single Database

**Why**: ACID transactions, referential integrity, simpler ops

**PostgreSQL handles**:

- Users and authentication
- Messages and history
- Channels and servers
- Roles and permissions
- Sessions and presence

### 4. Simple Deployment

**Why**: Fast iteration, easy debugging, lower operational burden

**Docker Compose provides**:

- Single-command startup
- Environment variable configuration
- Volume management for persistence
- Health checks and restarts

---

## Development Workflow

### Local Development

```bash
# Terminal 1: Start database
docker-compose -f docker-compose.dev.yml up postgres

# Terminal 2: Run server
cd server
cargo run
# Server runs on http://localhost:8080

# Terminal 3: Run desktop client
cd clients/desktop
npm run tauri dev
```

### Testing

```bash
# Server tests
cd server
cargo test

# Integration tests
cargo test --test '*'

# Client tests
cd clients/desktop
npm test
```

### Building

```bash
# Server (release)
cd server
cargo build --release
# Binary: target/release/together-server

# Desktop app
cd clients/desktop
npm run tauri build
# Output: src-tauri/target/release/bundle/

# Docker image
docker build -t together-server server/
```

---

## Dependencies

### Server (Rust)

```toml
[dependencies]
# Web framework
axum = "0.7"
tokio = { version = "1", features = ["full"] }

# Database
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio"] }

# Authentication
jsonwebtoken = "9"
bcrypt = "0.15"

# WebSocket
axum-tungstenite = "0.7"

# WebRTC
webrtc = "0.9"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Utilities
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
```

### Clients (TypeScript)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "zustand": "^4.5.0",
    "axios": "^1.6.0",
    "ws": "^8.16.0"
  }
}
```

---

## File Size Estimates

| Component   | Source Code  | Binary/Bundle         |
| ----------- | ------------ | --------------------- |
| Server      | ~15k LOC     | ~20MB                 |
| Desktop app | ~8k LOC      | ~5MB                  |
| Web client  | ~7k LOC      | ~500KB (gzipped)      |
| Mobile app  | ~7k LOC      | ~15MB (each platform) |
| **Total**   | **~37k LOC** | N/A                   |

**Compare to microservices**: Would be ~50k+ LOC with service coordination overhead.

---

## Scaling Considerations

### Current Architecture (20-500 users)

**Deployment**: Single VPS
**Cost**: $10-40/month
**Complexity**: Low

### If Needed (500-2000 users)

**Add**:

- Redis for sessions/presence
- PostgreSQL read replica
- Separate voice server

**Deployment**: 3-4 VPS
**Cost**: $100-200/month
**Complexity**: Medium

### If Needed (2000+ users)

**Migrate to**:

- Multiple server instances (horizontal scaling)
- ScyllaDB for messages
- Service mesh

**Deployment**: Kubernetes
**Cost**: $500+/month
**Complexity**: High

**For 20 users**: Stay at "Current Architecture" indefinitely.

---

## Security Boundaries

### External (Public Internet)

- HTTPS/WSS only (TLS termination at NGINX)
- Rate limiting at gateway
- Authentication on all routes

### Internal (Within Docker network)

- Server <-> Postgres: Internal Docker network
- No external database access
- Container isolation

### Client Security

- JWT tokens in secure storage
- Password never stored, only sent over HTTPS
- File uploads: Size + type validation

---

## Backup Strategy

### Automated Daily Backups

```bash
# PostgreSQL backup
docker-compose exec postgres pg_dump -U postgres together > backup.sql

# Incremental with timestamps
DATE=$(date +%Y%m%d)
docker-compose exec postgres pg_dump > backups/together_${DATE}.sql

# Compress and encrypt
gzip backups/together_${DATE}.sql
gpg --encrypt backups/together_${DATE}.sql.gz
```

### File Attachments

```bash
# Backup uploads directory
tar -czf backups/uploads_${DATE}.tar.gz data/uploads/
```

### Restoration

```bash
# Restore database
cat backup.sql | docker-compose exec -T postgres psql -U postgres together

# Restore uploads
tar -xzf backups/uploads_${DATE}.tar.gz -C data/
```

---

## Conclusion

This structure provides:

- ✅ Clear separation of concerns (server, clients, docs)
- ✅ Easy navigation (consistent naming, logical grouping)
- ✅ Simple deployment (single binary + Docker)
- ✅ Maintainable codebase (~37k LOC)
- ✅ Room to grow (can split later if needed)

**Philosophy**: Optimize for comprehension and iteration speed, not for hypothetical scale.

# Together Project Structure

## Root Directory

```
Together/
├── CLAUDE.md                      # AI assistant project context
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE                        # AGPL-3.0
├── README.md
├── SECURITY.md
├── .env.example                   # Environment variable template
├── .dockerignore
├── .gitignore
│
├── Dockerfile                     # Server production container
├── Dockerfile.web                 # Web client container
├── docker-compose.yml             # Production deployment
├── docker-compose.dev.yml         # Development (PostgreSQL only)
├── docker-compose.build.yml       # Build configuration
├── nginx.conf                     # Reverse proxy configuration
├── turn.conf                      # TURN server (coturn) configuration
├── turn.conf.example              # TURN config template
│
├── .github/workflows/             # CI/CD pipelines
│   ├── ci.yml                     # Rust + TypeScript CI (fmt, clippy, test, lint, typecheck)
│   ├── claude.yml                 # Claude Code automation
│   ├── docker.yml                 # Docker image builds
│   └── release.yml                # Release packaging
│
├── server/                        # Rust backend
├── clients/                       # Frontend applications
│   ├── web/                       # React + Vite (browser)
│   └── desktop/                   # Tauri v2 + React (desktop & mobile)
├── docs/                          # Project documentation
├── scripts/                       # Utility scripts
├── load-tests/                    # k6 load test suite
├── security-scan/                 # Security tooling
├── assets/                        # Project assets (icon.png, logo.png)
├── certs/                         # TLS certificates
└── data/                          # Runtime data (uploads/)
```

## Server (`server/`)

Single Rust binary built with Axum. Flat module layout with one handler file per domain.

```
server/
├── Cargo.toml
├── Cargo.lock
├── README.md
├── migrations/                    # 44 SQL migrations (sqlx-cli)
│   ├── 20240216000001_users_and_auth.sql
│   ├── 20240216000001_users_and_auth.down.sql
│   ├── ...                        # Named YYYYMMDDNNNNNN_<name>.sql
│   └── 20260320000001_voice_states_user_index.sql
├── tests/                         # Integration tests (sqlx::test with real PostgreSQL)
│   ├── common/mod.rs              # Shared test helpers
│   ├── auth_tests.rs
│   ├── messages_tests.rs
│   ├── channels_tests.rs
│   ├── servers_tests.rs
│   ├── users_tests.rs
│   ├── dm_tests.rs
│   ├── voice_tests.rs
│   ├── search_tests.rs
│   ├── search_scale_tests.rs
│   ├── reactions_tests.rs
│   ├── polls_tests.rs
│   ├── thread_tests.rs
│   ├── mention_tests.rs
│   ├── attachments_tests.rs
│   ├── events_tests.rs
│   ├── read_state_tests.rs
│   ├── link_preview_tests.rs
│   ├── automod_tests.rs
│   ├── custom_emojis.rs
│   └── health_tests.rs
└── src/
    ├── main.rs                    # Server setup, route configuration
    ├── lib.rs                     # Crate root, module declarations
    ├── state.rs                   # AppState (pool, config, connections, rate limiters)
    ├── bot_auth.rs                # Bot token authentication extractor
    ├── webhook_delivery.rs        # Webhook delivery with HMAC-SHA256 signing
    │
    ├── auth/
    │   └── mod.rs                 # JWT, bcrypt, AuthUser extractor
    │
    ├── config/
    │   └── mod.rs                 # AppConfig from environment variables
    │
    ├── db/
    │   └── mod.rs                 # Database pool initialization
    │
    ├── error/
    │   └── mod.rs                 # AppError enum, HTTP status mapping
    │
    ├── models/
    │   ├── mod.rs                 # All database models (sqlx::FromRow) and DTOs
    │   └── link_preview.rs        # Link preview model
    │
    ├── handlers/                  # One file per domain
    │   ├── mod.rs                 # Handler module declarations
    │   ├── auth.rs                # Login, register, refresh, password reset
    │   ├── users.rs               # User profiles, status, settings
    │   ├── servers.rs             # Server CRUD, roles, permissions, invites
    │   ├── channels.rs            # Channel CRUD, categories
    │   ├── messages.rs            # Send, edit, delete, threads
    │   ├── dm.rs                  # Direct message channels and messages
    │   ├── search.rs              # Full-text message search
    │   ├── voice.rs               # Voice state management
    │   ├── go_live.rs             # Screen sharing / Go Live
    │   ├── ice.rs                 # ICE/TURN server credentials endpoint
    │   ├── reactions.rs           # Message reactions
    │   ├── pins.rs                # Pinned messages
    │   ├── polls.rs               # Message polls
    │   ├── attachments.rs         # File upload and download
    │   ├── bots.rs                # Bot account management
    │   ├── webhooks.rs            # Webhook CRUD
    │   ├── audit.rs               # Audit log queries
    │   ├── automod.rs             # Auto-moderation rules
    │   ├── events.rs              # Server events (scheduled events)
    │   ├── export.rs              # Server data export (ZIP)
    │   ├── custom_emojis.rs       # Custom emoji management
    │   ├── giphy.rs               # Giphy GIF search proxy
    │   ├── link_preview.rs        # Link preview / OG tag extraction
    │   ├── read_states.rs         # Read state tracking
    │   ├── health.rs              # Health check endpoint
    │   └── shared.rs              # Common query helpers
    │
    └── websocket/
        ├── mod.rs
        ├── handler.rs             # WebSocket upgrade, message loop
        ├── events.rs              # GatewayOp enum, event name constants
        └── connection_manager.rs  # In-memory DashMap of active connections
```

### Migrations

44 migration files using sqlx-cli naming convention: `YYYYMMDDNNNNNN_<name>.sql` with matching `.down.sql` rollback files. Covers users, servers, channels, messages, voice, DMs, reactions, read states, mentions, threads, server discovery, polls, events, pinned messages, bots, automod, audit logs, password reset, admin flag, video, user profiles, custom emojis, webhooks, rich presence, and voice state indexes.

### Key Rust Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| axum | 0.7 | Web framework (ws, macros, multipart) |
| tokio | 1 | Async runtime |
| sqlx | 0.7 | PostgreSQL driver (with migrate, uuid, chrono, json) |
| serde / serde_json | 1 | Serialization |
| tower / tower-http | 0.4 / 0.5 | Middleware (CORS, tracing, static files) |
| governor / tower_governor | 0.6 / 0.4 | Rate limiting (DashMap-backed) |
| jsonwebtoken | 9 | JWT authentication |
| bcrypt | 0.15 | Password hashing |
| uuid | 1 | UUID generation and serde support |
| chrono | 0.4 | Date/time handling |
| reqwest | 0.11 | HTTP client (link previews, Giphy) |
| scraper | 0.19 | HTML parsing for OG tag extraction |
| validator | 0.16 | Input validation with derive macros |
| tracing / tracing-subscriber | 0.1 / 0.3 | Structured logging |
| axum-prometheus | 0.7 | Prometheus metrics |
| hmac / sha1 | 0.12 / 0.10 | TURN credential generation |
| sha2 | 0.10 | SHA-256 for refresh token hashing |
| zip | 2 | Server data export archives |
| infer | 0.16 | MIME type detection for uploads |

## Web Client (`clients/web/`)

React 18 SPA built with Vite. CSS Modules for styling. Zustand for state management.

```
clients/web/
├── package.json
├── index.html
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── tsconfig.node.json
└── src/
    ├── main.tsx                   # Entry point
    ├── App.tsx                    # Root component, routing
    │
    ├── api/
    │   ├── client.ts              # REST API client
    │   └── websocket.ts           # WebSocket gateway client
    │
    ├── components/
    │   ├── auth/
    │   │   └── AuthForm.tsx       # Login / register form
    │   ├── layout/
    │   │   ├── AppLayout.tsx      # Main app shell
    │   │   ├── ServerSidebar.tsx   # Server icon list
    │   │   ├── ChannelSidebar.tsx  # Channel list within a server
    │   │   └── MemberSidebar.tsx   # Member list panel
    │   ├── messages/
    │   │   ├── ChatArea.tsx       # Message view container
    │   │   ├── MessageList.tsx    # Scrollable message list
    │   │   ├── MessageItem.tsx    # Single message rendering
    │   │   ├── MessageInput.tsx   # Composer with attachments
    │   │   ├── DateSeparator.tsx
    │   │   ├── EmojiPicker.tsx
    │   │   ├── EmojiAutocomplete.tsx
    │   │   ├── GifPicker.tsx
    │   │   ├── LinkPreview.tsx
    │   │   ├── MentionAutocomplete.tsx
    │   │   ├── ReactionBar.tsx
    │   │   ├── PinnedMessages.tsx
    │   │   ├── ThreadPanel.tsx
    │   │   ├── PollCard.tsx
    │   │   ├── PollForm.tsx
    │   │   ├── EventCard.tsx
    │   │   ├── EventForm.tsx
    │   │   └── SlashCommandPicker.tsx
    │   ├── voice/
    │   │   ├── VoiceChannel.tsx   # Voice channel UI
    │   │   ├── VideoGrid.tsx      # Video participant grid
    │   │   ├── VideoTile.tsx      # Single video tile
    │   │   └── GoLiveViewer.tsx   # Screen share viewer
    │   ├── dm/
    │   │   ├── DMSidebar.tsx      # DM conversation list
    │   │   └── DMConversation.tsx # DM message view
    │   ├── servers/
    │   │   ├── CreateServerModal.tsx
    │   │   ├── BrowseServersModal.tsx
    │   │   ├── ServerSettingsModal.tsx
    │   │   ├── BotManager.tsx
    │   │   ├── WebhookManager.tsx
    │   │   ├── AutomodSettings.tsx
    │   │   └── CustomEmojiManager.tsx
    │   ├── channels/
    │   │   ├── CreateChannelModal.tsx
    │   │   └── EditChannelModal.tsx
    │   ├── users/
    │   │   ├── UserPanel.tsx
    │   │   ├── UserProfileCard.tsx
    │   │   ├── UserSettingsModal.tsx
    │   │   ├── StatusMenu.tsx
    │   │   └── AdminTab.tsx
    │   ├── search/
    │   │   └── SearchModal.tsx
    │   ├── moderation/
    │   │   └── AutoModModal.tsx
    │   ├── desktop/
    │   │   └── ServerSetup.tsx    # First-run server setup
    │   ├── common/
    │   │   ├── Modal.tsx
    │   │   ├── ContextMenu.tsx
    │   │   └── ErrorBoundary.tsx
    │   └── ErrorBoundary.tsx      # Top-level error boundary
    │
    ├── hooks/
    │   ├── useWebSocket.ts        # WebSocket connection management
    │   ├── useWebRTC.ts           # P2P voice/video
    │   ├── usePushToTalk.ts       # Push-to-talk keybinding
    │   ├── useGoLive.ts           # Screen sharing
    │   ├── useTypingIndicator.ts  # Typing status
    │   ├── useFocusTrap.ts        # Accessibility focus trap
    │   └── useMobileLayout.ts     # Responsive layout detection
    │
    ├── stores/                    # Zustand state stores
    │   ├── authStore.ts
    │   ├── serverStore.ts
    │   ├── channelStore.ts
    │   ├── messageStore.ts
    │   ├── dmStore.ts
    │   ├── voiceStore.ts
    │   ├── voiceSettingsStore.ts
    │   ├── typingStore.ts
    │   ├── readStateStore.ts
    │   ├── autoModStore.ts
    │   └── customEmojiStore.ts
    │
    ├── types/
    │   ├── index.ts               # All TypeScript type definitions
    │   └── globals.d.ts           # Global type augmentations
    │
    ├── utils/
    │   ├── emoji.ts               # Emoji parsing and rendering
    │   ├── markdown.ts            # Markdown rendering
    │   ├── links.ts               # URL detection and formatting
    │   ├── formatTime.ts          # Date/time formatting
    │   ├── formatBytes.ts         # File size formatting
    │   ├── slashCommands.ts       # Slash command definitions
    │   ├── iceCache.ts            # ICE server credential caching
    │   └── tauri.ts               # Tauri platform detection
    │
    ├── styles/
    │   └── globals.css            # Global styles
    │
    └── __tests__/                 # Vitest test suite (30 test files)
        ├── setup.ts               # Test setup (jsdom)
        ├── api-client.test.ts
        ├── auth-form.test.tsx
        ├── channel-store.test.ts
        ├── dm-store.test.ts
        ├── message-store.test.ts
        ├── server-store.test.ts
        ├── voice-store.test.ts
        ├── voice-settings-store.test.ts
        ├── useWebRTC.test.ts
        ├── usePushToTalk.test.ts
        ├── emoji-picker.test.tsx
        ├── emoji.test.ts
        ├── markdown.test.ts
        ├── links.test.ts
        ├── format-time.test.ts
        ├── link-preview.test.tsx
        ├── mention-autocomplete.test.ts
        ├── mention-autocomplete-component.test.tsx
        ├── message-input-mention.test.tsx
        ├── modal.test.tsx
        ├── video-tile.test.tsx
        ├── server-setup.test.tsx
        ├── slash-command-picker.test.tsx
        ├── slashCommands.test.ts
        ├── AdminTab.test.tsx
        ├── automod-settings.test.tsx
        ├── customEmojiStore.test.ts
        └── user-settings-modal.test.tsx
```

### Key Frontend Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| react / react-dom | ^18.3.1 | UI framework |
| react-router-dom | ^6.26.0 | Client-side routing |
| zustand | ^4.5.4 | State management |
| date-fns | ^3.6.0 | Date formatting |
| dompurify | ^3.3.3 | HTML sanitization |
| lucide-react | ^0.575.0 | Icon library |
| vite | ^5.4.21 | Build tool |
| vitest | ^2.1.9 | Test runner |
| typescript | ~5.5.4 | Type checking |
| @testing-library/react | ^16.0.0 | Component testing |

## Desktop Client (`clients/desktop/`)

Tauri v2 wrapper that loads the web client source. Supports desktop (macOS, Windows, Linux) and mobile (Android, iOS) targets from the same project.

```
clients/desktop/
├── package.json                   # Tauri CLI dependency
└── src-tauri/
    ├── Cargo.toml                 # Tauri Rust dependencies
    ├── Cargo.lock
    ├── build.rs
    ├── tauri.conf.json            # Tauri configuration
    ├── capabilities/
    │   └── default.json           # Permission capabilities
    ├── icons/                     # App icons (all sizes)
    ├── src/
    │   ├── main.rs                # Tauri entry point
    │   └── lib.rs                 # Tauri commands
    └── gen/
        ├── android/               # Generated Android project (Kotlin)
        └── apple/                 # Generated iOS/macOS project (Swift)
```

## Scripts (`scripts/`)

```
scripts/
├── README.md
├── setup-dev.sh                   # Development environment setup
├── migrate.sh                     # Database migration runner
├── backup.sh                      # Database backup (incremental)
├── backup-full.sh                 # Full database + uploads backup
├── restore.sh                     # Backup restoration
├── setup-android-keystore.sh      # Android signing key generation
└── setup-gpg-signing.sh           # GPG signing setup for releases
```

## Load Tests (`load-tests/`)

k6 load test scripts for validating performance at scale.

```
load-tests/
├── config.js                      # Test configuration
├── setup.js                       # Test data seeding
├── run-all.sh                     # Run full test suite
├── test-http.js                   # HTTP endpoint load tests
├── test-websocket.js              # WebSocket connection tests
├── test-voice.js                  # Voice signaling tests
└── results/                       # Test result output
```

## Documentation (`docs/`)

```
docs/
├── architecture.md                # System design overview
├── project-structure.md           # This file
├── websocket-protocol.md          # Gateway protocol specification
├── openapi.yaml                   # REST API specification
├── self-hosting.md                # Self-hosting guide
├── backup-restore.md              # Backup and restore procedures
├── release-roadmap.md             # Release planning
├── signing-setup.md               # Code signing documentation
├── together-signing-public.asc    # GPG public key for verification
│
├── bot-api.md                     # Bot API documentation
├── audit-logging.md               # Audit log system
├── auto-moderation.md             # Auto-moderation rules
├── message-search.md              # Full-text search
├── message-editing-deletion.md    # Message edit/delete behavior
├── message-pinning.md             # Pinned messages
├── presence-status.md             # User presence and status
├── server-discovery.md            # Public server discovery
├── channel-categories.md          # Channel categories
├── screen-sharing.md              # Screen sharing / Go Live
├── ios-voice.md                   # iOS voice implementation notes
│
└── superpowers/                   # Feature design specs
```

# Together

A private, non-federated Discord alternative built for gaming communities who want ownership of their communication platform.

## 🎯 Vision

Together is designed for gaming groups, clans, and communities who are tired of Discord's:
- **Privacy concerns** - Your data, your rules
- **Platform risk** - No more worrying about sudden bans or policy changes
- **Feature bloat** - Just the essentials that gaming groups actually use
- **Closed ecosystem** - Full control over your community's platform

> **Key Principle**: Together is NOT federated. It's designed for private, self-hosted instances where communities own their infrastructure.

## 📋 Quick Overview

| Feature | Status | Priority |
|---------|--------|----------|
| Text Channels | 🚧 Planned | P0 - MVP |
| Voice Channels (WebRTC) | 🚧 Planned | P0 - MVP |
| Role-Based Permissions | 🚧 Planned | P0 - MVP |
| User Presence/Status | 🚧 Planned | P0 - MVP |
| Direct Messages | 🚧 Planned | P1 |
| Emoji Reactions | 🚧 Planned | P1 |
| File Attachments | 🚧 Planned | P1 |
| Message Threading | 🚧 Planned | P2 |
| Screen Sharing | 🚧 Planned | P2 |
| Discord Bridge/Sync | 🚧 Planned | P3 - Transition |

## 🏗️ Architecture Summary

```
┌───────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                          │
├──────────────┬──────────────┬──────────────────────────────┤
│   Desktop    │    Web       │   Mobile                     │
│  (Tauri)     │  (React)     │(React Native)                │
└──────┬───────┴──────┬───────┴──────┬────────────────────────┘
       │              │              │
       └──────────────┴──────────────┘
                      │
              WebSocket / HTTPS
                      │
┌──────────────────────────────────────────────────────────────┐
│              TOGETHER SERVER (Rust/Axum)                     │
│                                                              │
│  ┌────────────────────────────────────────────────┐        │
│  │         HTTP/WebSocket Handler                  │        │
│  │  • Authentication (JWT)                         │        │
│  │  • Rate limiting                                │        │
│  │  • Connection management                        │        │
│  └──────────────────┬─────────────────────────────┘        │
│                     │                                       │
│     ┌───────────────┼───────────────┐                      │
│     ▼               ▼               ▼                      │
│  ┌────────┐   ┌─────────┐   ┌──────────────┐             │
│  │  Chat  │   │  Users  │   │ Voice (WebRTC)│             │
│  │ Module │   │ Module  │   │   SFU Module  │             │
│  └────────┘   └─────────┘   └──────────────┘             │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │  PostgreSQL    │
              │                │
              │  • Users/Auth  │
              │  • Messages    │
              │  • Channels    │
              │  • Sessions    │
              └────────────────┘
```

## 📁 Project Structure

```
Together/
├── README.md                  # This file
├── LICENSE                    # Project license
├── docker-compose.yml         # Single-command deployment
├── docs/                      # Documentation
│   ├── architecture.md        # Detailed architecture
│   ├── roadmap.md             # Implementation roadmap
│   ├── discord-analysis.md    # Discord feature analysis
│   └── api/                   # API documentation
├── server/                    # Rust backend (single binary)
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs            # Entry point
│   │   ├── auth/              # Authentication
│   │   ├── chat/              # Chat logic
│   │   ├── voice/             # WebRTC voice
│   │   ├── users/             # User management
│   │   ├── websocket/         # WebSocket handling
│   │   ├── models/            # Data models
│   │   └── db/                # Database operations
│   └── migrations/            # SQL migrations
├── clients/                   # Client applications
│   ├── desktop/               # Tauri desktop app
│   ├── mobile/                # React Native app
│   └── web/                   # Web client
└── tools/                     # Utilities
    └── discord-bridge/        # Discord sync tool
```

## 🚀 Getting Started

### Self-Hosting (5 minutes)

```bash
# Clone the repository
git clone https://github.com/yourusername/together.git
cd together

# Configure environment
cp .env.example .env
# Edit .env with your settings (JWT_SECRET, etc.)

# Start server and database
docker-compose up -d

# Create first admin user
docker-compose exec server together-cli create-admin

# Access at http://localhost:8080
```

### Desktop Client Development

```bash
cd clients/desktop
npm install
npm run tauri dev
```

### Server Development

```bash
cd server
cargo run
# Server runs on http://localhost:8080
```

## 🛠️ Tech Stack

| Component | Technology | Reason |
|-----------|------------|--------|
| **Desktop** | Tauri + React | Tiny bundles (~5MB), native performance |
| **Mobile** | React Native | Cross-platform, Discord-proven |
| **Web** | React + Vite | Fast, familiar, easy to deploy |
| **Backend** | Rust + Axum | Memory safety, async performance |
| **Voice** | Pion WebRTC | Pure Rust WebRTC stack |
| **Database** | PostgreSQL 16 | Reliable, feature-rich, handles millions of messages |
| **WebSockets** | Tokio + Axum | High-performance async I/O |
| **Deployment** | Docker Compose | Simple, reproducible, single-command |

## 📊 Comparison with Alternatives

| Feature | Together | Revolt | Matrix/Element |
|---------|----------|--------|----------------|
| Self-hosted | ✅ First-class | ✅ Yes | ✅ Yes |
| Federation | ❌ No (by design) | ❌ No | ✅ Yes |
| Voice Quality | 🎯 Priority | ⚠️ Basic | ⚠️ Varies |
| Mobile Apps | 🎯 Native | ⚠️ Beta | ✅ Yes |
| Discord-like UX | 🎯 Priority | ✅ Yes | ❌ Different |
| Deployment | 🎯 Single binary | ⚠️ Multiple services | ⚠️ Complex |
| Setup Time | 🎯 5 minutes | ~30 minutes | ~1 hour |
| Memory Usage | 🎯 <200MB | ~500MB | ~1GB+ |

## 📝 Documentation

- **[Architecture](docs/architecture.md)** - System design and technical decisions
- **[Roadmap](docs/roadmap.md)** - Phased implementation plan
- **[Discord Feature Analysis](docs/discord-analysis.md)** - What we're copying vs skipping
- **[Research Notes](docs/research-notes.md)** - What we learned from Revolt, Discord, others

## 🤝 Contributing

This project is in the planning phase. Once development begins:

1. Check the [roadmap](docs/roadmap.md) for current priorities
2. Read the [architecture doc](docs/architecture.md) for technical context
3. Join discussions in GitHub Issues

## 📜 License

[AGPL-3.0](LICENSE) - Keeping this open and self-hostable forever.

## 🙏 Acknowledgments

- Inspired by Discord's excellent UX
- Learned from Revolt's open-source journey
- WebRTC implementation using Pion
- Architecture philosophy: Start simple, scale when needed

---

**Together**: *Your community. Your platform. No compromises.*

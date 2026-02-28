# Together

<p align="center">
  <img src="assets/logo.png" alt="Together" width="480" />
</p>

**A self-hosted Discord alternative for small gaming communities.**

Own your platform. No data sold, no surprise bans, no feature bloat — just a fast, private chat
server you control.

> **Pre-production software.** Together is at version 0.0.1 and has not been independently
> security-audited. Self-hosting is at your own risk. See [SECURITY.md](SECURITY.md) for the
> full disclaimer.

---

## Who Is This For?

Together is designed for small, **private** communities of **20–500 people** — gaming groups,
friend circles, small clubs — who want to own their communication platform instead of depending
on a commercial service.

It is **not** a federation protocol (like Matrix/Element) and is **not** designed to scale to
thousands of users out of the box. If that's what you need, consider Mastodon, Matrix, or
Rocket.Chat instead.

---

## Features

| Feature | Status |
|---|---|
| Servers, channels, roles & permissions | ✅ |
| Real-time text chat with threads | ✅ |
| Direct messages | ✅ |
| Voice channels (WebRTC SFU) | ✅ |
| File & image uploads (up to 50 MB) | ✅ |
| Emoji reactions, polls, server events | ✅ |
| GIF picker (Giphy integration) | ✅ |
| Slash commands & Discord-style markdown | ✅ |
| Desktop app (Tauri — macOS, Windows, Linux) | ✅ |
| Web app (any browser) | ✅ |
| Mobile app (Tauri — Android & iOS) | ✅ |
| Link previews | ✅ |
| Rate limiting & basic security hardening | ✅ |

---

## Quick Start (Docker)

```bash
git clone https://github.com/jtjenkins/Together.git
cd Together

# Generate a strong secret for signing JWTs
openssl rand -hex 32

# Configure your environment
cp .env.example .env
# Edit .env — set POSTGRES_PASSWORD and paste your JWT_SECRET

# Start everything
docker compose up -d
```

Verify it's running:

```bash
curl http://localhost/api/health
# {"status":"ok","service":"together-server","version":"0.1.0","database":"ok"}
```

Open **http://localhost** in a browser and create your first account.
The first account you register becomes the server administrator.

For a complete guide covering TLS, backups, upgrades, and firewall configuration, see
**[docs/self-hosting.md](docs/self-hosting.md)**.

---

## Architecture

Together is a **single Rust binary** backed by PostgreSQL — no microservices, no message
queues, no Redis required.

```
Clients (Desktop · Web · Mobile)
          │  HTTPS / WebSocket
          ▼
  Together Server (Rust/Axum)
  ├── REST API  (auth, servers, channels, messages, files, polls, events)
  ├── WebSocket gateway  (real-time MESSAGE_CREATE, PRESENCE_UPDATE, etc.)
  └── WebRTC signaling relay  (voice channel coordination)
          │
          ▼
     PostgreSQL 16
```

**Target scale:** 20–500 users, <50 ms message delivery, <200 MB RAM.

The monolithic design keeps hosting costs low (~$20/month on a small VPS), deployment simple
(one `docker compose up`), and the codebase approachable for contributors.

---

## Client Setup (Development)

### Web (React + Vite)

```bash
cd clients/web
npm install
npm run dev
# Opens at http://localhost:5173 (proxies /api → http://localhost:8080 via vite.config.ts)
```

### Desktop (Tauri)

```bash
cd clients/desktop
npm install
npm run tauri dev
# Enter your server URL on first launch
```

### Mobile (Tauri v2 — Android & iOS)

The mobile clients share the same React frontend as the web app, served via Tauri's WebView.

```bash
# Android emulator
cd clients/desktop
npm run tauri android dev

# iOS simulator (macOS + Xcode required)
npm run tauri ios dev
```

> **iOS voice note:** WKWebView on iOS requires a TURN server (coturn) for voice channels to
> work. See [docs/ios-voice.md](docs/ios-voice.md) for setup instructions.

---

## Development

### Backend (Rust)

```bash
# Start the dev database (PostgreSQL, port bound to 127.0.0.1)
docker compose -f docker-compose.dev.yml up -d

cd server
cp .env.example .env    # set POSTGRES_PASSWORD and JWT_SECRET

~/.cargo/bin/cargo run  # starts on http://localhost:8080
~/.cargo/bin/cargo test # runs all integration tests
```

### Web client

```bash
cd clients/web
npm test          # interactive
npm test -- --run # single pass
npm run lint
npx tsc --noEmit
```

For the full contribution guide (code style, PR process, project structure), see
**[CONTRIBUTING.md](CONTRIBUTING.md)**.

---

## Documentation

| Document | Description |
|---|---|
| [docs/self-hosting.md](docs/self-hosting.md) | Full deployment guide (TLS, backup, upgrade) |
| [docs/openapi.yaml](docs/openapi.yaml) | OpenAPI 3.1 spec for all REST endpoints |
| [docs/websocket-protocol.md](docs/websocket-protocol.md) | WebSocket gateway event reference |
| [docs/architecture.md](docs/architecture.md) | Component design and database schema |
| [docs/ios-voice.md](docs/ios-voice.md) | TURN server setup for iOS voice |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to set up a dev environment and submit PRs |
| [SECURITY.md](SECURITY.md) | Security policy and pre-production disclaimer |

---

## How This Project Was Built

Together was built using **[Claude Code](https://claude.ai/code)**, an AI coding assistant. The
author has a disability that limits the amount of typing they can do, and Claude Code makes it
possible to write and maintain a project of this scope. Every design decision, architectural
choice, and code review was guided by a software engineer.

If you're curious about this development approach, or you use assistive tools yourself, you're
very welcome here. See [CONTRIBUTING.md](CONTRIBUTING.md) for more.

---

## License

**[PolyForm Noncommercial License 1.0.0](LICENSE)**

You may self-host Together for free for any non-commercial purpose. You may not sell Together
or use it to generate revenue for a third party. The author retains all commercial rights.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All skill levels welcome.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be kind.

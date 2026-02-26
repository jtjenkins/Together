# Together

**Self-hosted Discord alternative for small gaming communities.**

Own your platform. No data sold, no surprise bans, no feature bloat — just a fast, private chat
server you control.

---

## Status

All 7 development phases are complete.

| Feature                          | Status |
| -------------------------------- | ------ |
| Authentication (JWT + bcrypt)    | ✅     |
| Servers & Channels               | ✅     |
| Text Chat (with pagination)      | ✅     |
| Voice (WebRTC SFU)               | ✅     |
| File Uploads (up to 50 MB)       | ✅     |
| Desktop App (Tauri + React)      | ✅     |
| Web App (React + Vite)           | ✅     |
| Mobile App (React Native / Expo) | ✅     |

---

## Quick Start

```bash
git clone https://github.com/yourusername/together.git
cd together

cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD and generate a JWT_SECRET with:
#   openssl rand -hex 32

docker compose up -d
```

Verify it's running:

```bash
curl http://localhost:8080/health
# {"status":"ok","service":"together-server","version":"0.1.0","database":"ok"}
```

See **[docs/self-hosting.md](docs/self-hosting.md)** for the full deployment guide, including
backup, restore, TLS, and upgrade instructions.

---

## Architecture

Together is a **single Rust binary** backed by PostgreSQL — no microservices, no message queues,
no Redis.

```
Clients (Desktop · Web · Mobile)
          │  HTTPS / WebSocket
          ▼
  Together Server (Rust/Axum)
  ├── REST API (auth, servers, channels, messages, files, voice)
  ├── WebSocket gateway (real-time events)
  └── WebRTC signaling relay (voice)
          │
          ▼
     PostgreSQL 16
```

Target scale: **20–500 users**, <50 ms message delivery, <200 MB RAM. The architecture has a clear
migration path to horizontal scaling if your community grows beyond that.

---

## Clients

### Desktop (Tauri + React)

```bash
cd clients/desktop
npm install
npm run tauri dev
```

On first launch, enter your server URL (e.g. `http://localhost:8080`).

### Web (React + Vite)

```bash
cd clients/web
npm install
VITE_API_URL=http://localhost:8080 npm run dev
```

### Mobile (Expo / React Native)

```bash
cd clients/mobile
npm install
npm run ios      # iOS simulator
npm run android  # Android emulator
```

The app prompts for a server URL on first launch.

---

## Development

### Server (Rust)

```bash
cd server

# Start the dev database
docker compose -f ../docker-compose.dev.yml up -d

# Copy and edit server-specific env
cp .env.example .env

# Run the server (auto-reloads with cargo-watch)
~/.cargo/bin/cargo run

# Run tests
~/.cargo/bin/cargo test

# Lint
SQLX_OFFLINE=true ~/.cargo/bin/cargo clippy -- -D warnings
```

### Web client

```bash
cd clients/web
npm test
npm run lint
```

### Mobile client

```bash
cd clients/mobile
npm test
```

---

## Deployment

Full self-hosting guide: **[docs/self-hosting.md](docs/self-hosting.md)**

Covers: prerequisites, environment configuration, TLS, backup/restore, upgrades, and log
management.

---

## API Reference

OpenAPI 3.1 spec: **[docs/openapi.yaml](docs/openapi.yaml)**

All endpoints, request/response schemas, authentication requirements, and error shapes are
documented there. Import into Swagger UI, Insomnia, or Postman.

---

## WebSocket Protocol

Gateway protocol reference: **[docs/websocket-protocol.md](docs/websocket-protocol.md)**

Covers: connection lifecycle, message envelope format, all event types, voice signaling flow, and
reconnection guidance.

---

## License

[AGPL-3.0](LICENSE) — self-hostable forever.

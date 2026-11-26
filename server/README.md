# Together Server

Monolithic Rust backend for Together - a private Discord alternative.

## Development Setup

### Prerequisites

- Rust 1.94+ (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Docker and Docker Compose
- sqlx-cli (`cargo install sqlx-cli --version ~0.9 --no-default-features --features postgres`)

### Quick Start

```bash
# 1. Start PostgreSQL
docker-compose -f ../docker-compose.dev.yml up -d

# 2. Set up environment
cp .env.example .env

# 3. Run migrations
sqlx database create
sqlx migrate run

# 4. Run server
cargo run
```

### Development Commands

```bash
# Run with auto-reload (install cargo-watch)
cargo watch -x run

# Run tests
cargo test

# Check code without building
cargo check

# Format code
cargo fmt

# Lint code
cargo clippy
```

## Project Structure

```
server/
├── src/
│   ├── main.rs          # Entry point
│   ├── auth/            # Authentication (JWT, bcrypt)
│   ├── chat/            # Chat logic
│   ├── users/           # User management
│   ├── servers/         # Server management
│   ├── voice/           # WebRTC voice
│   ├── websocket/       # WebSocket gateway
│   ├── models/          # Database models
│   ├── db/              # Database operations
│   └── utils/           # Utilities
├── migrations/          # SQL migrations
└── tests/               # Integration tests
```

## Database Migrations

Migrations are managed with sqlx-cli:

```bash
# Create new migration
sqlx migrate add <name>

# Run migrations
sqlx migrate run

# Revert last migration
sqlx migrate revert

# Check migration status
sqlx migrate info
```

## Current Status

**Phase 1: Database Foundation** ✅

- PostgreSQL 16 setup
- Complete schema with migrations
- Seed data for development

**Phase 2: Core Backend** 🚧 (Next)

- REST API implementation
- JWT authentication
- Basic CRUD operations

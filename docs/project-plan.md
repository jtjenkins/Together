# Together Project Plan - Back to Front

## Development Philosophy

**Build from the foundation up**: Database → Backend API → UI Clients

This approach ensures:

- Solid data model before writing business logic
- Complete API before building UIs
- Each layer can be tested independently
- Clear contracts between layers

---

## Timeline Overview

| Phase                            | Duration   | Focus                     | Deliverable                 |
| -------------------------------- | ---------- | ------------------------- | --------------------------- |
| **Phase 1: Database Foundation** | Week 1     | Schema design, migrations | Working PostgreSQL database |
| **Phase 2: Core Backend**        | Week 2-3   | Auth, basic CRUD          | REST API functional         |
| **Phase 3: Real-Time Backend**   | Week 4-5   | WebSocket, chat           | Real-time messaging works   |
| **Phase 4: Voice Backend**       | Week 6-7   | WebRTC SFU                | Voice channels work         |
| **Phase 5: Desktop UI**          | Week 8-10  | Tauri app                 | Desktop client complete     |
| **Phase 6: Web UI**              | Week 11-12 | React web app             | Web client complete         |
| **Phase 7: Mobile UI**           | Week 13-14 | React Native              | Mobile apps complete        |

**Total**: 14 weeks to full v1.0

---

# Phase 1: Database Foundation (Week 1)

## Goal

Complete, tested PostgreSQL schema ready for all features

## Tasks

### 1.1 Environment Setup

**Duration**: 1 day

- [ ] Install PostgreSQL 16 locally
- [ ] Create `docker-compose.dev.yml` for development
- [ ] Set up database connection configuration
- [ ] Create `.env.example` with database credentials

**Deliverable**:

```bash
docker-compose -f docker-compose.dev.yml up -d
# PostgreSQL running on localhost:5432
```

### 1.2 Migration System Setup

**Duration**: 1 day

- [ ] Choose migration tool (sqlx-cli or diesel-cli)
- [ ] Create `migrations/` directory
- [ ] Set up migration runner
- [ ] Create initial migration: `000_init.sql`

**Deliverable**:

```bash
cargo install sqlx-cli --no-default-features --features postgres
sqlx database create
sqlx migrate run
```

### 1.3 Core Schema - Users & Auth

**Duration**: 1 day

**Migration**: `001_users_and_auth.sql`

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'away', 'dnd', 'offline')),
    custom_status TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- Sessions table
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**Acceptance**:

- [ ] Can create user
- [ ] Can create session
- [ ] Unique constraints work
- [ ] Indexes exist

### 1.4 Core Schema - Servers & Channels

**Duration**: 1 day

**Migration**: `002_servers_and_channels.sql`

```sql
-- Servers (guilds)
CREATE TABLE servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    icon_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_servers_owner ON servers(owner_id);

-- Server members
CREATE TABLE server_members (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    nickname TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, server_id)
);

CREATE INDEX idx_server_members_server ON server_members(server_id);
CREATE INDEX idx_server_members_user ON server_members(user_id);

-- Channels
CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('text', 'voice')),
    category TEXT,
    position INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_channels_server ON channels(server_id);
CREATE INDEX idx_channels_position ON channels(server_id, position);

-- Trigger for server updated_at
CREATE TRIGGER update_servers_updated_at
    BEFORE UPDATE ON servers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

**Acceptance**:

- [ ] Can create server
- [ ] Can add members
- [ ] Can create channels
- [ ] Cascading deletes work

### 1.5 Roles & Permissions Schema

**Duration**: 1 day

**Migration**: `003_roles_and_permissions.sql`

```sql
-- Roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    permissions BIGINT NOT NULL DEFAULT 0,
    color TEXT,
    position INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_roles_server ON roles(server_id);
CREATE INDEX idx_roles_position ON roles(server_id, position);

-- Member roles (many-to-many)
CREATE TABLE member_roles (
    user_id UUID NOT NULL,
    server_id UUID NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, server_id, role_id),
    FOREIGN KEY (user_id, server_id) REFERENCES server_members(user_id, server_id) ON DELETE CASCADE
);

CREATE INDEX idx_member_roles_user_server ON member_roles(user_id, server_id);

-- Channel permission overrides
CREATE TABLE channel_permission_overrides (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    allow BIGINT NOT NULL DEFAULT 0,
    deny BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, COALESCE(role_id, user_id)),
    CHECK ((role_id IS NOT NULL AND user_id IS NULL) OR (role_id IS NULL AND user_id IS NOT NULL))
);

CREATE INDEX idx_channel_perms_channel ON channel_permission_overrides(channel_id);
```

**Acceptance**:

- [ ] Can create roles with permissions
- [ ] Can assign roles to members
- [ ] Can set channel overrides
- [ ] Permission bitfield stored correctly

### 1.6 Messages Schema

**Duration**: 1 day

**Migration**: `004_messages.sql`

```sql
-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    reply_to UUID REFERENCES messages(id) ON DELETE SET NULL,
    edited_at TIMESTAMPTZ,
    deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Critical indexes for message pagination
CREATE INDEX idx_messages_channel_time
    ON messages(channel_id, created_at DESC)
    WHERE deleted = FALSE;

CREATE INDEX idx_messages_author
    ON messages(author_id, created_at DESC)
    WHERE deleted = FALSE;

-- Full-text search index
CREATE INDEX idx_messages_search
    ON messages USING GIN(to_tsvector('english', content))
    WHERE deleted = FALSE;

-- Reactions
CREATE TABLE reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON reactions(message_id);

-- Attachments
CREATE TABLE attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_message ON attachments(message_id);
```

**Acceptance**:

- [ ] Can insert messages efficiently
- [ ] Can paginate messages (before/after)
- [ ] Full-text search works
- [ ] Can add reactions and attachments

### 1.7 Voice Schema

**Duration**: 1 day

**Migration**: `005_voice.sql`

```sql
-- Voice states
CREATE TABLE voice_states (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    self_mute BOOLEAN DEFAULT FALSE,
    self_deaf BOOLEAN DEFAULT FALSE,
    server_mute BOOLEAN DEFAULT FALSE,
    server_deaf BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX idx_voice_states_channel ON voice_states(channel_id);
```

**Acceptance**:

- [ ] Can track voice channel membership
- [ ] Can query who's in a channel efficiently

### 1.8 Testing & Validation

**Duration**: 1 day

**Tasks**:

- [ ] Write SQL test scripts for each table
- [ ] Test all foreign key constraints
- [ ] Test cascading deletes
- [ ] Verify index performance with EXPLAIN
- [ ] Create seed data script for development
- [ ] Document schema in `docs/database-schema.md`

**Seed Data Script**: `seeds/dev_data.sql`

```sql
-- Create test users
INSERT INTO users (username, email, password_hash) VALUES
    ('alice', 'alice@example.com', '$2b$12$...'),
    ('bob', 'bob@example.com', '$2b$12$...');

-- Create test server
INSERT INTO servers (name, owner_id) VALUES
    ('Test Server', (SELECT id FROM users WHERE username = 'alice'));

-- Add members and channels...
```

## Phase 1 Deliverables

✅ **Database Schema Complete**:

- All tables created with proper constraints
- Indexes optimized for query patterns
- Cascading deletes configured
- Seed data for development

✅ **Documentation**:

- Entity-Relationship diagram
- Schema documentation
- Migration guide

✅ **Validation**:

- All constraints tested
- Performance verified
- Seed data script works

---

# Phase 2: Core Backend (Week 2-3)

## Goal

REST API with authentication, basic CRUD operations

## 2.1 Project Setup

**Duration**: 1 day

**Tasks**:

- [ ] Initialize Rust project: `cargo init --name together-server`
- [ ] Add dependencies to `Cargo.toml`
- [ ] Create module structure
- [ ] Set up configuration system
- [ ] Create `.env` handling

**Cargo.toml**:

```toml
[package]
name = "together-server"
version = "0.1.0"
edition = "2021"

[dependencies]
# Web framework
axum = "0.7"
tokio = { version = "1", features = ["full"] }
tower = "0.4"
tower-http = { version = "0.5", features = ["cors", "trace"] }

# Database
sqlx = { version = "0.7", features = ["postgres", "runtime-tokio-native-tls", "uuid", "chrono"] }

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Authentication
jsonwebtoken = "9"
bcrypt = "0.15"

# Utilities
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
dotenv = "0.15"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# Validation
validator = { version = "0.16", features = ["derive"] }
```

**Module Structure**:

```rust
// src/main.rs
mod config;
mod auth;
mod models;
mod handlers;
mod db;
mod error;
```

**Deliverable**: `cargo run` compiles and starts server on `http://localhost:8080`

## 2.2 Database Connection

**Duration**: 1 day

**Tasks**:

- [ ] Create `db/mod.rs` with connection pool
- [ ] Add database health check
- [ ] Test connection on startup

```rust
// src/db/mod.rs
use sqlx::PgPool;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPool::connect(database_url).await
}

pub async fn health_check(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").fetch_one(pool).await?;
    Ok(())
}
```

**Acceptance**:

- [ ] Server connects to database on startup
- [ ] Health check passes
- [ ] Graceful error if database unavailable

## 2.3 Models & DTOs

**Duration**: 1 day

**Tasks**:

- [ ] Create model structs matching database schema
- [ ] Create DTO (Data Transfer Object) structs for API
- [ ] Implement conversions between models and DTOs

```rust
// src/models/user.rs
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub password_hash: String,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDto {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
}

impl From<User> for UserDto {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            status: user.status,
            custom_status: user.custom_status,
        }
    }
}
```

**Models to Create**:

- [ ] User, UserDto
- [ ] Server, ServerDto
- [ ] Channel, ChannelDto
- [ ] Message, MessageDto
- [ ] Role, RoleDto

## 2.4 Authentication System

**Duration**: 2 days

**Tasks**:

### JWT Handling

```rust
// src/auth/jwt.rs
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use uuid::Uuid;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,  // user_id
    pub exp: usize, // expiry
    pub iat: usize, // issued at
}

pub fn create_token(user_id: Uuid, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::minutes(15))
        .unwrap()
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id,
        exp: expiration,
        iat: chrono::Utc::now().timestamp() as usize,
    };

    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_ref()))
}

pub fn validate_token(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )
    .map(|data| data.claims)
}
```

### Password Hashing

```rust
// src/auth/password.rs
use bcrypt::{hash, verify, DEFAULT_COST};

pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
    hash(password, DEFAULT_COST)
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
    verify(password, hash)
}
```

### Auth Middleware

```rust
// src/auth/middleware.rs
use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};

pub async fn auth_middleware(
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate token...

    Ok(next.run(request).await)
}
```

**Acceptance**:

- [ ] Can hash passwords with bcrypt
- [ ] Can create JWTs
- [ ] Can validate JWTs
- [ ] Auth middleware rejects invalid tokens

## 2.5 User Endpoints

**Duration**: 2 days

**Endpoints to Implement**:

```rust
// POST /api/auth/register
#[derive(Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(length(min = 3, max = 32))]
    pub username: String,
    #[validate(email)]
    pub email: Option<String>,
    #[validate(length(min = 8))]
    pub password: String,
}

// POST /api/auth/login
#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub user: UserDto,
}

// GET /api/users/@me
// PATCH /api/users/@me
// POST /api/auth/refresh
// POST /api/auth/logout
```

**Database Queries**:

```rust
// src/db/users.rs
use sqlx::PgPool;
use uuid::Uuid;
use crate::models::User;

pub async fn create_user(
    pool: &PgPool,
    username: &str,
    email: Option<&str>,
    password_hash: &str,
) -> Result<User, sqlx::Error> {
    sqlx::query_as!(
        User,
        "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *",
        username,
        email,
        password_hash
    )
    .fetch_one(pool)
    .await
}

pub async fn find_by_username(pool: &PgPool, username: &str) -> Result<Option<User>, sqlx::Error> {
    sqlx::query_as!(
        User,
        "SELECT * FROM users WHERE username = $1",
        username
    )
    .fetch_optional(pool)
    .await
}
```

**Tests**:

- [ ] Register new user succeeds
- [ ] Register duplicate username fails
- [ ] Login with correct password succeeds
- [ ] Login with wrong password fails
- [ ] Protected endpoint requires auth

## 2.6 Server & Channel Endpoints

**Duration**: 2 days

**Endpoints**:

```rust
// Servers
// POST   /api/servers
// GET    /api/servers/:id
// PATCH  /api/servers/:id
// DELETE /api/servers/:id
// GET    /api/servers/:id/members
// POST   /api/servers/:id/members  // Join server
// DELETE /api/servers/:id/members/:user_id

// Channels
// POST   /api/servers/:id/channels
// GET    /api/channels/:id
// PATCH  /api/channels/:id
// DELETE /api/channels/:id
```

**Permission Checks**:

- [ ] Only owner can delete server
- [ ] Members can view channels
- [ ] Check permissions before mutations

## 2.7 Role & Permission System

**Duration**: 2 days

**Permission Bitflags**:

```rust
// src/models/permissions.rs
use bitflags::bitflags;

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
        const MANAGE_ROLES = 1 << 11;
        const MANAGE_SERVER = 1 << 12;
        const ADMINISTRATOR = 1 << 13;
    }
}

pub async fn calculate_permissions(
    pool: &PgPool,
    user_id: Uuid,
    server_id: Uuid,
    channel_id: Option<Uuid>,
) -> Result<Permissions, sqlx::Error> {
    // 1. Check if user is server owner
    // 2. Get user's roles
    // 3. Calculate base permissions from roles
    // 4. Apply channel overrides if channel_id provided
    // 5. Return effective permissions
    todo!()
}
```

**Endpoints**:

```rust
// POST   /api/servers/:id/roles
// PATCH  /api/roles/:id
// DELETE /api/roles/:id
// PUT    /api/servers/:server_id/members/:user_id/roles
```

## 2.8 Testing & Documentation

**Duration**: 1 day

**Integration Tests**:

```rust
// tests/auth_test.rs
#[tokio::test]
async fn test_register_and_login() {
    let app = spawn_app().await;

    // Register
    let response = app.post_register(/* ... */).await;
    assert_eq!(response.status(), 201);

    // Login
    let response = app.post_login(/* ... */).await;
    assert_eq!(response.status(), 200);
    let body: AuthResponse = response.json().await;
    assert!(!body.access_token.is_empty());
}
```

**API Documentation**:

- [ ] Create OpenAPI spec
- [ ] Document all endpoints
- [ ] Add example requests/responses

## Phase 2 Deliverables

✅ **Working REST API**:

- User registration and login
- Server CRUD
- Channel CRUD
- Role management
- Permission system

✅ **Testing**:

- Unit tests for auth
- Integration tests for endpoints
- > 70% code coverage

✅ **Documentation**:

- API documentation
- Setup instructions

---

# Phase 3: Real-Time Backend (Week 4-5)

## Goal

WebSocket gateway with real-time chat

## 3.1 WebSocket Setup

**Duration**: 2 days

**Dependencies**:

```toml
axum = { version = "0.7", features = ["ws"] }
tokio = { version = "1", features = ["sync"] }
```

**Connection Manager**:

```rust
// src/websocket/connection_manager.rs
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

pub struct Connection {
    pub user_id: Uuid,
    pub tx: tokio::sync::mpsc::UnboundedSender<String>,
}

pub struct ConnectionManager {
    connections: Arc<RwLock<HashMap<Uuid, Connection>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn add(&self, user_id: Uuid, tx: tokio::sync::mpsc::UnboundedSender<String>) {
        let mut conns = self.connections.write().await;
        conns.insert(user_id, Connection { user_id, tx });
    }

    pub async fn remove(&self, user_id: Uuid) {
        let mut conns = self.connections.write().await;
        conns.remove(&user_id);
    }

    pub async fn broadcast_to_channel(&self, channel_id: Uuid, message: String) {
        // Get all users subscribed to this channel
        // Send message to each
    }
}
```

**WebSocket Handler**:

```rust
// src/websocket/handler.rs
use axum::{
    extract::{ws::{WebSocket, WebSocketUpgrade}, Query, State},
    response::Response,
};

pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> Response {
    let token = params.get("token").expect("Token required");

    // Validate JWT
    let claims = validate_token(token, &state.config.jwt_secret)
        .expect("Invalid token");

    ws.on_upgrade(|socket| handle_socket(socket, claims.sub, state))
}

async fn handle_socket(socket: WebSocket, user_id: Uuid, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    // Add to connection manager
    state.connections.add(user_id, tx).await;

    // Send READY event
    send_ready_event(&mut sender, user_id, &state).await;

    // Handle incoming messages
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            // Handle message
        }
    });

    // Handle outgoing messages
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            sender.send(Message::Text(msg)).await.ok();
        }
    });

    // Wait for disconnect
    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }

    state.connections.remove(user_id).await;
}
```

**Acceptance**:

- [ ] Client can connect with JWT
- [ ] Receives READY event
- [ ] Heartbeat working
- [ ] Disconnect handled gracefully

## 3.2 Message Events

**Duration**: 2 days

**Event Types**:

```rust
// src/websocket/events.rs
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct GatewayMessage {
    pub op: String,
    pub t: Option<String>,
    pub d: Option<serde_json::Value>,
}

// Events
pub const MESSAGE_CREATE: &str = "MESSAGE_CREATE";
pub const MESSAGE_UPDATE: &str = "MESSAGE_UPDATE";
pub const MESSAGE_DELETE: &str = "MESSAGE_DELETE";
pub const TYPING_START: &str = "TYPING_START";
pub const PRESENCE_UPDATE: &str = "PRESENCE_UPDATE";
```

**Message Handler**:

```rust
async fn handle_message_create(
    pool: &PgPool,
    connections: &ConnectionManager,
    author_id: Uuid,
    channel_id: Uuid,
    content: String,
) -> Result<(), Error> {
    // 1. Check permissions
    // 2. Insert into database
    // 3. Broadcast to all users in channel

    let message = create_message(pool, channel_id, author_id, &content).await?;

    let event = GatewayMessage {
        op: "DISPATCH".to_string(),
        t: Some(MESSAGE_CREATE.to_string()),
        d: Some(serde_json::to_value(message)?),
    };

    connections.broadcast_to_channel(channel_id, serde_json::to_string(&event)?).await;

    Ok(())
}
```

## 3.3 Message REST Endpoints

**Duration**: 1 day

```rust
// POST   /api/channels/:id/messages
// GET    /api/channels/:id/messages?before=&limit=50
// PATCH  /api/messages/:id
// DELETE /api/messages/:id
// POST   /api/messages/:id/reactions
// DELETE /api/messages/:id/reactions/:emoji
```

## 3.4 Presence System

**Duration**: 1 day

**Presence Tracking**:

```rust
// Update user status
pub async fn update_presence(
    pool: &PgPool,
    connections: &ConnectionManager,
    user_id: Uuid,
    status: &str,
    custom_status: Option<&str>,
) -> Result<(), Error> {
    // Update in database
    sqlx::query!(
        "UPDATE users SET status = $1, custom_status = $2 WHERE id = $3",
        status,
        custom_status,
        user_id
    )
    .execute(pool)
    .await?;

    // Broadcast to all servers user is in
    broadcast_presence_update(connections, user_id, status, custom_status).await;

    Ok(())
}
```

## 3.5 File Uploads

**Duration**: 1 day

```rust
// src/handlers/attachments.rs
use axum::extract::Multipart;
use tokio::fs;

pub async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<AttachmentDto>, Error> {
    while let Some(field) = multipart.next_field().await? {
        let name = field.name().unwrap().to_string();

        if name == "file" {
            let filename = field.file_name().unwrap().to_string();
            let data = field.bytes().await?;

            // Validate size and type
            if data.len() > 50 * 1024 * 1024 { // 50MB
                return Err(Error::FileTooLarge);
            }

            // Save to filesystem
            let file_id = Uuid::new_v4();
            let path = format!("data/uploads/{}", file_id);
            fs::write(&path, &data).await?;

            // Store metadata in database
            let attachment = create_attachment(
                &state.pool,
                message_id,
                &filename,
                data.len() as i64,
                &mime_type,
                &path,
            ).await?;

            return Ok(Json(attachment.into()));
        }
    }

    Err(Error::NoFileProvided)
}
```

## Phase 3 Deliverables

✅ **Real-Time Chat**:

- WebSocket connection working
- Message create/update/delete events
- Typing indicators
- Presence updates
- File uploads

✅ **Message History**:

- Pagination working
- Search functional
- Edit/delete working

---

# Phase 4: Voice Backend (Week 6-7)

## Goal

WebRTC SFU for voice channels

## 4.1 WebRTC Setup

**Duration**: 2 days

**Dependencies**:

```toml
webrtc = "0.9"
```

**SFU Manager**:

```rust
// src/voice/sfu.rs
use webrtc::peer_connection::PeerConnection;
use std::collections::HashMap;
use uuid::Uuid;

pub struct VoiceRoom {
    channel_id: Uuid,
    peers: HashMap<Uuid, PeerConnection>,
}

pub struct SfuManager {
    rooms: Arc<RwLock<HashMap<Uuid, VoiceRoom>>>,
}

impl SfuManager {
    pub async fn join_channel(&self, user_id: Uuid, channel_id: Uuid) -> Result<String, Error> {
        // Create peer connection
        // Generate SDP offer
        // Return offer to client
        todo!()
    }

    pub async fn handle_answer(&self, user_id: Uuid, sdp: String) -> Result<(), Error> {
        // Process SDP answer
        // Set up tracks
        todo!()
    }
}
```

## 4.2 Voice Signaling

**Duration**: 2 days

**WebSocket Events**:

```rust
// VOICE_STATE_UPDATE - join/leave channel
// VOICE_SERVER_UPDATE - send SDP offer
// ICE_CANDIDATE - send ICE candidates
```

## 4.3 Voice State Tracking

**Duration**: 1 day

```rust
// Track who's in voice channels
// Track mute/deaf state
// Broadcast state changes
```

## 4.4 TURN Server Setup

**Duration**: 1 day

- [ ] Install coturn
- [ ] Configure STUN/TURN
- [ ] Test NAT traversal

## Phase 4 Deliverables

✅ **Voice Chat Working**:

- Can join/leave voice channels
- Audio transmitted via WebRTC
- Mute/unmute working
- NAT traversal working

---

# Phase 5-7: UI Clients (Week 8-14)

These phases focus on building the user interfaces. Since you specified back-to-front, I've provided the backend foundation first. The UI phases would follow a similar detailed breakdown:

- **Phase 5**: Desktop (Tauri + React)
- **Phase 6**: Web (React + Vite)
- **Phase 7**: Mobile (React Native)

Each would include:

- Component structure
- State management
- API integration
- WebSocket handling
- Voice integration

---

## Next Steps

1. **Start Phase 1**: Set up database schema
2. **Validate**: Test each migration thoroughly
3. **Document**: Keep schema docs updated
4. **Iterate**: Adjust schema based on backend needs

Would you like me to start implementing Phase 1 (Database Foundation)?

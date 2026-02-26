# Implementation Roadmap

## Overview

This roadmap outlines the phased development of Together using a **monolithic architecture** optimized for small communities (20-500 users). Faster development, simpler deployment, lower costs.

**Timeline Estimate**:

- MVP (Phase 1-2): **6-8 weeks** with 1-2 developers
- v1.0 (Phase 3): +4 weeks
- Polish (Phase 4): +2 weeks
- **Total**: ~3-4 months to production-ready

**Why faster than microservices**:

- No service coordination overhead
- Single codebase, single language
- Simpler testing and deployment
- No inter-service communication
- Faster iteration cycles

---

## Phase 0: Foundation (Week 1)

**Goal**: Project setup and development environment

### Tasks

- [ ] Initialize monorepo structure (`server/` and `clients/`)
- [ ] Set up Rust project with Axum
- [ ] Configure PostgreSQL with Docker Compose
- [ ] Create database schema and migrations
- [ ] Set up GitHub Actions CI
- [ ] Define API contracts (REST + WebSocket protocol)
- [ ] Create shared TypeScript types package

### Deliverables

- `server/` compiles and runs (`cargo run`)
- PostgreSQL running with initial schema
- `docker-compose.yml` works locally
- CI pipeline passes

### Exit Criteria

- Developer can run full stack in 2 commands
- Database migrations apply successfully
- Basic health check endpoint works

---

## Phase 1: Core Backend + Auth (Week 2-3)

**Goal**: Working backend with authentication

### Tasks

#### Backend (Rust)

- [ ] User registration with bcrypt password hashing
- [ ] Login with JWT (access + refresh tokens)
- [ ] Logout / session revocation
- [ ] JWT authentication middleware
- [ ] User profile CRUD endpoints
- [ ] Server (guild) CRUD
- [ ] Channel CRUD (text only)
- [ ] Role system with permissions (bitflags)
- [ ] Permission middleware

#### Database

- [ ] Users table with auth fields
- [ ] Servers table
- [ ] Channels table
- [ ] Roles and permissions tables
- [ ] Server membership table

#### Testing

- [ ] Unit tests for auth logic
- [ ] Integration tests for API endpoints
- [ ] Permission system tests

### Deliverables

- Working REST API
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `GET /api/servers`
  - `POST /api/servers`
  - `POST /api/servers/:id/channels`
- Permission checks functional
- Tests passing

### Exit Criteria

- User can register, login, create server
- Permission checks work correctly
- > 70% test coverage

---

## Phase 2: Real-Time Chat (Week 3-5)

**Goal**: Full text chat with real-time updates

### Tasks

#### WebSocket Gateway

- [ ] WebSocket upgrade handler
- [ ] Connection state management (in-memory HashMap)
- [ ] JWT validation on connect
- [ ] Heartbeat/ping-pong
- [ ] IDENTIFY, READY, DISPATCH events
- [ ] Message routing to subscribers
- [ ] Presence tracking (online/offline)
- [ ] Rate limiting (100 msg/min per user)

#### Chat Functionality

- [ ] Messages table with indexes
- [ ] Send message endpoint
- [ ] Get message history (pagination)
- [ ] Edit message
- [ ] Delete message (soft delete)
- [ ] Typing indicators
- [ ] Full-text search (PostgreSQL FTS)
- [ ] File upload/download (filesystem storage)

#### Desktop Client (Tauri)

- [ ] Login/register UI
- [ ] Server list sidebar
- [ ] Channel list
- [ ] Message view (virtualized)
- [ ] Message input with file attachments
- [ ] WebSocket connection handling
- [ ] Auto-reconnect logic
- [ ] Typing indicators UI

### Deliverables

- Real-time chat working end-to-end
- Desktop app functional for text chat
- File uploads working
- Message search working
- Users can @mention others

### Exit Criteria

- Team dogfoods the app for internal communication
- Message delivery < 50ms in same region
- History loads < 100ms for 50 messages
- No critical bugs for 3 days

---

## Phase 3: Voice Chat (Week 6-9)

**Goal**: Working voice channels with good quality

### Tasks

#### Voice Module (WebRTC SFU)

- [ ] WebRTC peer connection management
- [ ] SDP offer/answer exchange (signaling)
- [ ] ICE candidate handling
- [ ] Pion WebRTC integration
- [ ] Opus codec configuration
- [ ] Voice state tracking (DB + in-memory)
- [ ] Mute/deafen logic
- [ ] Voice activity detection (VAD)

#### Infrastructure

- [ ] STUN server configuration
- [ ] TURN server setup (coturn) for NAT traversal
- [ ] UDP port range allocation
- [ ] Voice quality metrics

#### Desktop Client

- [ ] Voice channel UI
- [ ] Voice connection indicator
- [ ] Participant list with avatars
- [ ] Mute/unmute buttons
- [ ] Deafen/undeafen buttons
- [ ] Per-user volume controls
- [ ] Voice activity indicators
- [ ] Audio device selection

### Deliverables

- Join/leave voice channels
- Clear voice communication (64kbps Opus)
- Mute/unmute/deafen working
- Voice quality acceptable for gaming

### Exit Criteria

- Voice latency < 150ms end-to-end
- Packet loss < 2% under normal conditions
- 5-person voice channel stable for 1 hour
- Team uses it for daily standups

---

## Phase 4: Web & Mobile Clients (Week 10-12)

**Goal**: Full cross-platform support

### Tasks

#### Web Client

- [ ] Port desktop UI to web (React + Vite)
- [ ] Responsive layout for desktop/tablet/mobile
- [ ] WebSocket connection in browser
- [ ] WebRTC voice (browser APIs)
- [ ] Service Worker for offline support
- [ ] PWA manifest (installable)
- [ ] Browser notifications

#### Mobile Client (React Native)

- [ ] Navigation structure (React Navigation)
- [ ] Server list screen
- [ ] Channel list screen
- [ ] Chat screen with message list
- [ ] Voice screen
- [ ] Settings screen
- [ ] WebRTC audio (react-native-webrtc)
- [ ] Push notifications (FCM + APNs)
- [ ] Background audio handling

### Deliverables

- Web client at `app.together.yourdomain.com`
- iOS app (TestFlight)
- Android app (internal testing)
- Push notifications working
- Mobile voice functional

### Exit Criteria

- All three clients (desktop/web/mobile) work
- Feature parity for core functionality
- Mobile app daily-usable

---

## Phase 5: Polish & v1.0 (Week 13-14)

**Goal**: Production-ready release

### Tasks

#### Features

- [ ] Emoji reactions (Unicode only)
- [ ] Message threading (optional)
- [ ] User presence (online/away/dnd/offline)
- [ ] Custom status messages
- [ ] Direct messages (DMs)
- [ ] Notification preferences
- [ ] Unread indicators

#### Backend

- [ ] Database connection pooling tuning
- [ ] Query optimization
- [ ] Logging with tracing
- [ ] Metrics endpoints (Prometheus format)
- [ ] Health check with details

#### DevOps

- [ ] Production Docker Compose
- [ ] Automated backups script
- [ ] NGINX reverse proxy config
- [ ] SSL/TLS setup guide
- [ ] systemd service file
- [ ] Deployment documentation

#### Documentation

- [ ] API documentation (OpenAPI spec)
- [ ] WebSocket protocol docs
- [ ] Self-hosting guide
- [ ] Admin CLI documentation
- [ ] Troubleshooting guide

### Deliverables

- v1.0 release binaries
- Complete documentation
- Production deployment guide
- Automated backup system

### Exit Criteria

- All P0/P1 features complete
- No known critical bugs
- Documentation complete
- Successfully deployed to production test instance

---

## Phase 6: Discord Migration (Week 15-18)

**Goal**: Tools for migrating from Discord

### Tasks

#### Discord Bridge Bot

- [ ] Discord bot setup
- [ ] Message sync Discord → Together
- [ ] User mapping system
- [ ] Channel mapping configuration
- [ ] Rich embed translation
- [ ] Rate limiting compliance

#### Import Tools

- [ ] Discord export parser
- [ ] Server structure import (channels, roles)
- [ ] Message history import
- [ ] Invite generation for existing Discord users

#### Documentation

- [ ] Migration guide
- [ ] Bridge setup instructions
- [ ] FAQ for Discord switchers

### Deliverables

- Discord bridge bot functional
- Import CLI tool
- Migration documentation

### Exit Criteria

- Test community successfully migrated
- Bridge stable for 1+ week
- Import tested with 10k+ messages

---

## Feature Comparison by Phase

| Feature          | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
| ---------------- | ------- | ------- | ------- | ------- | ------- |
| **Backend**      |
| Auth/Users       | ✅      | ✅      | ✅      | ✅      | ✅      |
| Servers/Channels | ✅      | ✅      | ✅      | ✅      | ✅      |
| Permissions      | ✅      | ✅      | ✅      | ✅      | ✅      |
| Messages         | ❌      | ✅      | ✅      | ✅      | ✅      |
| WebSocket        | ❌      | ✅      | ✅      | ✅      | ✅      |
| Voice            | ❌      | ❌      | ✅      | ✅      | ✅      |
| DMs              | ❌      | ❌      | ❌      | ❌      | ✅      |
| Reactions        | ❌      | ❌      | ❌      | ❌      | ✅      |
| **Clients**      |
| Desktop          | Basic   | ✅      | ✅      | ✅      | ✅      |
| Web              | ❌      | ❌      | ❌      | ✅      | ✅      |
| Mobile           | ❌      | ❌      | ❌      | ✅      | ✅      |

---

## Development Velocity Comparison

| Architecture          | MVP Time    | Team Size | LOC  | Complexity |
| --------------------- | ----------- | --------- | ---- | ---------- |
| **Monolithic (This)** | 6-8 weeks   | 1-2 devs  | ~15k | Low        |
| Microservices         | 12-16 weeks | 3-4 devs  | ~35k | High       |

**Savings**: 6-8 weeks faster, half the team size, 57% less code.

---

## Resource Requirements

### Development Team (Minimum)

**Option 1: Solo Developer** (slower)

- 1 Full-stack developer (Rust + React)
- Timeline: 10-12 weeks

**Option 2: Small Team** (recommended)

- 1 Backend developer (Rust)
- 1 Frontend developer (React/React Native)
- Timeline: 6-8 weeks

### Infrastructure

**Development**:

- Local machines
- Docker Desktop
- GitHub (free)

**Production (20-100 users)**:

- 1 VPS: $10-20/month (Hetzner, DigitalOcean)
- Domain + SSL: $15/year
- **Total**: ~$25/month

**Production (100-500 users)**:

- 1 VPS: $20-40/month (4vCPU, 8GB RAM)
- Domain + SSL: $15/year
- Backups: $5/month
- **Total**: ~$50/month

---

## Risk Mitigation

### Technical Risks

**Voice Quality**

- **Risk**: WebRTC may not deliver Discord-quality voice
- **Mitigation**: Test Pion early (Week 6), acceptable if 80% of Discord quality
- **Fallback**: If unusable, evaluate alternatives or defer voice to v2.0

**Database Performance**

- **Risk**: PostgreSQL can't handle load
- **Mitigation**: PostgreSQL handles 10k writes/sec - 100x more than needed
- **Test**: Load test with 1M messages in Phase 2

**Single Point of Failure**

- **Risk**: Monolith crashes = everything down
- **Mitigation**: Acceptable for small teams, simple restart solves most issues
- **Future**: If needed, add horizontal scaling later

### Schedule Risks

**Scope Creep**

- **Mitigation**: Strict P0/P1 adherence, "nice to have" deferred
- Weekly scope review

**Developer Availability**

- **Mitigation**: 6-8 week timeline has buffer, can slip 2 weeks
- Document everything for knowledge transfer

---

## Success Metrics

### Phase 2 (Text MVP)

- ✅ Message delivery P99 < 50ms
- ✅ Support 50 concurrent users
- ✅ 0 critical security issues
- ✅ Team dogfoods daily

### Phase 3 (Voice MVP)

- ✅ Voice latency P99 < 150ms
- ✅ 5 concurrent speakers stable
- ✅ 95% call completion rate

### Phase 4 (Multi-Platform)

- ✅ All three clients functional
- ✅ Mobile app TestFlight approved
- ✅ Crash rate < 1%

### Phase 5 (v1.0)

- ✅ All P0/P1 features done
- ✅ Complete documentation
- ✅ Production deployment successful
- ✅ 2+ test communities using

---

## Post-v1.0 Features (Backlog)

### P2 Features (Nice to Have)

- Video calls (WebRTC video tracks)
- Screen sharing
- Custom server emoji
- Message threading
- Server templates
- Webhooks
- Bot API

### P3 Features (Maybe)

- End-to-end encryption for DMs
- Voice recording/playback
- Server discovery (opt-in)
- Mobile screen sharing
- Live streaming (Go Live)

### Community Requests

Will be prioritized based on:

1. User feedback
2. Implementation complexity
3. Maintenance burden
4. Performance impact

---

## Timeline Visualization

```
Week  │ Phase                           │ Deliverable
──────┼─────────────────────────────────┼──────────────────────────
1     │ Foundation                      │ Dev environment ready
2-3   │ Backend + Auth                  │ REST API functional
4-5   │ Real-Time Chat                  │ Desktop chat works
6-9   │ Voice                           │ Voice channels work
10-12 │ Web + Mobile                    │ All platforms work
13-14 │ Polish + v1.0                   │ Production ready
15-18 │ Discord Migration (optional)    │ Migration tools ready
```

**Total**: 14 weeks to v1.0 (18 weeks with Discord migration)

---

## Key Decisions

### Already Decided

✅ Monolithic architecture (single Rust binary)
✅ PostgreSQL only (no ScyllaDB, no Redis initially)
✅ Tauri for desktop
✅ React Native for mobile
✅ Pion for WebRTC

### To Decide By Week

- **Week 6**: Voice quality acceptable? (Pion evaluation)
- **Week 10**: Mobile platform priority? (iOS first vs Android first)
- **Week 13**: Release v1.0 or add more features?
- **Week 15**: Build Discord bridge or focus on organic growth?

---

## Conclusion

This roadmap delivers a fully-functional Discord alternative in **14 weeks** with a **1-2 person team**.

**Key Advantages**:

- 50% faster than microservices approach
- 60% less code to maintain
- $390/month cheaper infrastructure
- Simple deployment and operations

**Trade-offs**:

- Limited to ~500 users without scaling effort
- Single point of failure (acceptable for small communities)
- Voice may not match Discord quality (acceptable if 80% as good)

**Philosophy**: Ship fast, learn from users, scale when needed.

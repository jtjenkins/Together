# Research Notes

## Existing Discord Alternatives Analysis

### 1. Revolt (Now Stoat)

**Status**: Active but struggling

**What they did RIGHT**:

- Open source (GitHub: revoltchat)
- Self-hostable via Docker
- Very Discord-like UI (low switching friction)
- Built with modern stack (TypeScript, Rust)
- Custom CSS support
- Good web client from day one

**What they did WRONG / Lessons**:

- **Voice quality**: Voice was neglected for ~3 years due to backend rewrite
  - _Lesson_: Don't rewrite core infrastructure while users are waiting
  - _Lesson_: Voice is HARD - either commit resources or don't do it
- **Mobile apps**: Took too long to ship native mobile
  - _Lesson_: Gaming communities ARE mobile-first for many users
  - _Lesson_: Web app on mobile is not acceptable for chat
- **Positioning**: Marketed as "Discord alternative" which sets high expectations
  - _Lesson_: Consider positioning as "gaming community platform" instead
- **Feature parity game**: Always playing catch-up
  - _Lesson_: Focus on core features, accept some parity gaps
- **Single instance**: Like Discord, one central instance
  - _Lesson_: Self-hosting is a differentiator but complicates network effects

**Technical Stack**:

- Frontend: TypeScript, Preact ( lightweight React)
- Backend: Rust (API), TypeScript (realtime events)
- Database: MongoDB (messages), Redis (caching)
- Voice: Custom SFU (took years to develop)

**Relevance to Together**:

- Revolt proved the demand exists
- Proved Discord-like UI is the right choice
- Proved voice can't be an afterthought
- Proved mobile must be native

---

### 2. Matrix / Element

**Status**: Mature but complex

**What they did RIGHT**:

- True federation (decentralized)
- E2E encryption available
- Open standard (many clients)
- Bridges to everything (Discord, Slack, IRC, etc.)
- Very mature protocol

**What they did WRONG / Lessons**:

- **Complexity**: "Matrix is an protocol, not a product"
  - _Lesson_: Regular users don't want to think about homeservers
  - _Lesson_: Element (main client) has learning curve
- **Performance**: Synapse (reference server) is resource-heavy
  - _Lesson_: Need efficient backend (hence Rust/ScyllaDB for Together)
- **UX**: Not Discord-like enough
  - _Lesson_: Different paradigm (rooms vs servers/channels)
- **Voice**: Based on Jitsi, not native to protocol
  - _Lesson_: Voice needs first-class treatment

**Technical Stack**:

- Protocol: Matrix spec (HTTP+JSON)
- Server: Synapse (Python), Dendrite (Go), others
- Client: Element (React), many others
- Voice: Jitsi integration

**Relevance to Together**:

- Federation is powerful but not our goal
- E2E encryption is worth considering for DMs
- Bridges are valuable (Discord bridge inspiration)
- Protocol complexity is a warning

---

### 3. Zulip

**Status**: Excellent for work, not gaming

**What they did RIGHT**:

- Threading done right (topic-based)
- Fast and reliable
- Good search
- Open source, self-hostable

**What makes it wrong for gaming**:

- Thread-centric UI doesn't match gaming flow
- No voice (intentionally)
- Email-like paradigm
- More "work communication" than "hangout"

**Relevance to Together**:

- Threading implementation is interesting
- Fast search is a benchmark
- Otherwise, different use case

---

### 4. TeamSpeak / Mumble

**Status**: Legacy but functional

**What they did RIGHT**:

- Voice quality is excellent
- Low latency
- Self-hosted since forever
- Simple permissions

**What they did WRONG / Lessons**:

- **No text**: Or very poor text chat
  - _Lesson_: Modern communities need integrated text+voice
- **Desktop only**: No mobile story
  - _Lesson_: Must have mobile
- **UI**: Outdated, intimidating to new users
  - _Lesson_: UX matters for adoption
- **Complex setup**: Server configuration is expert-level
  - _Lesson_: Together needs simple Docker deployment

**Relevance to Together**:

- Voice quality target: as good as TeamSpeak
- Self-hosting model proven
- UI/UX must be modern

---

### 5. Guilded (Bought by Roblox)

**Status**: Acquired, uncertain future

**What they did RIGHT**:

- Feature-rich (events, forums, docs)
- Good voice quality
- Calendar integration
- Free alternative to Discord Nitro

**What they did WRONG**:

- **Bought by Roblox**: Community fears for future
  - _Lesson_: Being closed-source = platform risk
- **Network effects**: Never achieved Discord's scale
  - _Lesson_: Even with features, hard to compete

**Relevance to Together**:

- Guilded features are inspiring (calendars, docs)
- But focus on core first - Guilded was feature-bloated
- Acquisition risk validates self-hosted approach

---

## WebRTC SFU Research

### Options Evaluated

#### 1. Pion (Go)

**Verdict**: RECOMMENDED for Together

**Pros**:

- Pure Go - no CGO, easy deployment
- Active community
- Good documentation
- Used in production (Cloudflare, others)
- Simpler than C++ alternatives

**Cons**:

- Performance not quite Mediasoup level
- Smaller ecosystem than Janus
- Some advanced features missing

**Performance**:

- Handles ~100-200 participants per core (estimated)
- Good for small-medium communities

**Use Case**: Together MVP and v1.0

---

#### 2. Mediasoup (Node.js/C++)

**Verdict**: STRONG ALTERNATIVE

**Pros**:

- Excellent performance (C++ core)
- Very flexible API
- Industry standard for custom SFU
- Used by Discord competitors

**Cons**:

- C++ core adds complexity
- Node.js wrapper has overhead
- Harder to deploy than Pion
- Smaller community than Janus

**Performance**:

- Industry-leading throughput
- Can handle thousands of streams

**Use Case**: If Pion insufficient, migrate here

---

#### 3. Janus Gateway (C)

**Verdict**: TOO COMPLEX for MVP

**Pros**:

- Battle-tested (10+ years)
- Plugin architecture
- Excellent performance
- Huge feature set

**Cons**:

- C codebase - harder to modify
- Complex configuration
- Overkill for simple voice channels
- Documentation scattered

**Use Case**: Later if needed, probably overkill

---

#### 4. LiveKit

**Verdict**: PROPRIETARY CLOUD - AVOID

**Pros**:

- Easy to use
- Managed cloud option
- Good SDKs

**Cons**:

- Primary business is SaaS
- Self-hosted mode less supported
- Risk of "enshittification"

**Use Case**: Not for Together (we want full control)

---

### Together Decision

**Phase 1-2 (MVP)**: Use Pion SFU

- Simpler deployment
- Go codebase matches voice service
- Good enough for target scale

**Phase 3+**: Evaluate migration to Mediasoup if Pion limits reached

- Migration path: Both use WebRTC standard
- Client code mostly unchanged
- Only server changes

---

## Database Research

### Message Storage: ScyllaDB vs Cassandra vs PostgreSQL

#### Discord's Choice: ScyllaDB

Discord reportedly moved from Cassandra to ScyllaDB for messages.

**Why ScyllaDB over Cassandra**:

- Same CQL interface (drop-in replacement)
- 10x better performance (C++ vs Java)
- No GC pauses
- Shard-per-core architecture
- Compatible drivers

**Why ScyllaDB over PostgreSQL**:

- Write throughput: ScyllaDB 1M+ writes/s vs PostgreSQL 10k
- Time-series data: Natural fit for channel buckets
- Horizontal scaling: Add nodes easily
- Cost: Runs on commodity hardware

**Together Decision**: ScyllaDB for messages

---

### Relational Data: PostgreSQL

**What goes here**:

- Users
- Servers
- Channels
- Roles
- Permissions
- Relationships (friends)
- Audit logs

**Why PostgreSQL**:

- ACID compliance for critical data
- JSONB for flexible settings
- Well-understood
- Easy backups

**Why not ScyllaDB for everything**:

- JOINs are expensive in NoSQL
- Transactions needed for user operations
- Relationships are graph-like (better in SQL)

**Together Decision**: PostgreSQL for relational, ScyllaDB for messages

---

## Frontend Framework Research

### Desktop: Tauri vs Electron

#### Tauri (RECOMMENDED)

**Bundle Size**:

- Tauri: ~5MB
- Electron: ~150MB

**Memory**:

- Tauri: ~50MB idle
- Electron: ~300MB idle

**Startup**:

- Tauri: < 1 second
- Electron: 2-3 seconds

**Security**:

- Tauri: Capability-based (explicit permissions)
- Electron: Context isolation (better now, historically issues)

**Development**:

- Tauri: Rust + web frontend
- Electron: Node.js + web frontend

**Ecosystem**:

- Tauri: Growing rapidly, Tauri v2 adds mobile
- Electron: Mature, huge ecosystem

**Together Decision**: Tauri for desktop

- Performance matters for always-running chat app
- Smaller bundle = easier distribution
- Rust backend aligns with services

---

### Mobile: React Native vs Flutter

#### React Native (RECOMMENDED)

**Pros**:

- Discord uses it (proven for chat)
- JavaScript ecosystem
- Can share code with desktop (logic, not UI)
- Hot reload works well
- Native feel achievable

**Cons**:

- Bridge overhead (improving with New Architecture)
- iOS/Android differences still exist
- Build tooling complexity

#### Flutter (Alternative)

**Pros**:

- Single codebase (truly)
- Excellent performance
- Beautiful by default

**Cons**:

- Dart (another language to learn)
- Discord doesn't use it (less proven for chat)
- Larger app size

**Together Decision**: React Native

- Team likely knows React
- Discord precedent
- Easier to hire for

---

## WebSocket vs SSE vs Long Polling

### Decision: WebSocket

**Why not SSE (Server-Sent Events)**:

- Unidirectional only (need separate channel for sending)
- Browser support good but not universal
- HTTP-based (header overhead)

**Why not Long Polling**:

- Inefficient (repeated connections)
- Latency higher
- Battery drain on mobile

**WebSocket advantages**:

- True bidirectional
- Lower overhead after handshake
- Industry standard for chat
- Works with Rust (tokio-tungstenite) and Go (gorilla)

---

## Licensing Considerations

### For Together Project

**Recommended**: AGPL-3.0

**Why**:

- Self-hosting must remain free
- Forces derivative works to be open
- Protects against proprietary forks
- Used by Matrix, Mastodon

**Why not MIT/Apache**:

- Allows proprietary hosting services
- Could lead to "open core" fragmentation

**Why not GPL**:

- AGPL better for network services (triggers on network use, not just distribution)

---

## Deployment Model Research

### Option 1: Single Docker Compose (Target for MVP)

**Pros**:

- One command to start
- Single machine
- Simple backups

**Cons**:

- Vertical scaling only
- Single point of failure

**Use case**: Communities < 1000 users

---

### Option 2: Kubernetes (Future)

**Pros**:

- Horizontal scaling
- Auto-healing
- Industry standard

**Cons**:

- Complex to operate
- Overkill for most communities

**Use case**: Communities > 5000 users, or enterprise

---

### Option 3: Managed Services Hybrid

**Pros**:

- Use managed PostgreSQL, Redis
- Self-host only the app logic
- Easier operations

**Cons**:

- Cost
- Vendor lock-in

**Use case**: Communities wanting less ops burden

---

## Discord Architecture Insights

From Discord's engineering blog and public talks:

### Message Flow

1. Client WebSocket → Gateway (Elixir)
2. Gateway → Chat Service (internal routing)
3. Chat Service writes to ScyllaDB
4. Pub/sub broadcasts to other gateways
5. Other clients receive via WebSocket

### Voice Flow

1. Client joins voice channel
2. Gateway assigns Voice Server
3. Client WebRTC handshake with Voice Server (C++)
4. SFU routes audio between clients
5. UDP for media, WebSocket for signaling

### Key Stats (from blog posts)

- 850+ voice servers
- 2.6M concurrent voice users
- 220 Gbps voice egress
- ScyllaDB cluster (12+ nodes for messages)
- Elixir for WebSocket gateways

### What we can learn

- Use proven tech (Elixir is great but Rust is our choice)
- Separate voice and chat infrastructure
- ScyllaDB for messages is proven
- SFU not MCU for voice

---

## Risk Analysis from Research

### High Risk: Voice Quality

**Mitigation**:

- Test Pion early (Week 10 in roadmap)
- Keep Mediasoup as backup option
- Consider cloud SFU as last resort

### Medium Risk: Mobile Development

**Mitigation**:

- Start mobile scaffolding early
- Use React Native (proven)
- Feature parity is requirement, not stretch

### Low Risk: Database Scaling

**Mitigation**:

- ScyllaDB chosen specifically for this
- Discord's usage proves it works

### High Risk: Network Effects

**Mitigation**:

- Discord bridge for transition
- Focus on communities wanting self-hosting
- Accept smaller total userbase

---

## Competitive Position

| Feature         | Discord | Revolt | Matrix | Together Target |
| --------------- | ------- | ------ | ------ | --------------- |
| Self-hostable   | ❌      | ✅     | ✅     | ✅              |
| Federation      | ❌      | ❌     | ✅     | ❌              |
| Voice quality   | ⭐⭐⭐  | ⭐⭐   | ⭐⭐   | ⭐⭐⭐          |
| Mobile apps     | ⭐⭐⭐  | ⭐⭐   | ⭐⭐⭐ | ⭐⭐⭐          |
| Easy setup      | N/A     | ⭐⭐   | ⭐     | ⭐⭐⭐          |
| Discord-like    | N/A     | ⭐⭐⭐ | ⭐     | ⭐⭐⭐          |
| E2E encryption  | ❌      | ❌     | ✅     | 🚧              |
| Privacy control | ❌      | ✅     | ✅     | ✅              |

**Together's differentiators**:

1. Easier self-hosting than Matrix
2. Better voice than Revolt (planning ahead)
3. First-class mobile unlike early Revolt
4. Deliberately not federated (simpler)

---

## Research Sources

1. Discord Engineering Blog (blog.discord.com)
2. Revolt GitHub + community Discord
3. Matrix Spec documentation
4. Pion WebRTC documentation
5. Mediasoup documentation and community
6. ScyllaDB case studies
7. Tauri documentation
8. React Native performance benchmarks
9. WebRTC SFU comparison papers (CoSMo study)
10. r/selfhosted community discussions

# Discord Feature Analysis

## Executive Summary

This document analyzes Discord's features as they relate to gaming communities, prioritizing what Together must implement to be a viable alternative.

**Key Insight**: Discord has thousands of features, but gaming groups typically use 20% of them 80% of the time. We focus on that critical 20%.

---

## Core Features by Priority

### 🔴 P0 - Must Have for MVP

These features are non-negotiable. Without them, gaming groups won't even consider switching.

#### 1. Text Channels with Persistent History
**What it is**: Channel-based chat with unlimited scrollback history

**Why it matters**: 
- Gaming groups use this for coordination, strategy discussion, and banter
- History is essential for context ("who's on tonight?", "what's the raid strategy?")
- Communities rely on searchable logs

**Discord implementation**: 
- Infinite scroll with lazy loading
- Full-text search with filters (author, date, has:attachment, etc.)
- 25MB file upload limit for free tier

**Together approach**:
- Same UX: channel list left, messages center, members right
- Implement search from day one (easier than retrofitting)
- Start with 50MB upload limit (storage is cheap)
- Use ScyllaDB for message storage (proven at scale)

**Technical notes**:
- Messages partitioned by channel_id + timestamp
- TTL for message deletion compliance
- Async full-text indexing with Elasticsearch or native ScyllaDB indexing

#### 2. Real-Time Voice Channels (WebRTC SFU)
**What it is**: Join/leave voice rooms with continuous audio, push-to-talk or voice activation

**Why it matters**:
- THE killer feature for gaming (in-game coordination)
- Low latency is critical (< 200ms acceptable, < 100ms ideal)
- Quality needs to be "good enough" - doesn't need to be Discord-perfect

**Discord implementation**:
- Custom C++ WebRTC implementation
- 850+ voice servers globally
- ~220 Gbps egress at peak
- Salsa20 encryption instead of standard DTLS/SRTP
- Silence suppression for bandwidth savings

**Together approach**:
- Use Pion (Go) or Mediasoup (Node.js/C++) SFU
- Don't try to build custom WebRTC - use proven libraries
- Focus on single-region deployments first (lower complexity)
- Implement voice activity detection (VAD)
- Support both PTT and voice activation

**Technical notes**:
- SFU (Selective Forwarding Unit) architecture - NOT mesh
- UDP hole punching for NAT traversal
- Separate signaling (WebSocket) and media (UDP) paths
- Opus codec mandatory, 48kHz, 20ms frames

#### 3. Role-Based Permissions
**What it is**: Granular permission system tied to user roles

**Why it matters**:
- Essential for community moderation
- Different access for admins, moderators, members, guests
- Controls who can see channels, send messages, manage users

**Discord implementation**:
- Hierarchical roles (position-based precedence)
- 40+ granular permissions
- Channel-specific permission overrides
- Role colors and display separation

**Together approach**:
- Implement Discord's permission model directly (it's well-designed)
- Simplify: ~20 permissions instead of 40
- Keep hierarchical roles
- Must have channel-level overrides

**Permission categories**:
```
General: ViewChannels, ManageChannels, ManageRoles
Text: SendMessages, SendEmbeds, AttachFiles, 
      AddReactions, UseExternalEmoji, ReadHistory
Voice: Connect, Speak, Video, PrioritySpeaker
Moderation: KickMembers, BanMembers, ManageMessages
Admin: Administrator (grants everything)
```

#### 4. User Presence & Status
**What it is**: Online/offline/idle/dnd status, custom status messages, game activity

**Why it matters**:
- "Who's on?" is the #1 question in gaming groups
- Custom status lets users communicate intent ("LF raid group", "AFK dinner")
- Activity shows what game people are playing

**Discord implementation**:
- Presence broadcast to all guild members
- Rich presence via game SDK
- Custom status with emoji support
- "Playing GameName" auto-detection on desktop

**Together approach**:
- Implement core presence: Online, Away, DND, Invisible
- Custom status with emoji
- Skip game auto-detection initially (requires native integrations)
- Manual game status setting ("Playing: [input]")

**Technical notes**:
- Presence stored in Redis with pub/sub
- Heartbeat every 30-60 seconds
- Batch presence updates to reduce load

#### 5. Server/Community Organization
**What it is**: Servers containing multiple channels (text + voice), organized by category

**Why it matters**:
- Gaming groups organize by activity type
- Categories help structure: "GENERAL", "GAMES", "VOICE LOBBIES"
- Multiple servers per user (one for main clan, one for friends)

**Discord implementation**:
- "Guild" = server
- Channels organized in categories
- Text and voice channels mixed in categories
- Channel ordering within categories

**Together approach**:
- Keep the "Server" terminology (users know it)
- Support categories
- Allow text and voice in same category
- Implement channel ordering

**Data model**:
```
Server
  ├── Categories (ordered)
  │     ├── Channels (ordered, type: text|voice)
  │     └── Channels
  └── Channels (uncategorized)
```

---

### 🟡 P1 - High Priority Post-MVP

These make the experience polished and complete. Implement within 3-6 months of MVP.

#### 6. Direct Messages (DMs)
**What it is**: Private 1-on-1 conversations outside of servers

**Why it matters**:
- Private coordination between members
- Side conversations during raids/sessions
- Friend relationships outside server context

**Discord implementation**:
- User-to-user channels
- Group DMs (up to 10 people)
- Separate from server channels

**Together approach**:
- 1-on-1 DMs first
- Group DMs later
- Same message storage infrastructure as channel messages

#### 7. Emoji Reactions
**What it is**: Click emoji to react to messages, counter shows how many reactions

**Why it matters**:
- Lightweight acknowledgment (no "agreed!" message needed)
- Polling/voting ("Who's in for tonight? 👍👎")
- Community culture (custom server emoji)

**Discord implementation**:
- Unicode emoji + custom server emoji
- Animated emoji (Nitro)
- Reaction counts
- Notification on reaction

**Together approach**:
- Unicode emoji first (easy)
- Custom server emoji second
- Skip animated initially
- Implement counts + basic notifications

#### 8. Message Threading
**What it is**: Branching sub-conversations off a specific message

**Why it matters**:
- Keeps main channel clean during side discussions
- Useful for off-topic tangents
- Organizes raid strategy discussions

**Discord implementation**:
- Threads created from any message
- Can be text or announcement threads
- Archive after inactivity
- Optional thread notification

**Together approach**:
- Implement Discord-style threads (not Slack-style)
- Threads appear in channel, can be expanded
- Archive after 24h-7d of inactivity (configurable)
- Simpler: no separate thread channels list

#### 9. File Attachments & Embeds
**What it is**: Upload images, videos, documents; rich embeds from links

**Why it matters**:
- Screenshots of game moments
- Sharing configs, mods, save files
- Memes (critical for community culture)

**Discord implementation**:
- 25MB free / 500MB Nitro upload limits
- Inline image/video preview
- Rich embeds (OpenGraph) for links
- Spoiler tags

**Together approach**:
- 50MB upload limit (competitive advantage)
- Inline preview for images, GIFs, videos
- OpenGraph embeds for links
- Spoiler support
- Use object storage (MinIO/S3) for files

#### 10. @Mentions & Notifications
**What it is**: Alert users via @username, @role, @everyone/@here

**Why it matters**:
- Getting attention for urgent matters
- Role mentions for groups ("@Raiders tonight!")
- Server announcements

**Discord implementation**:
- @username for specific user
- @role for all with that role
- @everyone for all server members
- @here for online members
- Notification settings per-server, per-channel

**Together approach**:
- Implement all mention types
- Push notifications for mobile
- Email notifications for DMs (optional)
- Rich notification settings

---

### 🟢 P2 - Nice to Have

Implement after core features are solid.

#### 11. Screen Sharing
**What it is**: Share screen/application with voice channel members

**Why it matters**:
- Strategy planning ("look at this map position")
- Tech support/helping new players
- Watching streams together

**Discord implementation**:
- Screen/application/window selection
- 720p-1080p depending on tier
- Go Live (stream game while playing)

**Together approach**:
- Screen sharing within voice channels
- Use WebRTC for video transport
- Lower priority than voice quality

#### 12. Video Calls
**What it is**: Video in voice channels or 1-on-1

**Why it matters**:
- Face-to-face for closer communities
- Reaction streams, "facecam" culture

**Together approach**:
- Webcam support in voice channels
- Simulcast for bandwidth adaptation
- Lower priority than screen sharing

#### 13. Custom Server Emoji
**What it is**: Upload custom emoji for use within a server

**Why it matters**:
- Community identity
- In-jokes, memes
- Stickers express what words can't

**Discord implementation**:
- 50-250 emoji per server (based on boosts)
- Animated emoji support
- Global emoji (Nitro)

**Together approach**:
- 100 custom emoji per server
- Static only initially
- No global emoji (not trying to monetize)

#### 14. Server Boosts / Vanity Features
**What it is**: Skip entirely - no gamification

**Why skip**:
- Together is self-hosted, not SaaS
- No need to monetize
- Users control their own resources

---

### ⚫ P3 - Discord Bridge/Transition

Features specifically for migrating from Discord.

#### 15. Discord Bridge
**What it is**: Two-way sync between Discord and Together during transition

**Why it matters**:
- Gradual migration without losing community
- Some members can stay on Discord
- Test Together while maintaining Discord

**Discord implementation**:
- N/A - this is our feature

**Together approach**:
- Bot that bridges Discord <-> Together
- Sync messages from specific Discord channels
- Mirror voice presence (optional)
- User mapping between platforms

#### 16. Discord Import
**What it is**: Import server structure, channels, roles, messages from Discord

**Why it matters**:
- Preserve community history
- Don't start from scratch
- Lower switching friction

**Together approach**:
- Export Discord data (via API or DiscordTakeout)
- Import channels, roles, messages
- Map Discord users to Together accounts

---

## Discord-Specific Features to AVOID

These create complexity without value for self-hosted communities:

1. **Discord Shop / Cosmetics** - Monetization we don't need
2. **Activity Launcher** - Mini-games inside Discord, rarely used
3. **Quests** - Promotional feature
4. **Server Boosts** - Not applicable to self-hosted
5. **Nitro** - Premium tier, not relevant
6. **Stage Channels** - Specialized feature, rarely used by gaming groups
7. **Forum Channels** - Overlaps with threads + regular channels
8. **Soundboard** - Fun but not essential
9. **App Directory / Integrations** - Webhooks sufficient initially
10. **Discovery** - Public server directory, not for private instances

---

## Feature Comparison Matrix

| Feature | Discord | Together MVP | Together v1.0 |
|---------|---------|--------------|---------------|
| Text Channels | ✅ | ✅ | ✅ |
| Voice Channels | ✅ | ✅ | ✅ |
| Roles/Permissions | ✅ | ✅ | ✅ |
| User Presence | ✅ | ✅ | ✅ |
| DM Support | ✅ | ❌ | ✅ |
| Emoji Reactions | ✅ | ❌ | ✅ |
| File Attachments | ✅ | Basic | Full |
| Message Threading | ✅ | ❌ | ✅ |
| Screen Sharing | ✅ | ❌ | ✅ |
| Video Calls | ✅ | ❌ | ✅ |
| Custom Emoji | ✅ | ❌ | ✅ |
| Server Discovery | ✅ | N/A | N/A |
| Activity Launcher | ✅ | ❌ | ❌ |
| Stage Channels | ✅ | ❌ | Maybe |
| Forums | ✅ | ❌ | ❌ |
| Discord Bridge | N/A | ❌ | ✅ |

---

## Key UX Decisions

### 1. Channel Sidebar Layout
**Copy Discord exactly**: Server icons left → Channels middle → Messages right → Members far right

Why: 200M+ users know this layout. Changing it creates friction.

### 2. Voice Channel UI
- List view of who's in the channel
- Avatar, name, mute/deafen indicators
- Volume per-user (right-click menu)
- Connect/disconnect button

### 3. Message Composition
- Text input at bottom
- Emoji picker (Unicode first)
- Attach file button
- Typing indicator ("X is typing...")

### 4. Mobile Simplification
- Bottom nav: Servers, Messages, Notifications, Profile
- Swipe between servers
- Voice: full-screen when connected, minimize to bubble

---

## Conclusion

Together's goal isn't to copy every Discord feature - it's to provide the **essential 80%** that gaming communities actually use, with:

1. **Better privacy** - You own your data
2. **No platform risk** - Can't be banned, shut down
3. **Lower latency** - Host close to your members
4. **Full control** - Your rules, your mods

The MVP focuses on **text + voice + permissions + presence**. Everything else is a bonus.

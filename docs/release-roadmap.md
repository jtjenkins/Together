# Together Release Roadmap

**Version**: Pre-release (v0.0.1)
**Last Updated**: 2026-03-12
**Target Scale**: 20-500 users

---

## Executive Summary

Together is a self-hosted Discord alternative with core features already implemented. This roadmap identifies missing features, prioritizes them for release milestones, and establishes a path to a stable v1.0 launch.

---

## Current State Summary

| Category       | Status      | Notes                            |
| -------------- | ----------- | -------------------------------- |
| Core Chat      | ✅ Complete | Messages, channels, threads, DMs |
| Voice          | ✅ Complete | WebRTC SFU, voice channels       |
| Permissions    | ✅ Complete | Roles, channel overrides         |
| File Uploads   | ✅ Complete | Up to 50MB                       |
| Cross-Platform | ✅ Complete | Desktop, web, mobile (Tauri)     |
| Security       | ⚠️ Basic    | Rate limiting, no security audit |
| Moderation     | ⚠️ Minimal  | Basic roles, no dedicated tools  |

---

## Release Milestones

### Milestone 1: Security & Stability (v0.1.0)

**Target: Pre-public-beta hardening**

| Feature                          | Priority | Effort   | Dependencies | Status      |
| -------------------------------- | -------- | -------- | ------------ | ----------- |
| Security audit (self-assessment) | P0       | 2-3 days | None         | ⬜ Pending  |
| Password reset flow              | P1       | 1-2 days | Email config | ⬜ Pending  |
| Input validation hardening       | P0       | 1-2 days | None         | ⬜ Pending  |
| Audit logging (admin actions)    | P1       | 2-3 days | None         | ⬜ Pending  |
| Backup/restore documentation     | P1       | 1 day    | None         | ✅ Complete |
| Health check endpoints           | P1       | 1 day    | None         | ⬜ Pending  |

**Deliverables:**

- [ ] Security self-assessment report
- [ ] Password reset via email (when email configured)
- [ ] Comprehensive input validation
- [ ] Admin audit log viewer
- [x] Backup/restore guide with automated scripts

**Deferred (requires email infrastructure):**

- Two-factor authentication (2FA/TOTP) →

v1.1+ after email setup

---

### Milestone 2: Video Calls (v0.2.0)

**Target: Video calling feature (Dev team focus)**

| Feature                      | Priority | Effort   | Dependencies                  |
| ---------------------------- | -------- | -------- | ----------------------------- |
| WebRTC video track support   | P0       | 5-7 days | Existing voice infrastructure |
| Camera on/off controls       | P0       | 2-3 days | Video track                   |
| Video grid layout            | P1       | 3-4 days | UI framework                  |
| Screensharing                | P1       | 4-5 days | WebRTC screenshare API        |
| Spotlight/focus speaker view | P2       | 2-3 days | Video grid                    |
| Virtual backgrounds          | P2       | 3-4 days | Video processing              |

**Deliverables:**

- [ ] Video calls with camera support
- [ ] Screensharing capability
- [ ] Mobile video support
- [ ] Bandwidth adaptation

---

### Milestone 3: Moderation & Administration (v0.3.0)

**Target: Server management essentials**

| Feature                        | Priority | Effort   | Dependencies        |
| ------------------------------ | -------- | -------- | ------------------- |
| User ban/kick with audit trail | P0       | 2-3 days | Audit logging       |
| Mute/timeout functionality     | P0       | 2-3 days | None                |
| Message deletion (bulk)        | P0       | 2 days   | None                |
| Slow mode for channels         | P1       | 1-2 days | None                |
| Report system                  | P1       | 3-4 days | Notification system |
| Server-wide announcement       | P1       | 1-2 days | None                |
| Member list search/filter      | P1       | 2 days   | None                |

**Deliverables:**

- [ ] Complete moderation toolkit
- [ ] Admin dashboard for user management
- [ ] Report handling workflow

---

### Milestone 4: Search & Discovery (v0.4.0)

**Target: Finding content & people**

| Feature                            | Priority | Effort   | Dependencies       |
| ---------------------------------- | -------- | -------- | ------------------ |
| Full-text message search           | P0       | 4-5 days | PostgreSQL indexes |
| Server/member search               | P1       | 2-3 days | None               |
| @mention autocomplete improvements | P1       | 1-2 days | None               |
| Message pinning                    | P1       | 1 day    | None               |
| Pinned messages view               | P1       | 1 day    | Pinning            |
| Bookmark/save messages             | P2       | 2-3 days | None               |

**Deliverables:**

- [ ] Search across all messages
- [ ] Pinned messages per channel
- [ ] Improved user discovery

---

### Milestone 5: Notifications & Engagement (v0.5.0)

**Target: Stay connected**

| Feature                      | Priority | Effort   | Dependencies             |
| ---------------------------- | -------- | -------- | ------------------------ |
| Push notifications (mobile)  | P0       | 5-7 days | Push service integration |
| Desktop notifications        | P0       | 2-3 days | Tauri notification API   |
| Email notifications (digest) | P1       | 3-4 days | Email service            |
| Typing indicators            | P1       | 2 days   | WebSocket events         |
| Read receipts (optional)     | P1       | 2-3 days | None                     |
| Online/idle/offline presence | P1       | 1-2 days | Already Partial          |

**Deliverables:**

- [ ] Push notification infrastructure
- [ ] Desktop/mobile notification support
- [ ] Presence visibility controls

---

### Milestone 6: Polish & Performance (v0.6.0)

**Target: Launch readiness**

| Feature                       | Priority | Effort   | Dependencies        |
| ----------------------------- | -------- | -------- | ------------------- |
| Custom emoji                  | P0       | 3-4 days | File upload system  |
| Message edit indicators       | P1       | 1 day    | None                |
| Message embeds (URL previews) | ✅ Done  | -        | Link previews exist |
| Connection status indicator   | P1       | 1-2 days | WebSocket state     |
| Reconnection handling         | P1       | 2 days   | WebSocket           |
| Performance optimization      | P1       | 3-5 days | Profiling           |
| Accessibility audit           | P1       | 2-3 days | None                |
| Error boundary UX             | P2       | 2 days   | None                |

**Deliverables:**

- [ ] Custom emoji support
- [ ] Resilient connection handling
- [ ] Accessibility compliance

---

### Milestone 7: v1.0 Launch

**Target: Production-ready release**

| Feature                  | Priority | Effort    | Dependencies    |
| ------------------------ | -------- | --------- | --------------- |
| Documentation site       | P0       | 3-4 days  | None            |
| Installation docs update | P0       | 1 day     | None            |
| Security documentation   | P0       | 1-2 days  | Security audit  |
| Performance benchmarks   | P1       | 2-3 days  | Load testing    |
| External security audit  | P1       | N/A       | Budget/approval |
| Launch website           | P0       | 2-3 days  | Marketing team  |
| Beta testing period      | P0       | 2-4 weeks | All milestones  |
| Version tagging (v1.0.0) | P0       | 1 day     | Final review    |

**Deliverables:**

- [ ] Public documentation
- [ ] Security audit report
- [ ] Stable release artifact
- [ ] Marketing launch materials

---

## Post-1.0 Roadmap (v1.1+)

### Phase 8: Bot API & Integrations (v1.1.0)

- Bot accounts and API tokens
- WebSocket API for bots
- REST API for bot actions
- Webhook support

### Phase 9: Advanced Voice (v1.2.0)

- Voice messages (record & send)
- Stage channels (speaker/audience model)
- Noise suppression
- Music bot support

### Phase 10: Community Features (v1.3.0)

- Server discovery page
- Public server toggle
- Server templates
- Import from Discord tool

---

## Technical Debt & Infrastructure

| Item                    | Priority | Status  | Notes              |
| ----------------------- | -------- | ------- | ------------------ |
| CI/CD pipeline          | P1       | Needed  | GitHub Actions     |
| Automated testing       | P1       | Partial | Need more coverage |
| Docker image publishing | P1       | Done    | Multi-arch images  |
| Monitoring/metrics      | P2       | Needed  | Prometheus/Grafana |
| Error tracking          | P2       | Needed  | Sentry or similar  |

---

## Risk Assessment

| Risk                   | Likelihood | Impact   | Mitigation                              |
| ---------------------- | ---------- | -------- | --------------------------------------- |
| WebRTC complexity      | Medium     | High     | Use Pion, existing voice infrastructure |
| Mobile performance     | Medium     | Medium   | Tauri v2 handles well, profile early    |
| Security vulnerability | Low        | Critical | Security audit before v1.0              |
| Scale beyond design    | Low        | Medium   | Architecture allows Redis addition      |
| iOS TURN requirement   | Known      | Low      | Already documented                      |

---

## Dependencies Between Agents

- **Sage** → **Planner**: Competitive analysis informs priority adjustments
- **Dev** → **Planner**: Video call implementation blockers/estimates
- **Marketing** → **Planner**: Website requirements for launch milestone
- **Planner** → **All**: Milestone coordination, blocker identification

---

## Notes

- Features labeled ✅ are already implemented
- Effort estimates are approximate (days of focused work)
- Priorities: P0 (must-have), P1 (should-have), P2 (nice-to-have)
- Timeline will be adjusted based on agent feedback

---

_This roadmap is a living document. Update as milestones progress._

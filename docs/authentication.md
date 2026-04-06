⚠️ This document has been moved to the [Together docs site](https://docs.together-chat.com/features/authentication).
Please visit the new site for the latest version.

---

# Together Authentication

This document describes the authentication system for Together — registration, login, token management, and password reset flows.

## Overview

Together uses JWT-based authentication with short-lived access tokens and long-lived refresh tokens. Passwords are hashed with bcrypt (cost 12). Refresh tokens are stored as SHA-256 hashes in the `sessions` table for deterministic lookup.

---

## Endpoints

All authentication endpoints are grouped under `/auth/` and share a stricter per-IP rate limit (see [Rate Limiting](#rate-limiting)).

---

### POST /auth/register

Create a new user account. Returns an access token, a refresh token, and the created user profile.

**Request body:**

| Field      | Type             | Required | Constraints                                           |
|------------|------------------|----------|-------------------------------------------------------|
| `username` | string           | yes      | 2–32 characters, alphanumeric or underscore only      |
| `email`    | string \| null   | no       | Must be a valid email address if provided             |
| `password` | string           | yes      | 8–128 characters                                      |

The password maximum of 128 characters prevents bcrypt's 72-byte truncation from becoming a denial-of-service vector.

**Response** (`201 Created`):

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "user": {
    "id": "uuid",
    "username": "alice",
    "email": "alice@example.com",
    "status": "offline",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

**Behavior:**

1. Validates the request fields (username regex, email format, password length).
2. Hashes the password with bcrypt (cost 12).
3. Inserts the user row and session row inside a single database transaction. If the session insert fails, the user row is rolled back so the client does not end up locked out of an account it never successfully created.
4. The refresh token is SHA-256 hashed before storage.

**Error cases:**

| Status | Condition                                              |
|--------|--------------------------------------------------------|
| 400    | Validation failure (username format, password length)  |
| 409    | Username or email already exists (DB unique constraint)|
| 429    | Rate limit exceeded                                    |

---

### POST /auth/login

Authenticate an existing user. Returns an access token, a refresh token, and the user profile.

**Request body:**

| Field      | Type   | Required | Constraints       |
|------------|--------|----------|-------------------|
| `username` | string | yes      | 1–128 characters  |
| `password` | string | yes      | 1–128 characters  |

**Response** (`200 OK`):

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "user": { ... }
}
```

**Behavior:**

1. Looks up the user by username. Returns a generic error if not found (does not reveal whether the username exists).
2. Verifies the password against the stored bcrypt hash.
3. Inside a transaction:
   - Deletes expired sessions for this user (prevents unbounded table growth).
   - Inserts a new session with the hashed refresh token (expires in 7 days).
   - Caps active sessions at 10 per user — the oldest sessions beyond this limit are deleted.
   - Updates the user's status to `online`.

**Error cases:**

| Status | Condition                                  |
|--------|--------------------------------------------|
| 400    | Validation failure (empty fields)          |
| 401    | Invalid username or password               |
| 429    | Rate limit exceeded                        |

---

### POST /auth/refresh

Exchange a valid refresh token for a new access token and a new refresh token. The old refresh token is invalidated (rotation).

**Request body:**

| Field           | Type   | Required | Constraints        |
|-----------------|--------|----------|--------------------|
| `refresh_token` | string | yes      | 1–2048 characters  |

**Response** (`200 OK`):

```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "user": { ... }
}
```

**Behavior:**

1. Validates the JWT signature and expiry of the provided refresh token.
2. Rejects the request if the token's `token_type` claim is not `refresh`.
3. Looks up the session by the SHA-256 hash of the token. The session must exist and not be expired.
4. Generates a new access token and a new refresh token.
5. Performs a compare-and-swap update on the session row: the hash is only replaced if it still matches the old value. This prevents concurrent refresh races from both succeeding.

**Error cases:**

| Status | Condition                                                        |
|--------|------------------------------------------------------------------|
| 400    | Validation failure (empty token)                                 |
| 401    | JWT signature invalid or expired                                 |
| 401    | Token is not a refresh token (wrong `token_type`)                |
| 401    | Session not found or expired in the database                     |
| 401    | Token already rotated (concurrent refresh race lost)             |
| 429    | Rate limit exceeded                                              |

---

### POST /auth/forgot-password

Generate a password reset token for a user. **Admin-only** — the token is returned in the response body for manual out-of-band delivery (e.g., admin shares it with the user directly).

**Authentication:** Requires a valid access token (`Authorization: Bearer <jwt>`). The authenticated user must have `is_admin = true`.

**Request body:**

| Field   | Type   | Required | Constraints              |
|---------|--------|----------|--------------------------|
| `email` | string | yes      | Must be a valid email    |

**Response** (`200 OK`):

```json
{
  "message": "Password reset token generated",
  "token": "<base64url-encoded-token>",
  "expires_in_seconds": 3600,
  "note": "Share this token with the user to reset their password"
}
```

**Behavior:**

1. Verifies the caller is an admin via DB lookup.
2. Finds the target user by email. Returns 404 if not found (safe because this is admin-only, so email enumeration is not a concern).
3. Generates a 32-byte cryptographically random token, base64url-encoded.
4. Deletes any existing reset tokens for this user (only one active token at a time).
5. Stores the SHA-256 hash of the token in `password_reset_tokens` with a 1-hour expiry.

**Error cases:**

| Status | Condition                                  |
|--------|--------------------------------------------|
| 400    | Validation failure (invalid email format)  |
| 401    | Missing or invalid access token            |
| 403    | Caller is not an admin                     |
| 404    | No user found with that email              |
| 429    | Rate limit exceeded                        |

---

### POST /auth/reset-password

Reset a user's password using a previously issued reset token.

**Authentication:** None required. The reset token itself authorizes the operation.

**Request body:**

| Field          | Type   | Required | Constraints       |
|----------------|--------|----------|-------------------|
| `token`        | string | yes      | The reset token   |
| `new_password` | string | yes      | 8–128 characters  |

**Response** (`200 OK`):

```json
{
  "message": "Password has been reset successfully"
}
```

**Behavior:**

1. Hashes the provided token with SHA-256 and looks up a matching row in `password_reset_tokens` that is not expired and has not been used.
2. Hashes the new password with bcrypt (cost 12).
3. Inside a transaction:
   - Updates the user's `password_hash`.
   - Marks the reset token as used (`used_at = NOW()`).
   - Deletes all existing sessions for the user (forces re-login on all devices).

**Error cases:**

| Status | Condition                                          |
|--------|----------------------------------------------------|
| 400    | Validation failure (password too short/long)       |
| 401    | Token is invalid, expired, or already used         |
| 429    | Rate limit exceeded                                |

---

## JWT Structure

Tokens are signed with HS256 using a server-configured secret (`JWT_SECRET` env var).

**Claims:**

| Claim        | Type   | Description                                       |
|--------------|--------|---------------------------------------------------|
| `sub`        | string | User ID (UUID)                                    |
| `username`   | string | Username at time of token creation                |
| `token_type` | string | `"access"` or `"refresh"`                         |
| `iat`        | i64    | Issued-at timestamp (Unix seconds)                |
| `exp`        | i64    | Expiration timestamp (Unix seconds)               |

### Token Lifetimes

| Token Type     | Lifetime   |
|----------------|------------|
| Access token   | 15 minutes |
| Refresh token  | 7 days     |

### Token Usage

- **Access tokens** are sent in the `Authorization: Bearer <token>` header on protected endpoints. The `AuthUser` extractor validates the JWT and rejects refresh tokens used as access tokens.
- **Refresh tokens** are only accepted by the `POST /auth/refresh` endpoint. They are stored as SHA-256 hashes in the `sessions` table.

---

## Session Management

- Each login or registration creates a new session row in the `sessions` table containing the SHA-256 hash of the refresh token and an expiry timestamp (7 days from creation).
- On login, expired sessions for the user are cleaned up automatically.
- Active sessions are capped at **10 per user**. When a new session is created during login, any sessions beyond this limit (oldest first) are deleted.
- On token refresh, the old refresh token hash is atomically replaced with the new one (compare-and-swap). A stolen refresh token can only be used once.
- On password reset, all sessions for the user are deleted, forcing re-authentication on every device.

---

## Rate Limiting

Authentication endpoints use a stricter per-IP rate limit than the rest of the API:

| Environment | Auth rate limit           | Global rate limit            |
|-------------|---------------------------|------------------------------|
| Production  | 2 requests/sec (burst 5)  | 10 requests/sec (burst 20)   |
| Development | 100 requests/sec (burst 5000) | ~1000 requests/sec (burst 5000) |

Rate limiting is implemented via `tower-governor` using per-IP token buckets. Exceeding the limit returns `429 Too Many Requests`.

---

## Password Hashing

- **Passwords** are hashed with bcrypt at cost factor 12.
- **Refresh tokens and reset tokens** are hashed with SHA-256 (hex-encoded). SHA-256 is used instead of bcrypt because it is deterministic, allowing the server to look up sessions by hash without scanning all rows.

# Password Reset UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-mediated password reset flow: the site admin generates a one-time token via User Settings → Admin tab, shares it out-of-band, and the user enters it on the login screen.

**Architecture:** Backend adds `is_admin` to the users table and gates `POST /auth/forgot-password` behind an admin check. Frontend extends `AuthForm` with a reset view and adds an Admin tab to `UserSettingsModal` with a new `AdminTab` component.

**Tech Stack:** Rust/Axum/sqlx (backend), React/TypeScript/Vitest/@testing-library (frontend), CSS Modules

**Spec:** `docs/superpowers/specs/2026-03-12-password-reset-ui-design.md`

---

## Chunk 1: Backend — `is_admin` migration + model

### Task 1: Add `is_admin` migration

**Files:**
- Create: `server/migrations/20240312000003_is_admin.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Migration: Add is_admin flag to users
-- Grants admin to the earliest-registered user (first to sign up on self-hosted instance).

ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

UPDATE users
SET is_admin = true
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
```

- [ ] **Step 2: Verify migration applies cleanly**

```bash
cd server
cargo sqlx migrate run
```

Expected: migration runs without error. If the DB doesn't exist locally, run `docker-compose -f ../docker-compose.dev.yml up -d` first, then retry.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/20240312000003_is_admin.sql
git commit -m "feat(db): add is_admin column to users table"
```

---

### Task 2: Add `is_admin` to `User` and `UserDto`

**Files:**
- Modify: `server/src/models/mod.rs` (lines 13–56)

- [ ] **Step 1: Add `is_admin` to the `User` struct**

In `server/src/models/mod.rs`, add `is_admin: bool` to `User` after `updated_at`:

```rust
#[derive(Debug, Clone, FromRow)]
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
    pub is_admin: bool,
}
```

- [ ] **Step 2: Add `is_admin` to `UserDto` and the `From<User>` impl**

```rust
#[derive(Debug, Serialize)]
pub struct UserDto {
    pub id: Uuid,
    pub username: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
    pub status: String,
    pub custom_status: Option<String>,
    pub created_at: DateTime<Utc>,
    pub is_admin: bool,
}

impl From<User> for UserDto {
    fn from(user: User) -> Self {
        UserDto {
            id: user.id,
            username: user.username,
            email: user.email,
            avatar_url: user.avatar_url,
            status: user.status,
            custom_status: user.custom_status,
            created_at: user.created_at,
            is_admin: user.is_admin,
        }
    }
}
```

- [ ] **Step 3: Verify the project compiles**

```bash
cd server
cargo build 2>&1 | head -30
```

Expected: no errors. If `SELECT *` queries now fail to map `User`, add `is_admin` to the column list or use `SELECT *, false AS is_admin` in any raw query that doesn't touch the new column. The migration already adds the column so sqlx's `SELECT *` will include it.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
cd server
cargo test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/models/mod.rs
git commit -m "feat(models): add is_admin field to User and UserDto"
```

---

### Task 3: Protect `forgot_password` with admin gate and fix unknown-email handling

**Files:**
- Modify: `server/tests/common/mod.rs` (add routes)
- Create: `server/tests/auth_tests.rs`
- Modify: `server/src/handlers/auth.rs` (bottom of file — the `forgot_password` function)

The current `forgot_password` handler:
1. Is unauthenticated (no `AuthUser` extractor) — anyone can call it
2. Returns a silent 200 for unknown emails (enumeration prevention — not needed on an admin-only endpoint)

- [ ] **Step 1: Add password-reset routes to `common/mod.rs`**

In `server/tests/common/mod.rs`, add two routes to `create_test_app` just before the `.with_state(state)` line:

```rust
        // Password reset routes
        .route("/auth/forgot-password", post(handlers::auth::forgot_password))
        .route("/auth/reset-password", post(handlers::auth::reset_password))
```

- [ ] **Step 2: Write failing integration tests**

Create `server/tests/auth_tests.rs`:

```rust
mod common;

use axum::http::StatusCode;

#[tokio::test]
async fn forgot_password_requires_auth() {
    let pool = common::test_pool().await;
    let app = common::create_test_app(pool);

    let (status, _) = common::post_json(
        app,
        "/auth/forgot-password",
        serde_json::json!({ "email": "user@example.com" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn forgot_password_requires_admin() {
    let pool = common::test_pool().await;
    let username = common::unique_username();

    // Register a user — they get is_admin = false by default.
    // Explicitly force is_admin = false in case this is the very first user
    // on a fresh test DB (where the migration would have set them as admin).
    let app = common::create_test_app(pool.clone());
    let token = common::register_and_get_token(app, &username, "password123").await;

    sqlx::query("UPDATE users SET is_admin = false WHERE username = $1")
        .bind(&username)
        .execute(&pool)
        .await
        .unwrap();

    let app = common::create_test_app(pool);
    let (status, _) = common::post_json_authed(
        app,
        "/auth/forgot-password",
        &token,
        serde_json::json!({ "email": "other@example.com" }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN);
}
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
cd server
cargo test --test auth_tests 2>&1 | tail -20
```

Expected: FAIL — `forgot_password_requires_auth` receives 200 (endpoint currently has no auth), `forgot_password_requires_admin` receives 200 (no admin check).

- [ ] **Step 4: Update `forgot_password` to require auth + admin**

In `server/src/handlers/auth.rs`, update the `forgot_password` function signature and add the admin gate at the top. Also change the unknown-email branch to return a 404 (not silent 200):

```rust
pub async fn forgot_password(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<ForgotPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    req.validate()
        .map_err(|e| AppError::Validation(e.to_string()))?;

    // Admin-only endpoint — verify via DB lookup
    let is_admin: bool = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
        .bind(auth_user.user_id())
        .fetch_one(&state.pool)
        .await?;

    if !is_admin {
        return Err(AppError::Forbidden("Admin access required".into()));
    }

    // Find user by email — return 404 since this is admin-only (no enumeration risk)
    let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
        .bind(&req.email)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("No user found with email: {}", req.email)))?;

    // Generate a secure reset token (32 bytes, base64url encoded)
    let reset_token = {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        let bytes: [u8; 32] = rand::random();
        URL_SAFE_NO_PAD.encode(bytes)
    };

    let token_hash = hash_refresh_token(&reset_token);

    sqlx::query("DELETE FROM password_reset_tokens WHERE user_id = $1")
        .bind(user.id)
        .execute(&state.pool)
        .await?;

    sqlx::query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) \
         VALUES ($1, $2, NOW() + INTERVAL '1 hour')"
    )
    .bind(user.id)
    .bind(&token_hash)
    .execute(&state.pool)
    .await?;

    info!(
        "Password reset token created for user: {} ({})",
        user.username, user.id
    );

    Ok(Json(serde_json::json!({
        "message": "Password reset token generated",
        "token": reset_token,
        "expires_in_seconds": 3600,
        "note": "Share this token with the user to reset their password"
    })))
}
```

- [ ] **Step 5: Run the tests**

```bash
cd server
cargo test --test auth_tests 2>&1 | tail -20
```

Expected: both tests pass.

- [ ] **Step 6: Run all backend tests**

```bash
cd server
cargo test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/handlers/auth.rs server/tests/common/mod.rs server/tests/auth_tests.rs
git commit -m "feat(auth): gate forgot-password behind admin check"
```

---

## Chunk 2: Frontend — types, API client, restored code

### Task 4: Update TypeScript types

**Files:**
- Modify: `clients/web/src/types/index.ts`

- [ ] **Step 1: Add `is_admin` to `UserDto`**

In `clients/web/src/types/index.ts`, update `UserDto`:

```ts
export interface UserDto {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  status: UserStatus;
  custom_status: string | null;
  created_at: string;
  is_admin: boolean;
}
```

- [ ] **Step 2: Add password-reset types** (append after `PollVoteEvent`):

```ts
// ─── Password Reset ───────────────────────────────────────────────────────

export interface ForgotPasswordResponse {
  message: string;
  token: string;        // always present — admin-only endpoint, no enumeration risk
  expires_in_seconds: number;
  note: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}
```

- [ ] **Step 3: Restore types removed as merge artifact** (append after password-reset types):

```ts
// ─── ICE Servers (WebRTC) ─────────────────────────────────────────────────

export interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface IceServersResponse {
  iceServers: IceServer[];
  ttl: number;
}

// ─── Search ──────────────────────────────────────────────────────────────

export interface SearchQuery {
  q: string;
  channel_id?: string;
  before?: string;
  limit?: number;
}

export interface SearchResult {
  id: string;
  channel_id: string;
  author_id: string | null;
  author_username: string | null;
  content: string;
  highlight: string;
  created_at: string;
  rank: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  has_more: boolean;
  next_cursor: string | null;
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd clients/web
npm run typecheck
```

Expected: no errors (other than possibly unresolved references to the restored types — those get fixed in the next task).

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/types/index.ts
git commit -m "feat(types): add is_admin, password-reset types; restore search+ICE types"
```

---

### Task 5: Update API client

**Files:**
- Modify: `clients/web/src/api/client.ts`

- [ ] **Step 1: Add imports for new types**

In `client.ts`, add `ForgotPasswordResponse`, `ResetPasswordRequest`, `IceServer`, `IceServersResponse`, `SearchQuery`, `SearchResponse` to the import block at the top.

- [ ] **Step 2: Add `forgotPassword` and `resetPassword` methods**

Append to the `ApiClient` class (after the existing poll methods, before the closing brace):

```ts
// ─── Password Reset ──────────────────────────────────────────────────────

/** Generate a password reset token for a user by email. Admin only. */
forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  return this.request<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Reset a user's password using a reset token. */
resetPassword(data: ResetPasswordRequest): Promise<void> {
  return this.request<void>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

- [ ] **Step 3: Restore `searchMessages` and `getIceServers`**

```ts
// ─── Search ──────────────────────────────────────────────────────────────

/** Search messages in a server or specific channel. */
searchMessages(serverId: string, query: SearchQuery): Promise<SearchResponse> {
  const params = new URLSearchParams();
  params.set("q", query.q);
  if (query.channel_id) params.set("channel_id", query.channel_id);
  if (query.before) params.set("before", query.before);
  if (query.limit) params.set("limit", String(query.limit));
  return this.request<SearchResponse>(
    `/servers/${serverId}/search?${params.toString()}`
  );
}

// ─── ICE Servers (WebRTC) ──────────────────────────────────────────────

/** Get ICE servers for WebRTC peer connections, including TURN credentials. */
getIceServers(): Promise<IceServersResponse> {
  return this.request<IceServersResponse>("/ice-servers");
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd clients/web
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Run existing API client tests**

```bash
cd clients/web
npm test -- src/__tests__/api-client.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add clients/web/src/api/client.ts
git commit -m "feat(api): add forgotPassword, resetPassword; restore search+ICE methods"
```

---

## Chunk 3: Frontend — `AuthForm` reset view

### Task 6: Extend `AuthForm` with reset view

**Files:**
- Modify: `clients/web/src/components/auth/AuthForm.tsx`
- Modify: `clients/web/src/components/auth/AuthForm.module.css`
- Modify: `clients/web/src/__tests__/auth-form.test.tsx`

- [ ] **Step 1: Write failing tests for the reset view**

Two separate edits to `clients/web/src/__tests__/auth-form.test.tsx`:

**Edit 1** — add these lines at module scope, directly after the existing `vi.mock("../stores/authStore", ...)` block (Vitest requires `vi.mock` calls at module scope for hoisting):

```ts
import { act } from "@testing-library/react";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));
```

**Edit 2** — append the following `describe` block after the closing `});` of the existing `describe("AuthForm", ...)` block:

```ts
describe("AuthForm — reset view", () => {
  it("shows 'Have a reset token?' link on login view", () => {
    render(<AuthForm />);
    expect(screen.getByText("Have a reset token?")).toBeInTheDocument();
  });

  it("switches to reset view when link is clicked", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    expect(screen.getByText("Reset Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Reset Token")).toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeInTheDocument();
  });

  it("'Back to login' from reset view returns to login", async () => {
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.click(screen.getByText("Back to login"));
    expect(screen.getByText("Welcome back!")).toBeInTheDocument();
  });

  it("calls resetPassword with token and new password on submit", async () => {
    vi.mocked(api.resetPassword).mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.type(screen.getByLabelText("Reset Token"), "my-token-abc");
    await user.type(screen.getByLabelText("New Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(api.resetPassword).toHaveBeenCalledWith({
      token: "my-token-abc",
      new_password: "newpassword123",
    });
  });

  it("shows success message after reset and transitions to login", async () => {
    vi.useFakeTimers();
    vi.mocked(api.resetPassword).mockResolvedValueOnce(undefined);
    render(<AuthForm />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByText("Have a reset token?"));
    await user.type(screen.getByLabelText("Reset Token"), "my-token");
    await user.type(screen.getByLabelText("New Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(
      await screen.findByText("Password reset. You can now log in.")
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTime(2100));
    expect(screen.getByText("Welcome back!")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows error when resetPassword rejects", async () => {
    vi.mocked(api.resetPassword).mockRejectedValueOnce(
      new Error("Invalid or expired reset token")
    );
    render(<AuthForm />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Have a reset token?"));
    await user.type(screen.getByLabelText("Reset Token"), "bad-token");
    await user.type(screen.getByLabelText("New Password"), "newpassword123");
    await user.click(screen.getByRole("button", { name: "Reset Password" }));
    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("Invalid or expired reset token");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd clients/web
npm test -- src/__tests__/auth-form.test.tsx 2>&1 | tail -20
```

Expected: FAIL — "Have a reset token?" not found in DOM.

- [ ] **Step 3: Update `AuthForm.tsx`**

Replace the entire file content:

```tsx
import { useState, useEffect, useRef, type FormEvent } from "react";
import { useAuthStore } from "../../stores/authStore";
import { api } from "../../api/client";
import type { ResetPasswordRequest } from "../../types";
import styles from "./AuthForm.module.css";

type View = "login" | "register" | "reset";

export function AuthForm() {
  const [view, setView] = useState<View>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { login, register, error, clearError } = useAuthStore();

  // Cancel the 2-second post-reset transition timer if the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const switchView = (next: View) => {
    clearError();
    setResetError(null);
    setResetSuccess(false);
    setUsername("");
    setEmail("");
    setPassword("");
    setResetToken("");
    setNewPassword("");
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setView(next);
  };

  const handleLoginRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (view === "login") {
        await login({ username, password });
      } else {
        await register({ username, email: email || undefined, password });
      }
    } catch {
      // Error is stored in auth store
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResetError(null);
    try {
      const data: ResetPasswordRequest = {
        token: resetToken,
        new_password: newPassword,
      };
      await api.resetPassword(data);
      setResetSuccess(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        switchView("login");
      }, 2000);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>T</div>
          <h1 className={styles.logoText}>Together</h1>
        </div>

        {view === "reset" ? (
          <>
            <h2 className={styles.heading}>Reset Password</h2>
            <p className={styles.subtitle}>
              Enter the token your admin shared with you
            </p>

            {resetError && (
              <div className={styles.error} role="alert">
                {resetError}
              </div>
            )}
            {resetSuccess && (
              <div className={styles.success} role="alert" aria-live="polite">
                Password reset. You can now log in.
              </div>
            )}

            {!resetSuccess && (
              <form onSubmit={handleResetSubmit} className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reset-token">
                    Reset Token
                  </label>
                  <input
                    id="reset-token"
                    className={styles.input}
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste your reset token"
                    required
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="new-password">
                    New Password
                  </label>
                  <input
                    id="new-password"
                    className={styles.input}
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Resetting…" : "Reset Password"}
                </button>
              </form>
            )}

            <p className={styles.toggle}>
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => switchView("login")}
              >
                Back to login
              </button>
            </p>
          </>
        ) : (
          <>
            <h2 className={styles.heading}>
              {view === "login" ? "Welcome back!" : "Create an account"}
            </h2>
            <p className={styles.subtitle}>
              {view === "login"
                ? "Sign in to continue to Together"
                : "Join your community on Together"}
            </p>

            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleLoginRegisterSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  className={styles.input}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={view === "login" ? 1 : 3}
                  maxLength={32}
                  autoComplete="username"
                  autoFocus
                />
              </div>

              {view === "register" && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="email">
                    Email <span className={styles.optional}>(optional)</span>
                  </label>
                  <input
                    id="email"
                    className={styles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={view === "login" ? 1 : 8}
                  maxLength={128}
                  autoComplete={
                    view === "login" ? "current-password" : "new-password"
                  }
                />
              </div>

              <button
                type="submit"
                className={styles.submit}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Please wait..."
                  : view === "login"
                    ? "Sign In"
                    : "Create Account"}
              </button>
            </form>

            {view === "login" && (
              <p className={styles.toggle}>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => switchView("reset")}
                >
                  Have a reset token?
                </button>
              </p>
            )}

            <p className={styles.toggle}>
              {view === "login"
                ? "Don't have an account?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => switchView(view === "login" ? "register" : "login")}
              >
                {view === "login" ? "Register" : "Sign In"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add `.success` class to `AuthForm.module.css`**

Append to `clients/web/src/components/auth/AuthForm.module.css`:

```css
.success {
  background: rgba(59, 165, 93, 0.1);
  border: 1px solid rgba(59, 165, 93, 0.3);
  color: var(--status-online, #3ba55d);
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 13px;
  margin-bottom: 16px;
  text-align: center;
}
```

- [ ] **Step 5: Run the reset view tests**

```bash
cd clients/web
npm test -- src/__tests__/auth-form.test.tsx 2>&1 | tail -30
```

Expected: all tests pass (including existing login/register tests).

- [ ] **Step 6: Run full frontend test suite**

```bash
cd clients/web
npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Run typecheck and lint**

```bash
cd clients/web
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add clients/web/src/components/auth/AuthForm.tsx \
        clients/web/src/components/auth/AuthForm.module.css \
        clients/web/src/__tests__/auth-form.test.tsx
git commit -m "feat(auth): add password reset view to AuthForm"
```

---

## Chunk 4: Frontend — `AdminTab` + `UserSettingsModal`

### Task 7: Create `AdminTab` component

**Files:**
- Create: `clients/web/src/components/users/AdminTab.tsx`
- Create: `clients/web/src/__tests__/AdminTab.test.tsx`
- Modify: `clients/web/src/components/servers/ServerModals.module.css`

- [ ] **Step 1: Write failing tests for `AdminTab`**

Create `clients/web/src/__tests__/AdminTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTab } from "../components/users/AdminTab";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    forgotPassword: vi.fn(),
    setToken: vi.fn(),
    getToken: vi.fn(),
    setSessionExpiredCallback: vi.fn(),
  },
  ApiRequestError: class extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
Object.defineProperty(navigator, "clipboard", {
  value: mockClipboard,
  writable: true,
});

beforeEach(() => {
  vi.mocked(api.forgotPassword).mockReset();
  mockClipboard.writeText.mockReset();
});

describe("AdminTab", () => {
  it("renders email input and submit button", () => {
    render(<AdminTab />);
    expect(screen.getByLabelText("User's Email Address")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Generate Reset Token" })
    ).toBeInTheDocument();
  });

  it("shows token box and warning on success", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: "ok",
      token: "abc123token",
      expires_in_seconds: 3600,
      note: "share this",
    });
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("User's Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Generate Reset Token" }));
    await waitFor(() =>
      expect(screen.getByText("abc123token")).toBeInTheDocument()
    );
    expect(screen.getByText(/expires in 1 hour/i)).toBeInTheDocument();
  });

  it("copy button writes token to clipboard", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: "ok",
      token: "abc123token",
      expires_in_seconds: 3600,
      note: "share this",
    });
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("User's Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Generate Reset Token" }));
    await waitFor(() => expect(screen.getByText("abc123token")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(mockClipboard.writeText).toHaveBeenCalledWith("abc123token");
  });

  it("clears token result when email input is changed", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValueOnce({
      message: "ok",
      token: "abc123token",
      expires_in_seconds: 3600,
      note: "share this",
    });
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("User's Email Address"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Generate Reset Token" }));
    await waitFor(() => expect(screen.getByText("abc123token")).toBeInTheDocument());
    await user.type(screen.getByLabelText("User's Email Address"), "x");
    expect(screen.queryByText("abc123token")).not.toBeInTheDocument();
  });

  it("shows error on API failure", async () => {
    vi.mocked(api.forgotPassword).mockRejectedValueOnce(
      new Error("No user found with email: bad@example.com")
    );
    render(<AdminTab />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("User's Email Address"), "bad@example.com");
    await user.click(screen.getByRole("button", { name: "Generate Reset Token" }));
    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("No user found with email");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd clients/web
npm test -- src/__tests__/AdminTab.test.tsx 2>&1 | tail -10
```

Expected: FAIL — `AdminTab` module not found.

- [ ] **Step 3: Create `AdminTab.tsx`**

Create `clients/web/src/components/users/AdminTab.tsx`:

```tsx
import { useState } from "react";
import { api } from "../../api/client";
import type { ForgotPasswordResponse } from "../../types";
import styles from "../servers/ServerModals.module.css";

export function AdminTab() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null);

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (result !== null) setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.forgotPassword(email);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate token");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard?.writeText(result.token).catch(() => {
      // Fallback: token is selectable via user-select: all on .tokenBox
    });
  };

  return (
    <div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="admin-email">
            User's Email Address
          </label>
          <input
            id="admin-email"
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            required
            placeholder="user@example.com"
          />
        </div>
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isLoading}
          >
            {isLoading ? "Generating…" : "Generate Reset Token"}
          </button>
        </div>
      </form>

      {result && (
        <div className={styles.tokenSection}>
          <div className={styles.tokenBox}>{result.token}</div>
          <button
            type="button"
            className={styles.copyBtn}
            onClick={handleCopy}
          >
            Copy
          </button>
          <p className={styles.tokenWarning}>
            This token expires in 1 hour. Share it with the user now and tell
            them to click &ldquo;Have a reset token?&rdquo; on the login screen.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add CSS classes to `ServerModals.module.css`**

Append to `clients/web/src/components/servers/ServerModals.module.css`:

```css
/* ── Settings tabs (shared by UserSettingsModal and ServerSettingsModal) ─── */

.tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 16px;
}

.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 8px 16px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.tab:hover {
  color: var(--text-primary);
}

.tabActive {
  color: var(--text-primary);
  border-bottom-color: var(--accent-primary);
}

/* ── Admin token box ─────────────────────────────────────────────────── */

.tokenSection {
  margin-top: 16px;
}

.tokenBox {
  font-family: monospace;
  background: var(--bg-tertiary);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  word-break: break-all;
  user-select: all;
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.copyBtn {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.copyBtn:hover {
  background: var(--bg-hover);
}

.tokenWarning {
  color: var(--text-warning, #f0a500);
  font-size: 12px;
  margin-top: 8px;
}
```

- [ ] **Step 5: Run `AdminTab` tests**

```bash
cd clients/web
npm test -- src/__tests__/AdminTab.test.tsx 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add clients/web/src/components/users/AdminTab.tsx \
        clients/web/src/__tests__/AdminTab.test.tsx \
        clients/web/src/components/servers/ServerModals.module.css
git commit -m "feat(admin): add AdminTab component for password reset token generation"
```

---

### Task 8: Update `UserSettingsModal` with Admin tab

**Files:**
- Modify: `clients/web/src/components/users/UserSettingsModal.tsx`

- [ ] **Step 1: Write failing tests**

The existing `UserSettingsModal` tests live inline with the component (check `src/__tests__/modal.test.tsx` or similar). Create `clients/web/src/__tests__/user-settings-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserSettingsModal } from "../components/users/UserSettingsModal";
import { useAuthStore } from "../stores/authStore";

vi.mock("../stores/authStore", () => ({
  useAuthStore: vi.fn(),
}));
vi.mock("../components/users/AdminTab", () => ({
  AdminTab: () => <div data-testid="admin-tab-content">AdminTab</div>,
}));
vi.mock("../api/client", () => ({
  api: { setToken: vi.fn(), getToken: vi.fn(), setSessionExpiredCallback: vi.fn() },
  ApiRequestError: class extends Error {},
}));

const baseUser = {
  id: "1",
  username: "testuser",
  email: "test@example.com",
  avatar_url: null,
  status: "online" as const,
  custom_status: null,
  created_at: new Date().toISOString(),
  is_admin: false,
};

function setupMock(overrides: Partial<typeof baseUser> = {}) {
  const user = { ...baseUser, ...overrides };
  vi.mocked(useAuthStore).mockImplementation((selector?: unknown) => {
    const state = {
      user,
      updateProfile: vi.fn(),
      updatePresence: vi.fn(),
    };
    if (typeof selector === "function") return selector(state);
    return state;
  });
}

beforeEach(() => { setupMock(); });

describe("UserSettingsModal", () => {
  it("does not render tab bar for non-admin user", () => {
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("renders tab bar for admin user", () => {
    setupMock({ is_admin: true });
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Admin" })).toBeInTheDocument();
  });

  it("switches to Admin tab and renders AdminTab", async () => {
    setupMock({ is_admin: true });
    render(<UserSettingsModal open={true} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Admin" }));
    expect(screen.getByTestId("admin-tab-content")).toBeInTheDocument();
  });

  it("resets to Profile tab when modal closes and reopens", async () => {
    setupMock({ is_admin: true });
    const onClose = vi.fn();
    const { rerender } = render(
      <UserSettingsModal open={true} onClose={onClose} />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Admin" }));
    rerender(<UserSettingsModal open={false} onClose={onClose} />);
    rerender(<UserSettingsModal open={true} onClose={onClose} />);
    expect(
      screen.getByRole("tab", { name: "Profile" })
    ).toHaveAttribute("aria-selected", "true");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd clients/web
npm test -- src/__tests__/user-settings-modal.test.tsx 2>&1 | tail -10
```

Expected: FAIL — tab bar not found.

- [ ] **Step 3: Update `UserSettingsModal.tsx`**

Replace the entire file:

```tsx
import { useState, useEffect, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useAuthStore } from "../../stores/authStore";
import { AdminTab } from "./AdminTab";
import type { UserStatus } from "../../types";
import styles from "../servers/ServerModals.module.css";

interface UserSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: UserStatus; label: string; color: string }[] = [
  { value: "online", label: "Online", color: "var(--status-online)" },
  { value: "away", label: "Away", color: "var(--status-away)" },
  { value: "dnd", label: "Do Not Disturb", color: "var(--status-dnd)" },
  { value: "offline", label: "Invisible", color: "var(--status-offline)" },
];

export function UserSettingsModal({ open, onClose }: UserSettingsModalProps) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const updatePresence = useAuthStore((s) => s.updatePresence);

  const [activeTab, setActiveTab] = useState<"profile" | "admin">("profile");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || "");
  const [status, setStatus] = useState<UserStatus>(user?.status || "online");
  const [customStatus, setCustomStatus] = useState(user?.custom_status || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Reset to profile tab whenever the modal opens/closes.
  useEffect(() => {
    if (!open) setActiveTab("profile");
  }, [open]);

  if (!user) return null;

  const isOwner = user.is_admin;

  const handleClose = () => {
    setActiveTab("profile");
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      await updateProfile({
        avatar_url: avatarUrl.trim() || null,
        custom_status: customStatus.trim() || null,
      });
      if (status !== user.status) {
        updatePresence(status, customStatus.trim() || null);
      }
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="User Settings">
      {isOwner && (
        <div role="tablist" aria-label="User settings sections" className={styles.tabs}>
          <button
            role="tab"
            aria-selected={activeTab === "profile"}
            aria-controls="panel-profile"
            id="tab-profile"
            className={`${styles.tab} ${activeTab === "profile" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            Profile
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "admin"}
            aria-controls="panel-admin"
            id="tab-admin"
            className={`${styles.tab} ${activeTab === "admin" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("admin")}
          >
            Admin
          </button>
        </div>
      )}

      <div
        role="tabpanel"
        id="panel-profile"
        aria-labelledby="tab-profile"
        hidden={isOwner && activeTab !== "profile"}
      >
        {error && <div className={styles.error}>{error}</div>}
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label}>Username</label>
            <input
              className={styles.input}
              type="text"
              value={user.username}
              disabled
              style={{ opacity: 0.6 }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="settings-avatar">
              Avatar URL <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="settings-avatar"
              className={styles.input}
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="settings-status">
              Status
            </label>
            <select
              id="settings-status"
              className={styles.select}
              value={status}
              onChange={(e) => setStatus(e.target.value as UserStatus)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="settings-custom-status">
              Custom Status <span className={styles.optional}>(optional)</span>
            </label>
            <input
              id="settings-custom-status"
              className={styles.input}
              type="text"
              value={customStatus}
              onChange={(e) => setCustomStatus(e.target.value)}
              placeholder="What are you up to?"
            />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={handleClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </div>

      {isOwner && (
        <div
          role="tabpanel"
          id="panel-admin"
          aria-labelledby="tab-admin"
          hidden={activeTab !== "admin"}
        >
          <AdminTab />
        </div>
      )}
    </Modal>
  );
}
```

- [ ] **Step 4: Run `UserSettingsModal` tests**

```bash
cd clients/web
npm test -- src/__tests__/user-settings-modal.test.tsx 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 5: Run full test suite**

```bash
cd clients/web
npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Run typecheck and lint**

```bash
cd clients/web
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add clients/web/src/components/users/UserSettingsModal.tsx \
        clients/web/src/__tests__/user-settings-modal.test.tsx
git commit -m "feat(settings): add Admin tab to UserSettingsModal for token generation"
```

---

## Chunk 5: Final verification

### Task 9: Full build verification

- [ ] **Step 1: Run full backend test suite**

```bash
cd server
cargo test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 2: Run clippy**

```bash
cd server
cargo clippy -- -D warnings 2>&1 | tail -20
```

Expected: no warnings.

- [ ] **Step 3: Run rustfmt check**

```bash
cd server
cargo fmt --check
```

Expected: exit 0. If it fails, run `cargo fmt` and commit the formatting changes before proceeding.

- [ ] **Step 4: Run full frontend test suite**

```bash
cd clients/web
npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 5: Run frontend build**

```bash
cd clients/web
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Push to remote**

```bash
git push origin feature/password-reset
```

Then verify CI passes on GitHub Actions.

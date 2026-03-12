# Password Reset UI — Design Spec

**Date:** 2026-03-12
**Branch:** feature/password-reset
**Status:** Approved

---

## Overview

Add a password reset flow for self-hosted deployments where no email service is available. The site admin (first registered user) generates a one-time reset token via an Admin panel in their User Settings, shares it with the affected user out-of-band, and the user enters the token on the login screen to set a new password.

---

## Security Model

- `POST /auth/forgot-password` is **admin-only** — requires a valid JWT and a DB-level `is_admin` check in the handler (see Backend Changes §3). Unauthenticated or non-admin callers are rejected with `403 Forbidden`.
- The "Have a reset token?" entry point on the login screen is visible to everyone, but the token is single-use and expires after 1 hour — there is no self-service path to generate a token without admin involvement.
- Admin status is determined by `is_admin: bool` on the `users` table. The first registered user (`MIN(created_at)`) is set to `is_admin = true` via migration; all others default to `false`.
- **Limitation:** `is_admin` is read from `UserDto` at login/session-restore time and cached in the Zustand store. If `is_admin` changes in the database after a session is already active, the in-memory user object does not update until the next login or page reload. This is an accepted trade-off for the target deployment scale (one admin, small community).

---

## Backend Changes

### 1. Migration: `server/migrations/20240312000003_is_admin.sql`

Follows the existing sequential numbering after `20240312000002_password_reset.sql`. Independent of the password reset tokens migration — both can run in any order, but `000003` must run after the initial `users` table migration (`20240216000001`).

```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

-- Grant admin to the earliest-registered user.
UPDATE users
SET is_admin = true
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
```

### 2. `User` model / `UserDto`

Add `is_admin: bool` to both the `User` struct (`FromRow`) and `UserDto` (`Serialize`). `UserDto` is what the frontend receives on login, register, and `GET /users/@me`.

### 3. `forgot_password` handler — admin gate

`AuthUser` stores only `user_id` and `username` (JWT claims only — no DB lookup in the extractor). The admin check is done inside `forgot_password` itself:

```rust
pub async fn forgot_password(
    State(state): State<AppState>,
    auth_user: AuthUser,                       // requires valid JWT
    Json(req): Json<ForgotPasswordRequest>,
) -> AppResult<Json<serde_json::Value>> {
    // Verify caller is admin via DB lookup
    let is_admin: bool = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
        .bind(auth_user.user_id())
        .fetch_one(&state.pool)
        .await?;

    if !is_admin {
        return Err(AppError::Forbidden);
    }
    // … rest of existing logic unchanged
}
```

This keeps `AuthUser` and `Claims` unchanged — no JWT modification required.

---

## Types (`clients/web/src/types/index.ts`)

Add `is_admin: boolean` to `UserDto`:

```ts
export interface UserDto {
  // …existing fields…
  is_admin: boolean;
}
```

Add new password-reset types:

```ts
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

**Restore types removed as a merge artifact** (restore verbatim from `main`):

```ts
// IceServer, IceServersResponse — for WebRTC ICE server configuration
// SearchQuery, SearchResult, SearchResponse — for server message search
```

---

## API Client (`clients/web/src/api/client.ts`)

Add two methods:

```ts
/** POST /auth/forgot-password — Admin only; requires auth token. */
forgotPassword(email: string): Promise<ForgotPasswordResponse>

/** POST /auth/reset-password */
resetPassword(data: ResetPasswordRequest): Promise<void>
```

**Restore methods removed as a merge artifact** (restore verbatim from `main`):

```ts
searchMessages(serverId: string, query: SearchQuery): Promise<SearchResponse>
getIceServers(): Promise<IceServersResponse>
```

---

## Components

### 1. `AuthForm.tsx` (modified)

**State change:** replace `isLogin: boolean` with `view: "login" | "register" | "reset"`. On every view transition, call `clearError()` and reset all form fields.

**Login view additions:**
- Small "Have a reset token?" link below the submit button.
- Clicking it: `setView("reset")`.
- The existing "Create an account" / "Already have an account?" toggle remains, scoped to `login` and `register` views only.

**Reset view (new):**
- Heading: "Reset Password"
- Field 1: `token` — text input, label "Reset Token", placeholder "Paste your reset token"
- Field 2: `new_password` — password input, label "New Password"
- Submit button: "Reset Password" / "Resetting…" while in-flight
- Error message: inline, with `role="alert"` (consistent with existing error div in `AuthForm`)
- On success: display inline success message with `role="alert"` and `aria-live="polite"` — "Password reset. You can now log in." Then transition back to `view = "login"` after 2 seconds. The 2-second timer **must be cancelled in a `useEffect` cleanup function** to avoid calling `setState` on an unmounted component.
- "Back to login" link at the bottom — sets `view = "login"` and cancels any pending transition timer.

**Email-less users:** The `forgot_password` endpoint accepts email only. Users who registered without an email address cannot use this flow in this iteration. This is noted as out of scope.

### 2. `UserSettingsModal.tsx` (modified)

- Add `activeTab: "profile" | "admin"` state, default `"profile"`.
- On `onClose`: reset `activeTab` to `"profile"` before calling the passed-in `onClose`.
- Tab bar only appears when `user.is_admin === true`. Non-admins see no tab bar and always see the Profile form.
- Tab bar follows a partial WAI-ARIA Tabs pattern (see Accessibility section). Arrow-key navigation between tabs is deferred — same as `ServerSettingsModal`.
- Render `<AdminTab />` inside `role="tabpanel"` with `hidden` attribute when `activeTab !== "admin"`. The `hidden` attribute keeps `AdminTab` mounted for the modal lifetime but removes it from the accessibility tree when inactive.

### 3. `AdminTab.tsx` (new — `components/users/AdminTab.tsx`)

**State:** `email: string`, `isLoading: boolean`, `error: string | null`, `result: ForgotPasswordResponse | null` — local React state only.

**Behaviour:**
- Email input field: "User's Email Address". Changing the email value after a successful generation **clears `result`** (previous token is no longer relevant).
- Submit button: "Generate Reset Token" / "Generating…" while in-flight.
- Submitting clears both `result` and `error` before the request fires (backend deletes the old token automatically).
- On success: display token box (see CSS) with copy button and warning banner.
- Copy button calls `navigator.clipboard.writeText(result.token)`. If the Clipboard API is unavailable (non-HTTPS context), the token remains selectable in the `.tokenBox` via `user-select: all` as a fallback — no error is thrown.
- On error: inline error message with `role="alert"`.

**Token box content:**
- Read-only monospace box containing the full token value (`user-select: all` for easy manual selection)
- "Copy" button (`.copyBtn`) — copies token to clipboard
- Warning: "This token expires in 1 hour. Share it with the user now and tell them to click 'Have a reset token?' on the login screen." (styled with `.tokenWarning`)

### 4. `ServerModals.module.css` (modified)

Reuse the existing `.tabs`, `.tab`, `.tabActive` classes (added by the audit-log PR) for the `UserSettingsModal` tab bar — no duplication needed, both modals share this stylesheet.

**Note for implementer:** Before using the `hidden` HTML attribute on `role="tabpanel"` elements, verify that no global CSS rule overrides `[hidden]` with `display: block` or similar. If such a rule exists in `globals.css`, use `aria-hidden` plus a CSS visibility class instead.

Add new classes:
- `.tokenBox` — `font-family: monospace; background: var(--bg-secondary); padding: 8px 12px; border-radius: 4px; word-break: break-all; user-select: all`
- `.copyBtn` — small secondary button, right-aligned within `.tokenSection`
- `.tokenWarning` — `color: var(--text-warning, #f0a500); font-size: 13px; margin-top: 8px`
- `.tokenSection` — wrapper for token box + copy button + warning

---

## Accessibility

Tab bar in `UserSettingsModal` follows a **partial WAI-ARIA Tabs pattern** (arrow-key navigation deferred, same trade-off as `ServerSettingsModal`):

```tsx
<div role="tablist" aria-label="User settings sections">
  <button role="tab" aria-selected={activeTab === "profile"}
          aria-controls="panel-profile" id="tab-profile">Profile</button>
  <button role="tab" aria-selected={activeTab === "admin"}
          aria-controls="panel-admin" id="tab-admin">Admin</button>
</div>
<div role="tabpanel" id="panel-profile" aria-labelledby="tab-profile"
     hidden={activeTab !== "profile"}>
  {/* profile form */}
</div>
<div role="tabpanel" id="panel-admin" aria-labelledby="tab-admin"
     hidden={activeTab !== "admin"}>
  <AdminTab />
</div>
```

---

## Data Flow

```
Admin flow:
  Admin opens User Settings → sees "Admin" tab (is_admin only)
  Admin enters user's email → clicks "Generate Reset Token"
    └─ POST /auth/forgot-password (with JWT)
         ├─ 401 if no/invalid JWT
         ├─ 403 if not admin
         └─ 200: token displayed in copyable box
  Admin shares token with user out-of-band

User flow:
  User sees "Have a reset token?" on login screen → clicks link
  User enters token + new password → submits
    └─ POST /auth/reset-password
         ├─ 401 if token invalid or expired
         └─ 200: success message → auto-redirect to login after 2s
```

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Unauthenticated call to forgot-password | 401; frontend never reaches this (admin must be logged in) |
| Non-admin calls forgot-password | 403; `AdminTab` shows inline error |
| Unknown email | Since the endpoint is admin-only, enumeration prevention is unnecessary — the backend implementation should return a clear error (e.g. 404) rather than a silent 200. `AdminTab` shows the error inline. |
| User has no email | Flow unsupported (out of scope); admin sees the generic unknown-email success |
| Token expired or already used | Backend returns 401; reset view shows "Invalid or expired reset token" with `role="alert"` |
| Network error (either form) | Inline error message with `role="alert"` in the relevant component |
| New token generated before old one used | Backend deletes old token; UI clears `result` before submitting |
| `navigator.clipboard` unavailable | Token remains selectable in `.tokenBox` via `user-select: all` |
| 2-second transition timer fires on unmount | Cancelled via `useEffect` cleanup — no stale `setState` |

---

## Testing

**`auth-form.test.tsx`** (additions):
- "Have a reset token?" link is present on login view
- Clicking link switches to reset view
- Reset view renders token and new-password fields
- Successful reset shows success message (`role="alert"`) then transitions to login
- Error from API is displayed inline with `role="alert"`
- "Back to login" returns to login view without submitting
- Transition timer is cancelled if component unmounts before 2 seconds

**`AdminTab.test.tsx`** (new):
- Renders email input and submit button
- Shows token box and warning on successful API response
- Copy button writes token to clipboard via `navigator.clipboard.writeText`
- Changing email input after success clears the token box
- Inline error shown on API failure with `role="alert"`
- Submitting again clears previous token result before firing request

**`UserSettingsModal.test.tsx`** (additions):
- No tab bar rendered for non-admin user
- Tab bar rendered for admin user
- Clicking Admin tab reveals AdminTab panel
- Modal close resets to Profile tab

---

## Out of Scope

- Email/SMTP delivery (future iteration)
- Admin ability to list all users or their reset token status
- Password reset for users who registered without an email (username-based lookup is a future enhancement)
- Password strength meter
- Arrow-key keyboard navigation within the tab bar
- Bulk / multi-user token generation
- Promoting additional users to admin via the UI

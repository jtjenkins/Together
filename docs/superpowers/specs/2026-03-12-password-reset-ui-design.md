# Password Reset UI — Design Spec

**Date:** 2026-03-12
**Branch:** feature/password-reset
**Status:** Approved

---

## Overview

Add a password reset flow for self-hosted deployments where no email service is available. The site admin (first registered user) generates a one-time reset token via an Admin panel in their User Settings, shares it with the affected user out-of-band, and the user enters the token on the login screen to set a new password.

---

## Security Model

- `POST /auth/forgot-password` is **admin-only** — protected by the `AuthUser` extractor and a `403 Forbidden` check on `auth_user.is_admin`. Unauthenticated or non-admin callers are rejected.
- The "Have a reset token?" entry point on the login screen is visible to everyone, but the token is single-use and expires after 1 hour — there is no self-service path to generate a token without admin involvement.
- Admin status is determined by `is_admin: bool` on the `users` table. The first registered user (`MIN(created_at)`) is set to `is_admin = true` via migration; all others default to `false`.

---

## Backend Changes

### 1. Migration (new file)

`server/migrations/20240312000003_is_admin.sql`

```sql
ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false;

-- Grant admin to the earliest-registered user.
UPDATE users
SET is_admin = true
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
```

### 2. `User` model / `UserDto`

Add `is_admin: bool` to both the `User` struct (`FromRow`) and `UserDto` (`Serialize`). `UserDto` is what the frontend receives on login, register, and `GET /users/@me`.

### 3. `forgot_password` handler

Add `AuthUser` extractor as the first parameter. Return `AppError::Forbidden` if `auth_user.is_admin` is false. No other logic changes.

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
  token: string;
  expires_in_seconds: number;
  note: string;
}

export interface ResetPasswordRequest {
  token: string;
  new_password: string;
}
```

Restore types removed as a merge artifact:

```ts
// IceServer, IceServersResponse, SearchQuery, SearchResult, SearchResponse
```

---

## API Client (`clients/web/src/api/client.ts`)

Add two methods:

```ts
forgotPassword(email: string): Promise<ForgotPasswordResponse>
// POST /auth/forgot-password  (requires auth token — admin only)

resetPassword(data: ResetPasswordRequest): Promise<void>
// POST /auth/reset-password
```

Restore removed methods:

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
- On success: display inline success message "Password reset. You can now log in." then transition to `view = "login"` after 2 seconds.
- On error: inline error message (same `.error` style as existing).
- "Back to login" link at the bottom — sets `view = "login"`.

### 2. `UserSettingsModal.tsx` (modified)

- Add `useAuthStore((s) => s.user)` (already present via existing `user` variable).
- Add `activeTab: "profile" | "admin"` state, default `"profile"`.
- On `onClose`: reset `activeTab` to `"profile"` before calling the passed-in `onClose`.
- Tab bar only appears when `user.is_admin === true`. Non-admins see no tab bar and always see the Profile form.
- Tab bar follows WAI-ARIA Tabs pattern (same as `ServerSettingsModal` audit log design — see Accessibility section below).
- Render `<AdminTab />` inside `role="tabpanel"` with `hidden` attribute when `activeTab !== "admin"`.

### 3. `AdminTab.tsx` (new — `components/users/AdminTab.tsx`)

**State:** `email: string`, `isLoading: boolean`, `error: string | null`, `result: ForgotPasswordResponse | null` — local React state only.

**Render:**
- Label + email input: "User's Email Address"
- Submit button: "Generate Reset Token" / "Generating…" while in-flight
- On success: display a read-only token box (monospace, full token value) with a "Copy" button and a warning banner: "This token expires in 1 hour. Share it with the user now and tell them to use 'Have a reset token?' on the login screen."
- Generating a new token clears `result` and `error` before submitting (backend deletes the old token automatically).
- On error: inline error message.

### 4. `ServerModals.module.css` (modified)

Reuse the existing `.tabs`, `.tab`, `.tabActive` classes added by the audit-log PR for the `UserSettingsModal` tab bar (no duplication needed — both modals share this stylesheet).

Add new classes:
- `.tokenBox` — `font-family: monospace; background: var(--bg-secondary); padding: 8px 12px; border-radius: 4px; word-break: break-all; user-select: all`
- `.copyBtn` — small secondary button, right-aligned
- `.tokenWarning` — `color: var(--text-warning, #f0a500); font-size: 13px; margin-top: 8px`
- `.tokenSection` — wrapper for token box + copy + warning

---

## Accessibility

Tab bar in `UserSettingsModal` follows the same WAI-ARIA Tabs pattern as `ServerSettingsModal`:

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

The `hidden` HTML attribute keeps `AdminTab` mounted for the lifetime of the open modal but removes it from the accessibility tree when inactive.

---

## Data Flow

```
Admin flow:
  Admin opens User Settings → sees "Admin" tab (is_admin only)
  Admin enters user's email → clicks "Generate Reset Token"
    └─ POST /auth/forgot-password (with JWT)
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
| Non-admin calls forgot-password | Backend returns 403; frontend shows error in AdminTab |
| Unknown email | Backend returns 200 with no token (enumeration prevention); admin sees generic success — handle by showing token only when present in response |
| Token expired or already used | Backend returns 401; reset view shows "Invalid or expired reset token" |
| Network error (either form) | Inline error message in the relevant component |
| New token generated before old one is used | Backend deletes old token; UI clears previous result before submitting |

---

## Testing

**`auth-form.test.tsx`** (additions):
- "Have a reset token?" link is present on login view
- Clicking link switches to reset view
- Reset view renders token and new-password fields
- Successful reset shows success message then transitions to login
- Error from API is displayed inline
- "Back to login" returns to login view without submitting

**`AdminTab.test.tsx`** (new):
- Renders email input and submit button
- Shows token box and warning on successful API response
- Copy button writes token to clipboard
- Inline error shown on API failure
- Submitting again clears previous token result

**`UserSettingsModal.test.tsx`** (additions):
- No tab bar rendered for non-admin user
- Tab bar rendered for admin user
- Clicking Admin tab reveals AdminTab panel
- Modal close resets to Profile tab

---

## Out of Scope

- Email/SMTP delivery (future iteration)
- Admin ability to list all users or their reset token status
- Password strength meter
- Arrow-key keyboard navigation within the tab bar
- Bulk / multi-user token generation

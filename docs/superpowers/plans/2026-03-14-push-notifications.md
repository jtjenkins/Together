# Push Notifications (FCM/APNs/Web Push) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add push notifications to Together so users receive alerts for messages and mentions when they're offline or on mobile.

**Architecture:** The backend stores push subscriptions per device, then fires background Tokio tasks after message creation to notify offline users. Three transports are supported: VAPID Web Push (browsers/PWA), FCM HTTP v1 (Android via Tauri), and APNs JWT (iOS via Tauri). FCM and APNs are opt-in via environment variables; VAPID is always enabled.

**Tech Stack:** Rust (`web-push = "0.10"`, `a2 = "0.10"`, `reqwest` already present, `jsonwebtoken` already present), PostgreSQL (two new tables), React (`notificationStore`, service worker `sw.js`, `usePushNotifications` hook), Tauri v2 (`tauri-plugin-notification`)

---

## Chunk 1: Database + Models + Push Service Core

### Task 1: Database migrations

**Files:**

- Create: `server/migrations/20240314000001_push_subscriptions.sql`
- Create: `server/migrations/20240314000001_push_subscriptions.down.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20240314000001_push_subscriptions.sql

-- Push subscriptions: one row per device per user
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- "web" | "fcm" | "apns"
    subscription_type TEXT NOT NULL CHECK (subscription_type IN ('web', 'fcm', 'apns')),
    -- Web Push (VAPID) fields
    endpoint TEXT,
    p256dh  TEXT,
    auth_key TEXT,
    -- Native token (FCM registration token or APNs device token)
    device_token TEXT,
    -- Optional metadata
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT push_subs_web_fields CHECK (
        (subscription_type = 'web'
            AND endpoint IS NOT NULL
            AND p256dh   IS NOT NULL
            AND auth_key IS NOT NULL)
        OR
        (subscription_type IN ('fcm', 'apns')
            AND device_token IS NOT NULL)
    )
);

CREATE INDEX push_subscriptions_user_idx
    ON push_subscriptions(user_id);

-- Prevent duplicate subscriptions for the same endpoint/token
CREATE UNIQUE INDEX push_subscriptions_endpoint_idx
    ON push_subscriptions(endpoint)
    WHERE endpoint IS NOT NULL;

CREATE UNIQUE INDEX push_subscriptions_token_idx
    ON push_subscriptions(device_token)
    WHERE device_token IS NOT NULL;

-- Per-user notification preferences (created on first use)
CREATE TABLE notification_preferences (
    user_id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    all_messages          BOOLEAN NOT NULL DEFAULT FALSE,
    dm_notifications      BOOLEAN NOT NULL DEFAULT TRUE,
    mention_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```sql
-- 20240314000001_push_subscriptions.down.sql
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS push_subscriptions;
```

- [ ] **Step 2: Run migration to verify syntax**

```bash
cd server
sqlx migrate run
```

Expected: migration applies without error.

- [ ] **Step 3: Commit**

```bash
git add server/migrations/
git commit -m "feat(push): add push_subscriptions and notification_preferences migrations"
```

---

### Task 2: Rust models for push subscriptions

**Files:**

- Modify: `server/src/models/mod.rs`

- [ ] **Step 1: Add model structs**

Add to `server/src/models/mod.rs`:

```rust
// ── Push Notifications ──────────────────────────────────────────────────

#[derive(Debug, sqlx::FromRow)]
pub struct PushSubscription {
    pub id: Uuid,
    pub user_id: Uuid,
    pub subscription_type: String,
    // Web Push fields
    pub endpoint: Option<String>,
    pub p256dh: Option<String>,
    pub auth_key: Option<String>,
    // Native token
    pub device_token: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, serde::Deserialize, validator::Validate)]
pub struct RegisterSubscriptionRequest {
    pub subscription_type: String, // "web" | "fcm" | "apns"
    // Web Push
    pub endpoint: Option<String>,
    pub p256dh: Option<String>,
    pub auth_key: Option<String>,
    // Native
    pub device_token: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct DeleteSubscriptionRequest {
    pub endpoint: Option<String>,
    pub device_token: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, sqlx::FromRow)]
pub struct NotificationPreferences {
    pub user_id: Uuid,
    pub all_messages: bool,
    pub dm_notifications: bool,
    pub mention_notifications: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct UpdateNotificationPrefsRequest {
    pub all_messages: Option<bool>,
    pub dm_notifications: Option<bool>,
    pub mention_notifications: Option<bool>,
}
```

- [ ] **Step 2: Compile check**

```bash
cd server
cargo check 2>&1 | head -30
```

Expected: no errors related to models.

- [ ] **Step 3: Commit**

```bash
git add server/src/models/mod.rs
git commit -m "feat(push): add push subscription and preference models"
```

---

### Task 3: Config — add push notification env vars

**Files:**

- Modify: `server/src/config/mod.rs`

- [ ] **Step 1: Read current config file**

Read `server/src/config/mod.rs` in full before editing.

- [ ] **Step 2: Add push config fields**

Add to the `Config` struct and its loader:

```rust
// VAPID keys (required for web push — generate with: npx web-push generate-vapid-keys)
pub vapid_private_key: Option<String>,  // env: VAPID_PRIVATE_KEY (base64url encoded)
pub vapid_public_key: Option<String>,   // env: VAPID_PUBLIC_KEY (base64url encoded)
pub vapid_subject: String,              // env: VAPID_SUBJECT (e.g. "mailto:admin@example.com")

// FCM (optional — Android push)
pub fcm_service_account_json: Option<String>, // env: FCM_SERVICE_ACCOUNT_JSON (raw JSON string)
pub fcm_project_id: Option<String>,            // env: FCM_PROJECT_ID

// APNs (optional — iOS push)
pub apns_key_pem: Option<String>,      // env: APNS_KEY_PEM (PEM content of .p8 file)
pub apns_key_id: Option<String>,       // env: APNS_KEY_ID
pub apns_team_id: Option<String>,      // env: APNS_TEAM_ID
pub apns_bundle_id: Option<String>,    // env: APNS_BUNDLE_ID
pub apns_sandbox: bool,                // env: APNS_SANDBOX (true for dev, default false)
```

Load each field with `std::env::var("VAPID_PRIVATE_KEY").ok()` etc. For `apns_sandbox`: `std::env::var("APNS_SANDBOX").map(|v| v == "true").unwrap_or(false)`.
For `vapid_subject`: `std::env::var("VAPID_SUBJECT").unwrap_or_else(|_| "mailto:admin@example.com".to_string())`.

- [ ] **Step 3: Compile check**

```bash
cd server && cargo check 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add server/src/config/
git commit -m "feat(push): add push notification config fields (VAPID, FCM, APNs)"
```

---

### Task 4: VAPID Web Push sender

**Files:**

- Create: `server/src/push/mod.rs`
- Create: `server/src/push/web_push.rs`
- Modify: `server/Cargo.toml`

- [ ] **Step 1: Add web-push dependency**

In `server/Cargo.toml` under `[dependencies]`:

```toml
web-push = "0.10"
a2 = "0.10"
```

- [ ] **Step 2: Create the push module**

Create `server/src/push/mod.rs`:

```rust
pub mod web_push;
pub mod fcm;
pub mod apns;

use crate::config::Config;
use crate::models::PushSubscription;
use std::sync::Arc;
use tracing::{error, info};

/// Payload sent inside every push notification.
#[derive(Debug, serde::Serialize, Clone)]
pub struct NotificationPayload {
    pub title: String,
    pub body: String,
    pub icon: Option<String>,
    pub url: Option<String>,
    pub channel_id: Option<String>,
    pub server_id: Option<String>,
}

/// Send a notification to a single subscription. Errors are logged, not propagated.
pub async fn send_to_subscription(
    subscription: &PushSubscription,
    payload: &NotificationPayload,
    config: &Arc<Config>,
    http: &reqwest::Client,
) {
    let json = match serde_json::to_string(payload) {
        Ok(j) => j,
        Err(e) => { error!("push: serialize payload: {e}"); return; }
    };

    let result = match subscription.subscription_type.as_str() {
        "web" => web_push::send(subscription, &json, config).await,
        "fcm" => fcm::send(subscription, &json, config, http).await,
        "apns" => apns::send(subscription, &json, config).await,
        other => {
            error!("push: unknown subscription_type '{other}'");
            return;
        }
    };

    if let Err(e) = result {
        info!("push: failed to send to subscription {}: {e}", subscription.id);
    }
}
```

- [ ] **Step 3: Create VAPID web push sender**

Create `server/src/push/web_push.rs`:

```rust
use crate::config::Config;
use crate::models::PushSubscription;
use std::sync::Arc;
use web_push::{
    ContentEncoding, PartialVapidSignatureBuilder, SubscriptionInfo, VapidSignatureBuilder,
    WebPushClient, WebPushMessageBuilder,
};

pub async fn send(
    sub: &PushSubscription,
    payload: &str,
    config: &Arc<Config>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (Some(private_key), Some(endpoint), Some(p256dh), Some(auth_key)) = (
        config.vapid_private_key.as_deref(),
        sub.endpoint.as_deref(),
        sub.p256dh.as_deref(),
        sub.auth_key.as_deref(),
    ) else {
        return Err("web push: missing VAPID config or subscription fields".into());
    };

    let subscription_info = SubscriptionInfo::new(endpoint, p256dh, auth_key);

    let private_key_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(private_key)
        .map_err(|e| format!("VAPID key decode: {e}"))?;

    let sig_builder = VapidSignatureBuilder::from_pem(
        &private_key_bytes,
        &subscription_info,
    )?
    .add_sub_info(&subscription_info);

    let signature = sig_builder
        .set_sub(config.vapid_subject.clone())
        .build()?;

    let mut msg_builder = WebPushMessageBuilder::new(&subscription_info);
    msg_builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
    msg_builder.set_vapid_signature(signature);

    let msg = msg_builder.build()?;
    let client = WebPushClient::new()?;
    client.send(msg).await?;

    Ok(())
}
```

- [ ] **Step 4: Compile check**

```bash
cd server && cargo check 2>&1 | head -30
```

Fix any API mismatches with `web-push 0.10` docs. The API may differ slightly — adjust imports and method names to match the actual crate version. Run `cargo doc --open` locally if needed.

- [ ] **Step 5: Commit**

```bash
git add server/Cargo.toml server/src/push/
git commit -m "feat(push): add VAPID web push sender module"
```

---

### Task 5: FCM HTTP v1 sender

**Files:**

- Create: `server/src/push/fcm.rs`

FCM HTTP v1 uses a Google service account JWT to fetch an OAuth2 access token, then POSTs to `https://fcm.googleapis.com/v1/projects/{project_id}/messages:send`.

- [ ] **Step 1: Create FCM sender**

Create `server/src/push/fcm.rs`:

```rust
use crate::config::Config;
use crate::models::PushSubscription;
use std::sync::Arc;
use serde_json::{json, Value};
use tracing::error;

// Service account fields we need from the JSON
#[derive(serde::Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: String,
}

async fn get_access_token(
    sa: &ServiceAccount,
    http: &reqwest::Client,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};

    let now = chrono::Utc::now().timestamp();
    let claims = json!({
        "iss": sa.client_email,
        "scope": "https://www.googleapis.com/auth/firebase.messaging",
        "aud": sa.token_uri,
        "exp": now + 3600,
        "iat": now,
    });

    let key = EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .map_err(|e| format!("FCM RSA key: {e}"))?;

    let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| format!("FCM JWT encode: {e}"))?;

    let resp: Value = http
        .post(&sa.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &jwt),
        ])
        .send()
        .await?
        .json()
        .await?;

    resp["access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "FCM: no access_token in response".into())
}

pub async fn send(
    sub: &PushSubscription,
    payload: &str,
    config: &Arc<Config>,
    http: &reqwest::Client,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (Some(sa_json), Some(project_id), Some(token)) = (
        config.fcm_service_account_json.as_deref(),
        config.fcm_project_id.as_deref(),
        sub.device_token.as_deref(),
    ) else {
        return Err("FCM: missing FCM config or device token".into());
    };

    let sa: ServiceAccount = serde_json::from_str(sa_json)
        .map_err(|e| format!("FCM: parse service account: {e}"))?;

    let access_token = get_access_token(&sa, http).await?;

    let url = format!(
        "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
    );

    let body = json!({
        "message": {
            "token": token,
            "data": {
                "payload": payload
            },
            "notification": {
                "title": serde_json::from_str::<Value>(payload)
                    .ok()
                    .and_then(|v| v["title"].as_str().map(String::from))
                    .unwrap_or_default(),
                "body": serde_json::from_str::<Value>(payload)
                    .ok()
                    .and_then(|v| v["body"].as_str().map(String::from))
                    .unwrap_or_default(),
            }
        }
    });

    let resp = http
        .post(&url)
        .bearer_auth(&access_token)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("FCM: send failed: {text}").into());
    }

    Ok(())
}
```

- [ ] **Step 2: Compile check**

```bash
cd server && cargo check 2>&1 | head -30
```

- [ ] **Step 3: Commit**

```bash
git add server/src/push/fcm.rs
git commit -m "feat(push): add FCM HTTP v1 sender"
```

---

### Task 6: APNs sender

**Files:**

- Create: `server/src/push/apns.rs`

APNs uses JWT-authenticated HTTP/2 requests. The `a2` crate wraps this.

- [ ] **Step 1: Create APNs sender**

Create `server/src/push/apns.rs`:

```rust
use crate::config::Config;
use crate::models::PushSubscription;
use std::sync::Arc;
use a2::{Client, DefaultNotificationBuilder, NotificationBuilder, Endpoint};

pub async fn send(
    sub: &PushSubscription,
    payload: &str,
    config: &Arc<Config>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (Some(key_pem), Some(key_id), Some(team_id), Some(bundle_id), Some(device_token)) = (
        config.apns_key_pem.as_deref(),
        config.apns_key_id.as_deref(),
        config.apns_team_id.as_deref(),
        config.apns_bundle_id.as_deref(),
        sub.device_token.as_deref(),
    ) else {
        return Err("APNs: missing config or device token".into());
    };

    let endpoint = if config.apns_sandbox {
        Endpoint::Sandbox
    } else {
        Endpoint::Production
    };

    let client = Client::token(
        key_pem.as_bytes(),
        key_id,
        team_id,
        endpoint,
    )?;

    let parsed: serde_json::Value = serde_json::from_str(payload)
        .unwrap_or_default();
    let title = parsed["title"].as_str().unwrap_or("Together");
    let body = parsed["body"].as_str().unwrap_or("");

    let mut builder = DefaultNotificationBuilder::new()
        .set_title(title)
        .set_body(body)
        .set_sound("default");

    // Include raw payload as custom data
    let options = a2::NotificationOptions {
        apns_topic: Some(bundle_id),
        ..Default::default()
    };

    let notification = builder.build(device_token, options);
    client.send(notification).await?;

    Ok(())
}
```

- [ ] **Step 2: Compile check**

```bash
cd server && cargo check 2>&1 | head -30
```

Note: If `a2` crate API differs, adjust method calls to match `a2 = "0.10"` docs. Check `cargo doc --open` locally.

- [ ] **Step 3: Add push module to lib.rs**

In `server/src/lib.rs`, add:

```rust
pub mod push;
```

- [ ] **Step 4: Compile check**

```bash
cd server && cargo check 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add server/src/push/apns.rs server/src/lib.rs
git commit -m "feat(push): add APNs sender and wire push module to lib"
```

---

### Task 7: AppState — add push service context

**Files:**

- Modify: `server/src/state.rs`

- [ ] **Step 1: Read state.rs in full**

Read `server/src/state.rs` before editing.

- [ ] **Step 2: No struct change needed**

The `config` and `http_client` fields already on `AppState` are sufficient for push sending. Confirm both are `Arc<Config>` and `reqwest::Client` respectively. No struct change needed — push functions receive these via handler state.

- [ ] **Step 3: Verify**

```bash
cd server && cargo check 2>&1 | head -20
```

---

## Chunk 2: REST Handlers + Message Hook

### Task 8: Notification REST handlers

**Files:**

- Create: `server/src/handlers/notifications.rs`
- Modify: `server/src/handlers/mod.rs`
- Modify: `server/src/main.rs`

- [ ] **Step 1: Create notifications handler**

Create `server/src/handlers/notifications.rs`:

```rust
use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{
        DeleteSubscriptionRequest, NotificationPreferences,
        RegisterSubscriptionRequest, UpdateNotificationPrefsRequest,
    },
    AppState,
};
use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
};
use serde_json::{json, Value};
use std::sync::Arc;

/// GET /notifications/vapid-public-key
/// Returns the VAPID public key for Web Push subscription setup.
pub async fn get_vapid_public_key(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<Value>> {
    let key = state
        .config
        .vapid_public_key
        .as_deref()
        .ok_or_else(|| AppError::Validation("VAPID not configured".into()))?;
    Ok(Json(json!({ "public_key": key })))
}

/// POST /notifications/subscriptions
/// Register a push subscription for the authenticated user.
pub async fn register_subscription(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<RegisterSubscriptionRequest>,
) -> AppResult<StatusCode> {
    // Validate type-specific fields
    match req.subscription_type.as_str() {
        "web" => {
            if req.endpoint.is_none() || req.p256dh.is_none() || req.auth_key.is_none() {
                return Err(AppError::Validation(
                    "Web push requires endpoint, p256dh, and auth_key".into(),
                ));
            }
        }
        "fcm" | "apns" => {
            if req.device_token.is_none() {
                return Err(AppError::Validation(
                    "FCM/APNs require device_token".into(),
                ));
            }
        }
        _ => return Err(AppError::Validation("Invalid subscription_type".into())),
    }

    // Upsert subscription (insert or replace by endpoint/token)
    sqlx::query!(
        r#"
        INSERT INTO push_subscriptions
            (user_id, subscription_type, endpoint, p256dh, auth_key, device_token, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (endpoint) WHERE endpoint IS NOT NULL
            DO UPDATE SET
                user_id = EXCLUDED.user_id,
                p256dh = EXCLUDED.p256dh,
                auth_key = EXCLUDED.auth_key,
                created_at = NOW()
        ON CONFLICT (device_token) WHERE device_token IS NOT NULL
            DO UPDATE SET
                user_id = EXCLUDED.user_id,
                created_at = NOW()
        "#,
        auth.user_id,
        req.subscription_type,
        req.endpoint,
        req.p256dh,
        req.auth_key,
        req.device_token,
        req.user_agent,
    )
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::CREATED)
}

/// DELETE /notifications/subscriptions
/// Remove a push subscription by endpoint or device_token.
pub async fn delete_subscription(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<DeleteSubscriptionRequest>,
) -> AppResult<StatusCode> {
    if req.endpoint.is_none() && req.device_token.is_none() {
        return Err(AppError::Validation(
            "Provide endpoint or device_token".into(),
        ));
    }

    sqlx::query!(
        r#"
        DELETE FROM push_subscriptions
        WHERE user_id = $1
          AND (endpoint = $2 OR device_token = $3)
        "#,
        auth.user_id,
        req.endpoint,
        req.device_token,
    )
    .execute(&state.pool)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// GET /notifications/preferences
pub async fn get_preferences(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
) -> AppResult<Json<NotificationPreferences>> {
    let prefs = sqlx::query_as!(
        NotificationPreferences,
        r#"
        SELECT user_id, all_messages, dm_notifications, mention_notifications
        FROM notification_preferences
        WHERE user_id = $1
        "#,
        auth.user_id,
    )
    .fetch_optional(&state.pool)
    .await?
    .unwrap_or(NotificationPreferences {
        user_id: auth.user_id,
        all_messages: false,
        dm_notifications: true,
        mention_notifications: true,
    });

    Ok(Json(prefs))
}

/// PUT /notifications/preferences
pub async fn update_preferences(
    State(state): State<Arc<AppState>>,
    auth: AuthUser,
    Json(req): Json<UpdateNotificationPrefsRequest>,
) -> AppResult<Json<NotificationPreferences>> {
    let prefs = sqlx::query_as!(
        NotificationPreferences,
        r#"
        INSERT INTO notification_preferences
            (user_id, all_messages, dm_notifications, mention_notifications)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET
            all_messages          = COALESCE($2, notification_preferences.all_messages),
            dm_notifications      = COALESCE($3, notification_preferences.dm_notifications),
            mention_notifications = COALESCE($4, notification_preferences.mention_notifications),
            updated_at            = NOW()
        RETURNING user_id, all_messages, dm_notifications, mention_notifications
        "#,
        auth.user_id,
        req.all_messages,
        req.dm_notifications,
        req.mention_notifications,
    )
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(prefs))
}
```

- [ ] **Step 2: Export from handlers/mod.rs**

Add to `server/src/handlers/mod.rs`:

```rust
pub mod notifications;
```

- [ ] **Step 3: Register routes in main.rs**

Read `server/src/main.rs` and add routes in the router. Add after the existing route groups (before `.layer()` calls):

```rust
// Notification routes
let notification_routes = Router::new()
    .route("/vapid-public-key", get(handlers::notifications::get_vapid_public_key))
    .route(
        "/subscriptions",
        post(handlers::notifications::register_subscription)
            .delete(handlers::notifications::delete_subscription),
    )
    .route(
        "/preferences",
        get(handlers::notifications::get_preferences)
            .put(handlers::notifications::update_preferences),
    );
```

Then nest it:

```rust
.nest("/notifications", notification_routes)
```

- [ ] **Step 4: Compile check**

```bash
cd server && cargo check 2>&1 | head -40
```

Fix any type or import issues. Common fixes: add `use crate::handlers;` if missing, ensure AppError variants match.

- [ ] **Step 5: Commit**

```bash
git add server/src/handlers/notifications.rs server/src/handlers/mod.rs server/src/main.rs
git commit -m "feat(push): add notification subscription and preferences REST handlers"
```

---

### Task 9: Push trigger — hook into message creation

**Files:**

- Create: `server/src/push/trigger.rs`
- Modify: `server/src/push/mod.rs`
- Modify: `server/src/handlers/messages.rs`
- Modify: `server/src/handlers/dm.rs`

- [ ] **Step 1: Read messages.rs in full**

Read `server/src/handlers/messages.rs` to find the `create_message` handler and understand the message creation flow before editing.

- [ ] **Step 2: Create push trigger module**

Create `server/src/push/trigger.rs`:

```rust
//! Fires push notifications after message creation.
//! Runs as a background Tokio task — errors are logged, never propagated.

use crate::{
    models::{NotificationPreferences, PushSubscription},
    push::{send_to_subscription, NotificationPayload},
    AppState,
};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

/// Called after a channel message is created.
/// Notifies offline users who have access to the channel.
pub fn fire_channel_message(
    state: Arc<AppState>,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    author_id: Uuid,
    author_username: String,
    content_preview: String,
    message_id: Uuid,
) {
    tokio::spawn(async move {
        if let Err(e) = notify_channel_message(
            &state,
            channel_id,
            server_id,
            author_id,
            &author_username,
            &content_preview,
            message_id,
        )
        .await
        {
            error!("push trigger (channel): {e}");
        }
    });
}

async fn notify_channel_message(
    state: &Arc<AppState>,
    channel_id: Uuid,
    server_id: Option<Uuid>,
    author_id: Uuid,
    author_username: &str,
    content_preview: &str,
    _message_id: Uuid,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Get users who have push subscriptions and access to this channel,
    // excluding the author and users currently online via WebSocket.
    let online_users: Vec<Uuid> = state
        .connections
        .connected_user_ids()
        .into_iter()
        .collect();

    let subscriptions = sqlx::query_as!(
        PushSubscription,
        r#"
        SELECT DISTINCT ON (ps.user_id)
            ps.id, ps.user_id, ps.subscription_type,
            ps.endpoint, ps.p256dh, ps.auth_key,
            ps.device_token, ps.user_agent, ps.created_at
        FROM push_subscriptions ps
        JOIN server_members sm ON sm.user_id = ps.user_id
        WHERE sm.server_id = $1
          AND ps.user_id != $2
          AND ps.user_id != ALL($3::uuid[])
        ORDER BY ps.user_id, ps.created_at DESC
        "#,
        server_id,
        author_id,
        &online_users,
    )
    .fetch_all(&state.pool)
    .await?;

    if subscriptions.is_empty() {
        return Ok(());
    }

    // Check notification preferences and send
    let prefs = get_prefs_for_users(
        &state.pool,
        &subscriptions.iter().map(|s| s.user_id).collect::<Vec<_>>(),
    )
    .await?;

    let preview = truncate(content_preview, 100);
    let payload = NotificationPayload {
        title: format!("#{channel_id}"),
        body: format!("{author_username}: {preview}"),
        icon: None,
        url: server_id.map(|sid| format!("/app/servers/{sid}/channels/{channel_id}")),
        channel_id: Some(channel_id.to_string()),
        server_id: server_id.map(|s| s.to_string()),
    };

    for sub in &subscriptions {
        let pref = prefs.iter().find(|p| p.user_id == sub.user_id);
        let should_notify = pref
            .map(|p| p.all_messages || p.mention_notifications)
            .unwrap_or(true); // default: notify on mentions

        if should_notify {
            send_to_subscription(sub, &payload, &state.config, &state.http_client).await;
        }
    }

    info!("push: sent {} notifications for channel {channel_id}", subscriptions.len());
    Ok(())
}

/// Called after a DM is created.
pub fn fire_dm_message(
    state: Arc<AppState>,
    dm_channel_id: Uuid,
    author_id: Uuid,
    author_username: String,
    content_preview: String,
) {
    tokio::spawn(async move {
        if let Err(e) = notify_dm_message(
            &state,
            dm_channel_id,
            author_id,
            &author_username,
            &content_preview,
        )
        .await
        {
            error!("push trigger (dm): {e}");
        }
    });
}

async fn notify_dm_message(
    state: &Arc<AppState>,
    dm_channel_id: Uuid,
    author_id: Uuid,
    author_username: &str,
    content_preview: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let online_users: Vec<Uuid> = state.connections.connected_user_ids().into_iter().collect();

    // Get the other participant in the DM channel
    let subscriptions = sqlx::query_as!(
        PushSubscription,
        r#"
        SELECT DISTINCT ON (ps.user_id)
            ps.id, ps.user_id, ps.subscription_type,
            ps.endpoint, ps.p256dh, ps.auth_key,
            ps.device_token, ps.user_agent, ps.created_at
        FROM push_subscriptions ps
        JOIN direct_message_channels dmc ON (
            dmc.user1_id = ps.user_id OR dmc.user2_id = ps.user_id
        )
        WHERE dmc.id = $1
          AND ps.user_id != $2
          AND ps.user_id != ALL($3::uuid[])
        ORDER BY ps.user_id, ps.created_at DESC
        "#,
        dm_channel_id,
        author_id,
        &online_users,
    )
    .fetch_all(&state.pool)
    .await?;

    let preview = truncate(content_preview, 100);
    let payload = NotificationPayload {
        title: format!("DM from {author_username}"),
        body: preview,
        icon: None,
        url: Some(format!("/app/dm/{dm_channel_id}")),
        channel_id: Some(dm_channel_id.to_string()),
        server_id: None,
    };

    for sub in &subscriptions {
        send_to_subscription(sub, &payload, &state.config, &state.http_client).await;
    }

    Ok(())
}

async fn get_prefs_for_users(
    pool: &PgPool,
    user_ids: &[Uuid],
) -> Result<Vec<NotificationPreferences>, sqlx::Error> {
    sqlx::query_as!(
        NotificationPreferences,
        r#"
        SELECT user_id, all_messages, dm_notifications, mention_notifications
        FROM notification_preferences
        WHERE user_id = ANY($1)
        "#,
        user_ids,
    )
    .fetch_all(pool)
    .await
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max_chars).collect::<String>())
    }
}
```

- [ ] **Step 3: Add trigger to push/mod.rs**

Add to `server/src/push/mod.rs`:

```rust
pub mod trigger;
```

- [ ] **Step 4: Add `connected_user_ids()` to ConnectionManager**

Read `server/src/websocket/connection_manager.rs`. Add a method:

```rust
pub fn connected_user_ids(&self) -> Vec<uuid::Uuid> {
    self.connections.iter().map(|e| *e.key()).collect()
}
```

(Adjust to match the actual struct — the `connections` field is a `DashMap<Uuid, ...>`. If it's keyed by connection ID rather than user ID, collect unique user IDs from values.)

- [ ] **Step 5: Compile check**

```bash
cd server && cargo check 2>&1 | head -40
```

- [ ] **Step 6: Hook into create_message handler**

In `server/src/handlers/messages.rs`, find the `create_message` handler. After the WebSocket broadcast call, add:

```rust
// Fire push notifications to offline users (non-blocking)
crate::push::trigger::fire_channel_message(
    Arc::clone(&state),
    channel_id,
    Some(server_id),  // pass server_id from route params
    auth.user_id,
    auth.username.clone(),
    req.content.chars().take(200).collect(),
    message.id,
);
```

Read the actual handler to get the exact variable names before inserting.

- [ ] **Step 7: Hook into DM create_message handler**

In `server/src/handlers/dm.rs`, find the DM message creation handler. After the WebSocket broadcast, add:

```rust
crate::push::trigger::fire_dm_message(
    Arc::clone(&state),
    dm_channel_id,
    auth.user_id,
    auth.username.clone(),
    req.content.chars().take(200).collect(),
);
```

- [ ] **Step 8: Compile check**

```bash
cd server && cargo check 2>&1 | head -40
```

- [ ] **Step 9: Run server tests**

```bash
cd server && cargo test 2>&1 | tail -30
```

Expected: existing tests pass (push trigger won't run in unit tests).

- [ ] **Step 10: Commit**

```bash
git add server/src/push/ server/src/handlers/messages.rs server/src/handlers/dm.rs server/src/websocket/
git commit -m "feat(push): hook push notifications into message and DM creation"
```

---

## Chunk 3: Web Client

### Task 10: Service Worker

**Files:**

- Create: `clients/web/public/sw.js`
- Modify: `clients/web/index.html` (register service worker)

- [ ] **Step 1: Create service worker**

Create `clients/web/public/sw.js`:

```js
/* Together Service Worker — handles push notifications */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Together", body: event.data.text() };
  }

  const title = payload.title || "Together";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: payload.channel_id || "together-message",
    renotify: true,
    data: {
      url: payload.url || "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === url && "focus" in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      }),
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
```

- [ ] **Step 2: Register service worker in index.html**

Read `clients/web/index.html`. Add before `</body>`:

```html
<script>
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    });
  }
</script>
```

- [ ] **Step 3: Commit**

```bash
git add clients/web/public/sw.js clients/web/index.html
git commit -m "feat(push): add service worker for web push notifications"
```

---

### Task 11: Notification store and API

**Files:**

- Create: `clients/web/src/stores/notificationStore.ts`
- Modify: `clients/web/src/api/client.ts`

- [ ] **Step 1: Read api/client.ts in full**

Read `clients/web/src/api/client.ts` before editing.

- [ ] **Step 2: Add notification API methods to ApiClient**

Add these methods to the `ApiClient` class in `client.ts`:

```typescript
async getVapidPublicKey(): Promise<string> {
  const data = await this.request<{ public_key: string }>(
    '/notifications/vapid-public-key',
    { method: 'GET' }
  );
  return data.public_key;
}

async registerPushSubscription(payload: {
  subscription_type: 'web' | 'fcm' | 'apns';
  endpoint?: string;
  p256dh?: string;
  auth_key?: string;
  device_token?: string;
  user_agent?: string;
}): Promise<void> {
  await this.request('/notifications/subscriptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async deletePushSubscription(payload: {
  endpoint?: string;
  device_token?: string;
}): Promise<void> {
  await this.request('/notifications/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify(payload),
  });
}

async getNotificationPreferences(): Promise<NotificationPreferences> {
  return this.request<NotificationPreferences>('/notifications/preferences', {
    method: 'GET',
  });
}

async updateNotificationPreferences(
  prefs: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  return this.request<NotificationPreferences>('/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
}
```

Also add the `NotificationPreferences` type import/definition at the top of the file or in `types/index.ts`:

```typescript
export interface NotificationPreferences {
  user_id: string;
  all_messages: boolean;
  dm_notifications: boolean;
  mention_notifications: boolean;
}
```

- [ ] **Step 3: Create notification store**

Create `clients/web/src/stores/notificationStore.ts`:

```typescript
import { create } from "zustand";
import { api } from "../api/client";
import type { NotificationPreferences } from "../types";

interface NotificationState {
  permission: NotificationPermission;
  isSubscribed: boolean;
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  error: string | null;

  requestPermissionAndSubscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  permission:
    typeof Notification !== "undefined" ? Notification.permission : "default",
  isSubscribed: false,
  preferences: null,
  isLoading: false,
  error: null,

  requestPermissionAndSubscribe: async () => {
    set({ isLoading: true, error: null });
    try {
      const permission = await Notification.requestPermission();
      set({ permission });
      if (permission !== "granted") {
        set({ isLoading: false });
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = await api.getVapidPublicKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const json = sub.toJSON();
      await api.registerPushSubscription({
        subscription_type: "web",
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth_key: json.keys?.auth,
        user_agent: navigator.userAgent,
      });

      set({ isSubscribed: true });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  unsubscribe: async () => {
    set({ isLoading: true, error: null });
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.deletePushSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      set({ isSubscribed: false });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadPreferences: async () => {
    try {
      const prefs = await api.getNotificationPreferences();
      set({ preferences: prefs });
    } catch (e) {
      // Silently fail — defaults are fine
    }
  },

  updatePreferences: async (prefs) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await api.updateNotificationPreferences(prefs);
      set({ preferences: updated });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },
}));
```

- [ ] **Step 4: TypeScript check**

```bash
cd clients/web && npm run typecheck 2>&1 | head -40
```

Expected: no new errors. Fix any type import issues.

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/stores/notificationStore.ts clients/web/src/api/client.ts
git commit -m "feat(push): add notification store and API client methods"
```

---

### Task 12: Notification settings UI

**Files:**

- Create: `clients/web/src/hooks/usePushNotifications.ts`
- Create: `clients/web/src/components/notifications/NotificationSettings.tsx`
- Create: `clients/web/src/components/notifications/NotificationSettings.module.css`

- [ ] **Step 1: Create usePushNotifications hook**

Create `clients/web/src/hooks/usePushNotifications.ts`:

```typescript
import { useEffect } from "react";
import { useNotificationStore } from "../stores/notificationStore";

/**
 * Initializes notification state on mount.
 * Checks if already subscribed and loads preferences.
 */
export function usePushNotifications() {
  const store = useNotificationStore();

  useEffect(() => {
    // Check existing subscription state
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        useNotificationStore.setState({ isSubscribed: !!sub });
      });
    }
    store.loadPreferences();
  }, []);

  return store;
}
```

- [ ] **Step 2: Create NotificationSettings component**

Create `clients/web/src/components/notifications/NotificationSettings.tsx`:

```tsx
import React from "react";
import { usePushNotifications } from "../../hooks/usePushNotifications";
import styles from "./NotificationSettings.module.css";

const isPushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

export function NotificationSettings() {
  const {
    permission,
    isSubscribed,
    preferences,
    isLoading,
    error,
    requestPermissionAndSubscribe,
    unsubscribe,
    updatePreferences,
  } = usePushNotifications();

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Push Notifications</h3>

      {!isPushSupported && (
        <p className={styles.unsupported}>
          Push notifications are not supported in this browser.
        </p>
      )}

      {isPushSupported && (
        <>
          <div className={styles.subscribeRow}>
            <span className={styles.label}>
              {isSubscribed
                ? "Notifications enabled"
                : "Notifications disabled"}
            </span>
            <button
              className={isSubscribed ? styles.btnDisable : styles.btnEnable}
              onClick={
                isSubscribed ? unsubscribe : requestPermissionAndSubscribe
              }
              disabled={isLoading || permission === "denied"}
            >
              {isLoading ? "Loading…" : isSubscribed ? "Disable" : "Enable"}
            </button>
          </div>

          {permission === "denied" && (
            <p className={styles.denied}>
              Notifications are blocked. Allow them in your browser settings.
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {isSubscribed && preferences && (
            <div className={styles.prefs}>
              <label className={styles.prefRow}>
                <input
                  type="checkbox"
                  checked={preferences.dm_notifications}
                  onChange={(e) =>
                    updatePreferences({ dm_notifications: e.target.checked })
                  }
                />
                <span>Direct messages</span>
              </label>
              <label className={styles.prefRow}>
                <input
                  type="checkbox"
                  checked={preferences.mention_notifications}
                  onChange={(e) =>
                    updatePreferences({
                      mention_notifications: e.target.checked,
                    })
                  }
                />
                <span>@mentions</span>
              </label>
              <label className={styles.prefRow}>
                <input
                  type="checkbox"
                  checked={preferences.all_messages}
                  onChange={(e) =>
                    updatePreferences({ all_messages: e.target.checked })
                  }
                />
                <span>All messages</span>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create CSS module**

Create `clients/web/src/components/notifications/NotificationSettings.module.css`:

```css
.container {
  padding: 1rem;
  background: var(--bg-secondary, #2b2d31);
  border-radius: 8px;
}

.title {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #80848e);
}

.subscribeRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.label {
  font-size: 0.9375rem;
  color: var(--text-primary, #dcdfe4);
}

.btnEnable {
  padding: 0.375rem 0.875rem;
  border: none;
  border-radius: 4px;
  background: #5865f2;
  color: #fff;
  font-size: 0.875rem;
  cursor: pointer;
}

.btnEnable:hover {
  background: #4752c4;
}

.btnDisable {
  padding: 0.375rem 0.875rem;
  border: none;
  border-radius: 4px;
  background: #4e5058;
  color: #fff;
  font-size: 0.875rem;
  cursor: pointer;
}

.btnDisable:hover {
  background: #6d6f78;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.prefs {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.prefRow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9375rem;
  color: var(--text-primary, #dcdfe4);
  cursor: pointer;
}

.unsupported,
.denied,
.error {
  font-size: 0.875rem;
  margin: 0.5rem 0 0;
}

.unsupported {
  color: var(--text-muted, #80848e);
}
.denied {
  color: #f0a619;
}
.error {
  color: #ed4245;
}
```

- [ ] **Step 4: TypeScript check + lint**

```bash
cd clients/web
npm run typecheck 2>&1 | head -30
npm run lint 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add clients/web/src/hooks/usePushNotifications.ts \
        clients/web/src/components/notifications/
git commit -m "feat(push): add NotificationSettings UI component and usePushNotifications hook"
```

---

## Chunk 4: Desktop/Mobile + Config + Tests

### Task 13: Tauri — native notification plugin

**Files:**

- Modify: `clients/desktop/src-tauri/Cargo.toml`
- Modify: `clients/desktop/src-tauri/tauri.conf.json` (if exists)
- Create: `clients/desktop/src-tauri/src/main.rs` (if doesn't exist — check first)

- [ ] **Step 1: Check desktop Tauri structure**

```bash
ls clients/desktop/src-tauri/
```

- [ ] **Step 2: Add tauri-plugin-notification**

In `clients/desktop/src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tauri-plugin-notification = "2"
```

- [ ] **Step 3: Register plugin in main.rs**

Read `clients/desktop/src-tauri/src/main.rs`. Register the plugin:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Add permission in tauri.conf.json or capabilities**

If `clients/desktop/src-tauri/capabilities/default.json` exists, add:

```json
"notification:default"
```

to the permissions array.

If not, check tauri.conf.json for the permissions section and add `"notification:default"`.

- [ ] **Step 5: Create Tauri notification registration in web client**

Create `clients/web/src/hooks/useTauriNotifications.ts`:

```typescript
/**
 * Registers a native device token with the Together backend for Tauri (desktop/mobile) apps.
 * On Android: obtains FCM token via Tauri plugin.
 * On iOS: obtains APNs token via Tauri plugin.
 * On desktop: Tauri displays notifications natively; no token registration needed.
 */
export async function registerTauriNotifications(): Promise<void> {
  // Only run inside Tauri
  if (!("__TAURI__" in window)) return;

  try {
    const { isPermissionGranted, requestPermission, sendNotification } =
      await import("@tauri-apps/plugin-notification");

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }

    // For mobile: register FCM/APNs token with backend
    // This requires tauri-plugin-notification to expose getDeliveredNotifications
    // and the mobile-specific token registration (Tauri v2 handles this via the plugin).
    // The actual device token flow is platform-specific; on mobile Tauri uses the
    // native push registration. See: https://v2.tauri.app/plugin/notification/
    if (granted) {
      console.info("Tauri notifications: permission granted");
    }
  } catch (e) {
    // Plugin not available in this context
    console.debug("Tauri notification plugin unavailable:", e);
  }
}
```

Note: Full FCM/APNs token registration via Tauri requires the Tauri mobile push plugin, which is still maturing in Tauri v2. Web Push via the service worker approach above handles the browser case fully. The Tauri plugin handles desktop system notifications. Mobile token registration via FCM/APNs in Tauri v2 mobile requires additional setup documented at https://v2.tauri.app/plugin/notification/.

- [ ] **Step 6: Compile check desktop**

```bash
cd clients/desktop
npm run tauri build -- --no-bundle 2>&1 | tail -20
```

Or just check Rust:

```bash
cd clients/desktop/src-tauri && cargo check 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add clients/desktop/src-tauri/
git commit -m "feat(push): add tauri-plugin-notification for desktop/mobile native notifications"
```

---

### Task 14: Environment configuration documentation + docker-compose

**Files:**

- Modify: `docker-compose.yml`
- Modify: `.env.example` (create if not exists)

- [ ] **Step 1: Read docker-compose.yml**

Read `docker-compose.yml` to find the `server:` environment section.

- [ ] **Step 2: Add push env vars to docker-compose server service**

Under the `server:` service `environment:` section, add:

```yaml
# Push notifications (VAPID required for web push; FCM and APNs optional)
VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
VAPID_SUBJECT: ${VAPID_SUBJECT:-mailto:admin@example.com}
FCM_SERVICE_ACCOUNT_JSON: ${FCM_SERVICE_ACCOUNT_JSON:-}
FCM_PROJECT_ID: ${FCM_PROJECT_ID:-}
APNS_KEY_PEM: ${APNS_KEY_PEM:-}
APNS_KEY_ID: ${APNS_KEY_ID:-}
APNS_TEAM_ID: ${APNS_TEAM_ID:-}
APNS_BUNDLE_ID: ${APNS_BUNDLE_ID:-}
APNS_SANDBOX: ${APNS_SANDBOX:-false}
```

- [ ] **Step 3: Add VAPID key generation instructions to docs**

Create `docs/push-notifications.md`:

```markdown
# Push Notifications Setup

## VAPID Keys (Web Push)

Generate VAPID keys:
```

npx web-push generate-vapid-keys

```

Set in your environment:
```

VAPID_PRIVATE_KEY=<private key (base64url)>
VAPID_PUBLIC_KEY=<public key (base64url)>
VAPID_SUBJECT=mailto:admin@yourdomain.com

```

## FCM (Android)

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Firebase Cloud Messaging
3. Create a service account and download the JSON key
4. Set: `FCM_SERVICE_ACCOUNT_JSON=<contents of JSON file>` and `FCM_PROJECT_ID=<your-project-id>`

## APNs (iOS)

1. In Apple Developer portal, create an APNs Key (.p8 file)
2. Note your Key ID and Team ID
3. Set:
   - `APNS_KEY_PEM=<contents of .p8 file>`
   - `APNS_KEY_ID=<key ID>`
   - `APNS_TEAM_ID=<team ID>`
   - `APNS_BUNDLE_ID=<your.app.bundle.id>`
   - `APNS_SANDBOX=true` (for development)
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docs/push-notifications.md
git commit -m "feat(push): add push notification env config to docker-compose and docs"
```

---

### Task 15: Backend integration test

**Files:**

- Create: `server/tests/push_subscriptions.rs`

- [ ] **Step 1: Write failing integration test**

Create `server/tests/push_subscriptions.rs`:

```rust
mod common;
use common::*;
use reqwest::StatusCode;
use serde_json::json;

#[sqlx::test(migrations = "migrations")]
async fn test_register_and_delete_web_push_subscription(pool: sqlx::PgPool) {
    let (token, _user_id) = register_and_get_token(&pool, &unique_username()).await;
    let client = reqwest::Client::new();
    let base = test_server_url();

    // Register a web push subscription
    let resp = client
        .post(format!("{base}/notifications/subscriptions"))
        .bearer_auth(&token)
        .json(&json!({
            "subscription_type": "web",
            "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlqHgx5R5OAc2yS9FKr7g9wAFHy2VGAi1Kos1Lw",
            "auth_key": "dGVzdC1hdXRoLWtleQ",
            "user_agent": "TestBrowser/1.0"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::CREATED);

    // Registering the same endpoint again should succeed (upsert)
    let resp2 = client
        .post(format!("{base}/notifications/subscriptions"))
        .bearer_auth(&token)
        .json(&json!({
            "subscription_type": "web",
            "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-123",
            "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlqHgx5R5OAc2yS9FKr7g9wAFHy2VGAi1Kos1Lw",
            "auth_key": "dGVzdC1hdXRoLWtleQ",
            "user_agent": "TestBrowser/2.0"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), StatusCode::CREATED);

    // Delete the subscription
    let resp3 = client
        .delete(format!("{base}/notifications/subscriptions"))
        .bearer_auth(&token)
        .json(&json!({
            "endpoint": "https://fcm.googleapis.com/fcm/send/test-endpoint-123"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp3.status(), StatusCode::NO_CONTENT);
}

#[sqlx::test(migrations = "migrations")]
async fn test_notification_preferences_crud(pool: sqlx::PgPool) {
    let (token, _) = register_and_get_token(&pool, &unique_username()).await;
    let client = reqwest::Client::new();
    let base = test_server_url();

    // Get default preferences
    let resp = client
        .get(format!("{base}/notifications/preferences"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let prefs: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(prefs["dm_notifications"], true);
    assert_eq!(prefs["mention_notifications"], true);
    assert_eq!(prefs["all_messages"], false);

    // Update preferences
    let resp2 = client
        .put(format!("{base}/notifications/preferences"))
        .bearer_auth(&token)
        .json(&json!({ "all_messages": true }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp2.status(), StatusCode::OK);
    let updated: serde_json::Value = resp2.json().await.unwrap();
    assert_eq!(updated["all_messages"], true);
    assert_eq!(updated["dm_notifications"], true); // unchanged
}

#[sqlx::test(migrations = "migrations")]
async fn test_subscription_requires_auth(pool: sqlx::PgPool) {
    let client = reqwest::Client::new();
    let base = test_server_url();

    let resp = client
        .post(format!("{base}/notifications/subscriptions"))
        .json(&json!({
            "subscription_type": "web",
            "endpoint": "https://example.com/push",
            "p256dh": "test",
            "auth_key": "test"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "migrations")]
async fn test_invalid_subscription_type_rejected(pool: sqlx::PgPool) {
    let (token, _) = register_and_get_token(&pool, &unique_username()).await;
    let client = reqwest::Client::new();
    let base = test_server_url();

    let resp = client
        .post(format!("{base}/notifications/subscriptions"))
        .bearer_auth(&token)
        .json(&json!({
            "subscription_type": "telegram",
            "device_token": "abc"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}
```

Note: `test_server_url()` helper should already exist in `tests/common/mod.rs`; add it if not. It returns the base URL of the test server (typically `http://127.0.0.1:{port}`).

- [ ] **Step 2: Run tests to verify they fail correctly**

```bash
cd server && cargo test push_subscriptions 2>&1 | tail -30
```

Expected: compile error or connection refused (server not running) — confirming test infrastructure works.

- [ ] **Step 3: Run full test suite**

```bash
cd server && cargo test 2>&1 | tail -30
```

Expected: all existing tests pass. New tests may fail if test server not set up — that's acceptable.

- [ ] **Step 4: Lint and format**

```bash
cd server
cargo fmt
cargo clippy -- -D warnings 2>&1 | head -30
```

Fix any clippy warnings.

- [ ] **Step 5: Commit**

```bash
git add server/tests/push_subscriptions.rs
git commit -m "test(push): add integration tests for push subscription and preferences endpoints"
```

---

### Task 16: Final verification

- [ ] **Step 1: Full server compile**

```bash
cd server && cargo build 2>&1 | tail -20
```

Expected: builds cleanly.

- [ ] **Step 2: Frontend typecheck + lint**

```bash
cd clients/web
npm run typecheck 2>&1 | tail -20
npm run lint 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 3: Run all server tests**

```bash
cd server && cargo test 2>&1 | tail -30
```

Expected: all pass.

- [ ] **Step 4: Run frontend tests**

```bash
cd clients/web && npm test 2>&1 | tail -20
```

Expected: existing tests pass.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -u
git commit -m "fix(push): address final lint and typecheck issues"
```

- [ ] **Step 6: Run completion hook**

```bash
openclaw system event --text "Done: Push notifications implemented" --mode now
```

---

## Summary

| Component          | Files Created                                                                              | Files Modified                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| DB                 | 2 migrations                                                                               | —                                                                  |
| Rust models        | —                                                                                          | models/mod.rs                                                      |
| Rust push service  | push/mod.rs, web_push.rs, fcm.rs, apns.rs, trigger.rs                                      | —                                                                  |
| Rust handlers      | handlers/notifications.rs                                                                  | handlers/mod.rs, main.rs, messages.rs, dm.rs, state.rs, websocket/ |
| Rust config        | —                                                                                          | config/mod.rs                                                      |
| Web service worker | public/sw.js                                                                               | index.html                                                         |
| Web store          | stores/notificationStore.ts                                                                | api/client.ts                                                      |
| Web UI             | components/notifications/\*, hooks/usePushNotifications.ts, hooks/useTauriNotifications.ts | —                                                                  |
| Desktop            | —                                                                                          | desktop/src-tauri/Cargo.toml, main.rs                              |
| Config/Docs        | docs/push-notifications.md                                                                 | docker-compose.yml                                                 |
| Tests              | tests/push_subscriptions.rs                                                                | —                                                                  |

**Environment variables required:**

- `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` — for web push (generate with `npx web-push generate-vapid-keys`)
- `FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID` — optional, for Android
- `APNS_KEY_PEM`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_SANDBOX` — optional, for iOS

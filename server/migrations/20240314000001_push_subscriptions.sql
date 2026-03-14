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

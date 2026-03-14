//! Fires push notifications after message creation (non-blocking background tasks).

use crate::{
    models::{NotificationPreferences, PushSubscription},
    push::{send_to_subscription, NotificationPayload},
    state::AppState,
};
use sqlx::PgPool;
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

/// Called after a channel message is created.
pub fn fire_channel_message(
    state: Arc<AppState>,
    channel_id: Uuid,
    server_id: Uuid,
    author_id: Uuid,
    author_username: String,
    content_preview: String,
) {
    tokio::spawn(async move {
        if let Err(e) = notify_channel_message(
            &state,
            channel_id,
            server_id,
            author_id,
            &author_username,
            &content_preview,
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
    server_id: Uuid,
    author_id: Uuid,
    author_username: &str,
    content_preview: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let online_users = state.connections.connected_user_ids().await;

    let subscriptions = sqlx::query_as::<_, PushSubscription>(
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
    )
    .bind(server_id)
    .bind(author_id)
    .bind(&online_users)
    .fetch_all(&state.pool)
    .await?;

    if subscriptions.is_empty() {
        return Ok(());
    }

    let user_ids: Vec<Uuid> = subscriptions.iter().map(|s| s.user_id).collect();
    let prefs = get_prefs_for_users(&state.pool, &user_ids).await?;

    let payload = NotificationPayload {
        title: format!("New message in #{channel_id}"),
        body: format!("{author_username}: {}", truncate(content_preview, 100)),
        icon: None,
        url: Some(format!("/channels/{channel_id}")),
        channel_id: Some(channel_id.to_string()),
        server_id: Some(server_id.to_string()),
    };

    let mut sent = 0usize;
    for sub in &subscriptions {
        let pref = prefs.iter().find(|p| p.user_id == sub.user_id);
        let should_notify = pref
            .map(|p| p.all_messages || p.mention_notifications)
            .unwrap_or(true);

        if should_notify {
            send_to_subscription(sub, &payload, &state.config, &state.http_client).await;
            sent += 1;
        }
    }

    if sent > 0 {
        info!("push: sent {sent} notifications for channel {channel_id}");
    }
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
    let online_users = state.connections.connected_user_ids().await;

    let subscriptions = sqlx::query_as::<_, PushSubscription>(
        r#"
        SELECT DISTINCT ON (ps.user_id)
            ps.id, ps.user_id, ps.subscription_type,
            ps.endpoint, ps.p256dh, ps.auth_key,
            ps.device_token, ps.user_agent, ps.created_at
        FROM push_subscriptions ps
        JOIN direct_message_members dmm ON dmm.user_id = ps.user_id
        WHERE dmm.channel_id = $1
          AND ps.user_id != $2
          AND ps.user_id != ALL($3::uuid[])
        ORDER BY ps.user_id, ps.created_at DESC
        "#,
    )
    .bind(dm_channel_id)
    .bind(author_id)
    .bind(&online_users)
    .fetch_all(&state.pool)
    .await?;

    let payload = NotificationPayload {
        title: format!("DM from {author_username}"),
        body: truncate(content_preview, 100),
        icon: None,
        url: Some(format!("/dm/{dm_channel_id}")),
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
    sqlx::query_as::<_, NotificationPreferences>(
        r#"
        SELECT user_id, all_messages, dm_notifications, mention_notifications
        FROM notification_preferences
        WHERE user_id = ANY($1)
        "#,
    )
    .bind(user_ids)
    .fetch_all(pool)
    .await
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

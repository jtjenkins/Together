pub mod apns;
pub mod fcm;
pub mod trigger;
pub mod web_push;

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
        Err(e) => {
            error!("push: serialize payload: {e}");
            return;
        }
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
        info!(
            "push: failed to deliver to subscription {}: {e}",
            subscription.id
        );
    }
}

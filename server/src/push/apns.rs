use crate::config::Config;
use crate::models::PushSubscription;
use a2::{Client, ClientConfig, DefaultNotificationBuilder, Endpoint, NotificationBuilder, NotificationOptions};
use std::sync::Arc;

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

    let client_config = ClientConfig::new(endpoint);
    let mut pem_reader = key_pem.as_bytes();
    let client = Client::token(&mut pem_reader, key_id, team_id, client_config)?;

    let parsed: serde_json::Value = serde_json::from_str(payload).unwrap_or_default();
    let title = parsed["title"].as_str().unwrap_or("Together");
    let body_text = parsed["body"].as_str().unwrap_or("");

    let options = NotificationOptions {
        apns_topic: Some(bundle_id),
        ..Default::default()
    };

    let notification = DefaultNotificationBuilder::new()
        .set_title(title)
        .set_body(body_text)
        .set_sound("default")
        .build(device_token, options);

    client.send(notification).await?;

    Ok(())
}

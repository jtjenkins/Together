use crate::config::Config;
use crate::models::PushSubscription;
use std::sync::Arc;
use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, VapidSignatureBuilder, WebPushClient,
    WebPushMessageBuilder, URL_SAFE_NO_PAD,
};

pub async fn send(
    sub: &PushSubscription,
    payload: &str,
    config: &Arc<Config>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let (Some(private_key_b64), Some(endpoint), Some(p256dh), Some(auth_key)) = (
        config.vapid_private_key.as_deref(),
        sub.endpoint.as_deref(),
        sub.p256dh.as_deref(),
        sub.auth_key.as_deref(),
    ) else {
        return Err("web push: missing VAPID config or subscription fields".into());
    };

    let subscription_info = SubscriptionInfo::new(endpoint, p256dh, auth_key);

    let mut sig_builder =
        VapidSignatureBuilder::from_base64(private_key_b64, URL_SAFE_NO_PAD, &subscription_info)?;

    // Include the VAPID subject (mailto: or https: URI identifying the sender)
    sig_builder.add_claim("sub", config.vapid_subject.as_str());

    let signature = sig_builder.build()?;

    let mut msg_builder = WebPushMessageBuilder::new(&subscription_info);
    msg_builder.set_payload(ContentEncoding::Aes128Gcm, payload.as_bytes());
    msg_builder.set_vapid_signature(signature);

    let msg = msg_builder.build()?;
    let client = IsahcWebPushClient::new()?;
    client.send(msg).await?;

    Ok(())
}

use crate::config::Config;
use crate::models::PushSubscription;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::{json, Value};
use std::sync::Arc;

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
    let now = chrono::Utc::now().timestamp();
    let claims = json!({
        "iss": sa.client_email,
        "scope": "https://www.googleapis.com/auth/firebase.messaging",
        "aud": sa.token_uri,
        "exp": now + 3600,
        "iat": now,
    });

    let key = EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .map_err(|e| format!("FCM RSA key parse: {e}"))?;

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
        return Err("FCM: missing config or device token".into());
    };

    let sa: ServiceAccount =
        serde_json::from_str(sa_json).map_err(|e| format!("FCM: parse service account: {e}"))?;

    let access_token = get_access_token(&sa, http).await?;

    let parsed: Value = serde_json::from_str(payload).unwrap_or_default();
    let title = parsed["title"].as_str().unwrap_or("Together").to_string();
    let body = parsed["body"].as_str().unwrap_or("").to_string();

    let url = format!("https://fcm.googleapis.com/v1/projects/{project_id}/messages:send");

    let body_json = json!({
        "message": {
            "token": token,
            "data": { "payload": payload },
            "notification": { "title": title, "body": body }
        }
    });

    let resp = http
        .post(&url)
        .bearer_auth(&access_token)
        .json(&body_json)
        .send()
        .await?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("FCM: send failed: {text}").into());
    }

    Ok(())
}

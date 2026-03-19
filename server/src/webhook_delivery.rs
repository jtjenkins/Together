//! In-memory webhook delivery queue with exponential-backoff retry.
//!
//! # Design
//!
//! An unbounded `mpsc` channel carries `DeliveryJob` values from event
//! handlers to a single background worker task.  The worker spawns one
//! independent task per delivery job; each task runs up to MAX_ATTEMPTS
//! attempts sequentially, sleeping between attempts (5 s then 15 s).
//!
//! # Signature format
//!
//! ```text
//! X-Together-Signature-256: sha256=<lowercase-hex>
//! ```
//!
//! Receivers verify the signature by computing
//! `HMAC-SHA256(secret, body_bytes)` and comparing to the header value.
//! The header mimics the GitHub webhook signature format so existing
//! verification libraries work out of the box.

use std::sync::Arc;
use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::PgPool;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use uuid::Uuid;

// ── Public API ────────────────────────────────────────────────────────────────

/// A queued webhook delivery job.
#[derive(Debug, Clone)]
pub struct DeliveryJob {
    /// Webhook DB row id — used to update delivery stats.
    pub webhook_id: Uuid,
    /// Target URL.
    pub url: String,
    /// HMAC-SHA256 signing secret (plaintext).
    pub secret: String,
    /// Serialised JSON event payload.
    pub payload: String,
}

impl DeliveryJob {
    pub fn new(webhook_id: Uuid, url: String, secret: String, payload: String) -> Self {
        Self {
            webhook_id,
            url,
            secret,
            payload,
        }
    }
}

/// Cheap handle for enqueuing delivery jobs from anywhere in the server.
#[derive(Clone)]
pub struct WebhookQueue(UnboundedSender<DeliveryJob>);

impl WebhookQueue {
    /// Enqueue a delivery job.  Never blocks; silently drops if the worker has
    /// stopped (which only happens on shutdown).
    pub fn send(&self, job: DeliveryJob) {
        let _ = self.0.send(job);
    }
}

/// Spawn the background delivery worker and return a queue handle.
///
/// Call once in `main` after the DB pool and HTTP client are ready.
pub fn start_worker(pool: PgPool, http_client: reqwest::Client) -> WebhookQueue {
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(run_worker(rx, pool, http_client));
    WebhookQueue(tx)
}

// ── Internal worker ───────────────────────────────────────────────────────────

const MAX_ATTEMPTS: u8 = 3;
/// Delay before attempt N (0-indexed): 5 s before attempt 2, 15 s before attempt 3.
const RETRY_DELAYS_SECS: [u64; 2] = [5, 15];

async fn run_worker(
    mut rx: UnboundedReceiver<DeliveryJob>,
    pool: PgPool,
    http_client: reqwest::Client,
) {
    while let Some(job) = rx.recv().await {
        let pool = pool.clone();
        let client = http_client.clone();
        // Each job runs in its own task; retries happen sequentially within
        // that task (sleep between attempts) rather than via nested spawns,
        // which keeps the future Send.
        tokio::spawn(run_job(job, pool, client));
    }
}

/// Execute a single delivery job, retrying on failure up to MAX_ATTEMPTS times.
async fn run_job(job: DeliveryJob, pool: PgPool, client: reqwest::Client) {
    let mut last_success = false;

    for attempt in 1u8..=MAX_ATTEMPTS {
        // Sleep before retry attempts.
        if attempt > 1 {
            let delay = RETRY_DELAYS_SECS[(attempt - 2) as usize];
            tracing::info!(
                webhook_id = %job.webhook_id,
                attempt,
                retry_delay_secs = delay,
                "Webhook delivery failed; retrying"
            );
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }

        last_success = attempt_delivery(&job, attempt, &client).await;
        if last_success {
            break;
        }
    }

    if last_success {
        tracing::debug!(webhook_id = %job.webhook_id, "Webhook delivered successfully");
        let _ = sqlx::query(
            "UPDATE webhooks SET delivery_failures = 0, last_used_at = NOW() WHERE id = $1",
        )
        .bind(job.webhook_id)
        .execute(&pool)
        .await;
    } else {
        tracing::warn!(
            webhook_id = %job.webhook_id,
            "Webhook delivery exhausted all retries"
        );
        let _ = sqlx::query(
            "UPDATE webhooks SET delivery_failures = delivery_failures + 1 WHERE id = $1",
        )
        .bind(job.webhook_id)
        .execute(&pool)
        .await;
    }
}

/// Make one HTTP POST attempt. Returns `true` on a 2xx response.
async fn attempt_delivery(job: &DeliveryJob, attempt: u8, client: &reqwest::Client) -> bool {
    let signature = sign_payload(&job.secret, job.payload.as_bytes());

    let result = client
        .post(&job.url)
        .header("Content-Type", "application/json")
        .header("X-Together-Signature-256", &signature)
        .header("X-Together-Hook-ID", job.webhook_id.to_string())
        .header("X-Together-Delivery-Attempt", attempt.to_string())
        .body(job.payload.clone())
        .timeout(Duration::from_secs(10))
        .send()
        .await;

    match result {
        Ok(resp) => resp.status().is_success(),
        Err(e) => {
            tracing::warn!(
                webhook_id = %job.webhook_id,
                attempt,
                error = %e,
                "Webhook HTTP request failed"
            );
            false
        }
    }
}

// ── HMAC-SHA256 helper ────────────────────────────────────────────────────────

fn sign_payload(secret: &str, body: &[u8]) -> String {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(body);
    let result = mac.finalize().into_bytes();
    let hex: String = result.iter().map(|b| format!("{:02x}", b)).collect();
    format!("sha256={hex}")
}

// ── Fire helpers (called from event handlers) ─────────────────────────────────

/// Query all enabled webhooks for a server that subscribe to `event_type`,
/// then enqueue a delivery job for each one.
pub async fn fire_event(
    queue: &WebhookQueue,
    pool: &PgPool,
    server_id: Uuid,
    event_type: &str,
    payload: serde_json::Value,
) {
    #[derive(sqlx::FromRow)]
    struct WebhookRow {
        id: Uuid,
        url: String,
        secret: String,
    }

    let webhooks: Vec<WebhookRow> = match sqlx::query_as::<_, WebhookRow>(
        "SELECT id, url, secret FROM webhooks
         WHERE server_id = $1
           AND enabled = TRUE
           AND event_types @> to_jsonb($2::text)",
    )
    .bind(server_id)
    .bind(event_type)
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = ?e, "Failed to query webhooks for event dispatch");
            return;
        }
    };

    if webhooks.is_empty() {
        return;
    }

    let envelope = serde_json::json!({
        "event": event_type,
        "server_id": server_id,
        "data": payload,
    });

    let body = match serde_json::to_string(&envelope) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = ?e, "Failed to serialize webhook payload");
            return;
        }
    };

    let body = Arc::new(body);
    for wh in webhooks {
        queue.send(DeliveryJob::new(wh.id, wh.url, wh.secret, (*body).clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_payload_produces_sha256_prefix() {
        let sig = sign_payload("mysecret", b"hello");
        assert!(
            sig.starts_with("sha256="),
            "signature should start with sha256="
        );
        assert_eq!(sig.len(), 7 + 64, "sha256= (7) + 64 hex chars");
    }

    #[test]
    fn sign_payload_is_deterministic() {
        let a = sign_payload("key", b"body");
        let b = sign_payload("key", b"body");
        assert_eq!(a, b);
    }

    #[test]
    fn sign_payload_differs_with_different_secret() {
        let a = sign_payload("key1", b"body");
        let b = sign_payload("key2", b"body");
        assert_ne!(a, b);
    }
}

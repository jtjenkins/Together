use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

/// Tracks active WebSocket connections keyed by user ID.
///
/// Cheaply cloneable — all clones share the same underlying map via `Arc`.
#[derive(Clone, Default)]
pub struct ConnectionManager {
    connections: Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<String>>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new connection for the given user.
    ///
    /// If the user already has a connection (e.g. they reconnected), the old
    /// sender is replaced. The old send half will be dropped, closing the
    /// previous connection's outbound channel.
    pub async fn add(&self, user_id: Uuid, tx: mpsc::UnboundedSender<String>) {
        self.connections.write().await.insert(user_id, tx);
    }

    /// Remove the connection for the given user (called on disconnect).
    pub async fn remove(&self, user_id: Uuid) {
        self.connections.write().await.remove(&user_id);
    }

    /// Send a JSON-serialized message to a single user.
    ///
    /// Silently ignores sends to users who are not connected or whose channel
    /// has already been closed — a failed broadcast is always non-fatal.
    pub async fn send_to_user(&self, user_id: Uuid, message: &str) {
        let conns = self.connections.read().await;
        if let Some(tx) = conns.get(&user_id) {
            let _ = tx.send(message.to_owned());
        }
    }

    /// Send a JSON-serialized message to every user in the provided list.
    ///
    /// Stale or disconnected entries are silently skipped.
    pub async fn broadcast_to_users(&self, user_ids: &[Uuid], message: &str) {
        let conns = self.connections.read().await;
        for user_id in user_ids {
            if let Some(tx) = conns.get(user_id) {
                let _ = tx.send(message.to_owned());
            }
        }
    }

    /// Returns `true` if the user currently has an active WebSocket connection.
    #[allow(dead_code)]
    pub async fn is_connected(&self, user_id: Uuid) -> bool {
        self.connections.read().await.contains_key(&user_id)
    }

    /// Returns the number of currently connected users.
    #[allow(dead_code)]
    pub async fn connection_count(&self) -> usize {
        self.connections.read().await.len()
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_channel() -> (
        mpsc::UnboundedSender<String>,
        mpsc::UnboundedReceiver<String>,
    ) {
        mpsc::unbounded_channel()
    }

    #[tokio::test]
    async fn add_and_is_connected() {
        let mgr = ConnectionManager::new();
        let user = Uuid::new_v4();
        let (tx, _rx) = make_channel();

        assert!(!mgr.is_connected(user).await);
        mgr.add(user, tx).await;
        assert!(mgr.is_connected(user).await);
    }

    #[tokio::test]
    async fn remove_clears_connection() {
        let mgr = ConnectionManager::new();
        let user = Uuid::new_v4();
        let (tx, _rx) = make_channel();

        mgr.add(user, tx).await;
        mgr.remove(user).await;
        assert!(!mgr.is_connected(user).await);
    }

    #[tokio::test]
    async fn send_to_user_delivers_message() {
        let mgr = ConnectionManager::new();
        let user = Uuid::new_v4();
        let (tx, mut rx) = make_channel();

        mgr.add(user, tx).await;
        mgr.send_to_user(user, "hello").await;

        assert_eq!(rx.recv().await.unwrap(), "hello");
    }

    #[tokio::test]
    async fn send_to_disconnected_user_is_noop() {
        let mgr = ConnectionManager::new();
        // Should not panic or error
        mgr.send_to_user(Uuid::new_v4(), "dropped").await;
    }

    #[tokio::test]
    async fn broadcast_to_users_sends_to_all_connected() {
        let mgr = ConnectionManager::new();
        let u1 = Uuid::new_v4();
        let u2 = Uuid::new_v4();
        let u3 = Uuid::new_v4(); // not connected

        let (tx1, mut rx1) = make_channel();
        let (tx2, mut rx2) = make_channel();
        mgr.add(u1, tx1).await;
        mgr.add(u2, tx2).await;

        mgr.broadcast_to_users(&[u1, u2, u3], "broadcast").await;

        assert_eq!(rx1.recv().await.unwrap(), "broadcast");
        assert_eq!(rx2.recv().await.unwrap(), "broadcast");
    }

    #[tokio::test]
    async fn connection_count_tracks_adds_and_removes() {
        let mgr = ConnectionManager::new();
        assert_eq!(mgr.connection_count().await, 0);

        let u1 = Uuid::new_v4();
        let u2 = Uuid::new_v4();
        let (tx1, _rx1) = make_channel();
        let (tx2, _rx2) = make_channel();

        mgr.add(u1, tx1).await;
        assert_eq!(mgr.connection_count().await, 1);

        mgr.add(u2, tx2).await;
        assert_eq!(mgr.connection_count().await, 2);

        mgr.remove(u1).await;
        assert_eq!(mgr.connection_count().await, 1);
    }

    #[tokio::test]
    async fn clone_shares_state() {
        let mgr = ConnectionManager::new();
        let clone = mgr.clone();

        let user = Uuid::new_v4();
        let (tx, _rx) = make_channel();

        mgr.add(user, tx).await;
        // The clone should see the same connection
        assert!(clone.is_connected(user).await);
    }
}

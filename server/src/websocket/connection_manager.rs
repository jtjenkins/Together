use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use uuid::Uuid;

/// `(connection_id, sender)` stored per user in the connection map.
type ConnEntry = (Uuid, mpsc::UnboundedSender<String>);

/// Tracks active WebSocket connections keyed by user ID.
///
/// Cheaply cloneable — all clones share the same underlying map via `Arc`.
///
/// Each connection entry stores a per-connection UUID alongside the sender.
/// This allows `remove` to be session-aware: a reconnecting user's old
/// cleanup task will not evict the new connection's entry.
#[derive(Clone, Default)]
pub struct ConnectionManager {
    connections: Arc<RwLock<HashMap<Uuid, ConnEntry>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a new connection for the given user and return its connection ID.
    ///
    /// If the user already has a connection (e.g. they reconnected), the old
    /// sender is replaced. The old send half will be dropped, closing the
    /// previous connection's outbound channel. This causes the old connection's
    /// send task to terminate, which triggers its `select!` cleanup path —
    /// the previous session self-disconnects without any explicit intervention.
    ///
    /// The returned connection ID must be passed to `remove` so that a stale
    /// cleanup task cannot evict a newer connection for the same user.
    pub async fn add(&self, user_id: Uuid, tx: mpsc::UnboundedSender<String>) -> Uuid {
        let conn_id = Uuid::new_v4();
        self.connections
            .write()
            .await
            .insert(user_id, (conn_id, tx));
        conn_id
    }

    /// Remove the connection for the given user, but only if `conn_id` matches
    /// the currently registered connection.
    ///
    /// This guard prevents a reconnecting user's old cleanup task from evicting
    /// the new connection's sender after `add` has already replaced it.
    pub async fn remove(&self, user_id: Uuid, conn_id: Uuid) {
        let mut conns = self.connections.write().await;
        if let Some((existing_id, _)) = conns.get(&user_id) {
            if *existing_id == conn_id {
                conns.remove(&user_id);
            }
        }
    }

    /// Send a JSON-serialized message to a single user.
    ///
    /// Silently ignores sends to users who are not connected or whose channel
    /// has already been closed — a failed send is always non-fatal.
    pub async fn send_to_user(&self, user_id: Uuid, message: &str) {
        let conns = self.connections.read().await;
        if let Some((_, tx)) = conns.get(&user_id) {
            let _ = tx.send(message.to_owned());
        }
    }

    /// Send a JSON-serialized message to every user in the provided list.
    ///
    /// Stale or disconnected entries are silently skipped.
    pub async fn broadcast_to_users(&self, user_ids: &[Uuid], message: &str) {
        let conns = self.connections.read().await;
        for user_id in user_ids {
            if let Some((_, tx)) = conns.get(user_id) {
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

        let conn_id = mgr.add(user, tx).await;
        mgr.remove(user, conn_id).await;
        assert!(!mgr.is_connected(user).await);
    }

    #[tokio::test]
    async fn remove_wrong_conn_id_is_noop() {
        let mgr = ConnectionManager::new();
        let user = Uuid::new_v4();
        let (tx, _rx) = make_channel();

        mgr.add(user, tx).await;
        // A stale cleanup task with a different conn_id must not remove the current entry.
        mgr.remove(user, Uuid::new_v4()).await;
        assert!(mgr.is_connected(user).await);
    }

    #[tokio::test]
    async fn reconnect_old_remove_does_not_evict_new_connection() {
        let mgr = ConnectionManager::new();
        let user = Uuid::new_v4();
        let (tx1, _rx1) = make_channel();
        let (tx2, mut rx2) = make_channel();

        // First connection
        let old_conn_id = mgr.add(user, tx1).await;
        // User reconnects — old sender is replaced
        mgr.add(user, tx2).await;
        // Old connection's cleanup fires with the stale conn_id
        mgr.remove(user, old_conn_id).await;

        // New connection must still be registered and receive messages
        assert!(mgr.is_connected(user).await);
        mgr.send_to_user(user, "hello").await;
        assert_eq!(rx2.recv().await.unwrap(), "hello");
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
    async fn send_to_user_with_closed_receiver_is_noop() {
        let mgr = ConnectionManager::new();
        let user = Uuid::new_v4();
        let (tx, rx) = make_channel();

        mgr.add(user, tx).await;
        drop(rx); // simulate abrupt disconnect before cleanup
                  // Must not panic — stale sender is silently skipped
        mgr.send_to_user(user, "will be dropped").await;
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

        let conn_id1 = mgr.add(u1, tx1).await;
        assert_eq!(mgr.connection_count().await, 1);

        mgr.add(u2, tx2).await;
        assert_eq!(mgr.connection_count().await, 2);

        mgr.remove(u1, conn_id1).await;
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

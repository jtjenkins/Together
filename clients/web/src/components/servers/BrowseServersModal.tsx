import { useEffect, useState } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import styles from "./ServerModals.module.css";

interface BrowseServersModalProps {
  open: boolean;
  onClose: () => void;
}

export function BrowseServersModal({ open, onClose }: BrowseServersModalProps) {
  const discoverableServers = useServerStore((s) => s.discoverableServers);
  const isBrowseLoading = useServerStore((s) => s.isBrowseLoading);
  const browseError = useServerStore((s) => s.browseError);
  const fetchDiscoverableServers = useServerStore(
    (s) => s.fetchDiscoverableServers,
  );
  const servers = useServerStore((s) => s.servers);
  const joinServer = useServerStore((s) => s.joinServer);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchDiscoverableServers();
    }
  }, [open, fetchDiscoverableServers]);

  const joinedIds = new Set(servers.map((s) => s.id));

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      await joinServer(id);
      await fetchDiscoverableServers();
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Browse Servers">
      {browseError && <div className={styles.error}>{browseError}</div>}

      {isBrowseLoading ? (
        <div className={styles.browseEmpty}>Loading servers…</div>
      ) : discoverableServers.length === 0 ? (
        <div className={styles.browseEmpty}>
          No public servers available yet.
        </div>
      ) : (
        <div className={styles.browseList}>
          {discoverableServers.map((server) => {
            const isJoined = joinedIds.has(server.id);
            return (
              <div key={server.id} className={styles.serverCard}>
                <div className={styles.cardAvatar}>
                  {server.icon_url ? (
                    <img
                      src={server.icon_url}
                      alt={server.name}
                      className={styles.cardAvatarImg}
                    />
                  ) : (
                    <span>{server.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className={styles.cardInfo}>
                  <div className={styles.cardName}>{server.name}</div>
                  <div className={styles.cardMeta}>
                    {server.member_count}{" "}
                    {server.member_count === 1 ? "member" : "members"}
                  </div>
                </div>
                {isJoined ? (
                  <span className={styles.joinedBadge}>Joined</span>
                ) : (
                  <button
                    className={styles.joinBtn}
                    disabled={joiningId === server.id}
                    onClick={() => handleJoin(server.id)}
                  >
                    {joiningId === server.id ? "Joining…" : "Join"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.actions} style={{ marginTop: "16px" }}>
        <button className={styles.cancelBtn} onClick={onClose}>
          Skip for now
        </button>
      </div>
    </Modal>
  );
}

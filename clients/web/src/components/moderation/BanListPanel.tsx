import { useEffect, useState } from "react";
import { useServerStore } from "../../stores/serverStore";
import styles from "./BanListPanel.module.css";

interface BanListPanelProps {
  serverId: string;
}

export function BanListPanel({ serverId }: BanListPanelProps) {
  const { bans, isBansLoading, fetchBans, unbanMember } = useServerStore();
  const [unbanningId, setUnbanningId] = useState<string | null>(null);

  useEffect(() => {
    fetchBans(serverId);
  }, [serverId, fetchBans]);

  const handleUnban = async (userId: string) => {
    setUnbanningId(userId);
    try {
      await unbanMember(serverId, userId);
    } catch {
      // Error is set on the store; button resets below.
    } finally {
      setUnbanningId(null);
    }
  };

  if (isBansLoading) {
    return <div className={styles.loading}>Loading bans...</div>;
  }

  if (bans.length === 0) {
    return <div className={styles.empty}>No banned users.</div>;
  }

  return (
    <div className={styles.banList}>
      <h3 className={styles.heading}>Banned Users ({bans.length})</h3>
      <div className={styles.list}>
        {bans.map((ban) => (
          <div key={ban.user_id} className={styles.banEntry}>
            <div className={styles.banInfo}>
              <span className={styles.userId}>
                {ban.user_id.slice(0, 8)}...
              </span>
              {ban.reason && (
                <span className={styles.reason}>Reason: {ban.reason}</span>
              )}
              <span className={styles.date}>
                {new Date(ban.created_at).toLocaleDateString()}
              </span>
            </div>
            <button
              className={styles.unbanButton}
              onClick={() => handleUnban(ban.user_id)}
              disabled={unbanningId === ban.user_id}
            >
              {unbanningId === ban.user_id ? "Unbanning..." : "Unban"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import { UserSettingsModal } from "./UserSettingsModal";
import type { UserStatus } from "../../types";
import styles from "./UserPanel.module.css";

export function UserPanel() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [showSettings, setShowSettings] = useState(false);

  if (!user) return null;

  const statusColors: Record<UserStatus, string> = {
    online: "var(--status-online)",
    away: "var(--status-away)",
    dnd: "var(--status-dnd)",
    offline: "var(--status-offline)",
  };

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.userInfo} onClick={() => setShowSettings(true)}>
          <div className={styles.avatarWrapper}>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarFallback}>
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
            <span
              className={styles.statusDot}
              style={{ background: statusColors[user.status] }}
            />
          </div>
          <div className={styles.names}>
            <span className={styles.username}>{user.username}</span>
            <span className={styles.statusText}>
              {user.custom_status || user.status}
            </span>
          </div>
        </div>
        <button
          className={styles.logoutBtn}
          onClick={logout}
          title="Sign Out"
          aria-label="Sign Out"
        >
          &#x2192;
        </button>
      </div>

      <UserSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </>
  );
}

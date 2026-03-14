import { usePushNotifications } from "../../hooks/usePushNotifications";
import styles from "./NotificationSettings.module.css";

const isPushSupported =
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

export function NotificationSettings() {
  const {
    permission,
    isSubscribed,
    preferences,
    isLoading,
    error,
    requestPermissionAndSubscribe,
    unsubscribe,
    updatePreferences,
  } = usePushNotifications();

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Push Notifications</h3>

      {!isPushSupported && (
        <p className={styles.unsupported}>
          Push notifications are not supported in this browser.
        </p>
      )}

      {isPushSupported && (
        <>
          <div className={styles.subscribeRow}>
            <span className={styles.label}>
              {isSubscribed
                ? "Notifications enabled"
                : "Notifications disabled"}
            </span>
            <button
              className={isSubscribed ? styles.btnDisable : styles.btnEnable}
              onClick={
                isSubscribed ? unsubscribe : requestPermissionAndSubscribe
              }
              disabled={isLoading || permission === "denied"}
            >
              {isLoading ? "Loading…" : isSubscribed ? "Disable" : "Enable"}
            </button>
          </div>

          {permission === "denied" && (
            <p className={styles.denied}>
              Notifications are blocked. Allow them in your browser settings.
            </p>
          )}

          {error && <p className={styles.error}>{error}</p>}

          {isSubscribed && preferences && (
            <div className={styles.prefs}>
              <label className={styles.prefRow}>
                <input
                  type="checkbox"
                  checked={preferences.dm_notifications}
                  onChange={(e) =>
                    updatePreferences({ dm_notifications: e.target.checked })
                  }
                />
                <span>Direct messages</span>
              </label>
              <label className={styles.prefRow}>
                <input
                  type="checkbox"
                  checked={preferences.mention_notifications}
                  onChange={(e) =>
                    updatePreferences({
                      mention_notifications: e.target.checked,
                    })
                  }
                />
                <span>@mentions</span>
              </label>
              <label className={styles.prefRow}>
                <input
                  type="checkbox"
                  checked={preferences.all_messages}
                  onChange={(e) =>
                    updatePreferences({ all_messages: e.target.checked })
                  }
                />
                <span>All messages</span>
              </label>
            </div>
          )}
        </>
      )}
    </div>
  );
}

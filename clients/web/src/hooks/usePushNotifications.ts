import { useEffect } from "react";
import { useNotificationStore } from "../stores/notificationStore";

/**
 * Initializes notification state on mount.
 * Checks if the browser is already subscribed and loads preferences.
 */
export function usePushNotifications() {
  const store = useNotificationStore();

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.ready.then(async (reg) => {
        const sub = await reg.pushManager.getSubscription();
        useNotificationStore.setState({ isSubscribed: !!sub });
      });
    }
    store.loadPreferences();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return store;
}

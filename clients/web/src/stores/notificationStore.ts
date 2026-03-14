import { create } from "zustand";
import { api } from "../api/client";
import type { NotificationPreferences } from "../types";

interface NotificationState {
  permission: NotificationPermission;
  isSubscribed: boolean;
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  error: string | null;

  requestPermissionAndSubscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  loadPreferences: () => Promise<void>;
  updatePreferences: (prefs: Partial<NotificationPreferences>) => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return new Uint8Array([...rawData].map((char) => char.charCodeAt(0)));
}

export const useNotificationStore = create<NotificationState>((set) => ({
  permission:
    typeof Notification !== "undefined" ? Notification.permission : "default",
  isSubscribed: false,
  preferences: null,
  isLoading: false,
  error: null,

  requestPermissionAndSubscribe: async () => {
    set({ isLoading: true, error: null });
    try {
      const permission = await Notification.requestPermission();
      set({ permission });
      if (permission !== "granted") {
        set({ isLoading: false });
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const vapidKey = await api.getVapidPublicKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
          .buffer as ArrayBuffer,
      });

      const json = sub.toJSON();
      await api.registerPushSubscription({
        subscription_type: "web",
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth_key: json.keys?.auth,
        user_agent: navigator.userAgent,
      });

      set({ isSubscribed: true });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  unsubscribe: async () => {
    set({ isLoading: true, error: null });
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.deletePushSubscription({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      set({ isSubscribed: false });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  loadPreferences: async () => {
    try {
      const prefs = await api.getNotificationPreferences();
      set({ preferences: prefs });
    } catch {
      // Silently fail — user may not be logged in
    }
  },

  updatePreferences: async (prefs) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await api.updateNotificationPreferences(prefs);
      set({ preferences: updated });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },
}));

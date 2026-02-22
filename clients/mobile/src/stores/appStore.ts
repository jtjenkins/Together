import { create } from "zustand";
import { storage } from "../utils/storage";
import { SERVER_URL_KEY } from "../utils/platform";
import { api } from "../api/client";
import { gateway } from "../api/websocket";

interface AppState {
  /** The configured Together server URL, or null if not set. */
  serverUrl: string | null;
  setServerUrl: (url: string) => void;
  clearServerUrl: () => void;
}

export const useAppStore = create<AppState>()(() => ({
  serverUrl: null,

  setServerUrl: (url: string) => {
    api.setServerUrl(url);
    gateway.setServerUrl(url);
    storage.setItem(SERVER_URL_KEY, url);
    useAppStore.setState({ serverUrl: url });
  },

  clearServerUrl: () => {
    gateway.disconnect();
    storage.removeItem(SERVER_URL_KEY);
    useAppStore.setState({ serverUrl: null });
  },
}));

/** Initialize appStore from storage. Call after initStorage() resolves. */
export function initAppStore(): void {
  const url = storage.getItem(SERVER_URL_KEY);
  if (url) {
    api.setServerUrl(url);
    gateway.setServerUrl(url);
  }
  useAppStore.setState({ serverUrl: url });
}

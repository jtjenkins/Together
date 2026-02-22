import AsyncStorage from "@react-native-async-storage/async-storage";
import { SERVER_URL_KEY, TOKEN_KEY, REFRESH_KEY } from "./platform";

/** In-memory cache populated once at startup by initStorage(). */
const cache: Record<string, string> = {};

/**
 * Load all app storage keys into the in-memory cache.
 * Must be awaited before the app renders so that synchronous reads work.
 */
export async function initStorage(): Promise<void> {
  const keys = [SERVER_URL_KEY, TOKEN_KEY, REFRESH_KEY];
  const pairs = await AsyncStorage.multiGet(keys);
  pairs.forEach(([key, value]) => {
    if (value !== null) {
      cache[key] = value;
    }
  });
}

/**
 * Synchronous-style storage wrapper backed by AsyncStorage.
 * Reads come from the in-memory cache (populated by initStorage).
 * Writes update the cache immediately and persist to AsyncStorage asynchronously.
 */
export const storage = {
  getItem(key: string): string | null {
    return cache[key] ?? null;
  },

  setItem(key: string, value: string): void {
    cache[key] = value;
    AsyncStorage.setItem(key, value).catch((err) =>
      console.error("[Storage] setItem failed", err),
    );
  },

  removeItem(key: string): void {
    delete cache[key];
    AsyncStorage.removeItem(key).catch((err) =>
      console.error("[Storage] removeItem failed", err),
    );
  },

  clear(): void {
    Object.keys(cache).forEach((k) => delete cache[k]);
    AsyncStorage.clear().catch((err) =>
      console.error("[Storage] clear failed", err),
    );
  },
};

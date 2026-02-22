// Presence of this property identifies a Tauri runtime context.
// The value is never read; only its existence is tested.
export const isTauri =
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

// Single source of truth for the localStorage key used by both the
// API client and the WebSocket client to store and retrieve the
// user-configured server URL.
export const SERVER_URL_KEY = "server_url";

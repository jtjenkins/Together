// Global environment type augmentations (not domain types).

declare global {
  interface Window {
    // Presence of this property identifies a Tauri runtime context.
    // The value is never read; only its existence is tested (!!window.__TAURI_INTERNALS__).
    __TAURI_INTERNALS__?: unknown;
  }
}

export {};

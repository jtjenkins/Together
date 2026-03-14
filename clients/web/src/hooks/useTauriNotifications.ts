/**
 * Requests notification permission in Tauri (desktop/mobile) context.
 * Called on app startup when running inside Tauri.
 */
export async function registerTauriNotifications(): Promise<void> {
  // Only run inside Tauri
  if (!("__TAURI__" in window)) return;

  try {
    // Indirect import avoids TS module resolution for Tauri-only package
    const mod = "@tauri-apps/plugin-notification";
    const { isPermissionGranted, requestPermission } = await (import(
      /* @vite-ignore */ mod
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) as Promise<any>);

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }

    if (granted) {
      // Permission acquired — no action needed beyond the grant
    }
  } catch (_e) {
    // Plugin not available in this context — silently ignore
  }
}

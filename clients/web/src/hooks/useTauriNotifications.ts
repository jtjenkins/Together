/**
 * Requests notification permission in Tauri (desktop/mobile) context.
 * Called on app startup when running inside Tauri.
 */
export async function registerTauriNotifications(): Promise<void> {
  // Only run inside Tauri
  if (!("__TAURI__" in window)) return;

  try {
    const { isPermissionGranted, requestPermission } = await import(
      "@tauri-apps/plugin-notification"
    );

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }

    if (granted) {
      console.info("Tauri notifications: permission granted");
    }
  } catch (e) {
    // Plugin not available in this context
    console.debug("Tauri notification plugin unavailable:", e);
  }
}

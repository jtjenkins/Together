import { useCallback, useEffect, useState } from "react";
import { useAuthStore } from "./stores/authStore";
import { AuthForm } from "./components/auth/AuthForm";
import { AppLayout } from "./components/layout/AppLayout";
import { ServerSetup } from "./components/desktop/ServerSetup";
import { api } from "./api/client";
import { gateway } from "./api/websocket";
import { isTauri, SERVER_URL_KEY } from "./utils/tauri";
import "./styles/globals.css";

export function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  const [hasServerUrl, setHasServerUrl] = useState(
    () => !isTauri || !!localStorage.getItem(SERVER_URL_KEY),
  );

  useEffect(() => {
    if (isTauri && !localStorage.getItem(SERVER_URL_KEY)) {
      // No server URL yet — ServerSetup will call restoreSession via onComplete
      return;
    }
    restoreSession();
  }, [restoreSession]);

  const handleSetupComplete = useCallback(
    (url: string) => {
      api.setServerUrl(url);
      gateway.setServerUrl(url);
      setHasServerUrl(true);
      restoreSession();
    },
    [restoreSession],
  );

  if (isTauri && !hasServerUrl) {
    return <ServerSetup onComplete={handleSetupComplete} />;
  }

  if (isLoading) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-primary)",
          color: "var(--text-muted)",
          fontSize: 16,
        }}
      >
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthForm />;
  }

  return <AppLayout />;
}

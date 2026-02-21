import { useEffect, useState } from "react";
import { useAuthStore } from "./stores/authStore";
import { AuthForm } from "./components/auth/AuthForm";
import { AppLayout } from "./components/layout/AppLayout";
import { ServerSetup } from "./components/desktop/ServerSetup";
import "./styles/globals.css";

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  const [hasServerUrl, setHasServerUrl] = useState(
    () => !isTauri || !!localStorage.getItem("server_url"),
  );

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  if (isTauri && !hasServerUrl) {
    return <ServerSetup onComplete={() => setHasServerUrl(true)} />;
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

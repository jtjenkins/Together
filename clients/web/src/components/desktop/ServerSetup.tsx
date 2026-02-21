import { useState } from "react";
import { api } from "../../api/client";
import { gateway } from "../../api/websocket";
import styles from "./ServerSetup.module.css";

interface ServerSetupProps {
  onComplete: () => void;
}

export function ServerSetup({ onComplete }: ServerSetupProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim().replace(/\/$/, "");
    if (!trimmed) {
      setError("Please enter a server URL.");
      return;
    }

    try {
      new URL(trimmed);
    } catch {
      setError("Invalid URL. Example: http://localhost:8080");
      return;
    }

    api.setServerUrl(trimmed);
    gateway.setServerUrl(trimmed);
    onComplete();
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>T</div>
          <span className={styles.logoText}>Together</span>
        </div>
        <h1 className={styles.heading}>Connect to a Server</h1>
        <p className={styles.subtitle}>
          Enter the address of your Together server to get started.
        </p>
        {error && <div className={styles.error}>{error}</div>}
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="server-url" className={styles.label}>
              Server URL
            </label>
            <input
              id="server-url"
              type="text"
              className={styles.input}
              placeholder="http://localhost:8080"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className={styles.submit}>
            Connect
          </button>
        </form>
      </div>
    </div>
  );
}

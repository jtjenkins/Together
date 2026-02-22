import { useState } from "react";
import styles from "./ServerSetup.module.css";

interface ServerSetupProps {
  onComplete: (url: string) => void;
}

export function ServerSetup({ onComplete }: ServerSetupProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim().replace(/\/$/, "");
    if (!trimmed) {
      setError("Please enter a server URL.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setError("Invalid URL. Example: http://localhost:8080");
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setError("URL must use http:// or https://");
      return;
    }

    setIsChecking(true);
    try {
      await fetch(`${trimmed}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      onComplete(trimmed);
    } catch {
      setError("Could not reach the server. Check the URL and try again.");
      setIsChecking(false);
    }
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
              disabled={isChecking}
              autoFocus
            />
          </div>
          <button type="submit" className={styles.submit} disabled={isChecking}>
            {isChecking ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}

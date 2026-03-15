import { useState } from "react";
import { api } from "../../api/client";
import type { ForgotPasswordResponse } from "../../types";
import styles from "../servers/ServerModals.module.css";

export function AdminTab() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgotPasswordResponse | null>(null);

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (result !== null) setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.forgotPassword(email);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate token");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard?.writeText(result.token).catch(() => {
      // Fallback: token is selectable via user-select: all on .tokenBox
    });
  };

  return (
    <div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="admin-email">
            User&apos;s Email Address
          </label>
          <input
            id="admin-email"
            className={styles.input}
            type="email"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            required
            placeholder="user@example.com"
          />
        </div>
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isLoading}
          >
            {isLoading ? "Generating…" : "Generate Reset Token"}
          </button>
        </div>
      </form>

      {result && (
        <div className={styles.tokenSection}>
          <div className={styles.tokenBox}>{result.token}</div>
          <button type="button" className={styles.copyBtn} onClick={handleCopy}>
            Copy
          </button>
          <p className={styles.tokenWarning}>
            This token expires in 1 hour. Share it with the user now and tell
            them to click &ldquo;Have a reset token?&rdquo; on the login screen.
          </p>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, type FormEvent } from "react";
import { useAuthStore } from "../../stores/authStore";
import { api } from "../../api/client";
import type { ResetPasswordRequest } from "../../types";
import styles from "./AuthForm.module.css";

type View = "login" | "register" | "reset";

export function AuthForm() {
  const [view, setView] = useState<View>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { login, register, error, clearError } = useAuthStore();

  // Cancel the 2-second post-reset transition timer if the component unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const switchView = (next: View) => {
    clearError();
    setResetError(null);
    setResetSuccess(false);
    setUsername("");
    setEmail("");
    setPassword("");
    setResetToken("");
    setNewPassword("");
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setView(next);
  };

  const handleLoginRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (view === "login") {
        await login({ username, password });
      } else {
        await register({ username, email: email || undefined, password });
      }
    } catch {
      // Error is stored in auth store
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setResetError(null);
    try {
      const data: ResetPasswordRequest = {
        token: resetToken,
        new_password: newPassword,
      };
      await api.resetPassword(data);
      setResetSuccess(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        switchView("login");
      }, 2000);
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : "Password reset failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>T</div>
          <h1 className={styles.logoText}>Together</h1>
        </div>

        {view === "reset" ? (
          <>
            <h2 className={styles.heading}>Reset Password</h2>
            <p className={styles.subtitle}>
              Enter the token your admin shared with you
            </p>

            {resetError && (
              <div className={styles.error} role="alert">
                {resetError}
              </div>
            )}
            {resetSuccess && (
              <div className={styles.success} role="alert" aria-live="polite">
                Password reset. You can now log in.
              </div>
            )}

            {!resetSuccess && (
              <form onSubmit={handleResetSubmit} className={styles.form}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reset-token">
                    Reset Token
                  </label>
                  <input
                    id="reset-token"
                    className={styles.input}
                    type="text"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                    placeholder="Paste your reset token"
                    required
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="new-password">
                    New Password
                  </label>
                  <input
                    id="new-password"
                    className={styles.input}
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  className={styles.submit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Resetting…" : "Reset Password"}
                </button>
              </form>
            )}

            <p className={styles.toggle}>
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() => switchView("login")}
              >
                Back to login
              </button>
            </p>
          </>
        ) : (
          <>
            <h2 className={styles.heading}>
              {view === "login" ? "Welcome back!" : "Create an account"}
            </h2>
            <p className={styles.subtitle}>
              {view === "login"
                ? "Sign in to continue to Together"
                : "Join your community on Together"}
            </p>

            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleLoginRegisterSubmit} className={styles.form}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  className={styles.input}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={view === "login" ? 1 : 3}
                  maxLength={32}
                  autoComplete="username"
                  autoFocus
                />
              </div>

              {view === "register" && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="email">
                    Email <span className={styles.optional}>(optional)</span>
                  </label>
                  <input
                    id="email"
                    className={styles.input}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={view === "login" ? 1 : 8}
                  maxLength={128}
                  autoComplete={
                    view === "login" ? "current-password" : "new-password"
                  }
                />
              </div>

              <button
                type="submit"
                className={styles.submit}
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Please wait..."
                  : view === "login"
                    ? "Sign In"
                    : "Create Account"}
              </button>
            </form>

            {view === "login" && (
              <p className={styles.toggle}>
                <button
                  type="button"
                  className={styles.toggleBtn}
                  onClick={() => switchView("reset")}
                >
                  Have a reset token?
                </button>
              </p>
            )}

            <p className={styles.toggle}>
              {view === "login"
                ? "Don't have an account?"
                : "Already have an account?"}{" "}
              <button
                type="button"
                className={styles.toggleBtn}
                onClick={() =>
                  switchView(view === "login" ? "register" : "login")
                }
              >
                {view === "login" ? "Register" : "Sign In"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

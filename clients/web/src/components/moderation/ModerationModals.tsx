import { useState } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import styles from "./ModerationModals.module.css";

// ─── Duration options for timeout ────────────────────────────────────────────

const TIMEOUT_DURATIONS = [
  { label: "1 minute", value: 1 },
  { label: "5 minutes", value: 5 },
  { label: "10 minutes", value: 10 },
  { label: "30 minutes", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "12 hours", value: 720 },
  { label: "1 day", value: 1440 },
  { label: "7 days", value: 10080 },
] as const;

// ─── Kick Modal ──────────────────────────────────────────────────────────────

interface KickModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  userId: string;
  username: string;
}

export function KickModal({
  open,
  onClose,
  serverId,
  userId,
  username,
}: KickModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const kickMember = useServerStore((s) => s.kickMember);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await kickMember(serverId, userId, reason || undefined);
      setReason("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to kick member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setError("");
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Kick ${username}?`}>
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="kick-reason">
            Reason (optional)
          </label>
          <textarea
            id="kick-reason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for kicking this member..."
            maxLength={512}
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Kicking..." : "Kick"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Ban Modal ───────────────────────────────────────────────────────────────

interface BanModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  userId: string;
  username: string;
}

export function BanModal({
  open,
  onClose,
  serverId,
  userId,
  username,
}: BanModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const banMember = useServerStore((s) => s.banMember);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await banMember(serverId, userId, reason || undefined);
      setReason("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ban member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setError("");
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Ban ${username}?`}>
      <div className={styles.form}>
        <div className={styles.warning}>
          This will permanently ban {username} from the server. They will not be
          able to rejoin unless the ban is removed.
        </div>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ban-reason">
            Reason (optional)
          </label>
          <textarea
            id="ban-reason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for banning this member..."
            maxLength={512}
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Banning..." : "Ban"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Timeout Modal ───────────────────────────────────────────────────────────

interface TimeoutModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  userId: string;
  username: string;
}

export function TimeoutModal({
  open,
  onClose,
  serverId,
  userId,
  username,
}: TimeoutModalProps) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(10);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const timeoutMember = useServerStore((s) => s.timeoutMember);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError("");
    try {
      await timeoutMember(serverId, userId, duration, reason || undefined);
      setReason("");
      setDuration(10);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to timeout member");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason("");
    setDuration(10);
    setError("");
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Timeout ${username}`}>
      <div className={styles.form}>
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="timeout-duration">
            Duration
          </label>
          <select
            id="timeout-duration"
            className={styles.select}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            {TIMEOUT_DURATIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="timeout-reason">
            Reason (optional)
          </label>
          <textarea
            id="timeout-reason"
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for timeout..."
            maxLength={512}
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.confirmBtn}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Applying..." : "Timeout"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

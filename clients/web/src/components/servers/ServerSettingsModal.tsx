import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import type { ServerDto } from "../../types";
import styles from "./ServerModals.module.css";

interface ServerSettingsModalProps {
  open: boolean;
  onClose: () => void;
  server: ServerDto;
}

export function ServerSettingsModal({
  open,
  onClose,
  server,
}: ServerSettingsModalProps) {
  const [name, setName] = useState(server.name);
  const [iconUrl, setIconUrl] = useState(server.icon_url || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const updateServer = useServerStore((s) => s.updateServer);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      await updateServer(server.id, {
        name: name.trim(),
        icon_url: iconUrl.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Server Settings">
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-server-name">
            Server Name
          </label>
          <input
            id="edit-server-name"
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-server-icon">
            Icon URL <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="edit-server-icon"
            className={styles.input}
            type="url"
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://example.com/icon.png"
          />
        </div>
        <div className={styles.info}>
          <span>Members: {server.member_count}</span>
          <span>
            Created: {new Date(server.created_at).toLocaleDateString()}
          </span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

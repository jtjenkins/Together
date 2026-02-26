import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import styles from "./ServerModals.module.css";

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateServerModal({ open, onClose }: CreateServerModalProps) {
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const createServer = useServerStore((s) => s.createServer);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      const server = await createServer({
        name: name.trim(),
        icon_url: iconUrl.trim() || undefined,
        is_public: isPublic,
      });
      setActiveServer(server.id);
      setName("");
      setIconUrl("");
      setIsPublic(true);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create server");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a Server">
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="server-name">
            Server Name
          </label>
          <input
            id="server-name"
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Awesome Server"
            required
            maxLength={100}
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="server-icon">
            Icon URL <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="server-icon"
            className={styles.input}
            type="url"
            value={iconUrl}
            onChange={(e) => setIconUrl(e.target.value)}
            placeholder="https://example.com/icon.png"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            List in Browse Servers (public)
          </label>
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
            {isSubmitting ? "Creating..." : "Create Server"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

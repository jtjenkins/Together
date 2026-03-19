import { useState, useEffect, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import { api } from "../../api/client";
import type { ServerTemplate } from "../../types";
import styles from "./ServerModals.module.css";

interface CreateServerModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  gaming: "🎮",
  community: "🌐",
  study: "📚",
  custom: "✨",
};

export function CreateServerModal({ open, onClose }: CreateServerModalProps) {
  const [name, setName] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const createServer = useServerStore((s) => s.createServer);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  useEffect(() => {
    if (open) {
      api
        .listTemplates()
        .then(setTemplates)
        .catch(() => setTemplates([]));
    }
  }, [open]);

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
        template_id: templateId ?? undefined,
      });
      setActiveServer(server.id);
      setName("");
      setIconUrl("");
      setIsPublic(true);
      setTemplateId(null);
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
        {templates.length > 0 && (
          <div className={styles.field}>
            <span className={styles.label}>
              Template <span className={styles.optional}>(optional)</span>
            </span>
            <div className={styles.templateGrid}>
              <button
                type="button"
                className={`${styles.templateCard} ${templateId === null ? styles.templateCardSelected : ""}`}
                onClick={() => setTemplateId(null)}
              >
                <span className={styles.templateIcon}>🏠</span>
                <span className={styles.templateName}>Blank</span>
              </button>
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.templateCard} ${templateId === t.id ? styles.templateCardSelected : ""}`}
                  onClick={() => setTemplateId(t.id)}
                  title={t.description}
                >
                  <span className={styles.templateIcon}>
                    {CATEGORY_ICONS[t.category] ?? "✨"}
                  </span>
                  <span className={styles.templateName}>{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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

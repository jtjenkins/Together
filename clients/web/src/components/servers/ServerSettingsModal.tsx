import { useState, useEffect, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import { useAuthStore } from "../../stores/authStore";
import { CustomEmojiManager } from "./CustomEmojiManager";
import { BotManager } from "./BotManager";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";

import type { ServerDto } from "../../types";
import styles from "./ServerModals.module.css";
import { AutomodSettings } from "./AutomodSettings";

type SettingsTab = "general" | "automod";

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
  const [tab, setTab] = useState<SettingsTab>("general");
  const [name, setName] = useState(server.name);
  const [iconUrl, setIconUrl] = useState(server.icon_url || "");
  const [isPublic, setIsPublic] = useState(server.is_public);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const updateServer = useServerStore((s) => s.updateServer);
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.id === server.owner_id;
  const { loadEmojis } = useCustomEmojiStore();
  useEffect(() => {
    if (open) loadEmojis(server.id);
  }, [open, server.id, loadEmojis]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      await updateServer(server.id, {
        name: name.trim(),
        icon_url: iconUrl.trim() || undefined,
        is_public: isPublic,
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
      {isOwner && (
        <div className={styles.tabRow}>
          <button
            className={tab === "general" ? styles.activeTab : styles.tab}
            onClick={() => setTab("general")}
          >
            General
          </button>
          <button
            className={tab === "automod" ? styles.activeTab : styles.tab}
            onClick={() => setTab("automod")}
          >
            Automod
          </button>
        </div>
      )}
      {tab === "general" && (
        <>
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
            <div className={styles.field}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                List this server in Browse Servers
              </label>
            </div>
            <div className={styles.info}>
              <span>Members: {server.member_count}</span>
              <span>
                Created: {new Date(server.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={onClose}
              >
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
        </>
      )}
      {tab === "automod" && isOwner && <AutomodSettings serverId={server.id} />}
      {tab === "general" && (
        <>
          <hr
            style={{
              border: "none",
              borderTop: "1px solid var(--bg-secondary, #2f3136)",
              margin: "16px 0",
            }}
          />
          <CustomEmojiManager server={server} />
          <hr
            style={{
              border: "none",
              borderTop: "1px solid var(--bg-secondary, #2f3136)",
              margin: "16px 0",
            }}
          />
          <BotManager serverId={server.id} />
        </>
      )}
    </Modal>
  );
}

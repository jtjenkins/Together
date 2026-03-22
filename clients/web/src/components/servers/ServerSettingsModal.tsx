import { useState, useEffect, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useServerStore } from "../../stores/serverStore";
import { useAuthStore } from "../../stores/authStore";
import { CustomEmojiManager } from "./CustomEmojiManager";
import { BotManager } from "./BotManager";
import { WebhookManager } from "./WebhookManager";
import { InviteManager } from "./InviteManager";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import { api } from "../../api/client";

import type { ServerDto } from "../../types";
import styles from "./ServerModals.module.css";
import { AutomodSettings } from "./AutomodSettings";
import { BanListPanel } from "../moderation/BanListPanel";
import { RolesTab } from "./RolesTab";
import { useRoleStore } from "../../stores/roleStore";
import { hasPermission, PERMISSIONS } from "../../types";

type SettingsTab = "general" | "automod" | "bans" | "roles" | "invites";

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
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const updateServer = useServerStore((s) => s.updateServer);
  const currentUser = useAuthStore((s) => s.user);
  const isOwner = currentUser?.id === server.owner_id;
  const myPerms = useRoleStore((s) => s.myPermissions[server.id] || 0);
  const canManageRoles =
    isOwner || hasPermission(myPerms, PERMISSIONS.MANAGE_ROLES);
  const canManageBans =
    isOwner || hasPermission(myPerms, PERMISSIONS.BAN_MEMBERS);
  const canCreateInvites =
    isOwner || hasPermission(myPerms, PERMISSIONS.CREATE_INVITES);
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

  const handleExport = async () => {
    setIsExporting(true);
    setError("");
    try {
      await api.exportServer(server.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export server data",
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Server Settings">
      {(isOwner || canManageRoles || canManageBans || canCreateInvites) && (
        <div className={styles.tabRow}>
          <button
            className={tab === "general" ? styles.activeTab : styles.tab}
            onClick={() => setTab("general")}
          >
            General
          </button>
          {isOwner && (
            <button
              className={tab === "automod" ? styles.activeTab : styles.tab}
              onClick={() => setTab("automod")}
            >
              Automod
            </button>
          )}
          {canManageRoles && (
            <button
              className={tab === "roles" ? styles.activeTab : styles.tab}
              onClick={() => setTab("roles")}
            >
              Roles
            </button>
          )}
          {canManageBans && (
            <button
              className={tab === "bans" ? styles.activeTab : styles.tab}
              onClick={() => setTab("bans")}
            >
              Bans
            </button>
          )}
          {canCreateInvites && (
            <button
              className={tab === "invites" ? styles.activeTab : styles.tab}
              onClick={() => setTab("invites")}
            >
              Invites
            </button>
          )}
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
      {tab === "roles" && canManageRoles && <RolesTab serverId={server.id} />}
      {tab === "bans" && canManageBans && <BanListPanel serverId={server.id} />}
      {tab === "invites" && canCreateInvites && (
        <InviteManager serverId={server.id} />
      )}
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
          {isOwner && (
            <>
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid var(--bg-secondary, #2f3136)",
                  margin: "16px 0",
                }}
              />
              <WebhookManager serverId={server.id} />
              <hr
                style={{
                  border: "none",
                  borderTop: "1px solid var(--bg-secondary, #2f3136)",
                  margin: "16px 0",
                }}
              />
              <div>
                <h3 style={{ margin: "0 0 8px" }}>Export Server Data</h3>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--text-muted, #72767d)",
                    margin: "0 0 12px",
                  }}
                >
                  Download a ZIP archive containing channels, members, roles,
                  and message history.
                </p>
                <button
                  type="button"
                  className={styles.submitBtn}
                  onClick={handleExport}
                  disabled={isExporting}
                >
                  {isExporting ? "Exporting..." : "Export as ZIP"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

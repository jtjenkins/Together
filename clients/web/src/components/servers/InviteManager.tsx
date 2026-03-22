import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Link, Trash2, Copy, Check } from "lucide-react";
import { api } from "../../api/client";
import type { ServerInviteDto } from "../../types";
import styles from "./InviteManager.module.css";

const EXPIRY_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "6 hours", value: 6 },
  { label: "24 hours", value: 24 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
  { label: "Never", value: 0 },
] as const;

interface InviteManagerProps {
  serverId: string;
}

export function InviteManager({ serverId }: InviteManagerProps) {
  const [invites, setInvites] = useState<ServerInviteDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [maxUses, setMaxUses] = useState("");
  const [expiresInHours, setExpiresInHours] = useState<number>(24);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.listInvites(serverId);
      setInvites(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invites");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const data: { max_uses?: number; expires_in_hours?: number } = {};
      const parsed = parseInt(maxUses, 10);
      if (!isNaN(parsed) && parsed > 0) {
        data.max_uses = parsed;
      }
      if (expiresInHours > 0) {
        data.expires_in_hours = expiresInHours;
      }
      const invite = await api.createInvite(serverId, data);
      setInvites((prev) => [invite, ...prev]);
      setMaxUses("");
      setExpiresInHours(24);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create invite",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (invite: ServerInviteDto) => {
    const url = `${window.location.origin}/invite/${invite.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(invite.id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === invite.id ? null : prev));
      }, 2000);
    } catch {
      setError(`Could not copy to clipboard. Invite link: ${url}`);
    }
  };

  const handleDelete = async (inviteId: string, code: string) => {
    if (!confirm(`Delete invite "${code}"? This cannot be undone.`)) return;
    try {
      await api.deleteInvite(serverId, inviteId);
      setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete invite");
    }
  };

  const formatExpiry = (expiresAt: string | null): string => {
    if (!expiresAt) return "Never";
    const date = new Date(expiresAt);
    if (date.getTime() < Date.now()) return "Expired";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className={styles.manager}>
      <h3 className={styles.heading}>Invites</h3>
      <p className={styles.hint}>
        Create invite links to let people join this server.
      </p>

      {/* Create invite form */}
      <form onSubmit={handleCreate} className={styles.createForm}>
        <div className={styles.formRow}>
          <input
            className={styles.formInput}
            type="number"
            placeholder="Unlimited"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            min={1}
            title="Max uses"
            aria-label="Max uses"
          />
          <select
            className={styles.formSelect}
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
            title="Expiry"
            aria-label="Expiry"
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className={styles.createBtn}
            disabled={creating}
          >
            <Link size={14} />
            {creating ? "Creating..." : "Create Invite"}
          </button>
        </div>
      </form>
      {createError && (
        <div className={styles.error} role="alert">
          {createError}
        </div>
      )}

      {/* Invite list */}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Loading invites...</p>
      ) : invites.length === 0 ? (
        <p className={styles.empty}>No invites yet. Create one above.</p>
      ) : (
        <div className={styles.list}>
          {invites.map((inv) => (
            <div key={inv.id} className={styles.inviteRow}>
              <div className={styles.inviteInfo}>
                <span className={styles.inviteCode}>{inv.code}</span>
                <div className={styles.inviteMeta}>
                  <span>
                    Uses: {inv.uses}
                    {inv.max_uses != null ? `/${inv.max_uses}` : ""}
                  </span>
                  <span>Expires: {formatExpiry(inv.expires_at)}</span>
                </div>
              </div>
              <div className={styles.inviteActions}>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => handleCopy(inv)}
                  title="Copy invite link"
                >
                  {copiedId === inv.id ? (
                    <>
                      <Check size={13} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      Copy
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(inv.id, inv.code)}
                  title="Delete invite"
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

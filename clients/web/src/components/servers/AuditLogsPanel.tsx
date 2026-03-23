import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../../api/client";
import type { AuditLog } from "../../types";
import styles from "./AuditLogsPanel.module.css";

interface ActionOption {
  label: string;
  value: string;
  disabled?: boolean;
}

const ACTION_OPTIONS: ActionOption[] = [
  { label: "All Actions", value: "" },
  // Server
  { label: "--- Server ---", value: "", disabled: true },
  { label: "Server Created", value: "server_create" },
  { label: "Server Updated", value: "server_update" },
  { label: "Server Deleted", value: "server_delete" },
  // Channel
  { label: "--- Channel ---", value: "", disabled: true },
  { label: "Channel Created", value: "channel_create" },
  { label: "Channel Updated", value: "channel_update" },
  { label: "Channel Deleted", value: "channel_delete" },
  // Member
  { label: "--- Member ---", value: "", disabled: true },
  { label: "Member Kicked", value: "member_kick" },
  { label: "Member Banned", value: "member_ban" },
  { label: "Member Unbanned", value: "member_unban" },
  { label: "Member Timeout", value: "member_timeout" },
  { label: "Timeout Removed", value: "member_timeout_remove" },
  { label: "Role Added", value: "member_role_add" },
  { label: "Role Removed", value: "member_role_remove" },
  // Role
  { label: "--- Role ---", value: "", disabled: true },
  { label: "Role Created", value: "role_create" },
  { label: "Role Updated", value: "role_update" },
  { label: "Role Deleted", value: "role_delete" },
  // Invite
  { label: "--- Invite ---", value: "", disabled: true },
  { label: "Invite Created", value: "invite_create" },
  { label: "Invite Revoked", value: "invite_revoke" },
];

const PAGE_SIZE = 50;

function formatAction(action: string): string {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function actionBadgeClass(action: string): string {
  if (action.includes("create")) return styles.badgeCreate;
  if (action.includes("update")) return styles.badgeUpdate;
  if (
    action.includes("delete") ||
    action.includes("kick") ||
    action.includes("ban") ||
    action.includes("revoke")
  )
    return styles.badgeDelete;
  if (action.includes("timeout")) return styles.badgeWarn;
  return styles.badgeUpdate;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

function formatDetails(details: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (value != null && value !== "") {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.join(", ");
}

interface AuditLogsPanelProps {
  serverId: string;
}

export function AuditLogsPanel({ serverId }: AuditLogsPanelProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = useCallback(
    async (before?: string) => {
      const result = await api.getAuditLogs(serverId, {
        action: actionFilter || undefined,
        before,
        limit: PAGE_SIZE,
      });
      setHasMore(result.length === PAGE_SIZE);
      return result;
    },
    [serverId, actionFilter],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLogs();
      setLogs(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load audit logs",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchLogs]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleLoadMore = async () => {
    const lastLog = logs[logs.length - 1];
    if (!lastLog) return;
    setLoadingMore(true);
    try {
      const result = await fetchLogs(lastLog.created_at);
      setLogs((prev) => [...prev, ...result]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more entries",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.heading}>Audit Log</h3>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={loadInitial}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      <div className={styles.filterRow}>
        <select
          className={styles.filterSelect}
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          aria-label="Filter by action"
        >
          {ACTION_OPTIONS.map((opt, i) =>
            opt.disabled ? (
              <option key={i} disabled value="">
                {opt.label}
              </option>
            ) : (
              <option key={opt.value || `all-${i}`} value={opt.value}>
                {opt.label}
              </option>
            ),
          )}
        </select>
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Loading audit logs...</p>
      ) : logs.length === 0 ? (
        <p className={styles.empty}>No audit log entries yet.</p>
      ) : (
        <>
          <div className={styles.list}>
            {logs.map((log) => {
              const detailStr = formatDetails(log.details);
              return (
                <div key={log.id} className={styles.logRow}>
                  <div className={styles.logMain}>
                    <div className={styles.logTop}>
                      <span
                        className={`${styles.badge} ${actionBadgeClass(log.action)}`}
                      >
                        {log.action.includes("create")
                          ? "CREATE"
                          : log.action.includes("update")
                            ? "UPDATE"
                            : log.action.includes("delete") ||
                                log.action.includes("revoke")
                              ? "DELETE"
                              : log.action.includes("kick") ||
                                  log.action.includes("ban")
                                ? "REMOVE"
                                : log.action.includes("timeout")
                                  ? "TIMEOUT"
                                  : "ACTION"}
                      </span>
                      <span className={styles.logActionText}>
                        {formatAction(log.action)}
                      </span>
                    </div>
                    <div className={styles.logMeta}>
                      <span>
                        Actor:{" "}
                        {log.actor_id ? log.actor_id.substring(0, 8) : "System"}
                      </span>
                      {log.target_type && (
                        <span>
                          Target: {log.target_type}
                          {log.target_id
                            ? ` (${log.target_id.substring(0, 8)})`
                            : ""}
                        </span>
                      )}
                    </div>
                    {detailStr && (
                      <div className={styles.logDetails}>
                        <span>{detailStr}</span>
                      </div>
                    )}
                  </div>
                  <span
                    className={styles.logTimestamp}
                    title={new Date(log.created_at).toLocaleString()}
                  >
                    {formatRelativeTime(log.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div className={styles.loadMore}>
              <button
                type="button"
                className={styles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

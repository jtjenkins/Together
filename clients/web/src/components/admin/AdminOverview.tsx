import { useEffect, useRef } from "react";
import { useAdminStore } from "../../stores/adminStore";
import styles from "./AdminOverview.module.css";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function AdminOverview() {
  const stats = useAdminStore((s) => s.stats);
  const statsLoading = useAdminStore((s) => s.statsLoading);
  const statsError = useAdminStore((s) => s.statsError);
  const fetchStats = useAdminStore((s) => s.fetchStats);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchStats();
    intervalRef.current = setInterval(fetchStats, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStats]);

  if (statsLoading && !stats) {
    return <div className={styles.loading}>Loading stats...</div>;
  }

  if (statsError) {
    return <div className={styles.error}>{statsError}</div>;
  }

  if (!stats) return null;

  const cards = [
    { label: "Users", value: stats.total_users.toLocaleString() },
    { label: "Servers", value: stats.total_servers.toLocaleString() },
    { label: "Messages", value: stats.total_messages.toLocaleString() },
    { label: "Channels", value: stats.total_channels.toLocaleString() },
    {
      label: "Active Connections",
      value: (stats.active_ws_connections ?? 0).toLocaleString(),
    },
    { label: "Uptime", value: formatUptime(stats.uptime_secs ?? 0) },
    {
      label: "DB Latency",
      value: `${(stats.db_latency_ms ?? 0).toFixed(1)} ms`,
    },
    { label: "Storage", value: formatBytes(stats.storage_bytes ?? 0) },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        {cards.map((card) => (
          <div key={card.label} className={styles.card}>
            <div className={styles.cardLabel}>{card.label}</div>
            <div className={styles.cardValue}>{card.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

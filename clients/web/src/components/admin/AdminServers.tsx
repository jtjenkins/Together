import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminStore } from "../../stores/adminStore";
import { ConfirmDialog } from "./ConfirmDialog";
import styles from "./AdminServers.module.css";

export function AdminServers() {
  const servers = useAdminStore((s) => s.servers);
  const serversTotal = useAdminStore((s) => s.serversTotal);
  const serversPage = useAdminStore((s) => s.serversPage);
  const serversPerPage = useAdminStore((s) => s.serversPerPage);
  const serversLoading = useAdminStore((s) => s.serversLoading);
  const serversError = useAdminStore((s) => s.serversError);
  const fetchServers = useAdminStore((s) => s.fetchServers);
  const deleteServer = useAdminStore((s) => s.deleteServer);

  const [searchInput, setSearchInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchServers(1, "");
  }, [fetchServers]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchServers(1, value);
      }, 300);
    },
    [fetchServers],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(serversTotal / serversPerPage));

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteServer(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Error is set in store
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search servers by name..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {serversError && <div className={styles.error}>{serversError}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th className={styles.hideMobile}>Owner</th>
              <th>Members</th>
              <th className={styles.hideMobile}>Channels</th>
              <th className={styles.hideMobile}>Messages</th>
              <th className={styles.hideMobile}>Public</th>
              <th className={styles.hideMobile}>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {serversLoading && servers.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.emptyCell}>
                  Loading...
                </td>
              </tr>
            ) : servers.length === 0 ? (
              <tr>
                <td colSpan={8} className={styles.emptyCell}>
                  No servers found
                </td>
              </tr>
            ) : (
              servers.map((s) => (
                <tr key={s.id}>
                  <td className={styles.nameCell}>{s.name}</td>
                  <td className={styles.hideMobile}>{s.owner_username}</td>
                  <td>{s.member_count}</td>
                  <td className={styles.hideMobile}>{s.channel_count}</td>
                  <td className={styles.hideMobile}>
                    {s.message_count.toLocaleString()}
                  </td>
                  <td className={styles.hideMobile}>
                    {s.is_public ? "Yes" : "No"}
                  </td>
                  <td className={styles.hideMobile}>
                    {formatDate(s.created_at)}
                  </td>
                  <td>
                    <button
                      className={styles.deleteBtn}
                      onClick={() =>
                        setDeleteTarget({ id: s.id, name: s.name })
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <button
          className={styles.pageBtn}
          onClick={() => fetchServers(serversPage - 1)}
          disabled={serversPage <= 1 || serversLoading}
        >
          Previous
        </button>
        <span className={styles.pageInfo}>
          Page {serversPage} of {totalPages} ({serversTotal} total)
        </span>
        <button
          className={styles.pageBtn}
          onClick={() => fetchServers(serversPage + 1)}
          disabled={serversPage >= totalPages || serversLoading}
        >
          Next
        </button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Server"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? All channels, messages, and memberships will be permanently removed. This action cannot be undone.`}
        confirmLabel="Delete Server"
        loading={deleteLoading}
      />
    </div>
  );
}

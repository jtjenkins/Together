import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminStore } from "../../stores/adminStore";
import { useAuthStore } from "../../stores/authStore";
import { ConfirmDialog } from "./ConfirmDialog";
import styles from "./AdminUsers.module.css";

export function AdminUsers() {
  const users = useAdminStore((s) => s.users);
  const usersTotal = useAdminStore((s) => s.usersTotal);
  const usersPage = useAdminStore((s) => s.usersPage);
  const usersPerPage = useAdminStore((s) => s.usersPerPage);
  const usersLoading = useAdminStore((s) => s.usersLoading);
  const usersError = useAdminStore((s) => s.usersError);
  const fetchUsers = useAdminStore((s) => s.fetchUsers);
  const updateUser = useAdminStore((s) => s.updateUser);
  const deleteUser = useAdminStore((s) => s.deleteUser);

  const currentUserId = useAuthStore((s) => s.user?.id);

  const [searchInput, setSearchInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    username: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchUsers(1, "");
  }, [fetchUsers]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchUsers(1, value);
      }, 300);
    },
    [fetchUsers],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(usersTotal / usersPerPage));

  const handleToggleAdmin = async (userId: string, currentValue: boolean) => {
    try {
      await updateUser(userId, { is_admin: !currentValue });
    } catch {
      // Error is set in store
    }
  };

  const handleToggleDisabled = async (
    userId: string,
    currentValue: boolean,
  ) => {
    try {
      await updateUser(userId, { disabled: !currentValue });
    } catch {
      // Error is set in store
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deleteUser(deleteTarget.id);
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
          placeholder="Search users by username or email..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {usersError && <div className={styles.error}>{usersError}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Username</th>
              <th className={styles.hideMobile}>Email</th>
              <th>Status</th>
              <th>Admin</th>
              <th>Disabled</th>
              <th className={styles.hideMobile}>Created</th>
              <th className={styles.hideMobile}>Servers</th>
              <th className={styles.hideMobile}>Messages</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {usersLoading && users.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.emptyCell}>
                  No users found
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id}>
                    <td className={styles.usernameCell}>{u.username}</td>
                    <td className={styles.hideMobile}>
                      {u.email || <span className={styles.muted}>--</span>}
                    </td>
                    <td>
                      <span
                        className={`${styles.statusDot} ${styles[u.status]}`}
                      />
                    </td>
                    <td>
                      <button
                        className={`${styles.toggleBtn} ${u.is_admin ? styles.toggleOn : ""}`}
                        onClick={() => handleToggleAdmin(u.id, u.is_admin)}
                        disabled={isSelf}
                        title={
                          isSelf
                            ? "Cannot change your own admin status"
                            : u.is_admin
                              ? "Remove admin"
                              : "Make admin"
                        }
                      >
                        {u.is_admin ? "Yes" : "No"}
                      </button>
                    </td>
                    <td>
                      <button
                        className={`${styles.toggleBtn} ${u.disabled ? styles.toggleDanger : ""}`}
                        onClick={() => handleToggleDisabled(u.id, u.disabled)}
                        disabled={isSelf}
                        title={
                          isSelf
                            ? "Cannot disable yourself"
                            : u.disabled
                              ? "Enable account"
                              : "Disable account"
                        }
                      >
                        {u.disabled ? "Yes" : "No"}
                      </button>
                    </td>
                    <td className={styles.hideMobile}>
                      {formatDate(u.created_at)}
                    </td>
                    <td className={styles.hideMobile}>{u.server_count}</td>
                    <td className={styles.hideMobile}>
                      {u.message_count.toLocaleString()}
                    </td>
                    <td>
                      <button
                        className={styles.deleteBtn}
                        onClick={() =>
                          setDeleteTarget({
                            id: u.id,
                            username: u.username,
                          })
                        }
                        disabled={isSelf}
                        title={
                          isSelf ? "Cannot delete yourself" : "Delete user"
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className={styles.pagination}>
        <button
          className={styles.pageBtn}
          onClick={() => fetchUsers(usersPage - 1)}
          disabled={usersPage <= 1 || usersLoading}
        >
          Previous
        </button>
        <span className={styles.pageInfo}>
          Page {usersPage} of {totalPages} ({usersTotal} total)
        </span>
        <button
          className={styles.pageBtn}
          onClick={() => fetchUsers(usersPage + 1)}
          disabled={usersPage >= totalPages || usersLoading}
        >
          Next
        </button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete User"
        description={`Are you sure you want to delete "${deleteTarget?.username}"? Their messages will be anonymized and all memberships removed. This action cannot be undone.`}
        confirmLabel="Delete User"
        loading={deleteLoading}
      />
    </div>
  );
}

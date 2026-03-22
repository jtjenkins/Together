import { useEffect, useState } from "react";
import { useRoleStore } from "../../stores/roleStore";
import { RoleEditor } from "./RoleEditor";
import type { RoleDto } from "../../types";
import { PERMISSIONS } from "../../types";
import styles from "./RolesTab.module.css";

interface RolesTabProps {
  serverId: string;
}

function countPermissions(perms: number): number {
  let count = 0;
  for (const val of Object.values(PERMISSIONS)) {
    if ((perms & val) !== 0) count++;
  }
  return count;
}

export function RolesTab({ serverId }: RolesTabProps) {
  const roles = useRoleStore((s) => s.roles[serverId] || []);
  const fetchRoles = useRoleStore((s) => s.fetchRoles);
  const deleteRole = useRoleStore((s) => s.deleteRole);
  const error = useRoleStore((s) => s.error);
  const clearError = useRoleStore((s) => s.clearError);

  const [editingRole, setEditingRole] = useState<RoleDto | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchRoles(serverId);
  }, [serverId, fetchRoles]);

  const sortedRoles = [...roles].sort((a, b) => b.position - a.position);

  const handleDelete = async (roleId: string) => {
    setIsDeleting(true);
    try {
      await deleteRole(serverId, roleId);
      setDeletingId(null);
    } catch {
      // error is set in the store
    } finally {
      setIsDeleting(false);
    }
  };

  if (isCreating || editingRole) {
    return (
      <RoleEditor
        serverId={serverId}
        role={editingRole ?? undefined}
        onClose={() => {
          setEditingRole(null);
          setIsCreating(false);
          clearError();
        }}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>Roles ({roles.length})</span>
        <button
          className={styles.createBtn}
          onClick={() => setIsCreating(true)}
        >
          Create Role
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {sortedRoles.length === 0 ? (
        <div className={styles.empty}>
          No roles yet. Create one to get started.
        </div>
      ) : (
        <div className={styles.roleList}>
          {sortedRoles.map((role) => (
            <div key={role.id}>
              <div className={styles.roleItem}>
                <span
                  className={styles.colorDot}
                  style={{ background: role.color || "#95a5a6" }}
                />
                <span className={styles.roleName}>{role.name}</span>
                <span className={styles.permCount}>
                  {countPermissions(role.permissions)} perms
                </span>
                <div className={styles.roleActions}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => setEditingRole(role)}
                    title="Edit role"
                    aria-label={`Edit ${role.name}`}
                  >
                    {"\u270E"}
                  </button>
                  <button
                    className={styles.dangerBtn}
                    onClick={() => setDeletingId(role.id)}
                    title="Delete role"
                    aria-label={`Delete ${role.name}`}
                  >
                    {"\u2715"}
                  </button>
                </div>
              </div>
              {deletingId === role.id && (
                <div className={styles.confirmDelete}>
                  <span className={styles.confirmText}>
                    Delete role &quot;{role.name}&quot;? This cannot be undone.
                  </span>
                  <div className={styles.confirmActions}>
                    <button
                      className={styles.confirmCancelBtn}
                      onClick={() => setDeletingId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className={styles.confirmDeleteBtn}
                      onClick={() => handleDelete(role.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

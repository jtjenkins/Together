import { useEffect, useRef, useState } from "react";
import { useRoleStore } from "../../stores/roleStore";
import { useAuthStore } from "../../stores/authStore";
import { useServerStore } from "../../stores/serverStore";
import type { MemberRoleInfo } from "../../types";
import styles from "./RoleAssignmentMenu.module.css";

interface RoleAssignmentMenuProps {
  serverId: string;
  userId: string;
  memberRoles: MemberRoleInfo[];
  x: number;
  y: number;
  onClose: () => void;
}

export function RoleAssignmentMenu({
  serverId,
  userId,
  memberRoles,
  x,
  y,
  onClose,
}: RoleAssignmentMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const roles = useRoleStore((s) => s.roles[serverId] || []);
  const assignRole = useRoleStore((s) => s.assignRole);
  const removeRole = useRoleStore((s) => s.removeRole);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const members = useServerStore((s) => s.members);
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);

  const [toggling, setToggling] = useState<string | null>(null);

  const activeServer = servers.find((s) => s.id === activeServerId);
  const isOwner = activeServer?.owner_id === currentUserId;

  // Compute actor's highest role position
  const currentMember = members.find((m) => m.user_id === currentUserId);
  const myRoles = currentMember?.roles || [];
  const myHighestPosition = isOwner
    ? Infinity
    : Math.max(0, ...myRoles.map((r) => r.position));

  const sortedRoles = [...roles].sort((a, b) => b.position - a.position);
  const memberRoleIds = new Set(memberRoles.map((r) => r.id));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleToggle = async (roleId: string, hasRole: boolean) => {
    setToggling(roleId);
    try {
      if (hasRole) {
        await removeRole(serverId, userId, roleId);
      } else {
        await assignRole(serverId, userId, roleId);
      }
    } catch {
      // error shown in store
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={ref}
        className={styles.menu}
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.title}>Manage Roles</div>
        {sortedRoles.length === 0 ? (
          <div className={styles.empty}>No roles available</div>
        ) : (
          sortedRoles.map((role) => {
            const hasRole = memberRoleIds.has(role.id);
            const canManage = isOwner || role.position < myHighestPosition;
            const isToggling = toggling === role.id;

            if (!canManage) {
              return (
                <div key={role.id} className={styles.roleRowDisabled}>
                  <input
                    type="checkbox"
                    checked={hasRole}
                    disabled
                    readOnly
                  />
                  <span
                    className={styles.roleDot}
                    style={{ background: role.color || "#95a5a6" }}
                  />
                  <span className={styles.roleName}>{role.name}</span>
                </div>
              );
            }

            return (
              <label key={role.id} className={styles.roleRow}>
                <input
                  type="checkbox"
                  checked={hasRole}
                  disabled={isToggling}
                  onChange={() => handleToggle(role.id, hasRole)}
                />
                <span
                  className={styles.roleDot}
                  style={{ background: role.color || "#95a5a6" }}
                />
                <span className={styles.roleName}>{role.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { useRoleStore } from "../../stores/roleStore";
import { api } from "../../api/client";
import { PERMISSIONS } from "../../types";
import type { RoleDto, ChannelPermissionOverride } from "../../types";
import styles from "./ChannelPermissions.module.css";

interface PermissionDef {
  key: string;
  label: string;
  bit: number;
}

const PERMISSION_SECTIONS: { title: string; perms: PermissionDef[] }[] = [
  {
    title: "General",
    perms: [
      {
        key: "VIEW_CHANNEL",
        label: "View Channel",
        bit: PERMISSIONS.VIEW_CHANNEL,
      },
      {
        key: "SEND_MESSAGES",
        label: "Send Messages",
        bit: PERMISSIONS.SEND_MESSAGES,
      },
      {
        key: "ATTACH_FILES",
        label: "Attach Files",
        bit: PERMISSIONS.ATTACH_FILES,
      },
      {
        key: "ADD_REACTIONS",
        label: "Add Reactions",
        bit: PERMISSIONS.ADD_REACTIONS,
      },
    ],
  },
  {
    title: "Voice",
    perms: [
      {
        key: "CONNECT_VOICE",
        label: "Connect Voice",
        bit: PERMISSIONS.CONNECT_VOICE,
      },
      { key: "SPEAK", label: "Speak", bit: PERMISSIONS.SPEAK },
    ],
  },
  {
    title: "Moderation",
    perms: [
      {
        key: "MANAGE_MESSAGES",
        label: "Manage Messages",
        bit: PERMISSIONS.MANAGE_MESSAGES,
      },
      {
        key: "MUTE_MEMBERS",
        label: "Mute Members",
        bit: PERMISSIONS.MUTE_MEMBERS,
      },
      {
        key: "KICK_MEMBERS",
        label: "Kick Members",
        bit: PERMISSIONS.KICK_MEMBERS,
      },
      {
        key: "BAN_MEMBERS",
        label: "Ban Members",
        bit: PERMISSIONS.BAN_MEMBERS,
      },
    ],
  },
  {
    title: "Management",
    perms: [
      {
        key: "MANAGE_CHANNELS",
        label: "Manage Channels",
        bit: PERMISSIONS.MANAGE_CHANNELS,
      },
      {
        key: "MANAGE_ROLES",
        label: "Manage Roles",
        bit: PERMISSIONS.MANAGE_ROLES,
      },
      {
        key: "MANAGE_SERVER",
        label: "Manage Server",
        bit: PERMISSIONS.MANAGE_SERVER,
      },
      {
        key: "CREATE_INVITES",
        label: "Create Invites",
        bit: PERMISSIONS.CREATE_INVITES,
      },
    ],
  },
];

type TriState = "inherit" | "allow" | "deny";

interface ChannelPermissionsProps {
  channelId: string;
  serverId: string;
  onClose: () => void;
}

export function ChannelPermissions({
  channelId,
  serverId,
  onClose,
}: ChannelPermissionsProps) {
  const roles = useRoleStore((s) => s.roles[serverId] || []);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ChannelPermissionOverride[]>([]);
  const [localAllow, setLocalAllow] = useState(0);
  const [localDeny, setLocalDeny] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  // Fetch overrides on mount
  useEffect(() => {
    setIsLoading(true);
    api
      .listChannelOverrides(channelId)
      .then((data) => {
        setOverrides(data);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Failed to load overrides",
        );
        setIsLoading(false);
      });
  }, [channelId]);

  // When selected role changes, load its override into local state
  useEffect(() => {
    if (!selectedRoleId) {
      setLocalAllow(0);
      setLocalDeny(0);
      return;
    }
    const existing = overrides.find((o) => o.role_id === selectedRoleId);
    setLocalAllow(existing?.allow ?? 0);
    setLocalDeny(existing?.deny ?? 0);
  }, [selectedRoleId, overrides]);

  const getTriState = useCallback(
    (bit: number): TriState => {
      if (localAllow & bit) return "allow";
      if (localDeny & bit) return "deny";
      return "inherit";
    },
    [localAllow, localDeny],
  );

  const setTriState = useCallback((bit: number, state: TriState) => {
    switch (state) {
      case "allow":
        setLocalAllow((prev) => prev | bit);
        setLocalDeny((prev) => prev & ~bit);
        break;
      case "deny":
        setLocalAllow((prev) => prev & ~bit);
        setLocalDeny((prev) => prev | bit);
        break;
      case "inherit":
        setLocalAllow((prev) => prev & ~bit);
        setLocalDeny((prev) => prev & ~bit);
        break;
    }
  }, []);

  const handleSave = async () => {
    if (!selectedRoleId) return;
    setIsSaving(true);
    setError("");
    try {
      const result = await api.setChannelOverride(channelId, {
        role_id: selectedRoleId,
        allow: localAllow,
        deny: localDeny,
      });
      // Update local overrides list
      setOverrides((prev) => {
        const idx = prev.findIndex((o) => o.id === result.id);
        if (idx >= 0) {
          return prev.map((o) => (o.id === result.id ? result : o));
        }
        return [...prev, result];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save override");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedRoleId) return;
    const existing = overrides.find((o) => o.role_id === selectedRoleId);
    if (!existing) {
      // Nothing to reset — just clear local state
      setLocalAllow(0);
      setLocalDeny(0);
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await api.deleteChannelOverride(channelId, existing.id);
      setOverrides((prev) => prev.filter((o) => o.id !== existing.id));
      setLocalAllow(0);
      setLocalDeny(0);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove override",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  if (isLoading) {
    return <div className={styles.loading}>Loading permissions...</div>;
  }

  return (
    <div>
      <button
        className={styles.resetBtn}
        onClick={onClose}
        style={{ marginBottom: 12, padding: "4px 0", background: "none" }}
      >
        {"\u2190"} Back
      </button>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.container}>
        <div className={styles.roleList}>
          <span className={styles.roleListHeader}>Roles</span>
          {roles.map((role: RoleDto) => {
            const hasOverride = overrides.some((o) => o.role_id === role.id);
            return (
              <button
                key={role.id}
                className={`${styles.roleBtn} ${selectedRoleId === role.id ? styles.roleBtnActive : ""}`}
                onClick={() => setSelectedRoleId(role.id)}
              >
                <span
                  className={styles.roleColor}
                  style={{ background: role.color || "#95a5a6" }}
                />
                <span>
                  {role.name}
                  {hasOverride ? " *" : ""}
                </span>
              </button>
            );
          })}
          {roles.length === 0 && (
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
              No roles
            </span>
          )}
        </div>

        <div
          className={`${styles.permPanel} ${!selectedRole ? styles.permPanelEmpty : ""}`}
        >
          {!selectedRole ? (
            <span>Select a role to edit channel permissions</span>
          ) : (
            <>
              {PERMISSION_SECTIONS.map((section) => (
                <div key={section.title} className={styles.section}>
                  <span className={styles.sectionTitle}>{section.title}</span>
                  {section.perms.map((perm) => {
                    const state = getTriState(perm.bit);
                    return (
                      <div key={perm.key} className={styles.permRow}>
                        <span className={styles.permLabel}>{perm.label}</span>
                        <div className={styles.triState}>
                          <button
                            type="button"
                            className={`${styles.triBtn} ${state === "inherit" ? styles.triBtnInherit : ""}`}
                            onClick={() => setTriState(perm.bit, "inherit")}
                            title="Inherit (use server default)"
                          >
                            /
                          </button>
                          <button
                            type="button"
                            className={`${styles.triBtn} ${state === "allow" ? styles.triBtnAllow : ""}`}
                            onClick={() => setTriState(perm.bit, "allow")}
                            title="Allow"
                          >
                            {"\u2713"}
                          </button>
                          <button
                            type="button"
                            className={`${styles.triBtn} ${state === "deny" ? styles.triBtnDeny : ""}`}
                            onClick={() => setTriState(perm.bit, "deny")}
                            title="Deny"
                          >
                            {"\u2717"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.resetBtn}
                  onClick={handleReset}
                  disabled={isSaving}
                >
                  Reset Override
                </button>
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={handleSave}
                  disabled={isSaving}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

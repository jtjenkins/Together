import { useState } from "react";
import { useRoleStore } from "../../stores/roleStore";
import { PERMISSIONS } from "../../types";
import type { RoleDto } from "../../types";
import styles from "./RoleEditor.module.css";

const PRESET_COLORS = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e91e63",
  "#95a5a6",
  "#607d8b",
];

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
        key: "ADMINISTRATOR",
        label: "Administrator",
        bit: PERMISSIONS.ADMINISTRATOR,
      },
    ],
  },
];

interface RoleEditorProps {
  serverId: string;
  role?: RoleDto;
  onClose: () => void;
}

export function RoleEditor({ serverId, role, onClose }: RoleEditorProps) {
  const createRole = useRoleStore((s) => s.createRole);
  const updateRole = useRoleStore((s) => s.updateRole);

  const [name, setName] = useState(role?.name || "");
  const [color, setColor] = useState(role?.color || "#95a5a6");
  const [customColor, setCustomColor] = useState(
    role?.color && !PRESET_COLORS.includes(role.color) ? role.color : "",
  );
  const [permissions, setPermissions] = useState(role?.permissions || 0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isAdmin = (permissions & PERMISSIONS.ADMINISTRATOR) !== 0;

  const togglePerm = (bit: number) => {
    if (bit === PERMISSIONS.ADMINISTRATOR) {
      if (isAdmin) {
        setPermissions(permissions & ~PERMISSIONS.ADMINISTRATOR);
      } else {
        setPermissions(permissions | PERMISSIONS.ADMINISTRATOR);
      }
    } else {
      setPermissions(permissions ^ bit);
    }
  };

  const handleColorSelect = (c: string) => {
    setColor(c);
    setCustomColor("");
  };

  const handleCustomColorChange = (value: string) => {
    setCustomColor(value);
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      setColor(value);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      if (role) {
        await updateRole(serverId, role.id, {
          name: name.trim(),
          permissions,
          color,
        });
      } else {
        await createRole(serverId, {
          name: name.trim(),
          permissions,
          color,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onClose}>
        {"\u2190"} Back to roles
      </button>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="role-name">
          Role Name
        </label>
        <input
          id="role-name"
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Moderator"
          required
          maxLength={100}
          autoFocus
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Color</span>
        <div className={styles.colorRow}>
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              className={`${styles.colorCircle} ${color === c && !customColor ? styles.colorCircleSelected : ""}`}
              style={{ background: c }}
              onClick={() => handleColorSelect(c)}
              title={c}
              aria-label={`Select color ${c}`}
              type="button"
            />
          ))}
          <input
            className={styles.colorInput}
            type="text"
            value={customColor}
            onChange={(e) => handleCustomColorChange(e.target.value)}
            placeholder="#hex"
            maxLength={7}
          />
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Permissions</span>
        {PERMISSION_SECTIONS.map((section) => (
          <div key={section.title} className={styles.section}>
            <span className={styles.sectionTitle}>{section.title}</span>
            <div className={styles.permGrid}>
              {section.perms.map((perm) => {
                const isDisabled =
                  isAdmin && perm.bit !== PERMISSIONS.ADMINISTRATOR;
                const isChecked = isAdmin || (permissions & perm.bit) !== 0;
                return (
                  <label
                    key={perm.key}
                    className={`${styles.permItem} ${isDisabled ? styles.permItemDisabled : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={isDisabled}
                      onChange={() => togglePerm(perm.bit)}
                    />
                    {perm.label}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <button className={styles.cancelBtn} onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className={styles.saveBtn}
          onClick={handleSubmit}
          disabled={isSubmitting || !name.trim()}
          type="button"
        >
          {isSubmitting ? "Saving..." : role ? "Save Changes" : "Create Role"}
        </button>
      </div>
    </div>
  );
}

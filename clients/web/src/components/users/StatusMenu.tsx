import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../../stores/authStore";
import type { UserStatus } from "../../types";
import styles from "./StatusMenu.module.css";

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "away", label: "Away" },
  { value: "dnd", label: "Do Not Disturb" },
  { value: "offline", label: "Invisible" },
];

interface StatusMenuProps {
  onClose: () => void;
}

export function StatusMenu({ onClose }: StatusMenuProps) {
  const user = useAuthStore((s) => s.user);
  const updatePresence = useAuthStore((s) => s.updatePresence);
  const [customStatus, setCustomStatus] = useState(user?.custom_status ?? "");
  const [activity, setActivity] = useState(user?.activity ?? "");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleStatusClick = (status: UserStatus) => {
    updatePresence(status, user?.custom_status ?? null, user?.activity ?? null);
  };

  const handleSave = () => {
    if (user) {
      updatePresence(
        user.status,
        customStatus.trim() || null,
        activity.trim() || null,
      );
    }
    onClose();
  };

  const handleKeyDown = (e: { key: string }) => {
    if (e.key === "Enter") handleSave();
  };

  if (!user) return null;

  return (
    <div className={styles.menu} ref={menuRef} role="menu">
      <div className={styles.section}>
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={`${styles.option} ${user.status === opt.value ? styles.active : ""}`}
            onClick={() => handleStatusClick(opt.value)}
            role="menuitem"
          >
            <span className={`${styles.dot} ${styles[opt.value]}`} />
            <span className={styles.optionLabel}>{opt.label}</span>
            {user.status === opt.value && (
              <span className={styles.check} aria-hidden>
                ✓
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={styles.divider} />

      <div className={styles.customSection}>
        <label className={styles.customLabel} htmlFor="status-menu-custom">
          Custom Status
        </label>
        <input
          id="status-menu-custom"
          className={styles.input}
          type="text"
          value={customStatus}
          onChange={(e) => setCustomStatus(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What are you up to?"
          maxLength={128}
        />

        <label
          className={styles.customLabel}
          htmlFor="status-menu-activity"
          style={{ marginTop: 8 }}
        >
          Activity
        </label>
        <input
          id="status-menu-activity"
          className={styles.input}
          type="text"
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Playing, watching, listening to…"
          maxLength={128}
        />

        <div className={styles.inputRow} style={{ marginTop: 8 }}>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
          {(customStatus !== (user.custom_status ?? "") ||
            activity !== (user.activity ?? "")) && (
            <button
              className={styles.clearBtn}
              onClick={() => {
                setCustomStatus("");
                setActivity("");
                updatePresence(user.status, null, null);
              }}
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

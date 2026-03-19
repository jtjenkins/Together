import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { PublicProfileDto } from "../../types";
import styles from "./UserProfileCard.module.css";

interface UserProfileCardProps {
  userId: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function UserProfileCard({
  userId,
  anchorRef,
  onClose,
}: UserProfileCardProps) {
  const [profile, setProfile] = useState<PublicProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getUserProfile(userId)
      .then((p) => {
        if (!cancelled) {
          setProfile(p);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Position the card relative to the anchor element
  useEffect(() => {
    const card = cardRef.current;
    const anchor = anchorRef.current;
    if (!card || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const viewportWidth = window.innerWidth;

    let left = rect.right + 8;
    if (left + cardRect.width > viewportWidth - 8) {
      left = rect.left - cardRect.width - 8;
    }
    card.style.top = `${Math.max(8, rect.top)}px`;
    card.style.left = `${Math.max(8, left)}px`;
  }, [profile, anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        cardRef.current &&
        !cardRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose, anchorRef]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const statusLabel: Record<string, string> = {
    online: "Online",
    away: "Away",
    dnd: "Do Not Disturb",
    offline: "Offline",
  };

  return (
    <div
      ref={cardRef}
      className={styles.card}
      role="dialog"
      aria-label="User profile"
    >
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !profile ? (
        <div className={styles.loading}>Profile unavailable</div>
      ) : (
        <>
          <div className={styles.header}>
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className={styles.avatar} />
            ) : (
              <div className={styles.avatarFallback}>
                {profile.username.charAt(0).toUpperCase()}
              </div>
            )}
            <div
              className={`${styles.statusDot} ${styles[profile.status]}`}
              title={statusLabel[profile.status] ?? profile.status}
            />
          </div>

          <div className={styles.body}>
            <div className={styles.username}>{profile.username}</div>
            {profile.pronouns && (
              <div className={styles.pronouns}>{profile.pronouns}</div>
            )}
            {profile.custom_status && (
              <div className={styles.customStatus}>{profile.custom_status}</div>
            )}
            {profile.activity && (
              <div className={styles.activity}>{profile.activity}</div>
            )}
            {profile.bio && (
              <>
                <hr className={styles.divider} />
                <div className={styles.bioLabel}>About Me</div>
                <div className={styles.bio}>{profile.bio}</div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect } from "react";
import { useDmStore } from "../../stores/dmStore";
import { useReadStateStore } from "../../stores/readStateStore";
import { formatMessageTime } from "../../utils/formatTime";
import type { DirectMessageChannel } from "../../types";
import styles from "./DMSidebar.module.css";

export function DMSidebar() {
  const channels = useDmStore((s) => s.channels);
  const activeDmChannelId = useDmStore((s) => s.activeDmChannelId);
  const setActiveDmChannel = useDmStore((s) => s.setActiveDmChannel);
  const fetchChannels = useDmStore((s) => s.fetchChannels);
  const unreadCounts = useReadStateStore((s) => s.unreadCounts);
  const markRead = useReadStateStore((s) => s.markRead);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const handleSelect = (channel: DirectMessageChannel) => {
    setActiveDmChannel(channel.id);
    markRead(channel.id);
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <h2 className={styles.title}>Direct Messages</h2>
      </div>

      <div className={styles.list}>
        {channels.length === 0 && (
          <div className={styles.empty}>
            <p>No direct messages yet</p>
            <p className={styles.emptyHint}>
              Open a DM from a server member's profile
            </p>
          </div>
        )}

        {channels.map((channel) => {
          const unread = unreadCounts[channel.id] ?? 0;
          const isActive = channel.id === activeDmChannelId;

          return (
            <button
              key={channel.id}
              className={`${styles.item} ${isActive ? styles.active : ""}`}
              onClick={() => handleSelect(channel)}
            >
              <div className={styles.avatar}>
                {channel.recipient.avatar_url ? (
                  <img
                    src={channel.recipient.avatar_url}
                    alt={channel.recipient.username}
                    className={styles.avatarImg}
                  />
                ) : (
                  <div className={styles.avatarFallback}>
                    {channel.recipient.username.charAt(0).toUpperCase()}
                  </div>
                )}
                <span
                  className={`${styles.statusDot} ${styles[channel.recipient.status]}`}
                />
              </div>

              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <span className={styles.name}>
                    {channel.recipient.username}
                  </span>
                  {channel.last_message_at && (
                    <span className={styles.time}>
                      {formatMessageTime(channel.last_message_at)}
                    </span>
                  )}
                </div>
              </div>

              {unread > 0 && (
                <span className={styles.badge}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

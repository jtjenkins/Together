import { useEffect, useState, useCallback } from "react";
import { X, Pin } from "lucide-react";
import { api } from "../../api/client";
import { formatMessageTime } from "../../utils/formatTime";
import { useServerStore } from "../../stores/serverStore";
import type { Message } from "../../types";
import styles from "./PinnedMessages.module.css";

interface PinnedMessagesProps {
  channelId: string;
  onClose: () => void;
}

export function PinnedMessages({ channelId, onClose }: PinnedMessagesProps) {
  const members = useServerStore((s) => s.members);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const pinned = await api.listPinnedMessages(channelId);
      setMessages(pinned);
    } catch {
      setError("Failed to load pinned messages.");
    } finally {
      setIsLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>
          <Pin size={14} />
        </span>
        <h3 className={styles.title}>Pinned Messages</h3>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close pinned messages"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.body}>
        {isLoading && <p className={styles.status}>Loading…</p>}
        {!isLoading && error && <p className={styles.error}>{error}</p>}
        {!isLoading && !error && messages.length === 0 && (
          <p className={styles.status}>No pinned messages in this channel.</p>
        )}
        {!isLoading &&
          !error &&
          messages.map((msg) => (
            <div key={msg.id} className={styles.item}>
              <div className={styles.itemMeta}>
                <span className={styles.itemAuthor}>
                  {members.find((m) => m.user_id === msg.author_id)?.username ?? "Deleted User"}
                </span>
                <span className={styles.itemTime}>
                  {formatMessageTime(msg.pinned_at ?? msg.created_at)}
                </span>
              </div>
              <p className={styles.itemContent}>{msg.content}</p>
            </div>
          ))}
      </div>
    </div>
  );
}

import { useState, useCallback } from "react";
import { SmilePlus } from "lucide-react";
import { api } from "../../api/client";
import type { ReactionCount } from "../../types";
import { EmojiPicker } from "./EmojiPicker";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import styles from "./ReactionBar.module.css";

interface ReactionBarProps {
  messageId: string;
  channelId: string;
  reactions: ReactionCount[];
  onReactionsChange: (reactions: ReactionCount[]) => void;
  serverId?: string;
}

function EmojiDisplay({
  emoji,
  serverId,
}: {
  emoji: string;
  serverId?: string;
}) {
  const customEmojis = useCustomEmojiStore((s) =>
    serverId ? s.getEmojis(serverId) : [],
  );
  if (emoji.startsWith("c:")) {
    const id = emoji.slice(2);
    const ce = customEmojis.find((e) => e.id === id);
    if (ce) {
      return (
        <img
          src={ce.url}
          alt={`:${ce.name}:`}
          title={`:${ce.name}:`}
          className={styles.customEmojiReaction}
        />
      );
    }
    return (
      <span className={styles.emoji} title={emoji}>
        ?
      </span>
    );
  }
  return <span className={styles.emoji}>{emoji}</span>;
}

export function ReactionBar({
  messageId,
  channelId,
  reactions,
  onReactionsChange,
  serverId,
}: ReactionBarProps) {
  const [showPicker, setShowPicker] = useState(false);

  const toggleReaction = useCallback(
    async (emoji: string) => {
      const existing = reactions.find((r) => r.emoji === emoji);
      try {
        if (existing?.me) {
          await api.removeReaction(channelId, messageId, emoji);
          onReactionsChange(
            reactions
              .map((r) =>
                r.emoji === emoji ? { ...r, count: r.count - 1, me: false } : r,
              )
              .filter((r) => r.count > 0),
          );
        } else {
          await api.addReaction(channelId, messageId, emoji);
          if (existing) {
            onReactionsChange(
              reactions.map((r) =>
                r.emoji === emoji ? { ...r, count: r.count + 1, me: true } : r,
              ),
            );
          } else {
            onReactionsChange([...reactions, { emoji, count: 1, me: true }]);
          }
        }
      } catch (err) {
        // Optimistic update failed — reload reactions from server.
        console.warn(
          "[ReactionBar] reaction toggle failed, reloading from server",
          err,
        );
        try {
          const fresh = await api.listReactions(channelId, messageId);
          onReactionsChange(fresh);
        } catch (reloadErr) {
          console.error(
            "[ReactionBar] failed to reload reactions after toggle error; state may be stale",
            reloadErr,
          );
        }
      }
      setShowPicker(false);
    },
    [channelId, messageId, reactions, onReactionsChange],
  );

  return (
    <div className={styles.wrapper}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`${styles.reaction} ${r.me ? styles.active : ""}`}
          onClick={() => toggleReaction(r.emoji)}
          title={`${r.count} reaction${r.count !== 1 ? "s" : ""}`}
        >
          <EmojiDisplay emoji={r.emoji} serverId={serverId} />
          <span className={styles.count}>{r.count}</span>
        </button>
      ))}

      <div className={styles.pickerWrapper}>
        <button
          className={styles.addBtn}
          onClick={() => setShowPicker((v) => !v)}
          title="Add reaction"
          aria-label="Add reaction"
        >
          <SmilePlus size={16} />
        </button>
        {showPicker && (
          <EmojiPicker
            onSelect={toggleReaction}
            onClose={() => setShowPicker(false)}
            serverId={serverId}
          />
        )}
      </div>
    </div>
  );
}

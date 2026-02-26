import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useServerStore } from "../../stores/serverStore";
import { MessageItem } from "./MessageItem";
import styles from "./ThreadPanel.module.css";

interface ThreadPanelProps {
  channelId: string;
  rootMessageId: string;
  onClose: () => void;
}

export function ThreadPanel({
  channelId,
  rootMessageId,
  onClose,
}: ThreadPanelProps) {
  const fetchThreadReplies = useMessageStore((s) => s.fetchThreadReplies);
  const sendThreadReply = useMessageStore((s) => s.sendThreadReply);
  const threadCache = useMessageStore((s) => s.threadCache);
  const messages = useMessageStore((s) => s.messages);
  const isLoading = useMessageStore((s) => s.isLoading);
  const storeError = useMessageStore((s) => s.error);
  const members = useServerStore((s) => s.members);

  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const replies = threadCache[rootMessageId] ?? [];
  const rootMessage = messages.find((m) => m.id === rootMessageId);

  useEffect(() => {
    fetchThreadReplies(channelId, rootMessageId);
  }, [channelId, rootMessageId, fetchThreadReplies]);

  // Auto-scroll to bottom when replies load or change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [replies.length]);

  const getAuthorName = (authorId: string | null): string => {
    if (!authorId) return "Deleted User";
    const member = members.find((m) => m.user_id === authorId);
    return member?.nickname || member?.username || "Unknown User";
  };

  const getAvatarUrl = (authorId: string | null): string | null => {
    if (!authorId) return null;
    const member = members.find((m) => m.user_id === authorId);
    return member?.avatar_url ?? null;
  };

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content || isSending) return;
    setIsSending(true);
    setSendError(null);
    try {
      await sendThreadReply(channelId, rootMessageId, content);
      setInputValue("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Thread</span>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          title="Close thread"
        >
          <X size={16} />
        </button>
      </div>

      {rootMessage && (
        <div className={styles.rootMessage}>
          <MessageItem
            message={rootMessage}
            showHeader
            authorName={getAuthorName(rootMessage.author_id)}
            avatarUrl={getAvatarUrl(rootMessage.author_id)}
            channelId={channelId}
          />
        </div>
      )}

      <div className={styles.divider} />

      {storeError && <p className={styles.error}>{storeError}</p>}

      <div className={styles.replies} ref={scrollRef}>
        {isLoading ? (
          <p className={styles.loading}>Loading replies…</p>
        ) : replies.length === 0 ? (
          <p className={styles.empty}>
            No replies yet. Start the conversation!
          </p>
        ) : (
          replies.map((reply, i) => {
            const prev = i > 0 ? replies[i - 1] : null;
            const showHeader =
              !prev ||
              prev.author_id !== reply.author_id ||
              new Date(reply.created_at).getTime() -
                new Date(prev.created_at).getTime() >
                5 * 60 * 1000;
            return (
              <MessageItem
                key={reply.id}
                message={reply}
                showHeader={showHeader}
                authorName={getAuthorName(reply.author_id)}
                avatarUrl={getAvatarUrl(reply.author_id)}
                channelId={channelId}
              />
            );
          })
        )}
      </div>

      {sendError && <p className={styles.error}>{sendError}</p>}

      <div className={styles.inputArea}>
        <textarea
          className={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply in thread…"
          rows={2}
          disabled={isSending}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!inputValue.trim() || isSending}
        >
          Send
        </button>
      </div>
    </div>
  );
}

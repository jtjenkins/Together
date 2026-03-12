import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { Pin } from "lucide-react";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { PinnedMessages } from "./PinnedMessages";
import { useMessageStore } from "../../stores/messageStore";
import { useChannelStore } from "../../stores/channelStore";
import styles from "./ChatArea.module.css";

interface ChatAreaProps {
  channelId: string;
  onOpenThread?: (messageId: string) => void;
  onBack?: () => void;
}

export function ChatArea({ channelId, onOpenThread, onBack }: ChatAreaProps) {
  const fetchMessages = useMessageStore((s) => s.fetchMessages);
  const messages = useMessageStore((s) => s.messages);
  const hasMore = useMessageStore((s) => s.hasMore);
  const isLoading = useMessageStore((s) => s.isLoading);
  const channels = useChannelStore((s) => s.channels);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const setHighlightedMessageId = useMessageStore(
    (s) => s.setHighlightedMessageId,
  );
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showPinned, setShowPinned] = useState(false);

  const channel = channels.find((c) => c.id === channelId);

  // Count pinned messages in the current list for the header badge.
  const pinnedCount = useMemo(
    () => messages.filter((m) => m.pinned && !m.deleted).length,
    [messages],
  );

  useEffect(() => {
    fetchMessages(channelId);
  }, [channelId, fetchMessages]);

  // Close pinned panel when switching channels.
  useEffect(() => {
    setShowPinned(false);
  }, [channelId]);

  // Auto-scroll when new messages arrive at bottom
  useEffect(() => {
    if (messages.length > prevMessageCount.current) {
      const el = scrollRef.current;
      if (el) {
        const isNearBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight < 150;
        if (isNearBottom || prevMessageCount.current === 0) {
          el.scrollTop = el.scrollHeight;
        }
      }
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  const handleLoadMore = useCallback(() => {
    if (!isLoading && hasMore && messages.length > 0) {
      fetchMessages(channelId, messages[0].id);
    }
  }, [isLoading, hasMore, messages, channelId, fetchMessages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const shouldShow = distFromBottom > 200;
    setShowScrollBtn((prev) => (prev === shouldShow ? prev : shouldShow));
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const handleJumpToMessage = useCallback(
    (messageId: string) => {
      const el = messageRefs.current.get(messageId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(messageId);
        setTimeout(() => setHighlightedMessageId(null), 2100);
      }
    },
    [setHighlightedMessageId],
  );

  const handleRegisterMessageRef = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (el) {
        messageRefs.current.set(id, el);
      } else {
        messageRefs.current.delete(id);
      }
    },
    [],
  );

  return (
    <div className={styles.chatArea}>
      <div className={styles.header}>
        {onBack && (
          <button
            className={styles.backBtn}
            onClick={onBack}
            aria-label="Back to channels"
          >
            ←
          </button>
        )}
        <span className={styles.channelIcon}>#</span>
        <h2 className={styles.channelName}>{channel?.name ?? "channel"}</h2>
        {channel?.topic && (
          <>
            <span className={styles.divider} />
            <p className={styles.topic}>{channel.topic}</p>
          </>
        )}
        <div className={styles.headerActions}>
          <button
            className={`${styles.pinBtn} ${showPinned ? styles.pinBtnActive : ""}`}
            onClick={() => setShowPinned((v) => !v)}
            title={`Pinned messages${pinnedCount > 0 ? ` (${pinnedCount})` : ""}`}
            aria-label="Toggle pinned messages"
            aria-pressed={showPinned}
          >
            <Pin size={16} />
            {pinnedCount > 0 && (
              <span className={styles.pinCount}>{pinnedCount}</span>
            )}
          </button>
        </div>
      </div>

      <div className={styles.mainRow}>
        <div className={styles.messagesWrapper}>
          <div
            className={styles.messages}
            ref={scrollRef}
            onScroll={handleScroll}
          >
            {hasMore && (
              <div className={styles.loadMore}>
                <button
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  className={styles.loadMoreBtn}
                >
                  {isLoading ? "Loading..." : "Load older messages"}
                </button>
              </div>
            )}
            <MessageList
              messages={messages}
              channelId={channelId}
              onOpenThread={onOpenThread}
              onJumpToMessage={handleJumpToMessage}
              onRegisterMessageRef={handleRegisterMessageRef}
            />
          </div>
          {showScrollBtn && (
            <button
              className={styles.scrollBtn}
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
            >
              ↓
            </button>
          )}
        </div>

        {showPinned && (
          <PinnedMessages
            channelId={channelId}
            onClose={() => setShowPinned(false)}
          />
        )}
      </div>

      <MessageInput channelId={channelId} />
    </div>
  );
}

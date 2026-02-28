import { useEffect, useRef, useCallback, useState } from "react";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
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
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const channel = channels.find((c) => c.id === channelId);

  useEffect(() => {
    fetchMessages(channelId);
  }, [channelId, fetchMessages]);

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
      </div>

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

      <MessageInput channelId={channelId} />
    </div>
  );
}

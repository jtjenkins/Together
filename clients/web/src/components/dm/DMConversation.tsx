import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { useDmStore } from "../../stores/dmStore";
import { useReadStateStore } from "../../stores/readStateStore";
import { useAuthStore } from "../../stores/authStore";
import { api } from "../../api/client";
import { formatMessageTime } from "../../utils/formatTime";
import styles from "./DMConversation.module.css";

interface DMConversationProps {
  channelId: string;
}

export function DMConversation({ channelId }: DMConversationProps) {
  const channels = useDmStore((s) => s.channels);
  const messagesByChannel = useDmStore((s) => s.messagesByChannel);
  const fetchMessages = useDmStore((s) => s.fetchMessages);
  const sendMessage = useDmStore((s) => s.sendMessage);
  const hasMore = useDmStore((s) => s.hasMore);
  const isLoading = useDmStore((s) => s.isLoading);
  const markRead = useReadStateStore((s) => s.markRead);
  const user = useAuthStore((s) => s.user);

  const error = useDmStore((s) => s.error);
  const clearError = useDmStore((s) => s.clearError);

  const [inputValue, setInputValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  const channel = channels.find((c) => c.id === channelId);
  const messages = useMemo(
    () => messagesByChannel[channelId] ?? [],
    [messagesByChannel, channelId],
  );

  useEffect(() => {
    fetchMessages(channelId);
    markRead(channelId);
    // Mark as read on server in background.
    api.ackDmChannel(channelId).catch((err) => {
      console.warn("[DMConversation] ack failed", err);
    });
  }, [channelId, fetchMessages, markRead]);

  // Auto-scroll to bottom when new messages arrive.
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

  const handleSend = async () => {
    const content = inputValue.trim();
    if (!content) return;
    try {
      await sendMessage(channelId, content);
      setInputValue("");
    } catch {
      // Error is displayed via the store.error banner; keep input so user can retry.
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getAuthorName = (authorId: string | null): string => {
    if (!authorId) return "Deleted User";
    if (authorId === user?.id) return "You";
    return channel?.recipient.username ?? "Unknown";
  };

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.errorBanner} role="alert" onClick={clearError}>
          {error} &times;
        </div>
      )}
      <div className={styles.header}>
        {channel && (
          <>
            <div className={styles.headerAvatar}>
              {channel.recipient.avatar_url ? (
                <img
                  src={channel.recipient.avatar_url}
                  alt={channel.recipient.username}
                  className={styles.headerAvatarImg}
                />
              ) : (
                <div className={styles.headerAvatarFallback}>
                  {channel.recipient.username.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className={styles.headerName}>
              {channel.recipient.username}
            </span>
          </>
        )}
      </div>

      <div className={styles.messages} ref={scrollRef}>
        {hasMore && (
          <button
            className={styles.loadMore}
            onClick={handleLoadMore}
            disabled={isLoading}
          >
            {isLoading ? "Loading…" : "Load earlier messages"}
          </button>
        )}

        {messages.length === 0 && !isLoading && (
          <div className={styles.empty}>
            <p>
              Start a conversation with{" "}
              <strong>{channel?.recipient.username}</strong>
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const showHeader =
            !prev ||
            prev.author_id !== msg.author_id ||
            new Date(msg.created_at).getTime() -
              new Date(prev.created_at).getTime() >
              5 * 60 * 1000;
          const isOwn = msg.author_id === user?.id;

          if (msg.deleted) {
            return (
              <div key={msg.id} className={styles.deletedMessage}>
                <em>This message has been deleted</em>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`${styles.message} ${showHeader ? styles.withHeader : styles.compact}`}
            >
              {showHeader && (
                <div className={styles.header2}>
                  <span
                    className={`${styles.authorName} ${isOwn ? styles.ownAuthor : ""}`}
                  >
                    {getAuthorName(msg.author_id)}
                  </span>
                  <span className={styles.timestamp}>
                    {formatMessageTime(msg.created_at)}
                  </span>
                  {msg.edited_at && (
                    <span className={styles.edited}>(edited)</span>
                  )}
                </div>
              )}
              <div className={styles.text}>{msg.content}</div>
            </div>
          );
        })}
      </div>

      <div className={styles.inputArea}>
        <textarea
          className={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${channel?.recipient.username ?? "…"}`}
          rows={1}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!inputValue.trim()}
        >
          &#9658;
        </button>
      </div>
    </div>
  );
}

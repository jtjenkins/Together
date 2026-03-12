import { Fragment, useEffect } from "react";
import { MessageItem } from "./MessageItem";
import { DateSeparator } from "./DateSeparator";
import { useServerStore } from "../../stores/serverStore";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import type { Message } from "../../types";
import styles from "./MessageList.module.css";

interface MessageListProps {
  messages: Message[];
  channelId: string;
  onOpenThread?: (messageId: string) => void;
  onJumpToMessage?: (messageId: string) => void;
  onRegisterMessageRef?: (id: string, el: HTMLDivElement | null) => void;
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function MessageList({
  messages,
  channelId,
  onOpenThread,
  onJumpToMessage,
  onRegisterMessageRef,
}: MessageListProps) {
  const members = useServerStore((s) => s.members);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const currentUser = useAuthStore((s) => s.user);

  // Derive whether the current user is the server owner (can pin messages).
  const canPin =
    currentUser != null &&
    activeServerId != null &&
    servers.find((s) => s.id === activeServerId)?.owner_id === currentUser.id;

  const replyTargetCache = useMessageStore((s) => s.replyTargetCache);
  const ensureReplyTarget = useMessageStore((s) => s.ensureReplyTarget);

  useEffect(() => {
    const replyIds = messages
      .filter(
        (m) =>
          m.reply_to !== null &&
          !messages.some((r) => r.id === m.reply_to) &&
          !replyTargetCache[m.reply_to!],
      )
      .map((m) => m.reply_to!);

    const unique = [...new Set(replyIds)];
    for (const id of unique) {
      ensureReplyTarget(channelId, id);
    }
  }, [messages, replyTargetCache, channelId, ensureReplyTarget]);

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

  // Group consecutive messages from same author
  const groupedMessages: Array<{
    message: Message;
    showHeader: boolean;
  }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = i > 0 ? messages[i - 1] : null;
    const showHeader =
      !prev ||
      prev.author_id !== msg.author_id ||
      new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() >
        5 * 60 * 1000 ||
      msg.reply_to !== null;

    groupedMessages.push({ message: msg, showHeader });
  }

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No messages yet</p>
        <p className={styles.emptySubtitle}>Be the first to say something!</p>
      </div>
    );
  }

  return (
    <div className={styles.list} role="log" aria-label="Message history">
      {groupedMessages.map(({ message, showHeader }, i) => (
        <Fragment key={message.id}>
          {(i === 0 ||
            !isSameDay(
              groupedMessages[i - 1].message.created_at,
              message.created_at,
            )) && <DateSeparator date={message.created_at} />}
          <MessageItem
            message={message}
            showHeader={showHeader}
            authorName={getAuthorName(message.author_id)}
            avatarUrl={getAvatarUrl(message.author_id)}
            channelId={channelId}
            replyAuthorName={
              message.reply_to
                ? getAuthorName(
                    (
                      messages.find((m) => m.id === message.reply_to) ??
                      replyTargetCache[message.reply_to] ??
                      null
                    )?.author_id ?? null,
                  )
                : undefined
            }
            replyContent={
              message.reply_to
                ? (
                    messages.find((m) => m.id === message.reply_to) ??
                    replyTargetCache[message.reply_to] ??
                    null
                  )?.content
                : undefined
            }
            replyIsDeleted={
              message.reply_to
                ? (
                    messages.find((m) => m.id === message.reply_to) ??
                    replyTargetCache[message.reply_to] ??
                    null
                  )?.deleted === true
                : undefined
            }
            onReplyBarClick={
              message.reply_to && onJumpToMessage
                ? () => onJumpToMessage(message.reply_to!)
                : undefined
            }
            onRegisterRef={onRegisterMessageRef}
            onOpenThread={onOpenThread}
            canPin={canPin ?? false}
          />
        </Fragment>
      ))}
    </div>
  );
}

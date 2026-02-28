import { Fragment } from "react";
import { MessageItem } from "./MessageItem";
import { DateSeparator } from "./DateSeparator";
import { useServerStore } from "../../stores/serverStore";
import type { Message } from "../../types";
import styles from "./MessageList.module.css";

interface MessageListProps {
  messages: Message[];
  channelId: string;
  onOpenThread?: (messageId: string) => void;
}

function isSameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function MessageList({
  messages,
  channelId,
  onOpenThread,
}: MessageListProps) {
  const members = useServerStore((s) => s.members);

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
                    messages.find((m) => m.id === message.reply_to)
                      ?.author_id ?? null,
                  )
                : undefined
            }
            replyContent={
              message.reply_to
                ? messages.find((m) => m.id === message.reply_to)?.content
                : undefined
            }
            onOpenThread={onOpenThread}
          />
        </Fragment>
      ))}
    </div>
  );
}

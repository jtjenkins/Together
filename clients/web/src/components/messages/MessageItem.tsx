import { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useMessageStore } from '../../stores/messageStore';
import { formatMessageTime } from '../../utils/formatTime';
import type { Message } from '../../types';
import styles from './MessageItem.module.css';

interface MessageItemProps {
  message: Message;
  showHeader: boolean;
  authorName: string;
  avatarUrl: string | null;
  channelId: string;
  replyAuthorName?: string;
  replyContent?: string;
}

export function MessageItem({
  message,
  showHeader,
  authorName,
  avatarUrl,
  channelId,
  replyAuthorName,
  replyContent,
}: MessageItemProps) {
  const user = useAuthStore((s) => s.user);
  const editMessage = useMessageStore((s) => s.editMessage);
  const deleteMessage = useMessageStore((s) => s.deleteMessage);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showActions, setShowActions] = useState(false);

  const isOwnMessage = message.author_id === user?.id;
  void channelId;

  const handleEdit = async () => {
    if (editContent.trim() && editContent !== message.content) {
      await editMessage(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEdit();
    }
    if (e.key === 'Escape') {
      setIsEditing(false);
      setEditContent(message.content);
    }
  };

  if (message.deleted) {
    return (
      <div className={`${styles.message} ${styles.deleted}`}>
        <div className={styles.deletedContent}>
          <em>This message has been deleted</em>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.message} ${showHeader ? styles.withHeader : styles.compact}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {message.reply_to && replyContent && (
        <div className={styles.replyBar}>
          <span className={styles.replyIcon}>&#8627;</span>
          <span className={styles.replyAuthor}>{replyAuthorName}</span>
          <span className={styles.replyText}>{replyContent}</span>
        </div>
      )}

      <div className={styles.body}>
        {showHeader ? (
          <div className={styles.avatar}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className={styles.avatarImg} />
            ) : (
              <div className={styles.avatarFallback}>
                {authorName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.gutterTime}>
            <span className={styles.compactTime}>
              {formatMessageTime(message.created_at)}
            </span>
          </div>
        )}

        <div className={styles.content}>
          {showHeader && (
            <div className={styles.header}>
              <span className={styles.authorName}>{authorName}</span>
              <span className={styles.timestamp}>
                {formatMessageTime(message.created_at)}
              </span>
              {message.edited_at && (
                <span className={styles.edited}>(edited)</span>
              )}
            </div>
          )}

          {isEditing ? (
            <div className={styles.editBox}>
              <textarea
                className={styles.editInput}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
                rows={1}
              />
              <div className={styles.editHint}>
                escape to cancel &middot; enter to save
              </div>
            </div>
          ) : (
            <div className={styles.text}>{message.content}</div>
          )}
        </div>

        {showActions && !isEditing && (
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => setReplyingTo(message)}
              title="Reply"
            >
              &#8617;
            </button>
            {isOwnMessage && (
              <>
                <button
                  className={styles.actionBtn}
                  onClick={() => {
                    setIsEditing(true);
                    setEditContent(message.content);
                  }}
                  title="Edit"
                >
                  &#9998;
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.dangerBtn}`}
                  onClick={() => deleteMessage(message.id)}
                  title="Delete"
                >
                  &#128465;
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

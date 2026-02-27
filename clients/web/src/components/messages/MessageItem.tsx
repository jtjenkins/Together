import React, { useState, useEffect, useCallback } from "react";
import {
  CornerDownRight,
  FileText,
  Reply,
  MessageSquare,
  Pencil,
  Trash2,
  SmilePlus,
} from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { useMessageStore } from "../../stores/messageStore";
import { useServerStore } from "../../stores/serverStore";
import { formatMessageTime } from "../../utils/formatTime";
import { parseEmoji } from "../../utils/emoji";
import { api } from "../../api/client";
import { ReactionBar } from "./ReactionBar";
import { EmojiPicker } from "./EmojiPicker";
import type { MemberDto, Message, ReactionCount } from "../../types";
import styles from "./MessageItem.module.css";

/** Split content on @word boundaries and wrap matched mentions in styled spans.
 *  Also converts :emoji_name: patterns to actual emoji characters. */
function renderMentions(
  content: string,
  members: MemberDto[],
  currentUserId: string | null,
): React.ReactNode {
  // Pre-process :name: → emoji character, then split on mentions
  const processed = parseEmoji(content);
  return processed.split(/(@\w+)/g).map((part, i) => {
    const stripped = part.startsWith("@") ? part.slice(1) : null;
    if (stripped !== null) {
      if (stripped === "everyone") {
        return (
          <span key={i} className={styles.mention}>
            {part}
          </span>
        );
      }
      const matched = members.find((m) => m.username === stripped);
      if (matched) {
        const isSelf = matched.user_id === currentUserId;
        return (
          <span
            key={i}
            className={`${styles.mention} ${isSelf ? styles.mentionSelf : ""}`}
          >
            {part}
          </span>
        );
      }
    }
    return part;
  });
}

interface MessageItemProps {
  message: Message;
  showHeader: boolean;
  authorName: string;
  avatarUrl: string | null;
  channelId: string;
  replyAuthorName?: string;
  replyContent?: string;
  /** Called when the user opens the thread panel for this message. */
  onOpenThread?: (messageId: string) => void;
}

export function MessageItem({
  message,
  showHeader,
  authorName,
  avatarUrl,
  channelId,
  replyAuthorName,
  replyContent,
  onOpenThread,
}: MessageItemProps) {
  const user = useAuthStore((s) => s.user);
  const members = useServerStore((s) => s.members);
  const editMessage = useMessageStore((s) => s.editMessage);
  const deleteMessage = useMessageStore((s) => s.deleteMessage);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const attachments = useMessageStore(
    (s) => s.attachmentCache[message.id] ?? [],
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showPicker, setShowPicker] = useState(false);
  const [reactions, setReactions] = useState<ReactionCount[]>([]);

  const isOwnMessage = message.author_id === user?.id;

  // Load reactions from server on mount.
  useEffect(() => {
    api
      .listReactions(channelId, message.id)
      .then(setReactions)
      .catch(() => {
        // Non-fatal: reactions will be empty; user can still add new ones.
      });
  }, [channelId, message.id]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleEdit = async () => {
    if (editContent.trim() && editContent !== message.content) {
      await editMessage(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleEdit();
    }
    if (e.key === "Escape") {
      setIsEditing(false);
      setEditContent(message.content);
    }
  };

  const handleQuickReact = useCallback(
    async (emoji: string) => {
      setShowPicker(false);
      try {
        await api.addReaction(channelId, message.id, emoji);
        setReactions((prev) => {
          const existing = prev.find((r) => r.emoji === emoji);
          if (existing) {
            return prev.map((r) =>
              r.emoji === emoji ? { ...r, count: r.count + 1, me: true } : r,
            );
          }
          return [...prev, { emoji, count: 1, me: true }];
        });
      } catch {
        // Non-fatal
      }
    },
    [channelId, message.id],
  );

  if (message.deleted) {
    return (
      <div
        className={`${styles.message} ${styles.deleted} ${isOwnMessage ? styles.own : ""}`}
      >
        <div className={styles.deletedContent}>
          <em>This message has been deleted</em>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${styles.message} ${isOwnMessage ? styles.own : ""} ${showHeader ? styles.withHeader : styles.compact}`}
      onMouseLeave={() => setShowPicker(false)}
    >
      {message.reply_to && replyContent && (
        <div className={styles.replyBar}>
          <span className={styles.replyIcon}>
            <CornerDownRight size={12} />
          </span>
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
            <>
              {message.content !== "\u200b" && (
                <div className={styles.text}>
                  {renderMentions(message.content, members, user?.id ?? null)}
                </div>
              )}
              {attachments.length > 0 && (
                <div className={styles.attachments}>
                  {attachments.map((att) =>
                    att.mime_type.startsWith("image/") ? (
                      <a
                        key={att.id}
                        href={api.fileUrl(att.url)}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.imageAttachment}
                      >
                        <img
                          src={api.fileUrl(att.url)}
                          alt={att.filename}
                          className={styles.attachmentImage}
                          style={
                            att.width !== null
                              ? {
                                  aspectRatio: `${att.width} / ${att.height}`,
                                }
                              : undefined
                          }
                        />
                      </a>
                    ) : (
                      <a
                        key={att.id}
                        href={api.fileUrl(att.url)}
                        download={att.filename}
                        className={styles.fileAttachment}
                      >
                        <span className={styles.fileAttachIcon}>
                          <FileText size={14} />
                        </span>
                        <span className={styles.fileAttachName}>
                          {att.filename}
                        </span>
                        <span className={styles.fileAttachSize}>
                          {formatBytes(att.file_size)}
                        </span>
                      </a>
                    ),
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Action toolbar — always in DOM, shown via CSS :hover, no layout impact */}
        {!isEditing && (
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => setShowPicker((v) => !v)}
              title="Add Reaction"
            >
              <SmilePlus size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => setReplyingTo(message)}
              title="Reply"
            >
              <Reply size={14} />
            </button>
            {!message.thread_id && onOpenThread && (
              <button
                className={styles.actionBtn}
                onClick={() => onOpenThread(message.id)}
                title="Start Thread"
              >
                <MessageSquare size={14} />
              </button>
            )}
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
                  <Pencil size={14} />
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.dangerBtn}`}
                  onClick={() => deleteMessage(message.id)}
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            {showPicker && (
              <div className={styles.pickerAnchor}>
                <EmojiPicker
                  onSelect={handleQuickReact}
                  onClose={() => setShowPicker(false)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reaction bar — only rendered when reactions exist; never causes layout shift on hover */}
      {reactions.length > 0 && (
        <div className={styles.reactionArea}>
          <ReactionBar
            messageId={message.id}
            channelId={channelId}
            reactions={reactions}
            onReactionsChange={setReactions}
          />
        </div>
      )}

      {!message.thread_id && message.thread_reply_count > 0 && onOpenThread && (
        <button
          className={styles.threadFooter}
          onClick={() => onOpenThread(message.id)}
        >
          <span className={styles.threadIcon}>
            <MessageSquare size={14} />
          </span>
          <span className={styles.threadCount}>
            {message.thread_reply_count}{" "}
            {message.thread_reply_count === 1 ? "reply" : "replies"}
          </span>
        </button>
      )}
    </div>
  );
}

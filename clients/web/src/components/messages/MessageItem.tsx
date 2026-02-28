import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { useMobileLayout } from "../../hooks/useMobileLayout";
import { formatMessageTime } from "../../utils/formatTime";
import { formatBytes } from "../../utils/formatBytes";
import { parseEmoji } from "../../utils/emoji";
import { extractUrls, isImageUrl } from "../../utils/links";
import { parseMarkdown, type MarkdownSegment } from "../../utils/markdown";
import { api } from "../../api/client";
import { ReactionBar } from "./ReactionBar";
import { EmojiPicker } from "./EmojiPicker";
import { LinkPreview } from "./LinkPreview";
import { PollCard } from "./PollCard";
import { EventCard } from "./EventCard";
import type { MemberDto, Message, PollDto, ReactionCount } from "../../types";
import styles from "./MessageItem.module.css";

interface RenderedContent {
  nodes: React.ReactNode[];
  /** First non-image URL in the message, used to display the link preview card.
   *  Null when the message contains no linkable (non-image) URLs. */
  firstLinkUrl: string | null;
}

function SpoilerText({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      className={`${styles.spoiler} ${revealed ? styles.spoilerRevealed : ""}`}
      onClick={() => setRevealed((v) => !v)}
      role="button"
      tabIndex={0}
      aria-label={revealed ? "Hide spoiler" : "Show spoiler"}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setRevealed((v) => !v);
        }
      }}
    >
      {revealed ? children : null}
    </span>
  );
}

function renderTextLeaf(
  text: string,
  members: MemberDto[],
  currentUserId: string | null,
  keyPrefix: string,
): React.ReactNode[] {
  const processed = parseEmoji(text);
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const parts = processed.split(urlPattern);
  const urlMatches = [...processed.matchAll(urlPattern)].map((m) => m[0]);
  const result: React.ReactNode[] = [];

  parts.forEach((textPart, i) => {
    if (textPart) {
      textPart.split(/(@\w+)/g).forEach((chunk, j) => {
        const stripped = chunk.startsWith("@") ? chunk.slice(1) : null;
        if (stripped !== null) {
          if (stripped === "everyone") {
            result.push(
              <span key={`${keyPrefix}-t${i}-${j}`} className={styles.mention}>
                {chunk}
              </span>,
            );
            return;
          }
          const matched = members.find((m) => m.username === stripped);
          if (matched) {
            const isSelf = matched.user_id === currentUserId;
            result.push(
              <span
                key={`${keyPrefix}-t${i}-${j}`}
                className={`${styles.mention} ${isSelf ? styles.mentionSelf : ""}`}
              >
                {chunk}
              </span>,
            );
            return;
          }
        }
        result.push(chunk);
      });
    }
    const url = urlMatches[i];
    if (url) {
      if (isImageUrl(url)) {
        result.push(
          <a
            key={`${keyPrefix}-u${i}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={styles.imageLink}
          >
            <img src={url} alt="" className={styles.inlineImage} />
          </a>,
        );
      } else {
        result.push(
          <a
            key={`${keyPrefix}-u${i}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className={styles.link}
          >
            {url}
          </a>,
        );
      }
    }
  });

  return result;
}

function renderSegments(
  segments: MarkdownSegment[],
  members: MemberDto[],
  currentUserId: string | null,
  keyPrefix: string,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];

  segments.forEach((seg, i) => {
    const key = `${keyPrefix}-${i}`;

    if (seg.type === "text") {
      nodes.push(...renderTextLeaf(seg.content, members, currentUserId, key));
      return;
    }

    const inner =
      "content" in seg && Array.isArray(seg.content)
        ? renderSegments(seg.content, members, currentUserId, key)
        : null;

    switch (seg.type) {
      case "bold":
        nodes.push(<strong key={key}>{inner}</strong>);
        break;
      case "italic":
        nodes.push(<em key={key}>{inner}</em>);
        break;
      case "bold_italic":
        nodes.push(
          <strong key={key}>
            <em>{inner}</em>
          </strong>,
        );
        break;
      case "strikethrough":
        nodes.push(<s key={key}>{inner}</s>);
        break;
      case "spoiler":
        nodes.push(<SpoilerText key={key}>{inner}</SpoilerText>);
        break;
      case "code_inline":
        nodes.push(
          <code key={key} className={styles.codeInline}>
            {seg.content}
          </code>,
        );
        break;
      case "code_block":
        nodes.push(
          <pre key={key} className={styles.codeBlock}>
            {seg.lang && <span className={styles.codeLang}>{seg.lang}</span>}
            <code>{seg.content}</code>
          </pre>,
        );
        break;
      case "blockquote":
        nodes.push(
          <blockquote key={key} className={styles.blockquote}>
            {inner}
          </blockquote>,
        );
        break;
    }
  });

  return nodes;
}

function renderContent(
  content: string,
  members: MemberDto[],
  currentUserId: string | null,
): RenderedContent {
  const segments = parseMarkdown(content);

  // Extract first non-image URL from text leaf nodes for link preview
  function findFirstLinkUrl(segs: MarkdownSegment[]): string | null {
    for (const seg of segs) {
      if (seg.type === "text") {
        const urls = extractUrls(seg.content);
        const link = urls.find((u) => !isImageUrl(u));
        if (link) return link;
      } else if ("content" in seg && Array.isArray(seg.content)) {
        const found = findFirstLinkUrl(seg.content);
        if (found) return found;
      }
    }
    return null;
  }

  const firstLinkUrl = findFirstLinkUrl(segments);
  const nodes = renderSegments(segments, members, currentUserId, "root");
  return { nodes, firstLinkUrl };
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
  const updateMessagePoll = useMessageStore((s) => s.updateMessagePoll);

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showPicker, setShowPicker] = useState(false);
  const [reactions, setReactions] = useState<ReactionCount[]>([]);

  const isOwnMessage = message.author_id === user?.id;
  const isMobile = useMobileLayout();
  const [actionsOpen, setActionsOpen] = useState(false);

  // Close action sheet when tapping outside
  useEffect(() => {
    if (!actionsOpen) return;
    const close = () => setActionsOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [actionsOpen]);

  // Load reactions from server on mount.
  useEffect(() => {
    api
      .listReactions(channelId, message.id)
      .then(setReactions)
      .catch(() => {
        // Non-fatal: reactions will be empty; user can still add new ones.
      });
  }, [channelId, message.id]);

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
      } catch (err: unknown) {
        console.warn(
          "[MessageItem] quick react failed, reverting optimistic update",
          err,
        );
        // Revert the optimistic update by re-fetching authoritative state from the server
        api
          .listReactions(channelId, message.id)
          .then(setReactions)
          .catch(() => {
            // Non-fatal: stale reactions are visible but not persisted
          });
      }
    },
    [channelId, message.id],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  // `members` is intentionally omitted from the dep array to avoid re-rendering
  // all messages whenever anyone joins/leaves. Mention highlighting can be
  // slightly stale, which is acceptable.
  const { nodes: contentNodes, firstLinkUrl } = useMemo(
    () =>
      message.content !== "\u200b"
        ? renderContent(message.content, members, user?.id ?? null)
        : { nodes: [], firstLinkUrl: null },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.content, message.id, user?.id],
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
                <>
                  <div className={styles.text}>{contentNodes}</div>
                  {firstLinkUrl && <LinkPreview url={firstLinkUrl} />}
                </>
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
              {message.poll && (
                <PollCard
                  poll={message.poll}
                  onUpdate={(updated: PollDto) =>
                    updateMessagePoll(updated.id, updated)
                  }
                />
              )}
              {message.event && <EventCard event={message.event} />}
            </>
          )}
        </div>

        {/* Mobile "···" button — visible only on narrow viewports */}
        {!isEditing && isMobile && (
          <button
            className={styles.moreBtn}
            aria-label="Message actions"
            onClick={(e) => {
              e.stopPropagation();
              setActionsOpen((v) => !v);
            }}
          >
            ···
          </button>
        )}

        {/* Action toolbar — always in DOM, shown via CSS :hover, no layout impact */}
        {!isEditing && (
          <div className={styles.actions}>
            <button
              className={styles.actionBtn}
              onClick={() => setShowPicker((v) => !v)}
              title="Add Reaction"
              aria-label="Add reaction"
            >
              <SmilePlus size={14} />
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => setReplyingTo(message)}
              title="Reply"
              aria-label="Reply to message"
            >
              <Reply size={14} />
            </button>
            {!message.thread_id && onOpenThread && (
              <button
                className={styles.actionBtn}
                onClick={() => onOpenThread(message.id)}
                title="Start Thread"
                aria-label="Start thread"
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
                  aria-label="Edit message"
                >
                  <Pencil size={14} />
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.dangerBtn}`}
                  onClick={() => {
                    if (window.confirm("Delete this message?")) {
                      deleteMessage(message.id);
                    }
                  }}
                  title="Delete"
                  aria-label="Delete message"
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

      {/* Mobile action sheet — shown when user taps the ··· button */}
      {isMobile && actionsOpen && (
        <div className={styles.actionSheet} role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setReplyingTo(message);
              setActionsOpen(false);
            }}
          >
            Reply
          </button>
          {!message.thread_id && onOpenThread && (
            <button
              role="menuitem"
              onClick={() => {
                onOpenThread(message.id);
                setActionsOpen(false);
              }}
            >
              Reply in Thread
            </button>
          )}
          {isOwnMessage && (
            <button
              role="menuitem"
              onClick={() => {
                setIsEditing(true);
                setEditContent(message.content);
                setActionsOpen(false);
              }}
            >
              Edit
            </button>
          )}
          {isOwnMessage && (
            <button
              role="menuitem"
              className={styles.dangerAction}
              onClick={() => {
                if (window.confirm("Delete this message?")) {
                  deleteMessage(message.id);
                }
                setActionsOpen(false);
              }}
            >
              Delete
            </button>
          )}
          <button role="menuitem" onClick={() => setActionsOpen(false)}>
            Cancel
          </button>
        </div>
      )}

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

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import { Paperclip, ImageIcon, FileText, ArrowUp } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useChannelStore } from "../../stores/channelStore";
import { useServerStore } from "../../stores/serverStore";
import { extractUrls, isImageUrl } from "../../utils/links";
import { searchEmoji } from "../../utils/emoji";
import {
  detectSlashTrigger,
  searchCommands,
  type SlashCommand,
} from "../../utils/slashCommands";
import { EmojiAutocomplete } from "./EmojiAutocomplete";
import { MentionAutocomplete, filterMembers } from "./MentionAutocomplete";
import { LinkPreview } from "./LinkPreview";
import { SlashCommandPicker } from "./SlashCommandPicker";
import { GifPicker } from "./GifPicker";
import { PollForm } from "./PollForm";
import { EventForm } from "./EventForm";
import type { GifResult } from "../../types";
import styles from "./MessageInput.module.css";

interface MessageInputProps {
  channelId: string;
}

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [emojiActiveIdx, setEmojiActiveIdx] = useState(0);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashActiveIdx, setSlashActiveIdx] = useState(0);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
  type ActiveCommand =
    | { type: "giphy"; query: string }
    | { type: "poll"; prefill: string }
    | { type: "event"; prefill: string }
    | null;
  const [activeCommand, setActiveCommand] = useState<ActiveCommand>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const replyingTo = useMessageStore((s) => s.replyingTo);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const channels = useChannelStore((s) => s.channels);
  const members = useServerStore((s) => s.members);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channel = channels.find((c) => c.id === channelId);

  // Debounced URL detection for compose-time link/image preview
  useEffect(() => {
    const id = setTimeout(() => {
      const urls = extractUrls(content);
      setPreviewUrl(urls[0] ?? null);
    }, 400);
    return () => clearTimeout(id);
  }, [content]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const files = Array.from(newFiles);
    setPendingFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [
        ...prev,
        ...files.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
    });
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    // Don't submit while a command form (poll/event/gif) is open
    if (activeCommand !== null) return;
    const trimmed = content.trim();
    if (!trimmed && pendingFiles.length === 0) return;

    const filesToSend = [...pendingFiles];
    // Zero-width space as placeholder content for file-only messages
    const messageContent = trimmed || "\u200b";

    try {
      await sendMessage(
        channelId,
        { content: messageContent, reply_to: replyingTo?.id },
        filesToSend.length > 0 ? filesToSend : undefined,
      );
      setContent("");
      setPendingFiles([]);
      setEmojiQuery(null);
      setEmojiActiveIdx(0);
      setSlashQuery(null);
      setSlashActiveIdx(0);
      setMentionQuery(null);
      setMentionActiveIdx(0);
      setActiveCommand(null);
      inputRef.current?.focus();
    } catch {
      // Error shown via store
    }
  };

  /** Detect emoji, slash, and mention triggers — called from onChange and onSelect. */
  function detectAllTriggers(currentContent = content) {
    const cursor = inputRef.current?.selectionStart ?? currentContent.length;
    const before = currentContent.slice(0, cursor);

    // Emoji trigger: :word (at least 1 char)
    const emojiMatch = before.match(/:([a-zA-Z0-9_+-]{1,})$/);

    // Slash trigger: only when no emoji trigger active
    const slashTrigger = !emojiMatch
      ? detectSlashTrigger(currentContent, cursor)
      : null;

    // Mention trigger: @word (zero or more chars) — only when no other trigger active.
    // The pattern requires whitespace (or start-of-string) before @ to avoid
    // treating email addresses embedded in text as mention triggers.
    const mentionMatch =
      !emojiMatch && slashTrigger === null
        ? before.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/)
        : null;

    setEmojiQuery(emojiMatch ? emojiMatch[1] : null);
    if (!emojiMatch) setEmojiActiveIdx(0);

    setSlashQuery(slashTrigger);
    if (slashTrigger === null) setSlashActiveIdx(0);

    setMentionQuery(mentionMatch ? mentionMatch[1] : null);
    if (!mentionMatch) setMentionActiveIdx(0);
  }

  /** Apply a selected emoji, replacing the :query text. */
  function applyEmoji(emoji: string) {
    const cursor = inputRef.current?.selectionStart ?? content.length;
    const before = content.slice(0, cursor);
    const colonIdx = before.lastIndexOf(":");
    const after = content.slice(cursor);
    const next = before.slice(0, colonIdx) + emoji + after;
    setContent(next);
    setEmojiQuery(null);
    setEmojiActiveIdx(0);
    // Restore focus and move cursor after the inserted emoji
    requestAnimationFrame(() => {
      const pos = colonIdx + [...emoji].length; // handle multi-codepoint emoji
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  /**
   * Apply a selected mention, replacing @query with @username followed by a
   * space. Focus and cursor position are restored asynchronously via
   * requestAnimationFrame so the textarea does not stay blurred after a
   * mouse-click selection.
   */
  function applyMention(username: string) {
    const cursor = inputRef.current?.selectionStart ?? content.length;
    const before = content.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    const after = content.slice(cursor);
    const inserted = `@${username} `;
    const next = before.slice(0, atIdx) + inserted + after;
    setContent(next);
    setMentionQuery(null);
    setMentionActiveIdx(0);
    requestAnimationFrame(() => {
      const pos = atIdx + inserted.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  /** Apply a selected slash command — clear input and open the appropriate UI. */
  function handleSlashSelect(command: SlashCommand) {
    const cursor = inputRef.current?.selectionStart ?? content.length;
    const slashIdx = content.slice(0, cursor).lastIndexOf("/");
    const argText = content.slice(slashIdx + command.name.length + 1).trim();

    setSlashQuery(null);
    setSlashActiveIdx(0);

    if (command.name === "spoiler") {
      const el = inputRef.current;
      if (!el) return;
      const start = el.selectionStart ?? cursor;
      const end = el.selectionEnd ?? cursor;
      const selected = content.slice(start, end);
      if (selected.length > 0) {
        setContent(
          content.slice(0, start) + `||${selected}||` + content.slice(end),
        );
      } else {
        const next =
          content.slice(0, slashIdx) + "||||" + content.slice(cursor);
        setContent(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(slashIdx + 2, slashIdx + 2);
        });
      }
      return;
    }

    setContent("");
    if (command.name === "giphy") {
      setActiveCommand({ type: "giphy", query: argText });
    } else if (command.name === "poll") {
      setActiveCommand({ type: "poll", prefill: argText });
    } else if (command.name === "event") {
      setActiveCommand({ type: "event", prefill: argText });
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command navigation — checked first
    if (slashQuery !== null) {
      const results = searchCommands(slashQuery);
      if (results.length > 0) {
        if (e.key === "ArrowDown") {
          setSlashActiveIdx((i) => Math.min(i + 1, results.length - 1));
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowUp") {
          setSlashActiveIdx((i) => Math.max(i - 1, 0));
          e.preventDefault();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          handleSlashSelect(results[slashActiveIdx]);
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        setSlashQuery(null);
        e.preventDefault();
        return;
      }
    }

    // Emoji navigation
    if (emojiQuery !== null) {
      const results = searchEmoji(emojiQuery, 8);
      if (results.length > 0) {
        if (e.key === "ArrowDown") {
          setEmojiActiveIdx((i) => Math.min(i + 1, results.length - 1));
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowUp") {
          setEmojiActiveIdx((i) => Math.max(i - 1, 0));
          e.preventDefault();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          applyEmoji(results[emojiActiveIdx].emoji);
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        setEmojiQuery(null);
        e.preventDefault();
        return;
      }
    }

    // Mention navigation
    if (mentionQuery !== null) {
      const results = filterMembers(members, mentionQuery);
      if (results.length > 0) {
        if (e.key === "ArrowDown") {
          setMentionActiveIdx((i) => Math.min(i + 1, results.length - 1));
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowUp") {
          setMentionActiveIdx((i) => Math.max(i - 1, 0));
          e.preventDefault();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          // Clamp index in case results shrunk while the user was navigating
          const idx = Math.min(mentionActiveIdx, results.length - 1);
          applyMention(results[idx].username);
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        e.preventDefault();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape" && replyingTo) {
      setReplyingTo(null);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      className={`${styles.container} ${isDragging ? styles.dragging : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {replyingTo && (
        <div className={styles.replyBar}>
          <span className={styles.replyText}>
            Replying to{" "}
            <strong>
              {(() => {
                if (!replyingTo.author_id) return "someone";
                const member = members.find(
                  (m) => m.user_id === replyingTo.author_id,
                );
                return member?.nickname || member?.username || "Unknown User";
              })()}
            </strong>
          </span>
          <button
            className={styles.replyClose}
            onClick={() => setReplyingTo(null)}
            aria-label="Cancel reply"
          >
            &times;
          </button>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className={styles.filePreview}>
          {pendingFiles.map((file, i) => (
            <div key={i} className={styles.fileChip}>
              <span className={styles.fileIcon}>
                {file.type.startsWith("image/") ? (
                  <ImageIcon size={14} />
                ) : (
                  <FileText size={14} />
                )}
              </span>
              <span className={styles.fileName} title={file.name}>
                {file.name}
              </span>
              <span className={styles.fileSize}>{formatBytes(file.size)}</span>
              <button
                className={styles.fileRemove}
                onClick={() => removeFile(i)}
                aria-label="Remove file"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {activeCommand?.type === "giphy" && (
        <GifPicker
          initialQuery={activeCommand.query}
          onSelect={(gif: GifResult) => {
            sendMessage(channelId, { content: gif.url });
            setActiveCommand(null);
            inputRef.current?.focus();
          }}
          onClose={() => {
            setActiveCommand(null);
            inputRef.current?.focus();
          }}
        />
      )}
      {activeCommand?.type === "poll" && (
        <PollForm
          channelId={channelId}
          prefill={activeCommand.prefill}
          onSubmit={() => {
            setActiveCommand(null);
            inputRef.current?.focus();
          }}
          onClose={() => {
            setActiveCommand(null);
            inputRef.current?.focus();
          }}
        />
      )}
      {activeCommand?.type === "event" && (
        <EventForm
          channelId={channelId}
          prefill={activeCommand.prefill}
          onSubmit={() => {
            setActiveCommand(null);
            inputRef.current?.focus();
          }}
          onClose={() => {
            setActiveCommand(null);
            inputRef.current?.focus();
          }}
        />
      )}

      {previewUrl && activeCommand === null && (
        <div className={styles.composePreview}>
          {isImageUrl(previewUrl) ? (
            <img
              src={previewUrl}
              className={styles.composeImagePreview}
              alt="Image preview"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <LinkPreview url={previewUrl} />
          )}
        </div>
      )}

      <div className={styles.inputWrapper}>
        {slashQuery !== null && (
          <SlashCommandPicker
            query={slashQuery}
            activeIndex={slashActiveIdx}
            onSelect={handleSlashSelect}
            onClose={() => setSlashQuery(null)}
          />
        )}
        {emojiQuery !== null && (
          <EmojiAutocomplete
            query={emojiQuery}
            activeIndex={emojiActiveIdx}
            onSelect={applyEmoji}
            onClose={() => setEmojiQuery(null)}
          />
        )}
        {mentionQuery !== null && (
          <MentionAutocomplete
            query={mentionQuery}
            members={members}
            activeIndex={mentionActiveIdx}
            onSelect={applyMention}
            onClose={() => setMentionQuery(null)}
          />
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <button
            type="button"
            className={styles.attachBtn}
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={styles.fileInput}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              // Reset so the same file can be re-added after removal
              e.target.value = "";
            }}
          />
          <textarea
            ref={inputRef}
            className={styles.input}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              detectAllTriggers(e.target.value); // pass fresh value to avoid stale closure
            }}
            onSelect={detectAllTriggers}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channel?.name ?? "channel"}`}
            rows={1}
            maxLength={4000}
            aria-label="Message input"
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!content.trim() && pendingFiles.length === 0}
            aria-label="Send message"
            title="Send message"
          >
            <ArrowUp size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

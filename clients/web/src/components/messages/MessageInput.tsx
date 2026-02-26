import {
  useState,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type DragEvent,
} from "react";
import { Paperclip, ImageIcon, FileText, ArrowUp } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useChannelStore } from "../../stores/channelStore";
import styles from "./MessageInput.module.css";

interface MessageInputProps {
  channelId: string;
}

export function MessageInput({ channelId }: MessageInputProps) {
  const [content, setContent] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const sendMessage = useMessageStore((s) => s.sendMessage);
  const replyingTo = useMessageStore((s) => s.replyingTo);
  const setReplyingTo = useMessageStore((s) => s.setReplyingTo);
  const channels = useChannelStore((s) => s.channels);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const channel = channels.find((c) => c.id === channelId);

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
      inputRef.current?.focus();
    } catch {
      // Error shown via store
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
            <strong>{replyingTo.author_id ? "message" : "someone"}</strong>
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
          onChange={(e) => setContent(e.target.value)}
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
  );
}

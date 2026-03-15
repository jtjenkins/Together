import { useState, useRef, type FormEvent } from "react";
import { Trash2, Upload } from "lucide-react";
import { api } from "../../api/client";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import type { ServerDto } from "../../types";
import styles from "./CustomEmojiManager.module.css";

interface CustomEmojiManagerProps {
  server: ServerDto;
}

export function CustomEmojiManager({ server }: CustomEmojiManagerProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { getEmojis, refreshEmojis } = useCustomEmojiStore();
  const emojis = getEmojis(server.id);

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setUploading(true);
    setUploadError("");
    try {
      await api.uploadCustomEmoji(server.id, name.trim(), file);
      await refreshEmojis(server.id);
      setName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (emojiId: string) => {
    try {
      await api.deleteCustomEmoji(server.id, emojiId);
      await refreshEmojis(server.id);
    } catch (err) {
      console.error("[CustomEmojiManager] delete failed", err);
    }
  };

  return (
    <div className={styles.manager}>
      <h3 className={styles.heading}>Custom Emojis</h3>
      <p className={styles.hint}>
        JPEG, PNG, GIF, or WebP · max 256 KB · max 50 per server · name:
        lowercase letters, digits, underscores, hyphens
      </p>

      <form onSubmit={handleUpload} className={styles.uploadForm}>
        <input
          className={styles.nameInput}
          type="text"
          placeholder="emoji_name"
          value={name}
          onChange={(e) =>
            setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
          }
          maxLength={32}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className={styles.fileInput}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="submit"
          className={styles.uploadBtn}
          disabled={!file || !name.trim() || uploading}
        >
          <Upload size={14} />
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </form>
      {uploadError && <div className={styles.error}>{uploadError}</div>}

      {emojis.length === 0 ? (
        <p className={styles.empty}>No custom emojis yet.</p>
      ) : (
        <div className={styles.list}>
          {emojis.map((ce) => (
            <div key={ce.id} className={styles.row}>
              <img src={ce.url} alt={ce.name} className={styles.preview} />
              <span className={styles.emName}>:{ce.name}:</span>
              <button
                className={styles.deleteBtn}
                onClick={() => handleDelete(ce.id)}
                title={`Delete :${ce.name}:`}
                aria-label={`Delete :${ce.name}:`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

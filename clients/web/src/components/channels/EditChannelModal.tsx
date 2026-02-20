import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useChannelStore } from "../../stores/channelStore";
import type { Channel } from "../../types";
import styles from "../servers/ServerModals.module.css";

interface EditChannelModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
  channel: Channel;
}

export function EditChannelModal({
  open,
  onClose,
  serverId,
  channel,
}: EditChannelModalProps) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic || "");
  const [category, setCategory] = useState(channel.category || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const updateChannel = useChannelStore((s) => s.updateChannel);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      await updateChannel(serverId, channel.id, {
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        topic: topic.trim() || undefined,
        category: category.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update channel");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Channel">
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-channel-name">
            Channel Name
          </label>
          <input
            id="edit-channel-name"
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-channel-topic">
            Topic <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="edit-channel-topic"
            className={styles.input}
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={1024}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-channel-category">
            Category <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="edit-channel-category"
            className={styles.input}
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={100}
          />
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

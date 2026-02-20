import { useState, type FormEvent } from "react";
import { Modal } from "../common/Modal";
import { useChannelStore } from "../../stores/channelStore";
import type { ChannelType } from "../../types";
import styles from "../servers/ServerModals.module.css";

interface CreateChannelModalProps {
  open: boolean;
  onClose: () => void;
  serverId: string;
}

export function CreateChannelModal({
  open,
  onClose,
  serverId,
}: CreateChannelModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>("text");
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const createChannel = useChannelStore((s) => s.createChannel);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsSubmitting(true);
    setError("");
    try {
      const channel = await createChannel(serverId, {
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        type,
        topic: topic.trim() || undefined,
        category: category.trim() || undefined,
      });
      if (type === "text") {
        setActiveChannel(channel.id);
      }
      setName("");
      setTopic("");
      setCategory("");
      setType("text");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Channel">
      {error && <div className={styles.error}>{error}</div>}
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="channel-type">
            Channel Type
          </label>
          <select
            id="channel-type"
            className={styles.select}
            value={type}
            onChange={(e) => setType(e.target.value as ChannelType)}
          >
            <option value="text"># Text Channel</option>
            <option value="voice">Voice Channel</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="channel-name">
            Channel Name
          </label>
          <input
            id="channel-name"
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="general"
            required
            maxLength={100}
            autoFocus
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="channel-topic">
            Topic <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="channel-topic"
            className={styles.input}
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What is this channel about?"
            maxLength={1024}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="channel-category">
            Category <span className={styles.optional}>(optional)</span>
          </label>
          <input
            id="channel-category"
            className={styles.input}
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="General"
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
            {isSubmitting ? "Creating..." : "Create Channel"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

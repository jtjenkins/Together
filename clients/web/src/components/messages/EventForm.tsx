import { useState } from "react";
import { api } from "../../api/client";
import styles from "./EventForm.module.css";

interface EventFormProps {
  channelId: string;
  prefill: string;
  onSubmit: () => void;
  onClose: () => void;
}

export function EventForm({
  channelId,
  prefill,
  onSubmit,
  onClose,
}: EventFormProps) {
  const [name, setName] = useState(prefill);
  const [description, setDescription] = useState("");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);
  const defaultDateTime = tomorrow.toISOString().slice(0, 16);
  const [startsAt, setStartsAt] = useState(defaultDateTime);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Event name is required");
      return;
    }
    if (!startsAt) {
      setError("Start time is required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await api.createEvent(channelId, {
        name: name.trim(),
        description: description.trim() || undefined,
        starts_at: new Date(startsAt).toISOString(),
      });
      onSubmit();
    } catch {
      setError("Failed to create event");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className={styles.container} onSubmit={handleSubmit}>
      <div className={styles.header}>
        <span className={styles.title}>📅 Schedule Event</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close event form"
        >
          ×
        </button>
      </div>
      <input
        className={styles.field}
        placeholder="Event name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={200}
        autoFocus
      />
      <input
        className={styles.field}
        type="datetime-local"
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
      />
      <textarea
        className={`${styles.field} ${styles.descField}`}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
        rows={2}
      />
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className={styles.submitBtn}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Scheduling…" : "Schedule Event"}
        </button>
      </div>
    </form>
  );
}

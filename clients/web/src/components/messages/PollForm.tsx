import { useState } from "react";
import { api } from "../../api/client";
import styles from "./PollForm.module.css";

interface PollFormProps {
  channelId: string;
  prefill: string;
  onSubmit: () => void;
  onClose: () => void;
}

export function PollForm({
  channelId,
  prefill,
  onSubmit,
  onClose,
}: PollFormProps) {
  const [question, setQuestion] = useState(prefill);
  const [options, setOptions] = useState(["", ""]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addOption = () => {
    if (options.length < 10) setOptions((o) => [...o, ""]);
  };
  const removeOption = (i: number) => {
    if (options.length > 2) setOptions((o) => o.filter((_, idx) => idx !== i));
  };
  const updateOption = (i: number, val: string) =>
    setOptions((o) => o.map((v, idx) => (idx === i ? val : v)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim()) {
      setError("Question is required");
      return;
    }
    if (validOptions.length < 2) {
      setError("At least 2 options required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await api.createPoll(channelId, {
        question: question.trim(),
        options: validOptions,
      });
      onSubmit();
    } catch {
      setError("Failed to create poll");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className={styles.container} onSubmit={handleSubmit}>
      <div className={styles.header}>
        <span className={styles.title}>📊 Create Poll</span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close poll form"
        >
          ×
        </button>
      </div>
      <input
        className={styles.questionInput}
        placeholder="What's your question?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={500}
        autoFocus
      />
      <div className={styles.options}>
        {options.map((opt, i) => (
          <div key={i} className={styles.optionRow}>
            <input
              className={styles.optionInput}
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              maxLength={200}
            />
            {options.length > 2 && (
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeOption(i)}
                aria-label={`Remove option ${i + 1}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {options.length < 10 && (
          <button type="button" className={styles.addBtn} onClick={addOption}>
            + Add Option
          </button>
        )}
      </div>
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
          {isSubmitting ? "Creating…" : "Create Poll"}
        </button>
      </div>
    </form>
  );
}

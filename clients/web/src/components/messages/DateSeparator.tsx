import styles from "./DateSeparator.module.css";

interface DateSeparatorProps {
  date: string;
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function DateSeparator({ date }: DateSeparatorProps) {
  return (
    <div
      className={styles.separator}
      role="separator"
      aria-label={formatDateLabel(date)}
    >
      <span className={styles.line} />
      <span className={styles.label}>{formatDateLabel(date)}</span>
      <span className={styles.line} />
    </div>
  );
}

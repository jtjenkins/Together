import type { ServerEventDto } from "../../types";
import styles from "./EventCard.module.css";

interface EventCardProps {
  event: ServerEventDto;
}

export function EventCard({ event }: EventCardProps) {
  const date = new Date(event.starts_at);
  const formatted = date.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={styles.card}>
      <div className={styles.icon}>📅</div>
      <div className={styles.info}>
        <div className={styles.name}>{event.name}</div>
        <div className={styles.time}>
          {formatted} at {time}
        </div>
        {event.description && (
          <div className={styles.desc}>{event.description}</div>
        )}
      </div>
    </div>
  );
}

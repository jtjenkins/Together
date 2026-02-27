import { useCallback } from "react";
import { api } from "../../api/client";
import type { PollDto } from "../../types";
import styles from "./PollCard.module.css";

interface PollCardProps {
  poll: PollDto;
  onUpdate: (updated: PollDto) => void;
}

export function PollCard({ poll, onUpdate }: PollCardProps) {
  const handleVote = useCallback(
    async (optionId: string) => {
      // Optimistic update
      const optimistic: PollDto = {
        ...poll,
        user_vote: optionId,
        options: poll.options.map((o) => ({
          ...o,
          votes:
            o.votes +
            (o.id === optionId ? 1 : 0) -
            (o.id === poll.user_vote ? 1 : 0),
        })),
        total_votes: poll.user_vote ? poll.total_votes : poll.total_votes + 1,
      };
      onUpdate(optimistic);

      try {
        const updated = await api.castVote(poll.id, optionId);
        onUpdate(updated);
      } catch {
        onUpdate(poll); // revert on error
      }
    },
    [poll, onUpdate],
  );

  return (
    <div className={styles.card}>
      <div className={styles.question}>{poll.question}</div>
      <div className={styles.options}>
        {poll.options.map((opt) => {
          const pct =
            poll.total_votes > 0 ? (opt.votes / poll.total_votes) * 100 : 0;
          const isVoted = poll.user_vote === opt.id;
          return (
            <button
              key={opt.id}
              className={`${styles.option} ${isVoted ? styles.voted : ""}`}
              onClick={() => handleVote(opt.id)}
            >
              <div className={styles.bar} style={{ width: `${pct}%` }} />
              <span className={styles.optText}>{opt.text}</span>
              <span className={styles.pct}>{Math.round(pct)}%</span>
            </button>
          );
        })}
      </div>
      <div className={styles.footer}>
        {poll.total_votes} {poll.total_votes === 1 ? "vote" : "votes"}
        {poll.user_vote && (
          <span className={styles.votedLabel}> · You voted</span>
        )}
      </div>
    </div>
  );
}

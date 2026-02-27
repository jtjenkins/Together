import React, { useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { PollDto } from "../types";

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
    <View style={styles.card}>
      <Text style={styles.question}>{poll.question}</Text>
      {poll.options.map((opt) => {
        const pct =
          poll.total_votes > 0 ? (opt.votes / poll.total_votes) * 100 : 0;
        const isVoted = poll.user_vote === opt.id;
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.option, isVoted && styles.optionVoted]}
            onPress={() => handleVote(opt.id)}
            activeOpacity={0.7}
          >
            {/* Progress bar */}
            <View
              style={[styles.bar, { width: `${pct}%` as unknown as number }]}
            />
            <Text style={styles.optText}>{opt.text}</Text>
            <Text style={styles.pct}>{Math.round(pct)}%</Text>
          </TouchableOpacity>
        );
      })}
      <Text style={styles.footer}>
        {poll.total_votes} {poll.total_votes === 1 ? "vote" : "votes"}
        {poll.user_vote ? " · You voted" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#2b2d31",
    borderRadius: 8,
    padding: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#3f4248",
    maxWidth: 360,
  },
  question: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
    marginBottom: 10,
  },
  option: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3f4248",
    padding: 8,
    marginBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#383a40",
    minHeight: 36,
  },
  optionVoted: {
    borderColor: "#5865f2",
  },
  bar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(88, 101, 242, 0.2)",
  },
  optText: {
    flex: 1,
    color: "#fff",
    fontSize: 13,
  },
  pct: {
    color: "#999",
    fontSize: 12,
    minWidth: 36,
    textAlign: "right",
  },
  footer: {
    color: "#999",
    fontSize: 12,
    marginTop: 4,
  },
});

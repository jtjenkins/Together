import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { ServerEventDto } from "../types";

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
    <View style={styles.card}>
      <Text style={styles.icon}>📅</Text>
      <View style={styles.info}>
        <Text style={styles.name}>{event.name}</Text>
        <Text style={styles.time}>
          {formatted} at {time}
        </Text>
        {event.description ? (
          <Text style={styles.desc}>{event.description}</Text>
        ) : null}
      </View>
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
    flexDirection: "row",
    gap: 12,
    maxWidth: 360,
  },
  icon: { fontSize: 28 },
  info: { flex: 1 },
  name: { color: "#fff", fontWeight: "600", fontSize: 14 },
  time: { color: "#5865f2", fontSize: 12, marginTop: 2 },
  desc: { color: "#aaa", fontSize: 12, marginTop: 4 },
});

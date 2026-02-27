import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";

export interface SlashCommand {
  name: string;
  description: string;
  argHint: string | null;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "giphy",
    description: "Search for and send a GIF",
    argHint: "[search query]",
  },
  { name: "poll", description: "Create a poll", argHint: "[question]" },
  {
    name: "event",
    description: "Schedule a server event",
    argHint: "[event name]",
  },
  { name: "spoiler", description: "Wrap text in a spoiler", argHint: "[text]" },
];

export function searchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(q));
}

export function detectSlashTrigger(
  content: string,
  cursorPos: number,
): string | null {
  const before = content.slice(0, cursorPos);
  const match = before.match(/(?:^|[\n\r])\/([a-zA-Z]*)$/);
  return match ? match[1] : null;
}

interface SlashCommandPickerProps {
  query: string;
  onSelect: (command: SlashCommand) => void;
}

export function SlashCommandPicker({
  query,
  onSelect,
}: SlashCommandPickerProps) {
  const results = searchCommands(query);
  if (results.length === 0) return null;

  return (
    <View style={styles.container}>
      {results.map((cmd) => (
        <TouchableOpacity
          key={cmd.name}
          style={styles.row}
          onPress={() => onSelect(cmd)}
          activeOpacity={0.7}
        >
          <Text style={styles.name}>/{cmd.name}</Text>
          {cmd.argHint ? <Text style={styles.hint}>{cmd.argHint}</Text> : null}
          <Text style={styles.desc}>{cmd.description}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#2b2d31",
    borderTopWidth: 1,
    borderColor: "#3f4248",
    maxHeight: 200,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#3f4248",
  },
  name: { color: "#5865f2", fontWeight: "600", fontSize: 14, minWidth: 80 },
  hint: { color: "#888", fontSize: 12, fontStyle: "italic" },
  desc: { color: "#aaa", fontSize: 12, flex: 1, textAlign: "right" },
});

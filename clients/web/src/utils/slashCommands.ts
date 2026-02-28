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

/**
 * Returns the partial command name typed after '/', or null if the cursor
 * is not in a slash-command position. Trigger: '/' at position 0 or after
 * a newline, with no space between '/' and the cursor, and cursor at end
 * of content or directly after the command word.
 */
export function detectSlashTrigger(
  content: string,
  cursorPos: number,
): string | null {
  const before = content.slice(0, cursorPos);
  // Match: start-of-string or newline, then /, then zero or more word chars,
  // and nothing else after (i.e. cursor is immediately after the command word)
  const match = before.match(/(?:^|[\n\r])\/([a-zA-Z]*)$/);
  if (!match) return null;
  const query = match[1];
  // Make sure the rest of content after cursorPos starts with a space or is empty
  // (i.e. cursor is at the boundary of the command token, not in the middle of text)
  const after = content.slice(cursorPos);
  if (after.length > 0 && !/^[\s]/.test(after)) return null;
  return query;
}

/** Filter commands by name prefix (case-insensitive). */
export function searchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(q));
}

import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import { searchAllEmoji } from "../../utils/emoji";
import styles from "./EmojiAutocomplete.module.css";

interface EmojiAutocompleteProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  activeIndex: number;
  serverId?: string;
}

export function EmojiAutocomplete({
  query,
  onSelect,
  activeIndex,
  serverId,
}: EmojiAutocompleteProps) {
  const customEmojis = useCustomEmojiStore((s) =>
    serverId ? s.getEmojis(serverId) : [],
  );
  const results = searchAllEmoji(query, customEmojis, 8);

  if (results.length === 0) return null;

  return (
    <div
      className={styles.dropdown}
      role="listbox"
      aria-label="Emoji suggestions"
    >
      {results.map((entry, i) => (
        <div
          key={entry.customEmojiId ?? entry.name}
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row} ${i === activeIndex ? styles.active : ""}`}
          onMouseDown={(e) => {
            // Prevent textarea blur before onSelect fires
            e.preventDefault();
            onSelect(entry.emoji); // ':name:' for custom, unicode char for standard
          }}
        >
          {entry.imageUrl ? (
            <img
              src={entry.imageUrl}
              alt={entry.name}
              className={styles.emojiChar}
              style={{ width: 20, height: 20, objectFit: "contain" }}
            />
          ) : (
            <span className={styles.emojiChar}>{entry.emoji}</span>
          )}
          <span className={styles.emojiName}>:{entry.name}:</span>
        </div>
      ))}
    </div>
  );
}

import { searchEmoji } from "../../utils/emoji";
import styles from "./EmojiAutocomplete.module.css";

interface EmojiAutocompleteProps {
  query: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  activeIndex: number;
}

export function EmojiAutocomplete({
  query,
  onSelect,
  activeIndex,
}: EmojiAutocompleteProps) {
  const results = searchEmoji(query, 8);

  if (results.length === 0) {
    return null;
  }

  return (
    <div
      className={styles.dropdown}
      role="listbox"
      aria-label="Emoji suggestions"
    >
      {results.map((entry, i) => (
        <div
          key={entry.name}
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row} ${i === activeIndex ? styles.active : ""}`}
          onMouseDown={(e) => {
            // Prevent textarea blur before onSelect fires
            e.preventDefault();
            onSelect(entry.emoji);
          }}
        >
          <span className={styles.emojiChar}>{entry.emoji}</span>
          <span className={styles.emojiName}>:{entry.name}:</span>
        </div>
      ))}
    </div>
  );
}

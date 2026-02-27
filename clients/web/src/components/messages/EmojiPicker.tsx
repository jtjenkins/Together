import { useState, useRef, useEffect, useCallback } from "react";
import { EMOJI_CATEGORIES, searchEmoji } from "../../utils/emoji";
import styles from "./EmojiPicker.module.css";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSelect = useCallback(
    (emoji: string) => {
      onSelect(emoji);
      onClose();
    },
    [onSelect, onClose],
  );

  const searchResults = query.trim() ? searchEmoji(query, 60) : null;
  const displayCat = EMOJI_CATEGORIES[activeCat];

  return (
    <div ref={containerRef} className={styles.picker}>
      {/* Search */}
      <div className={styles.searchRow}>
        <input
          ref={searchRef}
          className={styles.search}
          type="text"
          placeholder="Search emoji…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Category tabs — hidden during search */}
      {!searchResults && (
        <div className={styles.tabs}>
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.label}
              className={`${styles.tab} ${i === activeCat ? styles.tabActive : ""}`}
              onClick={() => setActiveCat(i)}
              title={cat.label}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div className={styles.grid}>
        {searchResults ? (
          searchResults.length > 0 ? (
            searchResults.map((entry) => (
              <button
                key={entry.emoji + entry.name}
                className={styles.emojiBtn}
                onClick={() => handleSelect(entry.emoji)}
                title={`:${entry.name}:`}
              >
                {entry.emoji}
              </button>
            ))
          ) : (
            <div className={styles.noResults}>No results</div>
          )
        ) : (
          displayCat.emojis.map((entry) => (
            <button
              key={entry.emoji + entry.name}
              className={styles.emojiBtn}
              onClick={() => handleSelect(entry.emoji)}
              title={`:${entry.name}:`}
            >
              {entry.emoji}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

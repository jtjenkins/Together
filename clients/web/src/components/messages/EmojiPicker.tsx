import { useState, useRef, useEffect, useCallback } from "react";
import { EMOJI_CATEGORIES, searchEmoji } from "../../utils/emoji";
import { useCustomEmojiStore } from "../../stores/customEmojiStore";
import styles from "./EmojiPicker.module.css";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  serverId?: string;
}

export function EmojiPicker({ onSelect, onClose, serverId }: EmojiPickerProps) {
  const customEmojis = useCustomEmojiStore((s) =>
    serverId ? s.getEmojis(serverId) : [],
  );
  const hasCustom = customEmojis.length > 0;

  // -1 = custom tab; 0+ = standard category index
  const [activeCat, setActiveCat] = useState(() => (hasCustom ? -1 : 0));
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

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
  const customSearchResults = query.trim()
    ? customEmojis.filter((ce) => ce.name.includes(query.toLowerCase()))
    : [];

  const displayCat = activeCat >= 0 ? EMOJI_CATEGORIES[activeCat] : null;

  return (
    <div ref={containerRef} className={styles.picker}>
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

      {!searchResults && (
        <div className={styles.tabs}>
          {hasCustom && (
            <button
              className={`${styles.tab} ${activeCat === -1 ? styles.tabActive : ""}`}
              onClick={() => setActiveCat(-1)}
              title="Custom"
            >
              ★
            </button>
          )}
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

      <div className={styles.grid}>
        {searchResults ? (
          <>
            {customSearchResults.map((ce) => (
              <button
                key={ce.id}
                className={styles.emojiBtn}
                onClick={() => handleSelect(`c:${ce.id}`)}
                title={`:${ce.name}:`}
              >
                <img
                  src={ce.url}
                  alt={ce.name}
                  className={styles.customEmojiThumb}
                />
              </button>
            ))}
            {searchResults.length > 0 ? (
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
            ) : customSearchResults.length === 0 ? (
              <div className={styles.noResults}>No results</div>
            ) : null}
          </>
        ) : activeCat === -1 ? (
          customEmojis.map((ce) => (
            <button
              key={ce.id}
              className={styles.emojiBtn}
              onClick={() => handleSelect(`c:${ce.id}`)}
              title={`:${ce.name}:`}
            >
              <img
                src={ce.url}
                alt={ce.name}
                className={styles.customEmojiThumb}
              />
            </button>
          ))
        ) : displayCat ? (
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
        ) : null}
      </div>
    </div>
  );
}

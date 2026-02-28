import { useState, useEffect } from "react";
import { api } from "../../api/client";
import type { GifResult } from "../../types";
import styles from "./GifPicker.module.css";

interface GifPickerProps {
  initialQuery: string;
  onSelect: (gif: GifResult) => void;
  onClose: () => void;
}

export function GifPicker({ initialQuery, onSelect, onClose }: GifPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<GifResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const gifs = await api.searchGifs(query, 15);
        setResults(gifs);
      } catch {
        setError("Could not load GIFs. Is GIPHY_API_KEY configured?");
      } finally {
        setIsLoading(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [query]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <input
          autoFocus
          className={styles.searchInput}
          placeholder="Search GIFs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close GIF picker"
        >
          ×
        </button>
      </div>
      {isLoading && <div className={styles.status}>Loading…</div>}
      {error && <div className={styles.status}>{error}</div>}
      {!isLoading && !error && results.length === 0 && query.trim() && (
        <div className={styles.status}>No GIFs found</div>
      )}
      {results.length > 0 && (
        <div className={styles.grid}>
          {results.map((gif, i) => (
            <button
              key={i}
              className={styles.gifTile}
              onClick={() => onSelect(gif)}
              title={gif.title}
            >
              <img
                src={gif.preview_url}
                alt={gif.title}
                style={{ aspectRatio: `${gif.width} / ${gif.height}` }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

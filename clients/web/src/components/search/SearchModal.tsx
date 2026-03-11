import React, { useState, useEffect, useCallback, useRef } from "react";
import { Search, X } from "lucide-react";
import { api } from "../../api/client";
import type { SearchResult, SearchResponse } from "../../types";
import styles from "./SearchModal.module.css";
import modalStyles from "../common/Modal.module.css";

interface SearchModalProps {
  serverId: string;
  channelId?: string;
  onClose: () => void;
  onResultClick?: (result: SearchResult) => void;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export function SearchModal({
  serverId,
  channelId,
  onClose,
  onResultClick,
}: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  const performSearch = useCallback(
    async (searchQuery: string, cursor?: string) => {
      if (searchQuery.length < MIN_QUERY_LENGTH) {
        setResults([]);
        setTotal(0);
        setHasMore(false);
        setNextCursor(null);
        return;
      }

      // Cancel previous request
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const response: SearchResponse = await api.searchMessages(serverId, {
          q: searchQuery,
          channel_id: channelId,
          before: cursor,
          limit: 20,
        });

        if (cursor) {
          // Append to existing results (load more)
          setResults((prev: SearchResult[]) => [...prev, ...response.results]);
        } else {
          // New search
          setResults(response.results);
        }
        setTotal(response.total);
        setHasMore(response.has_more);
        setNextCursor(response.next_cursor);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError("Search failed. Please try again.");
        }
      } finally {
        setLoading(false);
      }
    },
    [serverId, channelId]
  );

  // Debounce effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(query);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [query, performSearch]);

  const handleLoadMore = () => {
    if (nextCursor && !loading) {
      performSearch(query, nextCursor);
    }
  };

  const handleResultClick = (result: SearchResult) => {
    onResultClick?.(result);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return "Today";
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div className={modalStyles.overlay} onClick={onClose}>
      <div
        className={modalStyles.modal}
        style={{ maxWidth: "600px", maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={modalStyles.header}>
          <h2 className={modalStyles.title}>
            <Search size={20} />
            Search Messages
          </h2>
          <button
            className={modalStyles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className={modalStyles.content}>
          {/* Search input */}
          <div style={{ position: "relative", marginBottom: "16px" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search for messages..."
              className={modalStyles.input}
              style={{ paddingLeft: "36px" }}
            />
            <Search
              size={18}
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
          </div>

          {/* Results */}
          <div
            style={{
              maxHeight: "400px",
              overflowY: "auto",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
            }}
          >
            {loading && results.length === 0 ? (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner} />
              </div>
            ) : error ? (
              <div className={styles.noResults}>{error}</div>
            ) : query.length < MIN_QUERY_LENGTH ? (
              <div className={styles.searchHint}>
                Type at least {MIN_QUERY_LENGTH} characters to search
              </div>
            ) : results.length === 0 ? (
              <div className={styles.noResults}>
                No messages found for &quot;{query}&quot;
              </div>
            ) : (
              <>
                <div className={styles.searchHint}>
                  {total} result{total !== 1 ? "s" : ""} found
                </div>
                {results.map((result) => (
                  <div
                    key={result.id}
                    className={styles.messageResult}
                    onClick={() => handleResultClick(result)}
                  >
                    <div className={styles.messageHeader}>
                      <span className={styles.authorName}>
                        {result.author_username || "Unknown"}
                      </span>
                      <span className={styles.channelName}>
                        #{channelId || "All channels"}
                      </span>
                      <span className={styles.timestamp}>
                        {formatDate(result.created_at)}
                      </span>
                    </div>
                    <div
                      className={styles.messageContent}
                      dangerouslySetInnerHTML={{ __html: result.highlight }}
                    />
                  </div>
                ))}
                {hasMore && (
                  <button
                    className={styles.loadMore}
                    onClick={handleLoadMore}
                    disabled={loading}
                  >
                    {loading ? "Loading..." : "Load more"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
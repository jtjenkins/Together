import type { MemberDto } from "../../types";
import styles from "./MentionAutocomplete.module.css";

interface MentionAutocompleteProps {
  query: string;
  members: MemberDto[];
  activeIndex: number;
  onSelect: (username: string) => void;
  onClose: () => void;
}

/**
 * Filter members by query, returning up to 8 results.
 *
 * Matching rules:
 * - Empty query: returns the first 8 members unfiltered.
 * - Non-empty query: case-insensitive **substring** match against username or
 *   nickname (not prefix-only — "ice" matches "alice").
 */
export function filterMembers(
  members: MemberDto[],
  query: string,
): MemberDto[] {
  if (!query) return members.slice(0, 8);
  const q = query.toLowerCase();
  return members
    .filter((m) => {
      const username = m.username.toLowerCase();
      const nickname = (m.nickname ?? "").toLowerCase();
      return username.includes(q) || nickname.includes(q);
    })
    .slice(0, 8);
}

export function MentionAutocomplete({
  query,
  members,
  activeIndex,
  onSelect,
}: MentionAutocompleteProps) {
  const results = filterMembers(members, query);

  if (results.length === 0) return null;

  return (
    <div
      className={styles.dropdown}
      role="listbox"
      aria-label="Member suggestions"
    >
      {results.map((member, i) => (
        <div
          key={member.user_id}
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.row} ${i === activeIndex ? styles.active : ""}`}
          onMouseDown={(e) => {
            // Prevent textarea blur before onSelect fires
            e.preventDefault();
            onSelect(member.username);
          }}
        >
          <div className={styles.avatar}>
            {member.username.charAt(0).toUpperCase()}
          </div>
          <div className={styles.info}>
            <span className={styles.username}>@{member.username}</span>
            {member.nickname && (
              <span className={styles.nickname}>{member.nickname}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

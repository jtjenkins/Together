export type MarkdownSegment =
  | { type: "text"; content: string }
  | { type: "bold"; content: MarkdownSegment[] }
  | { type: "italic"; content: MarkdownSegment[] }
  | { type: "bold_italic"; content: MarkdownSegment[] }
  | { type: "strikethrough"; content: MarkdownSegment[] }
  | { type: "code_inline"; content: string }
  | { type: "code_block"; content: string; lang: string }
  | { type: "blockquote"; content: MarkdownSegment[] }
  | { type: "spoiler"; content: MarkdownSegment[] };

/**
 * Parse Discord-flavored markdown into a segment tree.
 * Parse order is critical — code blocks must be extracted before inline markers.
 */
export function parseMarkdown(text: string): MarkdownSegment[] {
  if (!text) return [];

  // Phase 1: Extract code blocks (``` ```) and inline code (` `) verbatim.
  // We replace them with placeholders so inner text doesn't get parsed.
  type Placeholder = { id: string; segment: MarkdownSegment };
  const placeholders: Placeholder[] = [];
  let counter = 0;

  function placeholder(seg: MarkdownSegment): string {
    const id = `\uE000PLACEHOLDER_${counter++}\uE000`;
    placeholders.push({ id, segment: seg });
    return id;
  }

  // Extract ```lang\nbody\n```
  let working = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, body) =>
    placeholder({ type: "code_block", content: body, lang }),
  );

  // Extract `inline code`
  working = working.replace(/`([^`\n]+)`/g, (_, body) =>
    placeholder({ type: "code_inline", content: body }),
  );

  // Phase 2: Parse remaining text recursively for other markers.
  function parseInner(s: string): MarkdownSegment[] {
    const result: MarkdownSegment[] = [];

    // Blockquote: lines starting with "> "
    if (/^> /.test(s)) {
      const lines = s.split("\n");
      const quoteLines: string[] = [];
      const rest: string[] = [];
      let inQuote = true;
      for (const line of lines) {
        if (inQuote && /^> /.test(line)) {
          quoteLines.push(line.slice(2));
        } else {
          inQuote = false;
          rest.push(line);
        }
      }
      result.push({
        type: "blockquote",
        content: parseInner(quoteLines.join("\n")),
      });
      if (rest.length > 0) {
        result.push(...parseInner(rest.join("\n")));
      }
      return result;
    }

    // Ordered by specificity: *** before ** before *
    const patterns: [RegExp, (inner: string) => MarkdownSegment][] = [
      [/\|\|(.+?)\|\|/s, (i) => ({ type: "spoiler", content: parseInner(i) })],
      [
        /\*\*\*(.+?)\*\*\*/s,
        (i) => ({ type: "bold_italic", content: parseInner(i) }),
      ],
      [/\*\*(.+?)\*\*/s, (i) => ({ type: "bold", content: parseInner(i) })],
      [/__(.+?)__/s, (i) => ({ type: "bold", content: parseInner(i) })],
      [/\*([^*\n]+)\*/s, (i) => ({ type: "italic", content: parseInner(i) })],
      [/_([^_\n]+)_/s, (i) => ({ type: "italic", content: parseInner(i) })],
      [
        /~~(.+?)~~/s,
        (i) => ({ type: "strikethrough", content: parseInner(i) }),
      ],
    ];

    let remaining = s;

    outer: while (remaining.length > 0) {
      // Check placeholders first
      const phMatch = remaining.match(/\uE000PLACEHOLDER_\d+\uE000/);
      if (phMatch && phMatch.index !== undefined) {
        const before = remaining.slice(0, phMatch.index);
        if (before) result.push(...parseInner(before));
        const ph = placeholders.find((p) => p.id === phMatch[0]);
        if (ph) result.push(ph.segment);
        remaining = remaining.slice(phMatch.index + phMatch[0].length);
        continue;
      }

      for (const [pattern, builder] of patterns) {
        const m = remaining.match(pattern);
        if (m && m.index !== undefined) {
          const before = remaining.slice(0, m.index);
          if (before) result.push({ type: "text", content: before });
          result.push(builder(m[1]));
          remaining = remaining.slice(m.index + m[0].length);
          continue outer;
        }
      }

      // No pattern matched — rest is plain text
      result.push({ type: "text", content: remaining });
      break;
    }

    return result;
  }

  return parseInner(working);
}

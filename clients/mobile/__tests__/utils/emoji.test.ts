import {
  parseEmoji,
  searchEmoji,
  EMOJI_CATEGORIES,
} from "../../src/utils/emoji";

// ── parseEmoji ───────────────────────────────────────────────

describe("parseEmoji", () => {
  it("replaces a known :name: with the emoji character", () => {
    expect(parseEmoji(":thumbsup:")).toBe("👍");
  });

  it("replaces a known alias (:+1: → 👍)", () => {
    expect(parseEmoji(":+1:")).toBe("👍");
  });

  it("replaces :joy: with 😂", () => {
    expect(parseEmoji(":joy:")).toBe("😂");
  });

  it("replaces multiple emoji names in one string", () => {
    expect(parseEmoji(":thumbsup: and :heart:")).toBe("👍 and ❤️");
  });

  it("replaces emoji names embedded in sentence text", () => {
    expect(parseEmoji("Great job :tada: well done")).toBe(
      "Great job 🎉 well done",
    );
  });

  it("leaves unknown names unchanged", () => {
    expect(parseEmoji(":totally_made_up_emoji_xyz:")).toBe(
      ":totally_made_up_emoji_xyz:",
    );
  });

  it("leaves plain text without colons unchanged", () => {
    expect(parseEmoji("just plain text")).toBe("just plain text");
  });

  it("returns an empty string unchanged", () => {
    expect(parseEmoji("")).toBe("");
  });

  it("does not match a token missing the closing colon", () => {
    expect(parseEmoji(":thumbsup")).toBe(":thumbsup");
  });

  it("does not match a token missing the opening colon", () => {
    expect(parseEmoji("thumbsup:")).toBe("thumbsup:");
  });

  it("handles adjacent emoji tokens with no whitespace", () => {
    expect(parseEmoji(":heart::heart:")).toBe("❤️❤️");
  });

  it("handles a string that is already emoji characters unchanged", () => {
    expect(parseEmoji("👍🎉❤️")).toBe("👍🎉❤️");
  });

  it("converts :fire: correctly", () => {
    expect(parseEmoji(":fire:")).toBe("🔥");
  });

  it("handles mixed known and unknown tokens", () => {
    const result = parseEmoji(":thumbsup: :doesnotexist: :heart:");
    expect(result).toBe("👍 :doesnotexist: ❤️");
  });
});

// ── searchEmoji ──────────────────────────────────────────────

describe("searchEmoji", () => {
  it("finds an emoji by its primary name", () => {
    const results = searchEmoji("thumbsup");
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.name === "thumbsup");
    expect(found).toBeDefined();
    expect(found!.emoji).toBe("👍");
  });

  it("finds an emoji by an alias (+1 → 👍)", () => {
    const results = searchEmoji("+1");
    const found = results.find(
      (r) => r.name === "thumbsup" || r.aliases?.includes("+1"),
    );
    expect(found).toBeDefined();
    expect(found!.emoji).toBe("👍");
  });

  it("returns an empty array when nothing matches", () => {
    const results = searchEmoji("zzzz_no_match_whatsoever_999");
    expect(results).toHaveLength(0);
  });

  it("respects the limit parameter", () => {
    const results = searchEmoji("", 3);
    expect(results).toHaveLength(3);
  });

  it("returns at most the default limit of 20 for a broad query", () => {
    const results = searchEmoji("a");
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("is case-insensitive", () => {
    const results = searchEmoji("THUMBSUP");
    const found = results.find((r) => r.name === "thumbsup");
    expect(found).toBeDefined();
  });

  it("results each have emoji and name string fields", () => {
    const results = searchEmoji("smile");
    expect(results.length).toBeGreaterThan(0);
    for (const entry of results) {
      expect(typeof entry.emoji).toBe("string");
      expect(typeof entry.name).toBe("string");
      expect(entry.emoji.length).toBeGreaterThan(0);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it("finds :fire: by searching 'fire'", () => {
    const results = searchEmoji("fire");
    const found = results.find((r) => r.name === "fire");
    expect(found?.emoji).toBe("🔥");
  });
});

// ── EMOJI_CATEGORIES ─────────────────────────────────────────

describe("EMOJI_CATEGORIES", () => {
  it("has 8 categories", () => {
    expect(EMOJI_CATEGORIES).toHaveLength(8);
  });

  it("each category has a label, icon, and non-empty emojis array", () => {
    for (const cat of EMOJI_CATEGORIES) {
      expect(typeof cat.label).toBe("string");
      expect(cat.label.length).toBeGreaterThan(0);
      expect(typeof cat.icon).toBe("string");
      expect(cat.emojis.length).toBeGreaterThan(0);
    }
  });

  it("every emoji entry has emoji and name fields", () => {
    for (const cat of EMOJI_CATEGORIES) {
      for (const entry of cat.emojis) {
        expect(entry.emoji.length).toBeGreaterThan(0);
        expect(entry.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("contains thumbsup with +1 alias in the People category", () => {
    const people = EMOJI_CATEGORIES.find((c) => c.label === "People");
    expect(people).toBeDefined();
    const thumbsup = people!.emojis.find((e) => e.name === "thumbsup");
    expect(thumbsup).toBeDefined();
    expect(thumbsup!.emoji).toBe("👍");
    expect(thumbsup!.aliases).toContain("+1");
  });

  it("contains joy (😂) in the Smileys category", () => {
    const smileys = EMOJI_CATEGORIES.find((c) => c.label === "Smileys");
    expect(smileys).toBeDefined();
    const joy = smileys!.emojis.find((e) => e.name === "joy");
    expect(joy?.emoji).toBe("😂");
  });
});

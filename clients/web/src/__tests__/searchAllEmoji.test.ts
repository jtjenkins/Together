import { describe, it, expect } from "vitest";
import { searchAllEmoji } from "../utils/emoji";

describe("searchAllEmoji", () => {
  const customEmojis = [
    { id: "c1", name: "pepe", url: "https://cdn.example.com/pepe.png" },
    {
      id: "c2",
      name: "pepehands",
      url: "https://cdn.example.com/pepehands.png",
    },
    { id: "c3", name: "catjam", url: "https://cdn.example.com/catjam.png" },
  ];

  it("returns custom emojis first, then standard emojis", () => {
    const results = searchAllEmoji("pe", customEmojis, 10);
    // "pepe" and "pepehands" should appear before any standard emoji
    expect(results[0].name).toBe("pepe");
    expect(results[0].customEmojiId).toBe("c1");
    expect(results[0].imageUrl).toBe("https://cdn.example.com/pepe.png");
    expect(results[0].emoji).toBe(":pepe:");

    expect(results[1].name).toBe("pepehands");
    expect(results[1].customEmojiId).toBe("c2");
  });

  it("includes standard emojis after custom emojis", () => {
    const results = searchAllEmoji("pe", customEmojis, 10);
    // Should include standard emojis that match "pe" (e.g. "peach", "peacock", "pear")
    const standard = results.filter((r) => !r.customEmojiId);
    expect(standard.length).toBeGreaterThan(0);
  });

  it("respects limit", () => {
    const results = searchAllEmoji("pe", customEmojis, 3);
    expect(results).toHaveLength(3);
  });

  it("returns only custom emojis when they fill the limit", () => {
    // Only 2 match "pepe", limit=2 should be all custom
    const results = searchAllEmoji("pepe", customEmojis, 2);
    expect(results).toHaveLength(2);
    expect(results[0].customEmojiId).toBe("c1");
    expect(results[1].customEmojiId).toBe("c2");
  });

  it("returns empty when no matches", () => {
    const results = searchAllEmoji("zzzznothing", customEmojis, 10);
    expect(results).toHaveLength(0);
  });

  it("returns standard emojis when no custom emojis match", () => {
    const results = searchAllEmoji("heart", customEmojis, 5);
    // None of the custom emojis contain "heart"
    expect(results.every((r) => !r.customEmojiId)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("works with empty custom emoji list", () => {
    const results = searchAllEmoji("fire", [], 5);
    expect(results.length).toBeGreaterThan(0);
    const fire = results.find((r) => r.name === "fire");
    expect(fire?.emoji).toBe("🔥");
  });
});

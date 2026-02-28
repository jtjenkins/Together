import { describe, it, expect } from "vitest";
import { filterMembers } from "../components/messages/MentionAutocomplete";
import type { MemberDto } from "../types";

function makeMember(
  username: string,
  nickname: string | null = null,
): MemberDto {
  return {
    user_id: `id-${username}`,
    username,
    avatar_url: null,
    status: "online",
    custom_status: null,
    nickname,
    joined_at: new Date().toISOString(),
  };
}

const MEMBERS: MemberDto[] = [
  makeMember("alice1"),
  makeMember("alice2", "Ally"),
  makeMember("alice3", "Queen Alice"),
  makeMember("bob"),
  makeMember("carol"),
  makeMember("dave"),
  makeMember("eve"),
  makeMember("frank"),
  makeMember("grace"),
  makeMember("heidi"),
];

describe("filterMembers", () => {
  it("returns up to 8 members when query is empty", () => {
    const result = filterMembers(MEMBERS, "");
    expect(result).toHaveLength(8);
  });

  it("returns exactly 8 members even when more than 8 match", () => {
    // Build 9 members that all share "x" — the cap of 8 must be enforced
    const nine = Array.from({ length: 9 }, (_, i) => makeMember(`user_x${i}`));
    expect(filterMembers(nine, "x")).toHaveLength(8);
  });

  it("filters by username substring case-insensitively", () => {
    const result = filterMembers(MEMBERS, "ali");
    const usernames = result.map((m) => m.username);
    expect(usernames).toContain("alice1");
    expect(usernames).toContain("alice2");
    expect(usernames).toContain("alice3");
    expect(usernames).not.toContain("bob");
  });

  it("matches mid-username substring (not prefix-only)", () => {
    // "ice" is not a prefix of "alice1" but should still match
    const result = filterMembers(MEMBERS, "ice");
    const usernames = result.map((m) => m.username);
    expect(usernames).toContain("alice1");
    expect(usernames).toContain("alice2");
    expect(usernames).toContain("alice3");
    expect(usernames).not.toContain("bob");
  });

  it("filters by username case-insensitively (upper input)", () => {
    const result = filterMembers(MEMBERS, "ALI");
    expect(result.length).toBe(3);
  });

  it("filters by nickname", () => {
    const result = filterMembers(MEMBERS, "ally");
    const usernames = result.map((m) => m.username);
    expect(usernames).toContain("alice2");
  });

  it("matches substring in nickname", () => {
    const result = filterMembers(MEMBERS, "queen");
    const usernames = result.map((m) => m.username);
    expect(usernames).toContain("alice3");
  });

  it("returns empty array when nothing matches", () => {
    const result = filterMembers(MEMBERS, "zzz");
    expect(result).toHaveLength(0);
  });

  it("exact username match returns that member", () => {
    const result = filterMembers(MEMBERS, "bob");
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("bob");
  });

  it("members with no nickname are filtered by username only", () => {
    const result = filterMembers(MEMBERS, "carol");
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("carol");
  });
});

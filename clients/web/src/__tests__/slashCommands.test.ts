import { describe, expect, it } from "vitest";
import {
  detectSlashTrigger,
  searchCommands,
  SLASH_COMMANDS,
} from "../utils/slashCommands";

describe("detectSlashTrigger", () => {
  it("detects / at position 0", () => {
    expect(detectSlashTrigger("/", 1)).toBe("");
  });
  it("detects /giphy at position 0", () => {
    expect(detectSlashTrigger("/giphy cats", 6)).toBe("giphy");
  });
  it("detects /gi partial", () => {
    expect(detectSlashTrigger("/gi", 3)).toBe("gi");
  });
  it("returns null for / in the middle of a word", () => {
    expect(detectSlashTrigger("foo/bar", 7)).toBeNull();
  });
  it("returns null when there is a space after /", () => {
    expect(detectSlashTrigger("/ poll", 6)).toBeNull();
  });
  it("detects /poll after a newline", () => {
    expect(detectSlashTrigger("hello\n/poll", 11)).toBe("poll");
  });
  it("returns null when cursor is not at end of /cmd", () => {
    // cursor is in the middle of already typed text
    expect(detectSlashTrigger("/poll question", 10)).toBeNull();
  });
});

describe("searchCommands", () => {
  it("returns all commands for empty query", () => {
    expect(searchCommands("")).toHaveLength(SLASH_COMMANDS.length);
  });
  it("filters by prefix 'gi' to return only giphy", () => {
    const r = searchCommands("gi");
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe("giphy");
  });
  it("is case-insensitive", () => {
    expect(searchCommands("GI")).toHaveLength(1);
  });
  it("returns empty array for unknown prefix 'xyz'", () => {
    expect(searchCommands("xyz")).toHaveLength(0);
  });
});

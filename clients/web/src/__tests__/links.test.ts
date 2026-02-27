import { describe, it, expect } from "vitest";
import { extractUrls, isImageUrl } from "../utils/links";

describe("extractUrls", () => {
  it("returns empty array for plain text", () => {
    expect(extractUrls("hello world")).toEqual([]);
  });

  it("finds a single http URL", () => {
    expect(extractUrls("check https://example.com out")).toEqual([
      "https://example.com",
    ]);
  });

  it("finds a single http URL (no trailing space)", () => {
    expect(extractUrls("https://example.com")).toEqual(["https://example.com"]);
  });

  it("finds multiple URLs", () => {
    expect(extractUrls("https://a.com and https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("preserves URL with path and query string", () => {
    expect(extractUrls("visit https://example.com/path?q=1&r=2")).toEqual([
      "https://example.com/path?q=1&r=2",
    ]);
  });

  it("returns empty for text with no URLs", () => {
    expect(extractUrls("no links here at all")).toEqual([]);
  });

  it("finds a URL embedded in sentence without spaces", () => {
    expect(extractUrls("seehttps://example.comhere")).toEqual([
      "https://example.comhere",
    ]);
  });
});

describe("isImageUrl", () => {
  it("returns true for .jpg", () => {
    expect(isImageUrl("https://example.com/photo.jpg")).toBe(true);
  });

  it("returns true for .jpeg", () => {
    expect(isImageUrl("https://example.com/photo.jpeg")).toBe(true);
  });

  it("returns true for .png", () => {
    expect(isImageUrl("https://example.com/img.png")).toBe(true);
  });

  it("returns true for .gif", () => {
    expect(isImageUrl("https://example.com/a.gif")).toBe(true);
  });

  it("returns true for .webp", () => {
    expect(isImageUrl("https://example.com/a.webp")).toBe(true);
  });

  it("returns true for .svg", () => {
    expect(isImageUrl("https://example.com/a.svg")).toBe(true);
  });

  it("returns true for .avif", () => {
    expect(isImageUrl("https://example.com/a.avif")).toBe(true);
  });

  it("returns false for a regular article URL", () => {
    expect(isImageUrl("https://example.com/article")).toBe(false);
  });

  it("returns false for a URL with no extension", () => {
    expect(isImageUrl("https://example.com")).toBe(false);
  });

  it("ignores query string when checking extension", () => {
    expect(isImageUrl("https://example.com/photo.jpg?size=large")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isImageUrl("https://example.com/PHOTO.JPG")).toBe(true);
    expect(isImageUrl("https://example.com/PHOTO.PNG")).toBe(true);
  });

  it("returns false for .pdf", () => {
    expect(isImageUrl("https://example.com/doc.pdf")).toBe(false);
  });
});

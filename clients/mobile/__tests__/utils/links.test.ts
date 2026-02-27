import { extractUrls, isImageUrl } from "../../src/utils/links";

describe("extractUrls", () => {
  it("returns empty array for plain text", () => {
    expect(extractUrls("hello world")).toEqual([]);
  });

  it("finds a single https URL", () => {
    expect(extractUrls("check https://example.com out")).toEqual([
      "https://example.com",
    ]);
  });

  it("finds multiple URLs", () => {
    expect(extractUrls("https://a.com and https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("preserves URL with path and query string", () => {
    expect(extractUrls("go to https://example.com/path?q=1")).toEqual([
      "https://example.com/path?q=1",
    ]);
  });

  it("returns empty for text with no URLs", () => {
    expect(extractUrls("no links here")).toEqual([]);
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

  it("ignores query string when checking extension", () => {
    expect(isImageUrl("https://example.com/photo.jpg?size=large")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isImageUrl("https://example.com/PHOTO.JPG")).toBe(true);
  });

  it("returns false for .pdf", () => {
    expect(isImageUrl("https://example.com/doc.pdf")).toBe(false);
  });
});

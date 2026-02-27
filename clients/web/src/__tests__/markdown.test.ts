import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../utils/markdown";

describe("parseMarkdown", () => {
  it("returns plain text as a single text segment", () => {
    const result = parseMarkdown("hello world");
    expect(result).toEqual([{ type: "text", content: "hello world" }]);
  });

  it("handles empty string", () => {
    expect(parseMarkdown("")).toEqual([]);
  });

  it("parses **bold**", () => {
    const result = parseMarkdown("say **hello**");
    expect(result).toEqual([
      { type: "text", content: "say " },
      { type: "bold", content: [{ type: "text", content: "hello" }] },
    ]);
  });

  it("parses *italic*", () => {
    const r = parseMarkdown("*hi*");
    expect(r).toEqual([
      { type: "italic", content: [{ type: "text", content: "hi" }] },
    ]);
  });

  it("parses _italic_", () => {
    const r = parseMarkdown("_hi_");
    expect(r).toEqual([
      { type: "italic", content: [{ type: "text", content: "hi" }] },
    ]);
  });

  it("parses ~~strikethrough~~", () => {
    const r = parseMarkdown("~~old~~");
    expect(r).toEqual([
      { type: "strikethrough", content: [{ type: "text", content: "old" }] },
    ]);
  });

  it("parses `inline code` without inner parsing", () => {
    const r = parseMarkdown("use `**this**`");
    expect(r).toEqual([
      { type: "text", content: "use " },
      { type: "code_inline", content: "**this**" },
    ]);
  });

  it("parses code block without inner parsing", () => {
    const r = parseMarkdown("```\n**bold**\n```");
    expect(r).toEqual([
      { type: "code_block", content: "**bold**\n", lang: "" },
    ]);
  });

  it("parses code block with language", () => {
    const r = parseMarkdown("```rust\nfn main() {}\n```");
    expect(r).toEqual([
      { type: "code_block", content: "fn main() {}\n", lang: "rust" },
    ]);
  });

  it("parses ||spoiler||", () => {
    const r = parseMarkdown("||secret||");
    expect(r).toEqual([
      { type: "spoiler", content: [{ type: "text", content: "secret" }] },
    ]);
  });

  it("parses ***bold italic***", () => {
    const r = parseMarkdown("***hi***");
    expect(r).toEqual([
      { type: "bold_italic", content: [{ type: "text", content: "hi" }] },
    ]);
  });

  it("parses nested: **bold _italic_ more**", () => {
    const r = parseMarkdown("**bold _italic_ more**");
    expect(r).toEqual([
      {
        type: "bold",
        content: [
          { type: "text", content: "bold " },
          { type: "italic", content: [{ type: "text", content: "italic" }] },
          { type: "text", content: " more" },
        ],
      },
    ]);
  });

  it("parses ||**spoiler with bold**||", () => {
    const r = parseMarkdown("||**x**||");
    expect(r).toEqual([
      {
        type: "spoiler",
        content: [{ type: "bold", content: [{ type: "text", content: "x" }] }],
      },
    ]);
  });

  it("parses > blockquote", () => {
    const r = parseMarkdown("> some text");
    expect(r).toEqual([
      { type: "blockquote", content: [{ type: "text", content: "some text" }] },
    ]);
  });

  it("does not parse markdown inside inline code", () => {
    const r = parseMarkdown("`**bold**`");
    expect(r).toEqual([{ type: "code_inline", content: "**bold**" }]);
  });

  it("handles adjacent markers: **a** *b*", () => {
    const r = parseMarkdown("**a** *b*");
    expect(r).toEqual([
      { type: "bold", content: [{ type: "text", content: "a" }] },
      { type: "text", content: " " },
      { type: "italic", content: [{ type: "text", content: "b" }] },
    ]);
  });

  it("leaves unclosed markers as plain text", () => {
    const r = parseMarkdown("**unclosed");
    expect(r).toEqual([{ type: "text", content: "**unclosed" }]);
  });
});

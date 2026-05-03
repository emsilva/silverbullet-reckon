import { describe, it, expect } from "vitest";
import { extractMathLines, splitIntoLines } from "./parser";

describe("extractMathLines", () => {
  it("returns one RawLine per source line for plain text", () => {
    const out = extractMathLines("a\nb\nc\n");
    expect(out).toEqual([
      { line: 1, text: "a" },
      { line: 2, text: "b" },
      { line: 3, text: "c" },
    ]);
  });

  it("strips frontmatter (lines through closing ---, plus one blank)", () => {
    const text = "---\ntags: foo\n---\n\n1+1\n2+2\n";
    expect(extractMathLines(text)).toEqual([
      { line: 5, text: "1+1" },
      { line: 6, text: "2+2" },
    ]);
  });

  it("strips fenced code blocks (any language, including reckon)", () => {
    const text =
      "1+1\n```reckon\nshould not appear\n```\n2+2\n```js\nalso should not appear\n```\n3+3\n";
    expect(extractMathLines(text)).toEqual([
      { line: 1, text: "1+1" },
      { line: 5, text: "2+2" },
      { line: 9, text: "3+3" },
    ]);
  });

  it("handles unterminated fenced blocks by treating the rest of the doc as inside the block", () => {
    const text = "1+1\n```\nstuff\nmore stuff\n";
    expect(extractMathLines(text)).toEqual([
      { line: 1, text: "1+1" },
    ]);
  });

  it("preserves blank lines as RawLines (they become blank result rows)", () => {
    const text = "1+1\n\n2+2\n";
    expect(extractMathLines(text)).toEqual([
      { line: 1, text: "1+1" },
      { line: 2, text: "" },
      { line: 3, text: "2+2" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(extractMathLines("")).toEqual([]);
  });

  it("trailing newline does not produce an extra blank RawLine", () => {
    const text = "1+1\n";
    expect(extractMathLines(text)).toEqual([{ line: 1, text: "1+1" }]);
  });
});

describe("splitIntoLines (helper used by block widgets)", () => {
  it("splits on \\n and preserves blank lines, no frontmatter/fence stripping", () => {
    expect(splitIntoLines("a\n\nb\n")).toEqual([
      { line: 1, text: "a" },
      { line: 2, text: "" },
      { line: 3, text: "b" },
    ]);
  });
});

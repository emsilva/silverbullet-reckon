import { describe, it, expect } from "vitest";
import { extractMathLines, splitIntoLines, rewriteExpression, detectAssignment } from "./parser";

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

  it("normalizes CRLF line endings (Windows-edited input)", () => {
    expect(extractMathLines("a\r\nb\r\nc\r\n")).toEqual([
      { line: 1, text: "a" },
      { line: 2, text: "b" },
      { line: 3, text: "c" },
    ]);
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

describe("rewriteExpression — percentages", () => {
  const noVars = new Set<string>();

  it("rewrites `X% of Y` to `(X/100) * Y`", () => {
    expect(rewriteExpression("20% of 450", noVars)).toBe("(20/100) * 450");
  });

  it("rewrites additive literal: `Y + X%` to `Y * (1 + X/100)`", () => {
    expect(rewriteExpression("100 + 20%", noVars)).toBe("100 * (1 + 20/100)");
  });

  it("rewrites subtractive literal: `Y - X%` to `Y * (1 - X/100)`", () => {
    expect(rewriteExpression("100 - 20%", noVars)).toBe("100 * (1 - 20/100)");
  });

  it("rewrites standalone `X%` to `X/100`", () => {
    expect(rewriteExpression("20%", noVars)).toBe("20/100");
  });

  it("rewrites additive var: `Y + tax` when tax is a percentage var", () => {
    const vars = new Set(["tax"]);
    expect(rewriteExpression("300 + tax", vars)).toBe("300 * (1 + tax)");
  });

  it("does NOT rewrite `Y + var` when var is not a percentage var", () => {
    expect(rewriteExpression("300 + tax", noVars)).toBe("300 + tax");
  });

  it("rewrites subtractive var: `Y - tax` when tax is a percentage var", () => {
    const vars = new Set(["tax"]);
    expect(rewriteExpression("300 - tax", vars)).toBe("300 * (1 - tax)");
  });

  it("handles dollar-sign prefixes pragmatically (does not break)", () => {
    // mathjs doesn't handle $; we leave it and let mathjs error → comment row.
    // Just verify the rewrite doesn't throw or mangle.
    expect(() => rewriteExpression("$300 + 20%", noVars)).not.toThrow();
  });

  it("chains literal additive percentages: `100 + 20% + 30%` → Soulver-faithful", () => {
    // Soulver convention: 100 * 1.2 * 1.3 = 156, not 100 + 0.2 + 0.3 = 100.5.
    expect(rewriteExpression("100 + 20% + 30%", noVars)).toBe(
      "100 * (1 + 20/100) * (1 + 30/100)",
    );
  });

  it("chains variable additive percentages", () => {
    const vars = new Set(["tax", "tip"]);
    expect(rewriteExpression("100 + tax + tip", vars)).toBe(
      "100 * (1 + tax) * (1 + tip)",
    );
  });
});

describe("rewriteExpression — `in` → `to`", () => {
  const noVars = new Set<string>();

  it("rewrites ` in ` to ` to ` (whole-word)", () => {
    expect(rewriteExpression("100km in miles", noVars)).toBe("100km to miles");
  });

  it("does not rewrite `in` inside a longer word", () => {
    expect(rewriteExpression("inflation * 2", noVars)).toBe("inflation * 2");
  });

  it("rewrites `in` once per occurrence (idempotent on already-`to` form)", () => {
    expect(rewriteExpression("24C in F", noVars)).toBe("24C to F");
  });

  it("does NOT rewrite bare `in` (inches unit)", () => {
    expect(rewriteExpression("12 in", noVars)).toBe("12 in");
  });

  it("does NOT rewrite `in to` (mathjs redundant form)", () => {
    expect(rewriteExpression("12 in to cm", noVars)).toBe("12 in to cm");
  });
});

describe("detectAssignment", () => {
  it("identifies `name = expr`", () => {
    expect(detectAssignment("tax = 20%")).toEqual({
      varName: "tax",
      rhs: "20%",
      isPercentageRhs: true,
    });
  });

  it("identifies non-percentage assignments", () => {
    expect(detectAssignment("salary = 200000")).toEqual({
      varName: "salary",
      rhs: "200000",
      isPercentageRhs: false,
    });
  });

  it("identifies a percent-of assignment as percentage RHS", () => {
    // `20% of 450` is a standalone numeric value, not a percentage variable.
    // Only assignments whose RHS is a literal `N%` (or whitespace `N %`) are
    // treated as percentage assignments for additive-variable purposes.
    expect(detectAssignment("rate = 20% of 450")?.isPercentageRhs).toBe(false);
  });

  it("returns null for non-assignment lines", () => {
    expect(detectAssignment("100 + 20%")).toBeNull();
    expect(detectAssignment("just text")).toBeNull();
  });

  it("does not confuse `==` for assignment", () => {
    expect(detectAssignment("a == b")).toBeNull();
  });
});

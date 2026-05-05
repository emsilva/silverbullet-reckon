import { describe, it, expect } from "vitest";
import { evaluate } from "./engine";

describe("engine.evaluate — arithmetic", () => {
  it("evaluates `1 + 1` to a value row with result `2`", () => {
    const out = evaluate("1 + 1\n");
    expect(out.rows).toEqual([
      { kind: "value", line: 1, source: "1 + 1", result: "2", numeric: 2, clipboard: "2" },
    ]);
    expect(out.total).toEqual({ value: "2", clipboard: "2" });
  });

  it("respects parentheses and precedence", () => {
    const out = evaluate("(1 + 2) * 3\n2 ^ 8\n");
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("9");
    expect(out.rows[1].kind === "value" && out.rows[1].result).toBe("256");
  });

  it("returns blank row for empty lines", () => {
    const out = evaluate("\n");
    expect(out.rows).toEqual([{ kind: "blank", line: 1 }]);
    expect(out.total).toBe(null);
  });

  it("returns no rows and no total for empty input", () => {
    expect(evaluate("")).toEqual({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
  });

  it("formats unit conversion via `in` → `to` rewrite", () => {
    const out = evaluate("100 km in miles\n");
    expect(out.rows[0].kind).toBe("value");
    if (out.rows[0].kind === "value") {
      // mathjs formats as "62.13711922373339 miles" — accept any representation
      // that starts with the right magnitude and contains "mile".
      expect(out.rows[0].result).toMatch(/^62\.\d+\s*miles?$/);
      expect(out.rows[0].numeric).toBeUndefined(); // unit values don't count toward total
    }
  });

  it("auto-total is null when only unit values exist", () => {
    const out = evaluate("100 km in miles\n5 m + 3 m\n");
    expect(out.total).toBe(null);
  });

  it("auto-total sums dimensionless rows with thousands separators", () => {
    const out = evaluate("1000\n2500\n");
    expect(out.total).toEqual({ value: "3,500", clipboard: "3500" });
  });
});

describe("engine.evaluate — percentages (literal)", () => {
  it("`20% of 450` → 90", () => {
    const out = evaluate("20% of 450\n");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("90");
  });

  it("`100 + 20%` → 120 (additive)", () => {
    const out = evaluate("100 + 20%\n");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("120");
  });

  it("`100 - 20%` → 80 (additive)", () => {
    const out = evaluate("100 - 20%\n");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("80");
  });

  it("standalone `20%` → 0.2", () => {
    const out = evaluate("20%\n");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("0.2");
  });

  it("chains additive percentages: `100 + 20% + 30%` → 156", () => {
    const out = evaluate("100 + 20% + 30%\n");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("156");
  });
});

describe("engine.evaluate — variables and scope", () => {
  it("evaluates assignment + later reference to same scope", () => {
    const out = evaluate("salary = 200000\nsalary * 1.15\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "salary",
      result: "200,000",
    });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("treats `tax = 20%` then `100 + tax` as additive (→ 120)", () => {
    const out = evaluate("tax = 20%\n100 + tax\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "tax",
      result: "20%",
    });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "120" });
  });

  it("treats `tax = 20%` then `200 - tax` as subtractive (→ 160)", () => {
    const out = evaluate("tax = 20%\n200 - tax\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "160" });
  });

  it("does NOT treat a non-percentage var additively", () => {
    const out = evaluate("rate = 0.2\n100 + rate\n");
    // 100 + 0.2 = 100.2 — plain arithmetic.
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "100.2" });
  });

  it("variable shadowing: later assignment overwrites earlier", () => {
    const out = evaluate("x = 1\nx = 2\nx + 1\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "3" });
  });

  it("each evaluate() call gets a fresh scope (isolation)", () => {
    evaluate("x = 99\n");
    const out = evaluate("x + 1\n");
    // x is not defined in this fresh evaluate() — so the line is a comment.
    expect(out.rows[0].kind).toBe("comment");
  });

  it("clears the additive flag when a percent-var is reassigned to a non-percentage", () => {
    // tax starts as a percentage literal — additive
    // tax is then reassigned to a plain number — additive flag must clear
    const out = evaluate("tax = 20%\ntax = 0.5\n100 + tax\n");
    expect(out.rows[0]).toMatchObject({ kind: "assignment", varName: "tax", result: "20%" });
    expect(out.rows[1]).toMatchObject({ kind: "assignment", varName: "tax", result: "0.5" });
    // 100 + tax must be plain arithmetic, NOT additive: 100 + 0.5 = 100.5
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "100.5" });
  });
});

describe("engine.evaluate — comments and error fallthrough", () => {
  it("non-math prose lines become comment rows", () => {
    const out = evaluate("Project budget Q2\n200000 * 1.15\n");
    expect(out.rows[0]).toEqual({
      kind: "comment",
      line: 1,
      source: "Project budget Q2",
    });
    expect(out.rows[1].kind).toBe("value");
  });

  it("typos in math-shaped lines also become comments (silent fail)", () => {
    const out = evaluate("5 + \n");
    expect(out.rows[0].kind).toBe("comment");
  });
});

describe("engine.evaluate — auto-total scope (excludes assignments)", () => {
  it("does not include `tax = 20%` assignment numeric in the total", () => {
    const out = evaluate("tax = 20%\n100\n");
    // Pre-fix: 0.2 + 100 = 100.2. Post-fix: just 100.
    expect(out.total).toEqual({ value: "100", clipboard: "100" });
  });

  it("ignores assignment rows even with multiple value rows", () => {
    const out = evaluate("salary = 200000\n100\n200\n");
    // Pre-fix: 200000 + 100 + 200 = 200,300. Post-fix: 100 + 200 = 300.
    expect(out.total).toEqual({ value: "300", clipboard: "300" });
  });

  it("returns null total when only assignments exist (no value rows)", () => {
    const out = evaluate("a = 1\nb = 2\n");
    // Pre-fix would return Total 3. Post-fix: null (no value rows to sum).
    expect(out.total).toBe(null);
  });
});

describe("engine.evaluate — comment escape (# and //)", () => {
  it("renders `# heading` as a heading row (ATX-form supersedes comment escape)", () => {
    const out = evaluate("# heading\n");
    expect(out.rows[0]).toEqual({
      kind: "heading",
      line: 1,
      depth: 1,
      text: "heading",
    });
  });

  it("renders `// note to self` as a comment", () => {
    const out = evaluate("// note to self\n");
    expect(out.rows[0]).toEqual({
      kind: "comment",
      line: 1,
      source: "// note to self",
    });
  });

  it("respects leading whitespace before ATX marker (trimmed `# indented` → heading)", () => {
    const out = evaluate("   # indented\n");
    expect(out.rows[0]).toEqual({
      kind: "heading",
      line: 1,
      depth: 1,
      text: "indented",
    });
  });

  it("`# tax = 20%` is a heading, not an assignment (ATX-form takes priority)", () => {
    const out = evaluate("# tax = 20%\n");
    expect(out.rows[0].kind).toBe("heading");
  });

  it("does not intercept mid-line `#` (mathjs handles it as inline comment)", () => {
    // Our line-start escape only fires when the trimmed line begins with
    // `#` or `//`. mathjs natively treats trailing `#` as an inline
    // comment, so `5 # inline` evaluates to `5` — both behaviors compose.
    const out = evaluate("5 # inline\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "5" });
  });

  it("heading does not leak scope: `# tax = 20%` then `100 + tax` → tax undefined → comment", () => {
    const out = evaluate("# tax = 20%\n100 + tax\n");
    expect(out.rows[0].kind).toBe("heading");
    expect(out.rows[1].kind).toBe("comment");
  });
});

describe("engine.evaluate — percent-literal assignment display (Fix 3)", () => {
  it("`tax = 20%` shows `20%` in the result column, not `0.2`", () => {
    const out = evaluate("tax = 20%\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "tax",
      source: "tax = 20%",
      result: "20%",
    });
  });

  it("preserves user spelling: `tax = 20.5%` shows `20.5%`", () => {
    const out = evaluate("tax = 20.5%\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "20.5%",
    });
  });

  it("preserves whitespace in RHS: `tax = 20 %` shows `20 %`", () => {
    const out = evaluate("tax = 20 %\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "20 %",
    });
  });

  it("non-percent assignments still format normally: `salary = 200000` → `200,000`", () => {
    const out = evaluate("salary = 200000\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "200,000",
    });
  });

  it("percent-RHS expression (not a literal) is NOT a percent display: `rate = 20% of 450` → `90`", () => {
    const out = evaluate("rate = 20% of 450\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "90",
    });
  });

  it("downstream additive percent still works after this fix: `tax = 20%` then `100 + tax` → `120`", () => {
    const out = evaluate("tax = 20%\n100 + tax\n");
    expect(out.rows[0]).toMatchObject({ kind: "assignment", result: "20%" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "120" });
  });
});

describe("engine.evaluate — multi-word variable names", () => {
  it("`current tax = 20%` then `100 + current tax` → 120", () => {
    const out = evaluate("current tax = 20%\n100 + current tax\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "current tax",
      source: "current tax = 20%",
      result: "20%",
    });
    expect(out.rows[1]).toMatchObject({
      kind: "value",
      source: "100 + current tax",
      result: "120",
    });
  });

  it("matches the canonical Soulver example: `current tax = 20%` then `300 + current tax` → 360", () => {
    const out = evaluate("current tax = 20%\n300 + current tax\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "360" });
  });

  it("multi-word non-percent assignment: `budget for q2 = 200000` then `budget for q2 * 1.15`", () => {
    const out = evaluate("budget for q2 = 200000\nbudget for q2 * 1.15\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "budget for q2",
      result: "200,000",
    });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("two independent multi-word vars on the same sheet: `a b = 5` and `c d = 3` then `a b + c d` → 8", () => {
    const out = evaluate("a b = 5\nc d = 3\na b + c d\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "8" });
  });

  it("multi-word reference with tabs/extra spaces still resolves", () => {
    const out = evaluate("current tax = 20%\n100 + current\ttax\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "120" });
  });

  it("auto-total ignores a multi-word assignment and counts only value rows", () => {
    const out = evaluate("current tax = 20%\n100\n200\n");
    expect(out.total).toEqual({ value: "300", clipboard: "300" });
  });

  it("scope is fresh per evaluate(): a multi-word var defined in one call is not visible in the next", () => {
    evaluate("foo bar = 99\n");
    const out = evaluate("foo bar + 1\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("single-word vars are unaffected by multi-word machinery", () => {
    const out = evaluate("salary = 200000\nsalary * 1.15\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("reassigning a multi-word percent-var to a plain value clears percent semantics", () => {
    const out = evaluate("current tax = 20%\ncurrent tax = 500\n100 + current tax\n");
    // After reassignment to 500, "100 + current tax" must be plain
    // arithmetic: 100 + 500 = 600. (If the canonical name leaked from
    // `percentageVars`, you'd get 100 * (1 + 500) = 50100 instead.)
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "600" });
  });
});

describe("engine.evaluate — headings (ATX-form supersedes comment escape)", () => {
  it("`# Q2 budget` → heading depth 1, text `Q2 budget`", () => {
    const out = evaluate("# Q2 budget\n");
    expect(out.rows[0]).toEqual({
      kind: "heading",
      line: 1,
      depth: 1,
      text: "Q2 budget",
    });
  });

  it("`### sub` → depth 3", () => {
    const out = evaluate("### sub\n");
    expect(out.rows[0]).toMatchObject({ kind: "heading", depth: 3, text: "sub" });
  });

  it("`###### deepest` → depth 6", () => {
    const out = evaluate("###### deepest\n");
    expect(out.rows[0]).toMatchObject({ kind: "heading", depth: 6, text: "deepest" });
  });

  it("`####### too many` → comment (regex requires 1-6 hashes)", () => {
    const out = evaluate("####### too many\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`# ` (hash + space + nothing) → comment (no content after space)", () => {
    const out = evaluate("# \n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`#nospace` → comment (no whitespace before content)", () => {
    const out = evaluate("#nospace\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`// note` → comment (no `#` at all)", () => {
    const out = evaluate("// note\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("trims the heading text", () => {
    const out = evaluate("##   spacey   \n");
    expect(out.rows[0]).toMatchObject({ kind: "heading", depth: 2, text: "spacey" });
  });

  it("a heading does not register an identifier or multi-word var", () => {
    const out = evaluate("# tax = 20%\n");
    // `# tax = 20%` is a heading, NOT an assignment — `tax` is not in scope after.
    expect(out.rows[0].kind).toBe("heading");
    const out2 = evaluate("# tax = 20%\n100 + tax\n");
    expect(out2.rows[1].kind).toBe("comment"); // `tax` undefined → silent error → comment
  });
});

describe("engine.evaluate — clipboard values", () => {
  it("plain value row has clipboard equal to String(numeric)", () => {
    const out = evaluate("100 + 50\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "150", clipboard: "150" });
  });

  it("formatted value row strips thousand separators in clipboard", () => {
    const out = evaluate("100000 + 50\n");
    expect(out.rows[0]).toMatchObject({
      kind: "value",
      result: "100,050",
      clipboard: "100050",
    });
  });

  it("percent literal assignment clipboard is the underlying decimal", () => {
    const out = evaluate("tax = 20%\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "20%",
      clipboard: "0.2",
    });
  });

  it("non-percent assignment clipboard is unformatted number", () => {
    const out = evaluate("salary = 200000\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "200,000",
      clipboard: "200000",
    });
  });

  it("unit value clipboard is the numeric portion only (no unit)", () => {
    const out = evaluate("100 km in miles\n");
    if (out.rows[0].kind !== "value") throw new Error("expected value row");
    // mathjs may format with full precision; clipboard should be the leading number.
    expect(out.rows[0].clipboard).toMatch(/^62\.\d+$/);
  });

  it("total row has clipboard equal to unformatted sum", () => {
    const out = evaluate("100000 + 50\n200\n");
    expect(out.total).toEqual({ value: "100,250", clipboard: "100250" });
  });
});

describe("engine.evaluate — identifier and multi-word name sets", () => {
  it("populates identifierNames with single-word assignments", () => {
    const out = evaluate("salary = 200000\ntax = 0.2\n");
    expect(out.identifierNames).toEqual(new Set(["salary", "tax"]));
    expect(out.multiWordNames).toEqual(new Set());
  });

  it("populates multiWordNames with multi-word assignments", () => {
    const out = evaluate("current tax = 20%\nbudget for q2 = 200000\n");
    expect(out.identifierNames).toEqual(new Set());
    expect(out.multiWordNames).toEqual(new Set(["current tax", "budget for q2"]));
  });

  it("an assignment that fails to evaluate does NOT register the name", () => {
    // `5 + ` makes mathjs throw — assignment is recorded as a comment row,
    // and the name is NOT pushed into either set.
    const out = evaluate("foo = 5 +\n");
    expect(out.rows[0].kind).toBe("comment");
    expect(out.identifierNames).toEqual(new Set());
    expect(out.multiWordNames).toEqual(new Set());
  });

  it("headings do not register names", () => {
    const out = evaluate("# tax = 20%\n");
    expect(out.identifierNames).toEqual(new Set());
    expect(out.multiWordNames).toEqual(new Set());
  });
});

describe("engine.evaluate — line references (lineN)", () => {
  it("`line1` resolves to the numeric value of source line 1", () => {
    const out = evaluate("100\nline1 + 50\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", line: 1, result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", line: 2, result: "150" });
  });

  it("works with assignment rows: `salary = 200000` then `line1 * 1.15`", () => {
    const out = evaluate("salary = 200000\nline1 * 1.15\n");
    expect(out.rows[0]).toMatchObject({ kind: "assignment", varName: "salary" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("multiple lineN references in one expression", () => {
    const out = evaluate("100\n200\nline1 + line2\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "300" });
  });

  it("forward reference (lineN where N > current line) → comment", () => {
    const out = evaluate("line2 + 5\n100\n");
    expect(out.rows[0].kind).toBe("comment");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "100" });
  });

  it("reference to non-numeric (unit) row → comment", () => {
    const out = evaluate("100 km in miles\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to comment row → comment", () => {
    const out = evaluate("not math here\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("comment");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to heading row → comment", () => {
    const out = evaluate("# heading\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("heading");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to blank row → comment", () => {
    const out = evaluate("\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("blank");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to non-existent line (line99) → comment", () => {
    const out = evaluate("100\nline99 + 5\n");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("source line numbering accounts for frontmatter (lineN matches editor line)", () => {
    const out = evaluate("---\nreckon: true\n---\n\n100\nline5 + 50\n");
    // Frontmatter lines 1-3 + closing-delim consumes line 4 (blank). The first
    // math line is source line 5; second math line is source line 6.
    expect(out.rows[0]).toMatchObject({ kind: "value", line: 5, result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", line: 6, result: "150" });
  });

  it("isolation: each evaluate() call has a fresh scope (line1 not visible across calls)", () => {
    evaluate("99\n");
    const out = evaluate("line1 + 1\n");
    expect(out.rows[0].kind).toBe("comment");
  });
});

describe("engine.evaluate — line references (ans)", () => {
  it("`ans` on row 2 resolves to row 1's numeric result", () => {
    const out = evaluate("100\nans + 50\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "150" });
  });

  it("`ans` chains: 100, ans * 2, ans + 1 → 100, 200, 201", () => {
    const out = evaluate("100\nans * 2\nans + 1\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "200" });
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "201" });
  });

  it("`ans` skips intervening non-numeric rows (unit) — keeps last numeric", () => {
    const out = evaluate("100\n200 km\nans + 5\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "100" });
    expect(out.rows[1].kind).toBe("value"); // unit row, numeric undefined
    expect(out.rows[1].kind === "value" && out.rows[1].numeric).toBeUndefined();
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` skips comment rows", () => {
    const out = evaluate("100\nnot math\nans + 5\n");
    expect(out.rows[1].kind).toBe("comment");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` skips blank rows", () => {
    const out = evaluate("100\n\nans + 5\n");
    expect(out.rows[1].kind).toBe("blank");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` skips heading rows", () => {
    const out = evaluate("100\n# heading\nans + 5\n");
    expect(out.rows[1].kind).toBe("heading");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` works with assignments: salary = 200000, ans * 1.15 → 230,000", () => {
    const out = evaluate("salary = 200000\nans * 1.15\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("`ans` on the first line → comment (no prior result)", () => {
    const out = evaluate("ans + 5\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`ans` after only non-numeric rows → comment (no numeric to reference)", () => {
    const out = evaluate("100 km in miles\nans + 5\n");
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("isolation: each evaluate() call has a fresh `ans`", () => {
    evaluate("99\n");
    const out = evaluate("ans + 1\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("realistic chain — bill, tip, total: 80, ans + 10%, ans * 1.2 → 80, 88, 105.6", () => {
    const out = evaluate("80\nans + 10%\nans * 1.2\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "80" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "88" });
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105.6" });
  });
});

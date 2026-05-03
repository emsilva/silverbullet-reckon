import { describe, it, expect } from "vitest";
import { evaluate } from "./engine";

describe("engine.evaluate — arithmetic", () => {
  it("evaluates `1 + 1` to a value row with result `2`", () => {
    const out = evaluate("1 + 1\n");
    expect(out.rows).toEqual([
      { kind: "value", line: 1, source: "1 + 1", result: "2", numeric: 2 },
    ]);
    expect(out.total).toEqual({ value: "2" });
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
    expect(evaluate("")).toEqual({ rows: [], total: null });
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
    expect(out.total).toEqual({ value: "3,500" });
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
      result: "0.2",
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
    expect(out.rows[0]).toMatchObject({ kind: "assignment", varName: "tax", result: "0.2" });
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

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
});

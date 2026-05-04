import { describe, it, expect } from "vitest";
import { renderSheet } from "./render";
import { evaluate } from "./engine";
import type { EvaluateResult } from "./engine";

const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    { kind: "assignment", line: 3, source: "tax = 20%", varName: "tax", result: "0.2" },
    {
      kind: "value",
      line: 4,
      source: "100 km in miles",
      result: "62.137 mi",
    },
    { kind: "value", line: 5, source: "300 + tax", result: "360", numeric: 360 },
  ],
  total: { value: "360" },
};

describe("renderSheet", () => {
  it("returns { html, script } with empty script", () => {
    const out = renderSheet(canonical);
    expect(typeof out.html).toBe("string");
    expect(out.script).toBe("");
  });

  it("includes one <tr> per ResultRow", () => {
    const out = renderSheet(canonical);
    const trCount = (out.html.match(/<tr\b/g) || []).length;
    // 5 result rows + 1 total row = 6
    expect(trCount).toBe(6);
  });

  it("renders the total row when total is non-null", () => {
    const out = renderSheet(canonical);
    expect(out.html).toContain('class="total"');
    expect(out.html).toContain("360");
  });

  it("omits the total row entirely when total is null", () => {
    const out = renderSheet({
      rows: [{ kind: "value", line: 1, source: "5 km", result: "5 km" }],
      total: null,
    });
    expect(out.html).not.toContain('class="total"');
  });

  it("escapes HTML in source text (e.g. <script> in prose)", () => {
    const out = renderSheet({
      rows: [{ kind: "comment", line: 1, source: "<script>alert(1)</script>" }],
      total: null,
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("matches the canonical snapshot", () => {
    expect(renderSheet(canonical)).toMatchSnapshot();
  });
});

describe("integration — evaluate(text) → renderSheet(result)", () => {
  it("snapshots the full pipeline for a canonical mixed input", () => {
    const input = [
      "Project budget Q2",
      "",
      "tax = 20%",
      "salary = 200000",
      "100 + 20%",
      "100 km in miles",
      "current tax = 20%",
      "300 + current tax",
      "# this is a heading",
      "// note to self",
      "5 # inline comment",
    ].join("\n") + "\n";

    const out = renderSheet(evaluate(input));
    expect(out).toMatchSnapshot();
  });
});

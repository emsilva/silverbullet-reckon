import { describe, it, expect } from "vitest";
import { renderSheet } from "./render";
import { evaluate } from "./engine";
import type { EvaluateResult } from "./engine";

const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    {
      kind: "assignment",
      line: 3,
      source: "tax = 20%",
      varName: "tax",
      result: "0.2",
      clipboard: "0.2",
    },
    {
      kind: "value",
      line: 4,
      source: "100 km in miles",
      result: "62.137 mi",
      clipboard: "62.137",
    },
    {
      kind: "value",
      line: 5,
      source: "300 + tax",
      result: "360",
      numeric: 360,
      clipboard: "360",
    },
  ],
  total: { value: "360", clipboard: "360" },
  identifierNames: new Set(["tax"]),
  multiWordNames: new Set(),
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
      rows: [{ kind: "value", line: 1, source: "5 km", result: "5 km", clipboard: "5 km" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).not.toContain('class="total"');
  });

  it("escapes HTML in source text (e.g. <script> in prose)", () => {
    const out = renderSheet({
      rows: [{ kind: "comment", line: 1, source: "<script>alert(1)</script>" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
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
    // The unit conversion row in this snapshot will show mathjs's full
    // precision (e.g. "62.13711922373339 miles"). The pure-render snapshot
    // above uses the shorter hand-built "62.137 mi" form. Both are
    // intentional: pure-render tests the renderer with a fixed fixture;
    // integration tests the engine→renderer pipeline with whatever
    // evaluate() actually produces.
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

    const { html } = renderSheet(evaluate(input));
    // Snapshot only the <table> portion: CSS is already covered by the
    // pure-render snapshot, and the integration contract being tested here
    // is engine output → renderer table structure.
    const table = html.match(/<table[\s\S]*<\/table>/)?.[0] ?? "";
    // Hard-fail if the renderer ever stops emitting a <table>: keeps the
    // snapshot from silently locking an empty string.
    expect(table).toBeTruthy();
    expect(table).toMatchSnapshot();
  });
});

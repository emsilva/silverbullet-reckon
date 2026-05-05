import { describe, it, expect } from "vitest";
import { renderSheet } from "./render";
import { evaluate } from "./engine";
import type { EvaluateResult } from "./engine";

const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    { kind: "heading", line: 3, depth: 2, text: "Inputs" },
    {
      kind: "assignment",
      line: 4,
      source: "tax = 20%",
      varName: "tax",
      result: "20%",
      numeric: 0.2,
      clipboard: "0.2",
    },
    {
      kind: "value",
      line: 5,
      source: "100 km in miles",
      result: "62.137 mi",
      clipboard: "62.137",
    },
    {
      kind: "value",
      line: 6,
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
  it("returns { html, script } with non-empty script", () => {
    const out = renderSheet(canonical);
    expect(typeof out.html).toBe("string");
    expect(out.script.length).toBeGreaterThan(0);
  });

  it("includes one <tr> per ResultRow", () => {
    const out = renderSheet(canonical);
    const trCount = (out.html.match(/<tr\b/g) || []).length;
    // 6 result rows (comment, blank, heading, assignment, value, value) + 1 total row = 7
    expect(trCount).toBe(7);
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

describe("render — heading row markup", () => {
  it("emits a tr.heading with colspan=2 for a heading row", () => {
    const out = renderSheet({
      rows: [{ kind: "heading", line: 1, depth: 1, text: "Q2 budget" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('<tr class="heading"');
    expect(out.html).toContain('<td class="source" colspan="2">Q2 budget</td>');
  });

  it("escapes HTML in heading text", () => {
    const out = renderSheet({
      rows: [{ kind: "heading", line: 1, depth: 1, text: "<b>x</b>" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("render — tokenized source spans on value/assignment rows", () => {
  it("wraps numbers, operators, and percent in token spans", () => {
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "100 + 20%",
        result: "120",
        numeric: 120,
        clipboard: "120",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('<span class="t-num">100</span>');
    expect(out.html).toContain('<span class="t-op">+</span>');
    expect(out.html).toContain('<span class="t-num">20</span>');
    expect(out.html).toContain('<span class="t-pct">%</span>');
  });

  it("renders a known multi-word identifier as a single id span", () => {
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "300 + current tax",
        result: "360",
        numeric: 360,
        clipboard: "360",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(["current tax"]),
    });
    expect(out.html).toContain('<span class="t-id">current tax</span>');
  });

  it("uses unit class when isUnit-via-mathjs recognizes a name", () => {
    // Smoke test that mathjs does recognize "km".
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "100 km",
        result: "100 km",
        clipboard: "100",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('<span class="t-unit">km</span>');
  });
});

describe("render — clipboard data attributes", () => {
  it("emits data-clipboard-value on value result cells", () => {
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "1+1",
        result: "2",
        numeric: 2,
        clipboard: "2",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('data-clipboard-value="2"');
  });

  it("emits data-clipboard-value on assignment result cells", () => {
    const out = renderSheet({
      rows: [{
        kind: "assignment",
        line: 1,
        source: "tax = 20%",
        varName: "tax",
        result: "20%",
        numeric: 0.2,
        clipboard: "0.2",
      }],
      total: null,
      identifierNames: new Set(["tax"]),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('data-clipboard-value="0.2"');
  });

  it("emits data-clipboard-value on the total row", () => {
    const out = renderSheet({
      rows: [],
      total: { value: "1,000", clipboard: "1000" },
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('data-clipboard-value="1000"');
  });

  it("does NOT emit data-clipboard-value on comment or heading rows", () => {
    const out = renderSheet({
      rows: [
        { kind: "heading", line: 1, depth: 1, text: "section" },
        { kind: "comment", line: 2, source: "// note" },
      ],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    // No data-clipboard-value attribute assignment should appear in the markup.
    // (The CSS block contains the selector text; we test the attribute form only.)
    expect(out.html).not.toContain('data-clipboard-value="');
  });
});

describe("render — script slot contains the click handler", () => {
  it("returns a non-empty script", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.script.length).toBeGreaterThan(0);
  });

  it("script wires a click listener that uses navigator.clipboard.writeText", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.script).toContain("addEventListener");
    expect(out.script).toContain("data-clipboard-value");
    expect(out.script).toContain("navigator.clipboard.writeText");
    expect(out.script).toContain("flashNotification");
  });

  it("script guards against duplicate listener registration on re-render", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    // Assertions confirm the idempotency flag pattern is in place.
    expect(out.script).toContain("__reckonClickBound");
    expect(out.script).toContain("window.__reckonClickBound = true");
  });
});

describe("render — Monokai Pro CSS palette", () => {
  it("includes both light and dark Monokai Pro palettes via media query", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain("@media (prefers-color-scheme: dark)");
    // Sentinel hex values from each palette
    expect(out.html).toContain("#ab9df2"); // Monokai Pro purple (numbers, dark)
    expect(out.html).toContain("#6849c2"); // Monokai Pro Light purple (numbers, light)
  });

  it("declares hover style on data-clipboard-value cells", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toMatch(/td\.result\[data-clipboard-value\]:hover/);
    expect(out.html).toMatch(/cursor:\s*pointer/);
  });
});

describe("renderSheet — line-number gutter", () => {
  it("every row has a <td class='gutter'> as its first cell", () => {
    const out = renderSheet(canonical);
    // 6 result rows + 1 total row = 7 rows. Every <tr> should open with
    // a gutter cell.
    const gutterCells = (out.html.match(/<td class="gutter[^"]*"/g) || []).length;
    expect(gutterCells).toBe(7);
  });

  it("referenceable rows (value, assignment) have class 'gutter referenceable'", () => {
    const out = renderSheet(canonical);
    // canonical has 1 assignment (line 4) + 2 value rows (lines 5, 6) = 3 referenceable.
    const matches = out.html.match(/<td class="gutter referenceable"/g) || [];
    expect(matches.length).toBe(3);
  });

  it("non-referenceable rows (comment, blank, heading) have class 'gutter' only (no referenceable)", () => {
    const out = renderSheet(canonical);
    // 1 comment + 1 blank + 1 heading = 3 non-referenceable.
    // Match opening <td class="gutter"> EXACTLY (not "gutter referenceable" or "gutter total").
    const matches = out.html.match(/<td class="gutter">/g) || [];
    expect(matches.length).toBe(3);
  });

  it("total row's gutter shows 'Σ' (no line number)", () => {
    const out = renderSheet(canonical);
    expect(out.html).toContain('<td class="gutter total">Σ</td>');
  });

  it("gutter cell carries the row's source line number", () => {
    const out = renderSheet(canonical);
    // canonical line 4 is the assignment row (tax = 20%). Its gutter should show "4".
    expect(out.html).toMatch(/<td class="gutter referenceable" data-line="4">4<\/td>/);
  });

  it("emits data-line and data-references on rows containing lineN", () => {
    const out = renderSheet({
      rows: [
        { kind: "value", line: 1, source: "100", result: "100", numeric: 100, clipboard: "100" },
        { kind: "value", line: 2, source: "200", result: "200", numeric: 200, clipboard: "200" },
        {
          kind: "value",
          line: 3,
          source: "line1 + line2",
          result: "300",
          numeric: 300,
          clipboard: "300",
        },
      ],
      total: { value: "600", clipboard: "600" },
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    // Row 3 references lines 1 and 2.
    expect(out.html).toMatch(/data-line="3"\s+data-references="1,2"/);
    // Rows 1 and 2 don't reference anything — data-references should be absent or empty.
    // (Implementation: omit the attribute entirely when there are no references.)
    expect(out.html).not.toMatch(/data-line="1"\s+data-references=/);
    expect(out.html).not.toMatch(/data-line="2"\s+data-references=/);
  });

  it("comment/heading/blank rows still get a gutter (just non-referenceable)", () => {
    const out = renderSheet({
      rows: [
        { kind: "comment", line: 1, source: "hello" },
        { kind: "blank", line: 2 },
        { kind: "heading", line: 3, depth: 1, text: "Section" },
      ],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    // 3 rows × 1 gutter each = 3 gutter cells.
    const gutterCells = (out.html.match(/<td class="gutter[^"]*"/g) || []).length;
    expect(gutterCells).toBe(3);
    // None of them are 'referenceable'.
    expect(out.html).not.toContain('class="gutter referenceable"');
    // Each shows its source line number.
    expect(out.html).toMatch(/<td class="gutter">1<\/td>/);
    expect(out.html).toMatch(/<td class="gutter">2<\/td>/);
    expect(out.html).toMatch(/<td class="gutter">3<\/td>/);
  });

  it("comment/heading/blank source cells use colspan=2 (gutter is separate)", () => {
    const out = renderSheet({
      rows: [
        { kind: "comment", line: 1, source: "hello" },
      ],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    // Gutter takes one column; source spans the remaining 2 (source + result columns).
    expect(out.html).toMatch(/<td class="source" colspan="2">/);
  });
});

describe("renderSheet — script wiring (gutter click + hover-pair)", () => {
  it("script handles clicks on .gutter.referenceable as well as data-clipboard-value cells", () => {
    const out = renderSheet(canonical);
    expect(out.script).toMatch(/gutter[\s\S]*referenceable|referenceable[\s\S]*gutter/);
    expect(out.script).toContain("data-clipboard-value");
  });

  it("script copies `line${dataLine}` (not the row's clipboard value) when a gutter is clicked", () => {
    const out = renderSheet(canonical);
    expect(out.script).toMatch(/["']line["']\s*\+\s*\w+|`line\$\{/);
  });

  it("script wires bidirectional hover-pair on tr[data-line]", () => {
    const out = renderSheet(canonical);
    expect(out.script).toMatch(/mouseenter|pointerenter/);
    expect(out.script).toMatch(/mouseleave|pointerleave/);
    expect(out.script).toContain("linref-pair");
    expect(out.script).toMatch(/data-references|dataReferences/);
  });

  it("script remains idempotent across re-injection (panel re-render guard)", () => {
    const out = renderSheet(canonical);
    expect(out.script).toContain("__reckonClickBound");
  });

  it("script broadcasts hover events to sibling iframes for cross-block hover-pair", () => {
    const out = renderSheet(canonical);
    expect(out.script).toContain("postMessage");
    expect(out.script).toContain("reckon:hoverEnter");
    expect(out.script).toContain("reckon:hoverLeave");
    expect(out.script).toMatch(/window\.top|top\.frames/);
  });
});

describe("renderSheet — totalref source coloring", () => {
  it("`total` source span gets .t-totalref class in a value row", () => {
    const out = evaluate("100\n200\ntotal / 2\n");
    const html = renderSheet(out).html;
    expect(html).toContain('<span class="t-totalref">total</span>');
  });

  it("non-`total` words like `Totally` do NOT get .t-totalref", () => {
    const out = evaluate("Totally = 5\n");
    const html = renderSheet(out).html;
    expect(html).not.toContain('class="t-totalref"');
  });

  it("light-mode CSS contains .t-totalref color rule", () => {
    const out = evaluate("100\n");
    const html = renderSheet(out).html;
    expect(html).toContain(".t-totalref { color: #a67c00; }");
  });

  it("dark-mode CSS contains .t-totalref color override", () => {
    const out = evaluate("100\n");
    const html = renderSheet(out).html;
    // Match either ordering inside the @media block.
    expect(html).toMatch(/@media \(prefers-color-scheme: dark\)[\s\S]*\.t-totalref \{ color: #ffd866; \}/);
  });
});

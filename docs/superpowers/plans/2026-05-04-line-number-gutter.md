# Line-Number Gutter & Reference Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the line-number gutter on every panel/widget row, with click-to-copy `lineN` on referenceable rows, `Σ` on the total row, and bidirectional hover-pair highlighting on `lineN` references. Closes [issue #12](https://github.com/emsilva/silverbullet-reckon/issues/12).

**Architecture:** Render-side change. Engine output is unchanged. The lexer gains one new `TokenKind` (`linref`) so `line5`/`line17`/etc. are classified distinctly from regular identifiers; render walks the existing token stream to extract `referencedLines: number[]` per row, emits `<td class="gutter">` as the first cell of every row with `data-line` and `data-references` attrs, and adds two new wiring blocks to the iframe's `<script>`: a click-to-copy on `.gutter.referenceable` and a bidirectional hover-pair toggle on `tr[data-line]`.

**Tech Stack:** TypeScript 5.5, mathjs 14, vitest 2 (existing).

**Spec:** `docs/superpowers/specs/2026-05-04-line-number-gutter-design.md`.

---

## File Structure

- `src/lexer.ts` (modify) — add `"linref"` to `TokenKind`; classify `^line\d+$` as `linref` before the id/unit fallthrough.
- `src/lexer.test.ts` (modify) — append a `describe` block with classification tests for `lineN`, `lineabc`, bare `line`, and combined sequences.
- `src/render.ts` (modify) — `rowHtml` and `totalRowHtml` prepend a gutter cell; new `extractReferencedLines(tokens)` helper; `<tr>` carries `data-line` and `data-references` attrs; `STYLE` block adds `.gutter`, `.gutter.referenceable`, `.gutter.total`, `.linref-pair` rules; `SCRIPT` block adds gutter click handler and bidirectional hover-pair JS.
- `src/render.test.ts` (modify) — refresh canonical snapshot; new structural assertions for gutter cell, `Σ` on total, `data-references` population, `.gutter.referenceable` only on value/assignment.
- `src/__snapshots__/render.test.ts.snap` (modify) — auto-regenerated with `npx vitest run -u`.
- `infra/space-seed/Tests/Line Number Gutter Verification.md` (create) — `reckon: true` page with embedded fenced ```reckon``` blocks demonstrating gutter, click-copy, and hover-pair behavior. Per memory rule, examples are in fenced blocks.
- `infra/space/Tests/Line Number Gutter Verification.md` (create, gitignored) — runtime mirror.
- `infra/space-seed/Changelog.md` (modify) — prepend "What's new — Line-number gutter (issue #12)".

No new files in `src/`.

---

## Task 1: Lexer — `linref` TokenKind

**Files:**
- Modify: `src/lexer.ts:1` (extend `TokenKind` union) + `src/lexer.ts:78-86` (insert `linref` classification before the id/unit branch in the WORD_RE handler).
- Test: `src/lexer.test.ts` (append a new describe block).

- [ ] **Step 1: Write failing tests**

Append to `src/lexer.test.ts`:

```ts
describe("tokenize — linref kind for `lineN` references", () => {
  const noUnits = (_: string) => false;
  const opts = {
    identifiers: new Set<string>(),
    multiWord: new Set<string>(),
    isUnit: noUnits,
  };

  it("`line5` tokenizes as kind: 'linref'", () => {
    const tokens = tokenize("line5", opts);
    expect(tokens).toEqual([{ kind: "linref", text: "line5" }]);
  });

  it("`line17` tokenizes as kind: 'linref' (multi-digit)", () => {
    const tokens = tokenize("line17", opts);
    expect(tokens).toEqual([{ kind: "linref", text: "line17" }]);
  });

  it("`lineabc` stays as kind: 'id' (not all-digit suffix)", () => {
    const tokens = tokenize("lineabc", opts);
    expect(tokens).toEqual([{ kind: "id", text: "lineabc" }]);
  });

  it("`line` (bare word, no digits) stays as kind: 'id'", () => {
    const tokens = tokenize("line", opts);
    expect(tokens).toEqual([{ kind: "id", text: "line" }]);
  });

  it("`line5_x` stays as kind: 'id' (digits not at end)", () => {
    const tokens = tokenize("line5_x", opts);
    expect(tokens).toEqual([{ kind: "id", text: "line5_x" }]);
  });

  it("combined: `line5 + 10` produces [linref, ws, op, ws, num]", () => {
    const tokens = tokenize("line5 + 10", opts);
    expect(tokens).toEqual([
      { kind: "linref", text: "line5" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "num", text: "10" },
    ]);
  });

  it("linref takes precedence over user identifiers (so `line5` user-var is colored as ref)", () => {
    const tokens = tokenize("line5", {
      identifiers: new Set(["line5"]),
      multiWord: new Set<string>(),
      isUnit: noUnits,
    });
    expect(tokens).toEqual([{ kind: "linref", text: "line5" }]);
  });
});
```

- [ ] **Step 2: Run, confirm failures**

Run: `npx vitest run src/lexer.test.ts -t "linref kind" --reporter verbose`

Expected: all 7 new tests FAIL because `line5` currently returns `kind: "id"`.

- [ ] **Step 3: Extend `TokenKind` union**

Modify `src/lexer.ts:1`:

```ts
export type TokenKind = "num" | "id" | "unit" | "op" | "kw" | "pct" | "ws" | "text" | "linref";
```

- [ ] **Step 4: Insert `linref` classification**

Modify `src/lexer.ts` inside `tokenize()`, in the WORD_RE branch around lines 78-86:

```ts
    // 5. Word — could be keyword, linref, identifier, or unit
    const wordM = WORD_RE.exec(rest);
    if (wordM) {
      const w = wordM[0];
      let kind: TokenKind;
      if (KEYWORDS.has(w)) kind = "kw";
      else if (/^line\d+$/.test(w)) kind = "linref";
      else if (identifiers.has(w)) kind = "id";
      else if (isUnit(w)) kind = "unit";
      else kind = "id";
      tokens.push({ kind, text: w });
      pos += w.length;
      continue;
    }
```

(The new line is `else if (/^line\d+$/.test(w)) kind = "linref";` inserted between the keyword and identifier checks. Order matters — `linref` precedes the user-identifier check so a user-defined `line5` variable doesn't shadow the reference semantics.)

- [ ] **Step 5: Run lexer tests, confirm pass**

Run: `npx vitest run src/lexer.test.ts`

Expected: all 21 prior tests + 7 new linref tests PASS (28 total).

- [ ] **Step 6: Run full suite — render snapshots will need refresh**

Run: `npx vitest run`

Expected: lexer (28) + frontmatter (15) + parser (41) + engine (184) PASS. **render tests may FAIL** because the snapshot was captured with `t-id` for any `lineN` source in the canonical fixture. Note: the canonical fixture in `src/render.test.ts:6-37` does NOT contain any `lineN` references (it's `tax`, `salary`, `100 km`, `300 + tax`), so the snapshot may actually still pass. Verify the test output.

- [ ] **Step 7: If render snapshots failed, refresh them**

If Step 6 showed render snapshot failures, run: `npx vitest run -u src/render.test.ts`

Then inspect the snapshot diff: `git diff src/__snapshots__/render.test.ts.snap`.

If the only changes are `class="t-id"` → `class="t-linref"` for `lineN` substrings, accept the diff. Otherwise something else changed — investigate before continuing.

- [ ] **Step 8: Type-check + build + commit**

```bash
npx tsc --noEmit
npm run build
git add src/lexer.ts src/lexer.test.ts reckon.plug.js
# If snapshot changed:
git add src/__snapshots__/render.test.ts.snap src/render.test.ts
git commit -m "feat(lexer): linref kind for lineN reference tokens"
```

---

## Task 2: Render — gutter cell + data attrs + Σ on total

**Files:**
- Modify: `src/render.ts` — STYLE block (add gutter CSS), `rowHtml` (prepend gutter cell, emit data attrs), `totalRowHtml` (prepend `Σ` gutter), new `extractReferencedLines` helper.
- Test: `src/render.test.ts` — new structural assertions; refresh snapshot.

- [ ] **Step 1: Write failing tests**

Append to `src/render.test.ts` (after the existing canonical-snapshot test):

```ts
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
```

- [ ] **Step 2: Run, confirm failures**

Run: `npx vitest run src/render.test.ts -t "line-number gutter" --reporter verbose`

Expected: all 8 new tests FAIL.

- [ ] **Step 3: Add `extractReferencedLines` helper + update STYLE/SCRIPT/rowHtml/totalRowHtml**

Modify `src/render.ts`. The cumulative diff:

**(a) Add to STYLE block** (insert before the closing `</style>`, just before the dark-mode `@media` rule):

```css
  /* Gutter */
  td.gutter {
    color: color-mix(in srgb, currentColor 35%, transparent);
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 2.5em;
    padding-right: 8px;
    user-select: none;
    white-space: nowrap;
  }
  td.gutter.referenceable {
    color: color-mix(in srgb, currentColor 75%, transparent);
    cursor: pointer;
    border-radius: 3px;
    transition: background 150ms ease;
  }
  td.gutter.referenceable:hover {
    background: rgba(104, 73, 194, 0.10);
  }
  td.gutter.referenceable:active { transform: translateY(1px); }
  td.gutter.total { font-weight: 600; opacity: 0.85; }
  tr.linref-pair td { background: rgba(104, 73, 194, 0.06); }
```

**(b) Mirror the dark-mode hover tint** — add inside the existing `@media (prefers-color-scheme: dark)` block (just after the existing result-cell hover override):

```css
    td.gutter.referenceable:hover { background: rgba(171, 157, 242, 0.14); }
    tr.linref-pair td { background: rgba(171, 157, 242, 0.10); }
```

(Concrete RGBA values for the polish pass — `/redesign-skill medium` will tune.)

**(c) Add `extractReferencedLines` helper** (place near `tokensToHtml`):

```ts
function extractReferencedLines(tokens: Token[]): number[] {
  const lines: number[] = [];
  for (const t of tokens) {
    if (t.kind === "linref") {
      const m = /^line(\d+)$/.exec(t.text);
      if (m) lines.push(Number(m[1]));
    }
  }
  return lines;
}
```

**(d) Replace `rowHtml`** with the gutter-aware version:

```ts
function rowHtml(row: ResultRow, options: TokenizeOptions): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank" data-line="${row.line}"><td class="gutter">${row.line}</td><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      return `<tr class="heading" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
    case "assignment": {
      const tokens = tokenize(row.source, options);
      const refs = extractReferencedLines(tokens);
      const refsAttr = refs.length > 0 ? ` data-references="${refs.join(",")}"` : "";
      return `<tr class="${row.kind}" data-line="${row.line}"${refsAttr}><td class="gutter referenceable" data-line="${row.line}">${row.line}</td><td class="source">${tokensToHtml(tokens)}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
    }
  }
}
```

**(e) Replace `totalRowHtml`**:

```ts
function totalRowHtml(total: TotalRow): string {
  return `<tr class="total"><td class="gutter total">Σ</td><td class="label">Total</td><td class="result" data-clipboard-value="${escapeHtml(total.clipboard)}">${escapeHtml(total.value)}</td></tr>`;
}
```

- [ ] **Step 4: Run gutter tests, confirm pass**

Run: `npx vitest run src/render.test.ts -t "line-number gutter"`

Expected: all 8 new tests PASS.

- [ ] **Step 5: Refresh canonical snapshot**

Run: `npx vitest run -u src/render.test.ts`

Inspect: `git diff src/__snapshots__/render.test.ts.snap`. The diff should show every `<tr>` gaining a gutter cell + `data-line` attribute, the total row's `Σ`, and the new `<style>` rules. No engine output should have changed.

- [ ] **Step 6: Full suite**

Run: `npx vitest run`

Expected: lexer (28) + frontmatter (15) + parser (41) + engine (184) + render (29 = 21 existing + 8 new) PASS. Total: 297.

- [ ] **Step 7: Type-check + build + commit**

```bash
npx tsc --noEmit
npm run build
git add src/render.ts src/render.test.ts src/__snapshots__/render.test.ts.snap reckon.plug.js
git commit -m "feat(render): line-number gutter with referenceable styling and Σ total"
```

---

## Task 3: Render JS — click-to-copy + bidirectional hover-pair

**Files:**
- Modify: `src/render.ts` — `SCRIPT` block. Add gutter click handler (extends existing data-clipboard-value click) and hover-pair JS.
- Test: `src/render.test.ts` — assert structural script content (the JS interaction itself is verified live; structural tests confirm the script wires up correctly).

- [ ] **Step 1: Write failing tests**

Append to `src/render.test.ts`:

```ts
describe("renderSheet — script wiring (gutter click + hover-pair)", () => {
  it("script handles clicks on .gutter.referenceable as well as data-clipboard-value cells", () => {
    const out = renderSheet(canonical);
    // The script should mention both selectors so a single click delegate
    // covers both surfaces. Loose match — implementation may use closest()
    // or explicit branching.
    expect(out.script).toMatch(/gutter[\s\S]*referenceable|referenceable[\s\S]*gutter/);
    expect(out.script).toContain("data-clipboard-value");
  });

  it("script copies `line${dataLine}` (not the row's clipboard value) when a gutter is clicked", () => {
    const out = renderSheet(canonical);
    // The script should construct "line" + dataLine for gutter clicks.
    // Loose match for a `line${...}` or "line" + concatenation pattern.
    expect(out.script).toMatch(/["']line["']\s*\+\s*\w+|`line\$\{/);
  });

  it("script wires bidirectional hover-pair on tr[data-line]", () => {
    const out = renderSheet(canonical);
    // Expect mouseenter/mouseleave or pointerenter/pointerleave handler.
    expect(out.script).toMatch(/mouseenter|pointerenter/);
    expect(out.script).toMatch(/mouseleave|pointerleave/);
    // Expect a class toggle of 'linref-pair'.
    expect(out.script).toContain("linref-pair");
    // Expect parsing of data-references (CSV).
    expect(out.script).toMatch(/data-references|dataReferences/);
  });

  it("script remains idempotent across re-injection (panel re-render guard)", () => {
    const out = renderSheet(canonical);
    // The re-injection guard from #3 should still be present.
    expect(out.script).toContain("__reckonClickBound");
  });
});
```

- [ ] **Step 2: Run, confirm failures**

Run: `npx vitest run src/render.test.ts -t "script wiring" --reporter verbose`

Expected: 3 of the 4 new tests FAIL (the re-injection guard test passes since it's already present).

- [ ] **Step 3: Replace the SCRIPT block**

Modify `src/render.ts`. Replace the existing `SCRIPT` constant with:

```ts
const SCRIPT = `
(function () {
  // Guard against accumulating duplicate listeners when SB re-injects the
  // panel script on each render. The flag lives on window for the iframe's
  // lifetime; a single delegate handles all subsequent renders.
  if (window.__reckonClickBound) return;
  window.__reckonClickBound = true;

  function safeCopy(value) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(function () {
      if (typeof api === "function") {
        api("editor.flashNotification", "Copied " + value);
      }
    }).catch(function () {});
  }

  document.addEventListener("click", function (e) {
    var gutter = e.target.closest("td.gutter.referenceable[data-line]");
    if (gutter) {
      var dataLine = gutter.getAttribute("data-line");
      if (dataLine) safeCopy("line" + dataLine);
      return;
    }
    var cell = e.target.closest("[data-clipboard-value]");
    if (!cell) return;
    var value = cell.getAttribute("data-clipboard-value");
    if (!value) return;
    safeCopy(value);
  });

  function parseRefs(attr) {
    if (!attr) return [];
    return attr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function findPairs(row) {
    var dataLine = row.getAttribute("data-line");
    if (!dataLine) return [];
    var forwardRefs = parseRefs(row.getAttribute("data-references"));
    var matches = [];
    var allRows = document.querySelectorAll("tr[data-line]");
    for (var i = 0; i < allRows.length; i++) {
      var other = allRows[i];
      if (other === row) continue;
      var otherLine = other.getAttribute("data-line");
      if (forwardRefs.indexOf(otherLine) !== -1) {
        matches.push(other);
        continue;
      }
      var otherRefs = parseRefs(other.getAttribute("data-references"));
      if (otherRefs.indexOf(dataLine) !== -1) {
        matches.push(other);
      }
    }
    return matches;
  }

  document.addEventListener("mouseenter", function (e) {
    if (!e.target.closest) return;
    var row = e.target.closest("tr[data-line]");
    if (!row) return;
    var pairs = findPairs(row);
    for (var i = 0; i < pairs.length; i++) pairs[i].classList.add("linref-pair");
  }, true);

  document.addEventListener("mouseleave", function (e) {
    if (!e.target.closest) return;
    var row = e.target.closest("tr[data-line]");
    if (!row) return;
    var paired = document.querySelectorAll("tr.linref-pair");
    for (var i = 0; i < paired.length; i++) paired[i].classList.remove("linref-pair");
  }, true);
})();
`.trim();
```

(Note: the `mouseenter`/`mouseleave` listeners use `useCapture: true` to receive events from descendant `<tr>` elements correctly, since these events do not bubble. This matches MDN's recommended pattern for delegated mouseenter/mouseleave.)

- [ ] **Step 4: Run script tests, confirm pass**

Run: `npx vitest run src/render.test.ts -t "script wiring"`

Expected: all 4 tests PASS.

- [ ] **Step 5: Refresh canonical snapshot (script content changed)**

Run: `npx vitest run -u src/render.test.ts`

Inspect: `git diff src/__snapshots__/render.test.ts.snap` — the change should be limited to the `script` field of the snapshot.

- [ ] **Step 6: Full suite**

Run: `npx vitest run`

Expected: 301 PASS (297 + 4 new script tests; correction: render gained 4 more = 33 total render tests).

- [ ] **Step 7: Type-check + build + commit**

```bash
npx tsc --noEmit
npm run build
git add src/render.ts src/render.test.ts src/__snapshots__/render.test.ts.snap reckon.plug.js
git commit -m "feat(render): gutter click-to-copy and bidirectional hover-pair"
```

---

## Task 4: Visual polish via `/redesign-skill medium`

**Controller-driven** — this task is NOT dispatched to an implementer subagent. The controller (Claude in the parent session) invokes the `redesign-skill` Skill against the rendered panel/widget and applies any approved changes inline.

- [ ] **Step 1: Snapshot the current visual state**

```bash
# Confirm the dev container has the latest bundle
npm run dev:link

# Take a baseline screenshot for redesign comparison (Playwright via the
# global CLAUDE.md guidance: use JPEG to avoid embedding huge PNGs).
# This step uses MCP browser tools; the controller invokes them directly.
```

The controller invokes the Playwright MCP to:
1. Navigate to `http://localhost:3000` (login `dev:dev`).
2. Open `Tests/Line Number Gutter Verification.md` (created in Task 5; if the page doesn't exist yet, use any existing `reckon: true` page that has multiple row kinds — `Tests/Visual Polish Verification.md` works well).
3. Capture a JPEG screenshot of the panel + an embedded `reckon` block.

- [ ] **Step 2: Invoke the redesign skill**

The controller invokes:

```
Skill: redesign-skill
Args: medium
```

Provide the skill with:
- Repo path: `/home/mannu/code/silverbullet-reckon`
- Target file: `src/render.ts` (STYLE block, lines 9-72 baseline plus the gutter additions from Task 2)
- Live URL: the SilverBullet page from Step 1
- Constraint: light + dark mode parity, palette stays Monokai Pro / Monokai Pro Light, no breaking changes to the structural HTML.
- Focus areas:
  1. Gutter fade level for non-referenceable rows.
  2. `Σ` weight, color, vertical alignment.
  3. `.linref-pair` background tint — subtle, palette-coherent, must not visually compete with `:hover` row tint or the result-cell click-flash.
  4. Click-flash on the gutter — match or differ from the result-cell flash?
  5. Transition timings — match the existing 150ms.

- [ ] **Step 3: Apply the polish**

The controller edits `src/render.ts` STYLE block according to the redesign suggestions. No engine, lexer, or rowHtml changes — only CSS values + maybe the `Σ` glyph treatment.

- [ ] **Step 4: Verify no test regressions**

```bash
npx vitest run
```

Expected: all 301 tests PASS. The render snapshot may need a refresh if STYLE block content changed (run `npx vitest run -u src/render.test.ts` if so).

- [ ] **Step 5: Type-check + build + commit**

```bash
npx tsc --noEmit
npm run build
git add src/render.ts src/__snapshots__/render.test.ts.snap reckon.plug.js
git commit -m "style(render): polish gutter and linref-pair via /redesign-skill medium"
```

---

## Task 5: Closeout — verification page + Changelog + push

**Files:**
- Create: `infra/space-seed/Tests/Line Number Gutter Verification.md` (`reckon: true` + embedded `reckon` blocks).
- Create: `infra/space/Tests/Line Number Gutter Verification.md` (gitignored runtime mirror).
- Modify: `infra/space-seed/Changelog.md` (prepend entry).

This task is dispatchable to an implementer subagent.

- [ ] **Step 1: Create verification page**

Path: `infra/space-seed/Tests/Line Number Gutter Verification.md`

Per the new feedback-memory rule, examples live inside fenced ```reckon``` blocks. The page itself is also a `reckon: true` sheet so panel-mode is verified too. Content (use literal triple-backticks for the `reckon` fences in the actual file):

````md
---
reckon: true
---

# Line-Number Gutter — Live Verification

Open this page in Silverbullet. The right-hand panel and each fenced
`reckon` block below should each show a left-side line-number gutter.

## What to look for in every panel/block

- Every row has a number on the left.
- Numbers on **value** and **assignment** rows are stronger; numbers on
  **comment**, **blank**, and **heading** rows are faded.
- The total row's gutter shows `Σ`.
- Hovering a referenceable row shows a faint background tint and a
  pointer cursor on the gutter cell.
- Clicking a referenceable gutter copies `line<N>` (e.g. `line1`) — paste
  somewhere to confirm.
- Hovering a row that contains `lineN` lights up the referenced row;
  hovering a row that's *referenced by* others lights up all rows that
  reference it.

## Block 1 — basic gutter shapes

```reckon
# Header (faded gutter)
salary = 200000
tax = 20%
salary * (1 + tax)
```

Expected:
- 4 rows total, gutters show 1, 2, 3, 4 (block-internal numbering).
- Row 1 (heading) has a faded gutter; rows 2-4 are stronger.
- Total `Σ` row appears below with the auto-sum.

## Block 2 — lineN references and forward-pair highlight

```reckon
100
200
line1 + line2
```

Expected:
- 3 rows, gutters 1-3.
- Hover the third row (`line1 + line2`) → rows 1 and 2 light up.
- Hover row 1 → row 3 lights up (reverse direction — row 3 references row 1).
- Click gutter on row 2 → `line2` lands in clipboard.

## Block 3 — chained ans (no highlight, ans not in scope)

```reckon
80
ans + 10%
ans * 1.2
```

Expected:
- 3 rows, gutters 1-3.
- All gutters strongly styled (all rows are value rows).
- Hovering row 2 or 3 does NOT light up row 1 — `ans` is excluded from
  hover-pair this iteration. (lineN-only highlighting per spec.)

## Block 4 — non-referenceable rows still numbered

```reckon
# Q2 budget
salary = 200000

salary * 1.15
```

Expected:
- 4 rows, gutters 1-4.
- Row 1 (heading), row 3 (blank) → faded gutters.
- Rows 2, 4 → stronger gutters, clickable.

## Page-mode verification (this whole page as a sheet)

Outside the fenced blocks, this page is itself a `reckon: true` sheet,
so the right-hand panel evaluates the whole page. The panel should
also show the gutter, with line numbers matching the source line of
each row in this Markdown file (likely starting in the teens because
of the headings and prose above).

500
ans + 100
````

(Note: in the actual `.md` file, the ```reckon``` fences are literal triple-backticks, not the four-tilde escape used in this prompt to nest them.)

- [ ] **Step 2: Mirror to runtime space**

```bash
mkdir -p infra/space/Tests
cp "infra/space-seed/Tests/Line Number Gutter Verification.md" "infra/space/Tests/Line Number Gutter Verification.md"
```

- [ ] **Step 3: Prepend Changelog entry**

Read `infra/space-seed/Changelog.md`, then insert the following block immediately after the file's intro lines and before the existing top entry.

````md
## What's new — Line-number gutter (issue #12)

Reckon panels and `reckon` blocks now show a line-number gutter on
every row, click-to-copy on referenceable gutters, and bidirectional
hover-pair highlighting on `lineN` references.

### The gutter

Every row gets a number on the left. Rows that produce a referenceable
result (value, assignment) are styled stronger; comment, blank, and
heading rows are faded. The total row shows `Σ` instead of a number.

```reckon
salary = 200000
tax = 20%
salary * (1 + tax)
```

The numbers above are the *source* line numbers of each row — same as
your editor — so `lineN` references stay coherent with what you see.

### Click a gutter to copy `lineN`

Click the gutter on a referenceable row and `line<N>` lands in your
clipboard with a flash, ready to paste into another expression. Same
copy/flash pattern as the existing result-cell click from issue #3.

### Hover-pair highlighting

Hover any row that contains `lineN` and the referenced row lights up.
Hover a row that *is* referenced and every row that references it
lights up — the find-all-uses pattern. Make a chain like

```reckon
100
200
line1 + line2
ans * 2
```

and try hovering each row to see the dependencies surface.

`ans` is excluded from hover highlighting in this iteration — the
engine doesn't yet expose which row `ans` resolved to. Future
iteration may add it.

---
````

(Existing `## What's new — Line references (issue #8)` follows.)

- [ ] **Step 4: Final type-check + build sanity**

```bash
npx tsc --noEmit
npm run build
```

Expected: clean. `reckon.plug.js` should be unchanged from Task 4's commit.

- [ ] **Step 5: Commit closeout (docs only)**

```bash
git add infra/space-seed/Tests/ infra/space-seed/Changelog.md
git commit -m "docs(infra): Changelog + Tests/ verification page for line-number gutter"
```

- [ ] **Step 6: Re-link plug into dev space**

```bash
npm run dev:link
```

(So when the user opens SilverBullet next, the new bundle is in place. They'll still need to run `Plugs: Reload` in the SB UI.)

- [ ] **Step 7: Push to origin/main**

```bash
git push origin main
```

- [ ] **Step 8: Comment on issue #12 requesting verification**

```bash
gh issue comment 12 --body "$(cat <<'EOF'
## Line-number gutter shipped on `main`

Issue #12 landed as a 5-commit bundle:

- `feat(lexer): linref kind for lineN reference tokens`
- `feat(render): line-number gutter with referenceable styling and Σ total`
- `feat(render): gutter click-to-copy and bidirectional hover-pair`
- `style(render): polish gutter and linref-pair via /redesign-skill medium`
- `docs(infra): Changelog + Tests/ verification page for line-number gutter`

To verify live, open `Tests/Line Number Gutter Verification.md` in
SilverBullet — the right-hand panel and each embedded `reckon` block
should match the inline expectations: visible gutter on every row,
stronger styling on referenceable rows, `Σ` on the total, click-to-copy
on the gutter, and bidirectional `lineN` hover-pair highlight.

Run `Plugs: Reload` in SB after pulling. Reply once verified and I'll close.
EOF
)"
```

Leave issue #12 OPEN. The user verifies in-browser, then closes via `gh issue close 12`.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Covered by |
|---|---|
| Q1c: gutter on all rows, stronger on referenceable | Task 2 Steps 1-3 (CSS + rowHtml branching) |
| Q2b: click gutter on referenceable → copy `lineN` + flash | Task 3 Steps 1-3 (script gutter handler + tests) |
| Q3c: total row gets `Σ` | Task 2 Step 3(e) (totalRowHtml) + tests |
| Q4b: hover-pair bundled into #12 | Task 3 Steps 1-3 (script + tests) |
| Q5b: bidirectional, lineN only, ans excluded | Task 3 Step 3 (parseRefs reads data-references which only has lineN refs from extractReferencedLines, which only collects linref tokens) |
| New token kind `linref` | Task 1 |
| Render data flow (data-line + data-references on tr) | Task 2 |
| Verification page + Changelog | Task 5 |
| Per-task CI bundle-drift compliance (rebuilt plug per src commit) | Tasks 1, 2, 3, 4 each include `npm run build` + `git add reckon.plug.js` |
| Examples in fenced reckon blocks (per memory rule) | Task 5 verification page + Changelog use fenced ```reckon``` blocks |

**2. Placeholder scan:** No "TBD", "TODO", or vague requirements. All test code is concrete; all CSS is committed (with the redesign pass tuning concrete values). Task 4 is intentionally controller-driven and not subagent-dispatchable — that's flagged at the top of the task.

**3. Type consistency:**
- `TokenKind` extends to include `"linref"` — used by lexer (Task 1) and render's `extractReferencedLines` (Task 2). Both reference the same exported type.
- `Token` interface unchanged — `kind` is `TokenKind`, `text` is `string`.
- `ResultRow` discriminated union unchanged.
- `EvaluateResult` unchanged.
- `RenderOutput` shape (`{ html, script }`) unchanged.
- All test assertions use the existing `toMatchObject` / `toContain` / `toMatch` patterns.

No new types beyond the extended `TokenKind` union.

**4. Sequence integrity:**
- Task 1 (lexer) before Task 2 (render that uses linref) — correct.
- Task 2 (gutter HTML) before Task 3 (script wiring on the new attrs) — correct; Task 3's tests depend on Task 2's `data-line`/`data-references` being present.
- Task 4 (visual polish) after Task 3 (so the polish has the full set of styles to refine) — correct.
- Task 5 (closeout) after everything — correct.

No drift between tasks.

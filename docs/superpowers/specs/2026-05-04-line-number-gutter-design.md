# Line-Number Gutter & Reference Highlighting — Design

**Status:** Design accepted (autonomous overnight session), ready for implementation plan.
**Date:** 2026-05-04
**Author:** Mannu Silva (with Claude)
**Repo:** `github.com/emsilva/silverbullet-reckon`
**Issue:** #12 — "UX: line-number gutter + fenced-block-first positioning"

## 1. Goal

Make the line-references shipped in #8 actually usable by giving every panel/widget row a visible source line number, and make dependency chains comprehensible at a glance via bidirectional hover-pair highlighting on `lineN` references. Three coordinated render-side additions:

1. **Gutter cell on every row** with a stronger style on referenceable rows (value, assignment) and a faded style on non-referenceable rows (blank, comment, heading). Total row gets a `Σ` glyph instead of a number.
2. **Click-to-copy on referenceable gutter cells** — clicking copies the literal text `lineN` (e.g. `line5`) to the clipboard with the same flash pattern as the result-cell copy from #3.
3. **Bidirectional hover-pair highlight on `lineN` references** — hovering a row that contains `lineN` lights up row N; hovering row N also lights up every row that references it (find-all-uses pattern).

`ans` references are intentionally excluded from highlight in this iteration to keep engine surface unchanged. Slash command (#5) defaulting to fenced blocks is a separate issue.

## 2. Decisions log

| # | Decision | Choice |
|---|---|---|
| Q1 | Which rows show the gutter | **C** — all rows show their line number; referenceable rows (value, assignment) get a stronger style; non-referenceable rows (blank, comment, heading) get a faded style. Communicates "every line has a number, but only the bolder ones can be referenced." |
| Q2 | Click behavior on the gutter | **B** — clicking a referenceable gutter cell copies the literal text `line${N}` to clipboard with a flash, same affordance pattern as the existing result-cell click-to-copy. Non-referenceable gutter cells have no click handler. |
| Q3 | Total row gutter | **C** — total row's gutter cell shows `Σ` instead of a line number. No click behavior. Establishes the precedent for future footer markers (currency totals from #7, etc.). |
| Q4 | Scope — bundle hover-pair or split? | **B** — bundle hover-pair into #12 since it shares the "make references visible" mental model with the gutter and ships from the same render touch points. |
| Q5 | Hover direction + `ans` handling | **B** — bidirectional, `lineN` only. Hover row 8 (`line5 + 10`) lights up row 5; hover row 5 lights up every row that references it. `ans` rows behave like normal value rows on hover (skipping `ans` keeps engine surface unchanged for this issue). |

## 3. Architecture & components

Render-side change. Engine output unchanged. One new `TokenKind` in the lexer.

```
src/
├── lexer.ts          ← MODIFIED — new "linref" TokenKind for /^line\d+$/
├── lexer.test.ts     ← MODIFIED — new classification tests
├── engine.ts         ← UNCHANGED
├── engine.test.ts    ← UNCHANGED
├── render.ts         ← MODIFIED — gutter cell, data-line/data-references attrs, click handler, hover-pair JS, gutter CSS
├── render.test.ts    ← MODIFIED — snapshot refresh + new structural assertions
├── parser.ts         ← UNCHANGED
└── plug.ts           ← UNCHANGED
```

## 4. Data flow

```
engine.evaluate (unchanged)
  → rows[] each with row.line populated (1-based source line)
  → render.rowHtml(row)
    → tokenize(row.source, options)               ← already done for syntax coloring
    → walk tokens; for each kind === "linref":
        extract Number from /^line(\d+)$/ → push to referencedLines[]
    → emit:
        <tr data-line="${row.line}" data-references="5,7"
             class="value | assignment | comment | heading | blank">
          <td class="gutter referenceable"            ← faded for non-ref rows
               data-line="${row.line}">${row.line}</td>
          ...source cell...
          ...result cell...
        </tr>
  → total row emits:
        <tr class="total">
          <td class="gutter total">Σ</td>
          ...total cells...
        </tr>
  → renderSheet's <script> block adds:
      • click handler on .gutter.referenceable → copy `line${dataLine}` + flash
      • mouseenter/leave on tr[data-line] →
            forward set: rows whose data-line ∈ this row's data-references
            reverse set: rows whose data-references contains this row's data-line
            toggle .linref-pair on the union
```

## 5. Lexer change (small)

Currently `line5` tokenizes as `id` (matches WORD_RE, no special handling). Insertion point is in `tokenize()` after the WORD_RE match and before the keyword/identifier/unit/id branch:

```ts
// Inside tokenize, after wordM = WORD_RE.exec(rest):
const w = wordM[0];
let kind: TokenKind;
if (KEYWORDS.has(w)) kind = "kw";
else if (/^line\d+$/.test(w)) kind = "linref";   // NEW
else if (identifiers.has(w)) kind = "id";
else if (isUnit(w)) kind = "unit";
else kind = "id";
```

Order matters: `linref` precedes the user-identifier check so a user-defined `line5` variable (unlikely but possible) doesn't shadow the reference semantics.

`ans` stays as a plain `id` token in this issue. Adding an `ansref` kind is deferred to a future iteration when `ans` hover highlight ships.

## 6. Render changes

### 6.1 Gutter cell

Every `<tr>` from `rowHtml` prepends `<td class="gutter ${maybeReferenceable}">${row.line || "Σ"}</td>`. The full-width comment/heading rows currently use `colspan="2"`; that becomes `colspan="2"` on a non-gutter `<td>` (gutter remains its own cell), so the structure is:

```
<tr class="comment">
  <td class="gutter">5</td>
  <td class="source" colspan="2">// note to self</td>
</tr>
```

Total row uses the existing two-cell structure with gutter prepended:

```
<tr class="total">
  <td class="gutter total">Σ</td>
  <td class="source">Total</td>
  <td class="result" data-clipboard-value="...">485</td>
</tr>
```

### 6.2 Reference extraction

A small helper inside render walks the already-tokenized source and returns a `number[]` of referenced lines:

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

Called once per row inside `rowHtml`. The result is rendered into `data-references="5,7,..."` (empty string omitted entirely if no refs).

### 6.3 Script block additions

The existing `script` returned by `renderSheet` already wires click-to-copy on `.result[data-clipboard-value]`. Two additions:

- **Click on `.gutter.referenceable`** — read `data-line` from the cell, copy `line${dataLine}`, fire the same flash pattern. Reuse the existing `safeCopy(...)` helper if present, otherwise factor a tiny shared function.
- **Hover-pair on `tr[data-line]`** — `mouseenter`: collect this row's `data-references` (parse comma-separated to Number[]) and this row's own `data-line`. Forward set: rows with `data-line` in the references. Reverse set: rows whose `data-references` contains this row's line. Add `.linref-pair` class to the union (excluding the hovered row itself, which already gets `:hover`). `mouseleave`: clear the class from all matching rows.

A defensive single-listener pattern (like the one added in commit `98e738d` for the panel re-injection guard) prevents duplicate handlers when the iframe re-renders.

### 6.4 CSS additions

Concrete colors and opacities are tuned by `/redesign-skill medium`. The structural hooks the plan needs:

- `.gutter` — base style: monospace, right-aligned, fixed minimum width (~3em), no-wrap, faded foreground.
- `.gutter.referenceable` — stronger foreground; `cursor: pointer`; subtle hover background tint identical in palette to the result-cell hover.
- `.gutter.total` — slightly heavier weight, no cursor change.
- `.linref-pair` — subtle background tint that doesn't compete with `:hover`. Both halves of the pair light simultaneously when one is hovered.

## 7. Testing

| Surface | Existing | New |
|---|---|---|
| Lexer (`src/lexer.test.ts`) | 21 tests covering existing kinds | `line5` → `linref`; `line17` → `linref`; `lineabc` → `id`; `line` (bare) → `id`; combined `line5 + 10` produces correct token sequence |
| Render (`src/render.test.ts`) | 21 tests + snapshot | Snapshot refresh; `<td class="gutter">` present on every row with `row.line` value or `Σ` for total; `data-references` populated for rows containing `lineN`; `.gutter.referenceable` only on value/assignment rows |
| Engine (`src/engine.test.ts`) | 86 tests | No new tests — engine output unchanged |
| Frontmatter (`src/frontmatter.test.ts`) | 15 tests | No changes |

Hover-pair JS interaction is hard to unit-test without a DOM. The verification page covers it live.

## 8. Visual polish (`/redesign-skill medium`)

Folded between core implementation and closeout, controller-driven. Tunes:

- Gutter fade level for non-referenceable rows (target: visible enough to read, faint enough to recede).
- `Σ` weight, color, vertical alignment.
- `.linref-pair` background tint — subtle, palette-coherent, not competing with the result-cell hover or the `:hover` row tint.
- Click-flash on the gutter — match or differ from the result-cell flash? Default: match.
- Transition timings — match the existing 150ms transitions from #3.

Light + dark mode parity, palette stays Monokai Pro / Monokai Pro Light.

## 9. Out of scope (#12 stays narrow)

- **`ans` hover highlight + engine-tracked `ansResolvedToLine`** (deferred). When a user hovers a row containing `ans`, nothing special happens. Future issue if it proves valuable.
- **Slash command default-to-fenced-block** (issue #5, deferred per backlog ordering).
- **Editor-cursor scroll on gutter click** (per Q2b — copy-only, no editor coupling).
- **Forward references** — `lineN` referencing a row that hasn't evaluated yet still throws and falls through to comment classification (existing behavior from #8).

## 10. Closeout playback

Verification page at `infra/space-seed/Tests/Line Number Gutter Verification.md` (mirrored to `infra/space/Tests/`). Per the new fenced-block-first memory rule, the verification page primarily exercises a fenced ```reckon``` block — the page panel is verified secondarily. The page should demonstrate:

1. Every row has a visible gutter number.
2. Referenceable rows (value, assignment) look stronger than non-referenceable rows (blank, comment, heading).
3. Total row shows `Σ`.
4. Clicking a referenceable gutter copies `lineN` to the clipboard (visible flash + paste-test).
5. Hovering a row containing `lineN` lights up the referenced row (forward).
6. Hovering a referenced row lights up every row that references it (reverse).
7. Both panel and fenced block widget show the gutter consistently; block widget gutters count from 1.

Changelog entry under "What's new — Line-number gutter (issue #12)" with three subsections (gutter, click-to-copy, hover-pair). Per memory rule, examples are written as fenced ```reckon``` blocks.

`gh issue comment 12` requests live verification, leaves issue OPEN.

# Cross-Block Continuous Mode + `total` Reference — Design

**Status:** Design accepted (interactive brainstorming session), ready for implementation plan.
**Date:** 2026-05-05
**Author:** Mannu Silva (with Claude)
**Repo:** `github.com/emsilva/silverbullet-reckon`
**Issue:** #13 — "Engine: cross-block continuous mode + total reference"

## 1. Goal

Make multi-block pages feel like one calculation. Two coordinated changes:

1. **Continuous mode (default).** Fenced `reckon` blocks share scope with each other in source order — variables and `ans` flow across block boundaries. A page-level frontmatter flag opts out of this behavior to preserve the V1 per-block isolation.
2. **`total` as a referenceable identifier.** Each block's auto-Σ row gains a name. Inside the block that produced it, `total` resolves to the same number shown in the Σ row. Implemented via two-pass evaluation when `total` is referenced. To preserve the equality `total = Σ` (the property we chose two-pass for in the first place), rows that reference `total` are **derived** — they display their resolved value but don't contribute to Σ.

`lineN` and the gutter flow continuously across blocks — block 1 starts at 1, block 2 picks up where block 1 left off (skipping prose between fences). `line1` from any block resolves to the first reckon row on the page. The page panel keeps its current behavior: evaluates non-fenced lines as one isolated track using source-line numbers. Panel and blocks are parallel timelines with their own numbering; no prose-math ↔ block crosstalk.

## 2. Decisions log

| # | Decision | Choice |
|---|---|---|
| Q1 | Bundle continuous + `total` in one spec | **A** — interactions need to be designed together (e.g. how does `total` behave in continuous mode); split would just postpone the conversation. |
| Q2 | Activation mechanism for continuous mode | **A (inverted)** — page frontmatter flag, but **continuous is the default**. Opt-out via `reckon-isolated: true` (name proposed; bikesheddable). |
| Q3 | What "continuous" means | Variables, `ans`, AND `lineN` all flow across blocks in source order. The gutter counts continuously — block 1 starts at 1, block 2 picks up where block 1 left off (skipping prose between fences). `lineN` references that continuous counter, so `line1` from any block resolves to the first reckon row on the page. (Reversed mid-implementation from initial "block-internal lineN" choice; the user's intent during brainstorming was continuous gutter+lineN, not block-local.) |
| Q4 | `total` semantics | **A** — block's final Σ. Two-pass evaluation: pass 1 computes Σ, pass 2 evaluates with `total` in scope. Cheap pass-2 fast-path: skip if no row's source contains the literal `total`. |
| Q5 | Implementation strategy | **A** — naive re-evaluate per block-widget render. No cache for V1. Eval cost is tiny over typical block counts. |
| Q6 | Edit safety | Silent breakage acceptable — broken cross-block refs classify as comment rows (existing behavior). The opt-in cost the user accepts. |

## 3. Architecture & components

Engine-level addition + small surface changes in plug, parser, lexer, render.

```
src/
├── engine.ts          ← MODIFIED — new evaluatePageContinuous(text), per-block pipeline, two-pass total handling
├── engine.test.ts     ← MODIFIED — new describe blocks for cross-block, total, and isolation parity
├── parser.ts          ← MODIFIED — new extractBlocks(text) helper
├── parser.test.ts     ← MODIFIED — extractBlocks tests
├── lexer.ts           ← MODIFIED — new "totalref" TokenKind for the literal `total`
├── lexer.test.ts      ← MODIFIED — totalref classification tests
├── render.ts          ← MODIFIED — new .t-totalref CSS class (gold/yellow palette, matches linref)
├── render.test.ts     ← MODIFIED — snapshot refresh + totalref class assertion
├── frontmatter.ts     ← MODIFIED — new isReckonIsolated(text) helper
├── frontmatter.test.ts← MODIFIED — isReckonIsolated tests
└── plug.ts            ← MODIFIED — reckonBlockWidget becomes async; dispatches to continuous or isolated path
```

No new files. The architectural shift fits inside the existing module layout.

## 4. Data flow

### 4.1 Continuous block-widget render

```
reckonBlockWidget(bodyText, _pageName)  [ASYNC]
  → editor.getText()
  → if isReckonIsolated(text):
        return renderSheet(evaluate(bodyText))         ← V1 fallback path
  → pageResult = evaluatePageContinuous(text)
  → block = findBlockByBody(pageResult.blocks, bodyText)   ← first-occurrence match
  → return renderSheet(toEvaluateResult(block))
```

### 4.2 evaluatePageContinuous

```
evaluatePageContinuous(text):
  blocks = extractBlocks(text)               ← reckon fences in source order
  parser = math.parser()                     ← shared across all blocks
  sharedPercentageVars = new Set()
  sharedMultiWordVars  = new Map()
  results = []
  for block in blocks:
    clearLineRefs(parser)                    ← remove all line<N> bindings
    rows, total = evaluateBlock(parser, block.body, sharedPercentageVars, sharedMultiWordVars)
    parser.remove("total")                   ← total is block-scoped
    results.push({ rows, total, body, startLine, ... })
  return { blocks: results }
```

`evaluateBlock` is a refactor of the current `evaluate(text)` body that:

- Accepts an externally-owned parser (instead of creating its own).
- Accepts externally-owned `percentageVars` / `multiWordVars` (so they accumulate across blocks).
- Numbers `RawLine.line` 1-based **within the block body** (not source-line — the gutter shows block-internal numbers, so `lineN` matches).
- Returns `{ rows, total, identifierNames, multiWordNames }`.

### 4.3 Two-pass evaluation for `total`

```
evaluateBlock(parser, body, percVars, mwVars):
  rawLines = splitIntoLines(body)            ← block-internal 1-based numbering
  hasTotal = body.includes("total")          ← string fast-path

  if !hasTotal:                              ← common case: single pass
    rows = [evaluateLine(line, parser, ...) for line in rawLines]
    return { rows, total: computeTotal(rows), ... }

  // total path: snapshot, pass 1, restore, set total, pass 2
  snapshot = parser.getAll()                 ← shallow clone of scope object
  pass1Rows = [evaluateLine(line, parser, ...) for line in rawLines]
  pass1Sum = sum of pass1Rows where kind === "value" && finite numeric
                                             ← total-referencing rows fail in pass 1 → are kind:"comment" → naturally excluded

  parser.clear()
  for (k, v) of snapshot: parser.set(k, v)   ← rollback
  parser.set("total", pass1Sum)              ← Σ from pass 1's value rows

  pass2Rows = [evaluateLine(line, parser, ...) for line in rawLines]

  // Derived-row rule: rows that reference `total` (resolved in pass 2)
  // don't contribute to Σ. They display their resolved value but are
  // "derivations of" total, not "additions to" it. This keeps Σ === total.
  finalTotal = computeTotal(pass2Rows, { excludeTotalRefs: true })
  return { rows: pass2Rows, total: finalTotal, ... }
```

`computeTotal` accepts an optional `excludeTotalRefs` flag. When set, value rows whose source matches `\btotal\b` are skipped during summation. The result is that `finalTotal` equals `pass1Sum` (modulo formatting), guaranteeing the displayed Σ row equals what `total` resolved to inside the block.

`percVars`, `mwVars`, `identifierNames`, and `multiWordNames` are NOT rolled back between passes — they accumulate across both passes. This is safe because the mutations are idempotent (`Set.add` and `Map.set` with the same key/value), so pass 2's reassignments produce the same final state as pass 1's.

The fast-path skip means most blocks are exactly as cheap as today. Only blocks that mention `total` do 2× work — and the cost is still negligible on typical block sizes.

### 4.4 Isolation opt-out

```
isReckonIsolated(text):
  parses frontmatter; returns true iff `reckon-isolated: true` is present
```

Same parsing strategy as `isReckonSheet`. When true, `reckonBlockWidget` returns `renderSheet(evaluate(bodyText))` exactly as today — no continuous-mode plumbing engages.

## 5. Block discovery (`parser.ts:extractBlocks`)

```ts
export interface ExtractedBlock {
  body: string;        // verbatim block contents (no leading or trailing newline)
  startLine: number;   // 1-based source line of the opening fence (for diagnostics)
}

export function extractBlocks(text: string): ExtractedBlock[];
```

**Logic:**

1. Strip frontmatter (same logic as `extractMathLines`).
2. Walk the remaining lines. When a line matches `^```reckon\b`, start collecting body lines until the next `^```` line. (Allow but ignore any fence info on the opening line — keeps room for future `'''reckon isolated` syntax.)
3. Body = collected lines joined with `\n`. Empty if fence is immediately closed.
4. Non-`reckon` fences (` ```js `, ` ```python `, ...) are skipped — neither extracted nor crossed for `reckon` matching.

**Edge cases:**

- Unterminated `reckon` fence: include the rest of the document as one block's body. Pragmatic; matches `extractMathLines`'s frontmatter handling.
- Back-to-back fences (`'''reckon\n...\n'''\n'''reckon\n...`): produces two blocks.

## 6. Lexer change

Add `"totalref"` to `TokenKind`. Insertion point in `tokenize()` — immediately after the `linref` check, before identifier/unit lookups:

```ts
const w = wordM[0];
let kind: TokenKind;
if (KEYWORDS.has(w)) kind = "kw";
else if (/^line\d+$/.test(w)) kind = "linref";
else if (w === "total") kind = "totalref";          // NEW
else if (identifiers.has(w)) kind = "id";
else if (isUnit(w)) kind = "unit";
else kind = "id";
```

Order matters: `totalref` precedes the user-identifier check so a user-defined `total` variable doesn't shadow the reference semantics. Case-sensitive, matching the `linref` rule (`Total`, `TOTAL` remain plain ids).

**Reserved-word behavior on assignment.** A line like `total = 5` is allowed and behaves as a normal mathjs assignment — same as `ans = 5` and `line5 = 5` do today (which the engine doesn't currently special-case). The consequence in two-pass mode: pass 2 starts with `parser.set("total", Σ)`, then walks the rows; if row M is `total = 5`, every row N > M sees `total = 5` instead of Σ. Rows N < M see Σ. This row-split behavior is a quirky consequence of the two-pass model, but it's predictable and parallels how `lineN` and `ans` already behave when reassigned. We accept it for V1 and don't add explicit forbid-logic. The verification page demonstrates the recommended pattern (don't reassign `total`).

## 7. Render changes

Tiny. The render layer doesn't know about cross-block flow — it consumes an `EvaluateResult` exactly as today.

**Token coloring.** Add `.t-totalref` to the existing CSS palette, matching `.t-linref`'s gold/yellow:

```css
.t-totalref { color: #a67c00; }
@media (prefers-color-scheme: dark) {
  .t-totalref { color: #ffd866; }
}
```

(Same hex as `linref` — `total` is the same flavor of reserved-reference identifier; sharing the color reinforces "this is a reckon-engine reference, not a user variable.")

**Σ row.** Unchanged. Already styled in #12 with the `Σ` glyph in the gutter and the running total in the result column. The new behavior is that the displayed Σ value is now also accessible as `total` in the source.

**`data-references` and hover-pair.** Unchanged. `total` doesn't reach across rows the way `lineN` does — referencing `total` is conceptually "reference the footer row," and the footer doesn't have a `data-line`. Leaving this out keeps render simple; a future iteration could add a Σ-row hover-pair if useful.

## 8. Plug.ts change

```ts
export async function reckonBlockWidget(
  bodyText: string,
  _pageName: string,
): Promise<{ html: string; script: string }> {
  const text = await editor.getText();
  if (isReckonIsolated(text)) {
    return renderSheet(evaluate(bodyText));
  }
  const pageResult = evaluatePageContinuous(text);
  const block = findBlockByBody(pageResult.blocks, bodyText);
  if (!block) {
    // Defensive — body text didn't match any extracted block (very rare;
    // could happen if SilverBullet calls the widget mid-edit with a stale
    // body). Fall back to isolated eval to avoid blank panels.
    return renderSheet(evaluate(bodyText));
  }
  return renderSheet(toEvaluateResult(block));
}
```

`findBlockByBody` matches by **normalized** body text (trim trailing newline, normalize CRLF→LF — same normalization applied by `splitIntoLines`), taking the first occurrence on the page. This is the documented limitation for duplicate-body blocks. SilverBullet may pass `bodyText` with or without a trailing newline; normalizing both sides guarantees the comparison works either way.

`toEvaluateResult(block)` converts `BlockEvalResult` → `EvaluateResult` (the structures are nearly identical; just a shape adapter).

`onPageEvent` and `runPanelRefresh` unchanged. The page panel keeps using `evaluate(text)` on the full page text, evaluating non-fenced lines only.

## 9. Testing

| Surface | New tests |
|---|---|
| `engine.test.ts` | `evaluatePageContinuous`: cross-block variable flow; cross-block `ans` flow; block-internal `lineN` reset (block 2's `line1` doesn't pick up block 1's first row); `total` resolves to block's Σ; `total` doesn't leak (next block's `total` → comment); two-pass behavior (e.g. block `100`, `200`, `total - 50` → Σ=300, `total`=300, row 3 displays 250 but doesn't add to Σ); derived-row exclusion (`total - 50` row's 250 doesn't appear in Σ); pass-2 fast-path (block without `total` → exactly today's behavior); empty block; block with only comments; reserved-word reassignment (`total = 5` mid-block produces row-split behavior — rows before see Σ, rows after see 5). |
| `engine.test.ts` (isolated parity) | When frontmatter has `reckon-isolated: true`, behavior matches today's `evaluate(bodyText)` — variables and `ans` do NOT flow across blocks. |
| `lexer.test.ts` | `total` → `totalref`; `totalfoo` → `id` (no false match); `Total` → `id` (case-sensitive); `tot` → `id`; combined `total * 2` produces correct token sequence. |
| `parser.test.ts` | `extractBlocks`: finds `reckon` fences in source order; ignores `js`/`python`/other fences; handles back-to-back `reckon` fences; ignores frontmatter; preserves body verbatim (whitespace, blank lines); unterminated fence yields one block with rest-of-doc body. |
| `frontmatter.test.ts` | `isReckonIsolated`: `true` → true; `false` → false; missing → false; coexists with `reckon: true`; malformed YAML → false (defensive); flag-only-in-block-context → false (must be page-level). |
| `render.test.ts` | Snapshot refresh for `.t-totalref`; `total` source spans get `.t-totalref` class; non-`total` words like `Totally` don't. |

`reckonBlockWidget` async dispatch isn't unit-tested — needs `editor.getText` stubbed across two paths. Verified live via the verification pages instead. Same pattern as `runPanelRefresh` in #8/#12.

## 10. Out of scope

- **`pageTotal`** or any cross-block sum identifier. `total` is block-scoped only.
- **Per-block fence-info opt-in/out** (e.g. ` ```reckon isolated `). Frontmatter flag is the only opt-out for V1.
- **Cache / memoization** for cross-block evaluation. V1 re-evaluates from scratch per block-widget render.
- **Cross-block hover-pair highlighting.** Hover-pair from #12 stays `lineN`-only and block-internal.
- **Edit-safety warnings.** Broken cross-block refs silently classify as comment rows (existing behavior).
- **Page panel / block fusion.** Panel and blocks remain parallel timelines.
- **Slash command (#5) interaction.** Separate backlog issue.

## 11. Closeout playback

Per project rule, every issue closeout ships verification pages under `infra/space-seed/Tests/` (mirrored to `infra/space/Tests/`). This issue ships **two pages** because the opt-out flag is page-level frontmatter:

### `Cross-Block Continuous Verification.md`

`reckon: true` page (no isolated flag → continuous default). Demonstrates:

1. Variable flow: Block 1 defines `bill = 80`; Block 2 uses `bill` → 80.
2. `ans` flow: Block 1's last numeric carries into Block 2's first row using `ans`.
3. Block-internal `lineN`: a block where `line1 + line2` resolves to its own first two rows, not the page's.
4. `total` reference: a block where one row references `total` → resolves to that block's Σ.
5. Derived-row rule: in a block `100`, `200`, `total - 50` — Σ shows 300, the third row displays 250 (= total − 50), but Σ stays 300 (the derived row doesn't add to itself).
6. `total` doesn't leak: next block uses `total` → comment row (block-scoped).

### `Cross-Block Isolated Verification.md`

`reckon: true` + `reckon-isolated: true` page (opt-out preserves V1 isolation). Demonstrates:

1. Same Block 1 / Block 2 setup as the continuous page; this time `bill` and `ans` do NOT flow, so Block 2's references comment-out.
2. One-line link to the continuous page so the contrast is obvious.

Both pages use fenced ` ```reckon ``` ` blocks per the project rule (not bare full-page sheet bodies), with expected values inline as comments.

### Changelog

Prepended to `infra/space-seed/Changelog.md`:

> **What's new — Cross-block continuous mode + `total` reference (issue #13)**
>
> Three subsections: continuous mode default, `reckon-isolated: true` opt-out, `total` identifier. Fenced ` ```reckon ``` ` examples throughout.

### Issue close

`gh issue comment 13` requests live verification, leaves issue OPEN. User verifies in browser, then closes via `gh issue close 13`.

## 12. Known limitations

- **Duplicate-body blocks.** If the user has two `reckon` blocks with byte-identical bodies on the same page, both render with first-occurrence semantics — the second block sees the same prior-block state as the first. This is a SilverBullet codeWidget API limitation (the callback receives only `bodyText`, not block index or position). Acceptable for V1; rare in practice; documented on the verification page.
- **Async block widget on first render.** `reckonBlockWidget` becomes async (calls `editor.getText()`). SilverBullet may render a transient empty panel before the promise resolves on first load. If observed, mitigation is a synchronous fallback to today's isolated eval — but not implemented unless flicker is observed.

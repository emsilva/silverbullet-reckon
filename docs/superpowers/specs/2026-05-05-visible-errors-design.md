# Visible Errors — Design

**Status:** Design accepted (interactive brainstorming session), ready for implementation plan.
**Date:** 2026-05-05
**Author:** Mannu Silva (with Claude)
**Repo:** `github.com/emsilva/silverbullet-reckon`
**Issue:** #2 — "Visible-errors config: opt-in red highlighting for math typos"

## 1. Goal

Math-shaped typos (`5 + `, `bil * 1.2` with a misspelled identifier) silently render as grey comment rows today, indistinguishable from intentional prose. Users debugging a sheet have no signal that they typed something invalid.

Add an opt-in mode where lines that fail mathjs parse render as a new `kind: "error"` row with a pink wash + red italic source — visible at a glance when scanning the sheet. Default behavior unchanged.

## 2. Decisions log

| # | Decision | Choice |
|---|---|---|
| Q1 | Scope: which surfaces respect the flag | **A — both panel and blocks.** One page-level flag drives the catch branch on both surfaces. Authors of prose-rich `reckon: true` pages who turn the flag on must comment-escape narrative paragraphs with `//` to avoid red rows. |
| Q2 | Visual treatment | **D — combo (background wash + red italic source).** Mirrors the comment-row treatment cue (italic, non-default color) but in red, plus a faint pink row background so errors stand out at a glance. Reuses the existing `.t-kw` Monokai Pro red (`#e14775` light, `#ff6188` dark) for palette coherence. |
| Q3 | Error message visibility | **A — source-only.** Mathjs error strings are often technical-noise (`Unexpected end of expression at character 4`); the source line is what the user actually fixes. Tooltip (B) and inline message (C) deferred to future iterations. |
| Q4 | Architecture: where the flag is read | **A — threaded bool from `plug.ts`.** Engine functions stay pure (`evaluate(text, options?)`, `evaluatePageContinuous(text, options?)`); plug.ts reads `isReckonShowErrors(text)` and passes `{ showErrors }`. Engine tests pass the bool directly without crafting frontmatter envelopes. |
| Q5 | Detection scope: which branches flip to error | **Catch branch only.** Only `parser.evaluate()` throws (engine.ts:321 today). Explicit comment escapes (`//`, `#` — engine.ts:303) stay as `kind: "comment"` regardless of the flag. ATX headings, blanks, and successful evals stay unchanged. |

## 3. Architecture & components

Engine + render + frontmatter additions, no new files. The flag threads from plug.ts down to `evaluateLine`'s catch branch.

```
src/
├── frontmatter.ts          ← MODIFIED — new isReckonShowErrors(text) helper
├── frontmatter.test.ts     ← MODIFIED — isReckonShowErrors tests
├── engine.ts               ← MODIFIED — new "error" ResultRow variant; { showErrors } option threaded through evaluate, evaluatePageContinuous, evaluateBlock, evaluateRows, evaluateLine
├── engine.test.ts          ← MODIFIED — new describe blocks for show-errors mode + default-mode parity
├── render.ts               ← MODIFIED — new rowHtml branch for kind: "error"; .error CSS rule
├── render.test.ts          ← MODIFIED — error-row HTML structure tests
└── plug.ts                 ← MODIFIED — read isReckonShowErrors; pass { showErrors } to evaluate / evaluatePageContinuous in both paths
```

No changes to `parser.ts`, `lexer.ts`. Errors live entirely in the engine→render seam.

## 4. Data flow

### 4.1 Threading the flag

```
plug.ts
  ├─ runPanelRefresh:
  │    text = await editor.getText()
  │    showErrors = isReckonShowErrors(text)
  │    result = evaluate(text, { showErrors })
  │    renderSheet(result)
  │
  └─ reckonBlockWidget:
       text = await editor.getText()
       showErrors = isReckonShowErrors(text)
       if isReckonIsolated(text):
         renderSheet(evaluate(bodyText, { showErrors }))     ← isolated path
       else:
         page = evaluatePageContinuous(text, { showErrors })  ← continuous path
         renderSheet(toEvaluateResult(findBlock(page, bodyText)))
```

Both engine entry points take an optional `{ showErrors?: boolean }` (default `false`), forward it to `evaluateBlock` / `evaluateRows`, which forward it to `evaluateLine`. No other engine signatures change beyond accepting and forwarding the option.

### 4.2 The decision rule (in `evaluateLine`)

`evaluateLine` produces a `comment` row from two distinct branches today:

- **Line 303** — explicit comment escape: `if (trimmed.startsWith("#") || trimmed.startsWith("//"))`. The user *intentionally* wrote a comment.
- **Line 321** — catch branch: `parser.evaluate()` threw. The user wrote something they expected to be math, but it didn't parse.

Only the **catch branch** flips to `error` when `showErrors === true`:

```ts
let value: unknown;
try {
  value = parser.evaluate(exprToEvaluate);
} catch {
  return showErrors
    ? { kind: "error", line: raw.line, source: raw.text }
    : { kind: "comment", line: raw.line, source: raw.text };
}
```

The explicit-escape branch (line 303) stays unchanged — `// foo` and `# bar` are *always* comments, never errors. ATX headings (line 290-296), blank lines, and successful evaluations also stay unchanged. The principle: error means "you typed math and it didn't parse." Explicit prose is not an error.

### 4.3 The new `ResultRow` variant

```ts
export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | { kind: "error"; line: number; source: string }    // NEW
  | { kind: "heading"; line: number; depth: number; text: string }
  | { kind: "value"; ... }
  | { kind: "assignment"; ... };
```

Same shape as `comment` — just `line` and `source`. No mathjs error message stored (Q3 decided source-only).

### 4.4 Σ behavior

`computeTotal` already only sums `kind === "value"` rows, so error rows are naturally excluded — no change. A sheet with errors silently produces a Σ across the value rows that did parse. We don't surface a "your sheet has errors that aren't counted" warning (out of scope; future iteration).

### 4.5 `lineN` referenceability

Error rows have no numeric value, so `parser.set(\`line${n}\`, ...)` never fires for them. A subsequent row that references an error line (`line5 + 100` where line 5 failed) throws → becomes another error row in show-errors mode, or a comment in default. Cascading is natural and needs no special handling.

## 5. Frontmatter helper (`isReckonShowErrors`)

Mirrors `isReckonIsolated` exactly:

```ts
const RECKON_SHOW_ERRORS_LINE_RE = /^reckon-show-errors:\s*true\s*$/;

export function isReckonShowErrors(text: string): boolean {
  const lines = text.split("\n");
  const fm = findFrontmatter(lines);
  if (!fm) return false;
  for (let i = fm.open + 1; i < fm.close; i++) {
    if (RECKON_SHOW_ERRORS_LINE_RE.test(lines[i])) return true;
  }
  return false;
}
```

Same parsing strategy: requires properly delimited frontmatter, no quoting, no indentation. Anything else returns false. Coexists with any combination of `reckon: true` and `reckon-isolated: true`.

## 6. Render changes

### 6.1 New `rowHtml` branch

Error rows are structurally identical to comment rows — same gutter + spanning source cell, no `data-references`, no clipboard:

```ts
case "comment":
  return `<tr class="comment" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
case "error":
  return `<tr class="error" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
```

No tokenization for error rows (same as comment) — the source didn't parse, so token-coloring would fight the "this is broken" signal. Just escape and dump.

### 6.2 CSS

Reuse the existing `.t-kw` Monokai Pro palette for the red — `#e14775` light, `#ff6188` dark. That hex is already in `render.ts` (line 52 light, line 101 dark) for keyword tokens; sharing it keeps the palette coherent and avoids inventing a one-off "error red."

```css
/* Light (default) */
tr.error td { background: rgba(225, 71, 117, 0.08); }
tr.error td.source { color: #e14775; font-style: italic; }

@media (prefers-color-scheme: dark) {
  tr.error td { background: rgba(255, 97, 136, 0.12); }
  tr.error td.source { color: #ff6188; }
}
```

**No opacity** on error source (comment rows use 0.6 to subdue; errors should *stand out*, not fade). **Italic** to signal "non-data row" — same treatment cue as comment, just a different color.

### 6.3 Interaction with hover-pair (`linref-pair`)

If a value row references an error line (`data-references="5"` where line 5 is an error), hovering the value row briefly applies `linref-pair` on top of `error` on line 5. The `linref-pair` rule sits later in the CSS, so its purple wash temporarily wins; mouse-leave reverts to red. Pre-existing precedent (hover-pair already overrides comment/heading row backgrounds the same way). Rare in practice (typos *and* references to them).

### 6.4 Σ row, gutter referenceability — unchanged

`computeTotal` already filters to `kind === "value"`; error gutter is non-referenceable (`<td class="gutter">`, not `<td class="gutter referenceable">`) since there's no numeric value to copy as `lineN`. Same as comment.

## 7. Plug.ts change

```ts
export async function reckonBlockWidget(
  bodyText: string,
  _pageName: string,
): Promise<{ html: string; script: string }> {
  const text = await editor.getText();
  const showErrors = isReckonShowErrors(text);
  if (isReckonIsolated(text)) {
    return renderSheet(evaluate(bodyText, { showErrors }));
  }
  const pageResult = evaluatePageContinuous(text, { showErrors });
  const block = findBlockByBody(pageResult.blocks, bodyText);
  if (!block) {
    return renderSheet(evaluate(bodyText, { showErrors }));
  }
  return renderSheet({
    rows: block.rows,
    total: block.total,
    identifierNames: pageResult.identifierNames,
    multiWordNames: pageResult.multiWordNames,
  });
}

async function runPanelRefresh(): Promise<void> {
  const text = await editor.getText();
  if (!isReckonSheet(text)) {
    await editor.hidePanel(PANEL_LOCATION);
    return;
  }
  const showErrors = isReckonShowErrors(text);
  const result = evaluate(text, { showErrors });
  const { html, script } = renderSheet(result);
  await editor.showPanel(PANEL_LOCATION, PANEL_MODE, html, script);
}
```

`onPageEvent` and `toggleSheetCommand` unchanged. No new commands.

## 8. Testing

| Surface | New tests |
|---|---|
| `engine.test.ts` | `evaluate(text, { showErrors: true })`: failed parse → `kind: "error"`. `evaluate(text)` (no opts): failed parse → `kind: "comment"` (parity with today). Explicit `// foo` and `# bar` → `kind: "comment"` even with `showErrors: true` (not flipped to error). ATX heading → `kind: "heading"` with flag on. Blank line → `kind: "blank"` with flag on. Successful eval → `kind: "value"` / `kind: "assignment"` with flag on. `computeTotal` excludes error rows (Σ unchanged when an error sits among value rows). `evaluatePageContinuous(text, { showErrors: true })`: errors in block N don't crash subsequent blocks. `lineN` referencing an error line cascades to another error row. |
| `frontmatter.test.ts` | `isReckonShowErrors`: standalone `true` → true; `false` → false; missing → false; coexists with `reckon: true` + `reckon-isolated: true`; quoted `"true"` → false; nested-key → false; body-context (after closing `---`) → false; empty doc → false. Mirrors the `isReckonIsolated` test set. |
| `render.test.ts` | New error row HTML: `tr.error` with `data-line`, gutter (non-referenceable), source cell `colspan=2`, no `data-references`, no `data-clipboard-value`. XSS escape of `source` (mirrors existing comment-row test). Snapshot refresh for the new CSS rules. |

`plug.ts` (the actual flag read + threading) is exercised by the verification page, not unit-tested. Same precedent as `isReckonIsolated` and the async block-widget dispatch.

## 9. Closeout playback

### `Visible Errors Verification.md`

`reckon: true` + `reckon-show-errors: true` page under `infra/space-seed/Tests/` (mirrored to `infra/space/Tests/`). Demonstrates:

1. A typo'd math line (`5 +`) → error row (red wash, red italic source).
2. An explicit comment (`// foo`) sitting near the typo → still grey, not red (the rule "explicit prose is not an error").
3. A successful math line → unaffected by the flag.
4. Σ excludes the error row — the displayed total only sums the value rows.
5. `lineN` referencing the error line cascades to a second error row.
6. Footer note: "To verify default behavior, edit frontmatter to remove `reckon-show-errors: true` and run `Plugs: Reload`. The same lines should now render as silent grey comments."

The page uses fenced ` ```reckon ``` ` blocks per the project rule, with expected values inline as `//` annotations per the project rule.

### Changelog

Prepended to `infra/space-seed/Changelog.md`:

> **What's new — Visible errors (issue #2)**
>
> Opt-in via `reckon-show-errors: true` in frontmatter. Lines that fail to parse render with a pink wash + red italic source instead of the silent grey comment fallback. Explicit comments (`//`, `#`) and ATX headings (`# Foo`) are unaffected — only failed-parse lines flip to errors.

### Issue close

`gh issue comment 2` requests live verification, leaves issue OPEN. User verifies in browser by toggling the flag, then closes via `gh issue close 2`.

## 10. Out of scope

- **Mathjs error message in tooltip / inline.** Decided source-only (Q3). Future iteration if real users ask.
- **Per-line / per-block error opt-in** (e.g. ` ```reckon show-errors ` fence info). Frontmatter flag is the only activation mechanism for V1.
- **Error styling for non-fatal warnings** (e.g. unit mismatches that mathjs accepts but produce surprising results). Scope is parse failures only.
- **Σ-with-errors warning glyph or annotation.** When error rows are present, Σ silently sums only the value rows. Future iteration.
- **Cascading-error visual linking.** A `line5 + line6` row where line 5 is an error becomes its own error; we don't visually link the cascade. Source-of-truth is the original typo.
- **Click-to-jump from error row to source location.** No editor integration — the gutter line number is informational only.

## 11. Known limitations

- **Prose interleaved with math on `reckon: true` panel pages.** Authors who enable `reckon-show-errors: true` on a panel page with prose paragraphs will see those paragraphs as red error rows unless they're escaped with `//`. This is the intentional trade-off from Q1: one flag, uniform behavior across both surfaces. Documented in the verification page footer.
- **No diagnostic detail.** The user sees the source they typed, not why mathjs rejected it. For most typos this is enough; for ambiguous cases ("did `bil * 1.2` fail because `bil` is undefined or because of operator precedence?") they have to reason from the source. Future iteration may add a hover tooltip with the mathjs message.

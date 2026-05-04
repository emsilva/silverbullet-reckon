# Reckon Visual Polish — Design

**Status:** Design accepted, ready for implementation plan.
**Date:** 2026-05-04
**Author:** Mannu Silva (with Claude)
**Repo:** `github.com/emsilva/silverbullet-reckon`
**Issue:** #3 — "Visual polish: source syntax coloring, headings, click-to-copy results"

## 1. Goal

Bring Reckon's panel from "functionally correct but visually flat" to a polished
Soulver-style surface. Three render-side improvements that ship together because
they all touch the iframe HTML/CSS/script:

1. **Tokenized source-side syntax coloring** with the Dracula palette in dark
   mode and its official Alucard counterpart in light mode.
2. **ATX-form Markdown headings** (`# Q2 budget`, `## sub`, etc.) rendered as
   bold full-width section labels with no result column for that row.
3. **Click-to-copy** on result cells, copying the closest underlying numeric
   value (not the formatted display string) and confirming via SB's
   `editor.flashNotification`.

## 2. Decisions log

The following choices were made during brainstorming and are now fixed:

| # | Decision | Choice |
|---|---|---|
| Q1 | Heading vs comment-escape conflict | **A** — ATX-shaped lines (`^#{1,6}\s+\S`) become heading rows, superseding the comment-escape rule from issue #1 for those lines. Other `#`-prefixed and all `//` lines stay comments. |
| Q2 | What lands in the clipboard on click | **B** — the closest underlying number (canonical numeric form): `300 + current tax` → `360`, `100 km in miles` → `62.13711922373339`, `100,000 + 50` → `100050`, `tax = 20%` → `0.2`, `salary = 200000` → `200000`, total `485` → `485`. |
| Q3 | Token classification scope | Six categories: numbers, identifiers, unit names, operators (`+ - * / ^ = ( )`), keywords (`of`, `in`, `to`), `%`. `between` is deferred until #9 (NL sugar) actually wires it as a keyword; lexer doesn't claim ownership it can't deliver. Assignment LHS and references are colored the same — single regex-only pass, no semantic awareness. |
| Q4 | Color palette | **Dracula** (dark) + **Alucard** (light, Dracula's official sibling). Theme-swap via `@media (prefers-color-scheme)` — no JS. |
| Q5 | Heading visual treatment | Uniform across depths 1-6 (bold, full-width, currentColor border-bottom). No size scaling. Reckon sheets rarely have heading hierarchy; uniform keeps the panel calm. |
| Q6 | Click-to-copy hover affordance | `cursor: pointer` + faint background tint on hover (Dracula `#44475a` low-opacity in dark; faint gray in light). |
| Q7 | Clickable cells | Result column on `value`, `assignment`, and `total` rows. Heading/comment/blank rows have no result column → not clickable. |
| Q8 | Flash notification text | `editor.flashNotification("Copied " + value)` — short, includes the value so the user gets a tail-of-eye confirmation. |
| Q9 | Click handler script wiring | `renderSheet()` populates its currently-empty `script` slot with a self-contained click handler. Handler reads `data-clipboard-value` on the cell, calls `navigator.clipboard.writeText(...)`, then calls back to host via SB's iframe API for the flash notification. |
| Q10 | Where the lexer lives | New module `src/lexer.ts`. Pure (string in, token-array out). No SB syscalls, no DOM. Imports the known-units list from mathjs. |
| Q11 | Forward references in lexer | If a row references a multi-word var defined on a later line, the lexer mis-colors the reference. Acceptable: such lines don't evaluate either, so they're already comment rows by the time render runs. |
| Q12 | `/redesign-skill medium` integration | Plan-level step between core implementation and closeout. The controller (Claude) invokes the skill against the live panel, applies approved suggestions back into `src/render.ts`, commits as one polish pass. |

## 3. Architecture & components

One new file, two existing modules modified, one untouched.

```
src/
├── lexer.ts          ← NEW — pure tokenizer
├── lexer.test.ts     ← NEW
├── engine.ts         ← MODIFIED — heading row kind, clipboard value, expose name sets
├── engine.test.ts    ← MODIFIED
├── render.ts         ← MODIFIED — token spans, Dracula/Alucard CSS, click script
├── render.test.ts    ← MODIFIED — tokenized output assertions, click attrs, snapshots
└── parser.ts         ← UNCHANGED
```

The lexer is fully decoupled from Silverbullet — it imports only from `mathjs` (for the known-units list) and is unit-testable like the other pure modules.

## 4. Data flow

The existing two-call pipeline (`evaluate(text) → renderSheet(result)`) is preserved. Two changes:

- **`EvaluateResult` gains two `Set<string>` fields** (`identifierNames`, `multiWordNames`) so the renderer can pass them to the lexer for source-side disambiguation.
- **`renderSheet()` returns a non-empty `script`** for the first time, containing the click handler.

```
evaluate(text)
  ├─ extractMathLines (parser, unchanged)
  ├─ for each row:
  │    evaluateLine — now order is:
  │      blank → heading → comment-escape → assignment/expr
  │    populates rows[], identifierNames, multiWordNames as it goes
  │    each value/assignment/total row gets a precomputed `clipboard` string
  └─ returns { rows, total, identifierNames, multiWordNames }
                              │
                              ▼
renderSheet(result)
  ├─ STYLE block (Dracula + Alucard, theme-switched via @media)
  ├─ for each row:
  │    rowHtml(row, { identifiers, multiWord }):
  │      heading → <tr class="heading"><td colspan=2>...</td></tr>
  │      comment → unchanged
  │      blank   → unchanged
  │      value/assignment → <td class="source">{tokenize → spans}</td>
  │                         <td class="result" data-clipboard-value="...">...</td>
  │    total → <td.result data-clipboard-value="...">...</td>
  ├─ script: click-handler IIFE
  └─ returns { html, script }
```

## 5. Lexer module (`src/lexer.ts`)

### Types

```ts
export type TokenKind = "num" | "id" | "unit" | "op" | "kw" | "pct" | "ws" | "text";
export type Token = { kind: TokenKind; text: string };

export interface TokenizeOptions {
  identifiers: Set<string>;  // single-word var names in scope
  multiWord: Set<string>;    // multi-word var names (original spellings, space-normalized)
}

export function tokenize(source: string, options: TokenizeOptions): Token[];
```

### Tokenization order (greedy, longest-match)

1. **Multi-word names**, sorted longest-first. Match before standard tokens so `current tax` becomes one `id` token. Match form: `\b<word1>\s+<word2>(\s+<word3>)*\b` with each word `escapeRegex`'d and the inter-word whitespace allowed as `\s+` so a tab-separated reference still matches a space-registered name.
2. **Numbers**: `/\d+(?:\.\d+)?/`
3. **Percent**: literal `%`
4. **Operators**: any of `+`, `-`, `*`, `/`, `^`, `=`, `(`, `)` (single chars).
5. **Keywords**: `/\b(of|in|to)\b/`
6. **Word**: `/[A-Za-z_][A-Za-z0-9_]*/`. Disambiguation:
   - in `options.identifiers` → `id`
   - else lookup in mathjs's known-units (`math.Unit.UNITS` if available; fallback `math.Unit.isValuelessUnit(name)`) → `unit`
   - else → `id` (fallback: unrecognized words colored as user variables — better than no color at all on user-typed identifiers)
7. **Whitespace**: pass through as `ws` tokens (no styling, just preserves layout).
8. **Anything else**: fall through as `text` (rare; e.g., stray punctuation).

### Output

The renderer maps `TokenKind` → CSS class:
- `num` → `t-num`, `id` → `t-id`, `unit` → `t-unit`, `op` → `t-op`, `kw` → `t-kw`, `pct` → `t-pct`
- `ws` and `text` are emitted as raw escaped text (no wrapping span)

## 6. Engine changes (`src/engine.ts`)

### `evaluateLine` — new ordering

```
trim
  ├─ "" → blank
  ├─ matches /^#{1,6}\s+\S/ → heading{depth = match[1].length, text = trimmed-content-after-hashes}
  ├─ starts with "#" or "//" → comment
  ├─ assignment? canonicalize, evaluate, register
  └─ math expr? evaluate, format, populate clipboard
```

The heading regex `^#{1,6}\s+\S` requires 1-6 hashes, at least one whitespace, then a non-whitespace character. `# `, `# ` (trailing space only), and `####### too many` all fail; `# title` passes with depth 1.

### `ResultRow` union

```ts
export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | { kind: "heading"; line: number; depth: number; text: string }                               // NEW
  | { kind: "value"; line: number; source: string; result: string; numeric?: number; clipboard: string }
  | { kind: "assignment"; line: number; source: string; varName: string; result: string; numeric?: number; clipboard: string };
```

### `TotalRow`

```ts
export interface TotalRow {
  value: string;
  clipboard: string;  // NEW — unformatted total (no thousand separators)
}
```

### Clipboard value computation

For each `value` / `assignment` / `total` row:

| Row content | `clipboard` value |
|---|---|
| Plain number (e.g. `100 + 50` → `150`) | `String(numeric)` — no thousand separators |
| Percent-literal assignment (`tax = 20%`) | `String(numeric)` (i.e. `"0.2"`) |
| Percent expression (e.g. `100 + 20%` → `120`) | `String(numeric)` (`"120"`) |
| Unit value (`100 km in miles` → `62.137… miles`) | `String(unit.toNumber(unit.formatUnits()))` — extracts the numeric in the unit's display form. If `toNumber` fails, fall back to extracting the leading number via regex from `formatted.text`. |
| Total | `String(sum)` — unformatted |

The `clipboard` field is `string`, never undefined, so the renderer can unconditionally emit `data-clipboard-value`. For rows where the underlying value isn't a finite number (e.g., a mathjs `ResultSet`), `clipboard` becomes the raw display string — best-effort.

### Name set exposure

`evaluate()` returns `identifierNames: Set<string>` and `multiWordNames: Set<string>` on `EvaluateResult`. They are populated as the engine processes assignments:

- `identifierNames`: every `assignment.varName` that is a single-word identifier (no spaces).
- `multiWordNames`: every `assignment.varName` containing a space (the original-spelling form, already whitespace-normalized to single spaces by `detectAssignment`).

These sets are the same scope mathjs uses; the lexer reads them per-row at render time.

## 7. Renderer changes (`src/render.ts`)

### CSS — both palettes in one stylesheet

```css
html { color-scheme: light dark; }
body { font-family: var(--ui-font, ui-monospace, ...); margin: 0; padding: 12px; font-size: 13px; }
table.reckon { width: 100%; border-collapse: collapse; }

/* Light mode (Alucard) */
:root, body { background: var(--root-background-color, #f1f1f3); color: var(--root-color, #1f1f1f); }
.t-num  { color: #644ac9; }
.t-id   { color: #14710a; }
.t-unit { color: #036a96; }
.t-op   { opacity: 0.45; }
.t-kw   { color: #a3144d; font-style: italic; }
.t-pct  { color: #a34d14; }
tr.comment td { color: #635c81; font-style: italic; }
tr.heading td { font-weight: 700; padding-top: 8px; padding-bottom: 5px; border-bottom: 1px solid currentColor; }
tr.total  td { border-top: 1px solid currentColor; padding-top: 6px; font-weight: 600; }
td.result[data-clipboard-value] { cursor: pointer; }
td.result[data-clipboard-value]:hover { background: rgba(0, 0, 0, 0.06); }

/* Dark mode (Dracula) — overrides via media query */
@media (prefers-color-scheme: dark) {
  :root, body { background: var(--root-background-color, #282a36); color: var(--root-color, #f8f8f2); }
  .t-num  { color: #bd93f9; }
  .t-id   { color: #50fa7b; }
  .t-unit { color: #8be9fd; }
  .t-op   { opacity: 0.55; }
  .t-kw   { color: #ff79c6; }
  .t-pct  { color: #ffb86c; }
  tr.comment td { color: #6272a4; }
  td.result[data-clipboard-value]:hover { background: rgba(255, 255, 255, 0.08); }
}
```

The exact palette will be refined by the `/redesign-skill medium` polish pass before closeout. The list above is the starting point.

### Row HTML

```ts
function rowHtml(row: ResultRow, options: TokenizeOptions): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank"><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment"><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      return `<tr class="heading"><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
    case "assignment":
      return `<tr class="${row.kind}"><td class="source">${tokensToHtml(tokenize(row.source, options))}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
  }
}

// Total row:
const totalHtml = result.total
  ? `<tr class="total"><td class="label">Total</td><td class="result" data-clipboard-value="${escapeHtml(result.total.clipboard)}">${escapeHtml(result.total.value)}</td></tr>`
  : "";
```

`tokensToHtml(tokens)` joins each token's HTML form, where a token of kind `K` becomes `<span class="t-K">${escapeHtml(text)}</span>` for styled kinds and a bare escaped text segment for `ws`/`text`.

### Script (the iframe-side click handler)

```js
(function () {
  document.addEventListener("click", function (e) {
    var cell = e.target.closest("[data-clipboard-value]");
    if (!cell) return;
    var value = cell.getAttribute("data-clipboard-value");
    if (!value) return;
    navigator.clipboard.writeText(value).then(function () {
      if (typeof api === "function") {
        api("editor.flashNotification", "Copied " + value);
      }
    }).catch(function () {});
  });
})();
```

Rendered as the `script` field of `renderSheet`'s return value. SB injects `api` as a global into codeWidget iframes — exact bridge surface verified at implementation time by reading another SB plug that uses `editor.flashNotification` from a panel/widget script (the `treeview` and `mindmap` plugs are local references). If the bridge surface differs from `api(name, ...args)`, the implementer adjusts the script body to match.

## 8. Testing

Three layers, all unit tests via vitest. No new test files beyond `src/lexer.test.ts`.

### `src/lexer.test.ts` (new, ~10 tests)

Each token category in isolation: `tokenize("100", ...)` → one `num` token; `tokenize("+", ...)` → one `op`; etc. Composite expressions: `100 + 20%` → `[num, ws, op, ws, num, pct]`. Multi-word longest-match: `tokenize("100 + current tax", { multiWord: new Set(["current tax"]) })` produces a single `id` token for `current tax`. Disambiguation: a name in `identifiers` beats a unit-name match. Empty string → `[]`. All-whitespace → one `ws` token. Word that's neither identifier nor unit → `id` (fallback).

### `src/engine.test.ts` (extension, ~10 tests)

Heading detection: `# Q2 budget` → `{ kind: "heading", depth: 1, text: "Q2 budget" }`; `### sub` → depth 3; `###### deepest` → depth 6; `####### too many` → comment (regex requires 1-6); `# ` (just hash + space, no content) → comment; `#nospace` → comment; `// note` → comment (unaffected). Heading does NOT register in `identifierNames`/`multiWordNames`. Clipboard rules: `100 + 50` → clipboard `"150"`; `100,000 + 50` doesn't apply (input has no thousand separator) — but `salary = 200000` → clipboard `"200000"`; `tax = 20%` → clipboard `"0.2"` (the underlying decimal); `100 km in miles` → clipboard `"62.13711922373339"` (numeric stripped from Unit). Total clipboard unformatted. `identifierNames` and `multiWordNames` populated correctly across mixed sheets.

### `src/render.test.ts` (extension, ~5 tests + snapshots)

Tokenized source emits the expected `<span class="t-X">` markup in document order. Heading row markup uses `colspan="2"` and contains the heading text only (no hash markers). `data-clipboard-value` present on value/assignment/total result cells with the expected (unformatted) string; absent on comment/heading. `script` field is non-empty and contains the click-handler IIFE. The pure-render snapshot updates to include both Dracula and Alucard palettes plus the `data-clipboard-value` attributes. The integration snapshot from issue #11 updates similarly — its diff is the canonical "before/after" for this issue.

### Visual smoke (manual, in `Visual Polish Verification.md`)

The verification page exercises: a heading; a row mixing every token category; a clickable assignment, value, and total. Closeout asks the user to (1) toggle SB dark mode and confirm both palettes look right, (2) click each result and confirm the right value lands in clipboard plus the flash notification appears.

## 9. Closeout

Per memory, every issue ships a verification page under `infra/space-seed/Tests/`. For #3 it's a `reckon: true` page (unlike #11's plain doc) since the verification IS observable in a Reckon panel.

Plan tasks end like this (writing-plans will detail each):

1. Lexer module + tests
2. Engine: heading row + clipboard values + extended `EvaluateResult`
3. Renderer: token spans + Dracula/Alucard CSS + click script + tests
4. Build + dev:link + manual smoke (heading, hover affordance, click)
5. **`/redesign-skill medium` polish pass.** Controller invokes the skill against the live panel HTML. Approved suggestions are folded back into `src/render.ts` (CSS/markup edits), tests + snapshot regenerated, committed as `style(render): apply redesign-skill polish pass`. If the skill produces nothing actionable, no commit for this step — the plan task simply records "ran, no changes."
6. Closeout: Changelog entry; `infra/space-seed/Tests/Visual Polish Verification.md` (mirrored to live `infra/space/Tests/`); commit; `gh issue comment 3` requesting verification.

## 10. Out of scope (explicitly deferred)

- **`between` keyword**: lexer doesn't claim it. Lands when issue #9 wires it as a real keyword. Adding the regex now would suggest functionality that doesn't exist.
- **Locale-aware formatting**: still issue #4. The `clipboard` value is in the en-US canonical form regardless of display locale; once #4 lands, `result` (display) localizes but `clipboard` stays en-US-canonical so external paste targets get a clean number.
- **Visible-error rows**: still issue #2. Comment rows continue to absorb parse failures.
- **Currency tokens**: issue #7 will add `$`/`€`/etc. as their own token kind.
- **Keyboard shortcut for copy**: not in scope. Only mouse-click copies. If users want keyboard, add later.
- **Animated flash on copy** (CSS keyframe pulse on the cell): considered, dropped. SB's flashNotification is the canonical confirmation channel.

## 11. Risks and mitigations

- **`api()` bridge surface mismatch.** If SB's iframe API isn't named `api(...)` or doesn't take the argument shape we assume, `editor.flashNotification` won't fire. The clipboard write still works (it's pure browser API). Mitigation: implementer verifies by reading `treeview` or `mindmap` plug scripts before writing ours; the script's catch arm prevents thrown errors from cascading.
- **Forward references in lexer.** A line referencing a multi-word name defined LATER in the sheet lexes as two id tokens. Acceptable: that line is already a comment row (mathjs can't resolve the symbol). The visual mismatch is invisible because comment rows aren't tokenized.
- **mathjs `Unit.UNITS` shape changes.** mathjs minor versions could rename the export or change the lookup API. Mitigation: lexer wraps the lookup in a `try/catch` and falls back to "every alphabetic word is `id`" — degraded coloring, not a crash.
- **Snapshot churn from `/redesign-skill` pass.** The redesign step is expected to update `render.test.ts.snap`. The plan's snapshot regeneration step is explicit, not a surprise.
- **Heading conflict with V1.x's comment-escape contract.** Already addressed in Q1: ATX-shaped lines now render as headings. `# rough notes` (one hash + space + content) becomes a heading; users who want a non-heading hash-comment can use `// note` instead. Documented in the Changelog.

---

End of design.

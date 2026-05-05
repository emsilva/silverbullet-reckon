# Visible Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in mode where math-shaped typos render as visible `kind: "error"` rows (pink wash + red italic source) instead of silent grey comment rows. Activated page-wide via `reckon-show-errors: true` in frontmatter. Closes [issue #2](https://github.com/emsilva/silverbullet-reckon/issues/2).

**Architecture:** Add `isReckonShowErrors(text)` frontmatter helper. Thread an optional `{ showErrors }` option from `plug.ts` through `evaluate()` and `evaluatePageContinuous()` down to `evaluateLine`'s catch branch — when set, that branch returns `kind: "error"` instead of `kind: "comment"`. Render adds a `tr.error` rule reusing the existing `.t-kw` Monokai Pro red. Default (silent comment fallback) is unchanged.

**Tech Stack:** TypeScript 5.5, mathjs 14, vitest 2 (existing).

**Spec:** `docs/superpowers/specs/2026-05-05-visible-errors-design.md`

---

## File Structure

- `src/frontmatter.ts` (modify) — add `RECKON_SHOW_ERRORS_LINE_RE` constant and `isReckonShowErrors(text)` helper. Mirrors `isReckonIsolated`.
- `src/frontmatter.test.ts` (modify) — append `isReckonShowErrors` describe block.
- `src/engine.ts` (modify) — add `kind: "error"` to `ResultRow` union; add exported `EvaluateOptions` interface; thread `showErrors` through `evaluate`, `evaluatePageContinuous`, `evaluateBlock`, `evaluateRows`, `evaluateLine`; flip the catch branch in `evaluateLine`.
- `src/engine.test.ts` (modify) — append two describe blocks: one for `evaluate` show-errors mode (parity, explicit-comment-stays, cascading) and one for `evaluatePageContinuous` show-errors mode.
- `src/render.ts` (modify) — add `case "error":` in `rowHtml` switch; append `tr.error` CSS rules to STYLE (light + dark mode).
- `src/render.test.ts` (modify) — add error-row HTML structure assertions; refresh fixture if needed.
- `src/plug.ts` (modify) — call `isReckonShowErrors(text)` in both `runPanelRefresh` and `reckonBlockWidget`; pass `{ showErrors }` to `evaluate` and `evaluatePageContinuous` in all three call sites (panel, isolated path, continuous path, defensive fallback).
- `infra/space-seed/Tests/Visible Errors Verification.md` (create) — `reckon: true` + `reckon-show-errors: true` page demonstrating error rows.
- `infra/space/Tests/Visible Errors Verification.md` (create, gitignored runtime mirror).
- `infra/space-seed/Changelog.md` (modify) — prepend `What's new — Visible errors (issue #2)`.

No new files in `src/`. Implementation order: frontmatter → engine → render → plug → closeout. Each task ships as one commit.

Current passing test count: **252** (lexer 34, parser 50, render 38, engine 106, frontmatter 24). Each task should grow the count and never reduce it.

**Working directory:** main (per user's persistent preference for this repo — no worktree).

---

## Task 1: Frontmatter — `isReckonShowErrors`

**Files:**
- Modify: `src/frontmatter.ts:3` (add constant), append new exported function after `isReckonIsolated`
- Test: `src/frontmatter.test.ts` (append after existing `isReckonIsolated` describe block, around line 115)

- [ ] **Step 1: Write failing tests**

Append to `src/frontmatter.test.ts` (after the `isReckonIsolated` describe block):

```ts
describe("isReckonShowErrors", () => {
  it("returns false for a page with no frontmatter", () => {
    expect(isReckonShowErrors("body\n")).toBe(false);
  });

  it("returns false for frontmatter without the flag", () => {
    expect(isReckonShowErrors("---\nreckon: true\n---\n")).toBe(false);
  });

  it("returns true for `reckon-show-errors: true`", () => {
    expect(isReckonShowErrors("---\nreckon-show-errors: true\n---\n")).toBe(true);
  });

  it("returns true alongside `reckon: true` and `reckon-isolated: true` and other keys", () => {
    expect(
      isReckonShowErrors(
        "---\nreckon: true\nreckon-isolated: true\nreckon-show-errors: true\ntags: foo\n---\n",
      ),
    ).toBe(true);
  });

  it("returns false for `reckon-show-errors: false`", () => {
    expect(isReckonShowErrors("---\nreckon-show-errors: false\n---\n")).toBe(false);
  });

  it("returns false for quoted `reckon-show-errors: \"true\"`", () => {
    expect(isReckonShowErrors("---\nreckon-show-errors: \"true\"\n---\n")).toBe(false);
  });

  it("returns false when the flag is indented (not top-level)", () => {
    expect(
      isReckonShowErrors("---\nfoo:\n  reckon-show-errors: true\n---\n"),
    ).toBe(false);
  });

  it("returns false when frontmatter is unterminated", () => {
    expect(isReckonShowErrors("---\nreckon-show-errors: true\n\nbody\n")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isReckonShowErrors("")).toBe(false);
  });
});
```

Update the import at the top of `src/frontmatter.test.ts:2`:

```ts
import {
  isReckonSheet,
  toggleReckonFrontmatter,
  isReckonIsolated,
  isReckonShowErrors,
} from "./frontmatter";
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/frontmatter.test.ts -t "isReckonShowErrors" --reporter verbose`

Expected: tests FAIL — `isReckonShowErrors is not a function` (or TS error: import not found).

- [ ] **Step 3: Add the constant**

Modify `src/frontmatter.ts:3`. Add after `RECKON_ISOLATED_LINE_RE`:

```ts
const RECKON_SHOW_ERRORS_LINE_RE = /^reckon-show-errors:\s*true\s*$/;
```

- [ ] **Step 4: Add the helper**

Append at the bottom of `src/frontmatter.ts`:

```ts
/**
 * Returns true iff the page's frontmatter has `reckon-show-errors: true`
 * as a top-level key. Used by plug.ts to opt the page into visible-error
 * rendering — failed mathjs parses become `kind: "error"` rows instead
 * of the silent `kind: "comment"` fallback.
 *
 * Mirrors isReckonIsolated's parsing strategy: requires properly
 * delimited frontmatter, no quoting, no indentation. Anything else
 * returns false (defensive — when in doubt, treat as default-off).
 */
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

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/frontmatter.test.ts --reporter verbose`

Expected: all `isReckonShowErrors` tests PASS; existing 24 frontmatter tests still pass.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: 261 passing (252 prior + 9 new).

- [ ] **Step 7: Commit**

```bash
git add src/frontmatter.ts src/frontmatter.test.ts
git commit -m "$(cat <<'EOF'
feat(frontmatter): isReckonShowErrors helper for #2 visible-errors flag

Mirrors isReckonIsolated parsing strategy. Returns true iff
top-level `reckon-show-errors: true` appears between frontmatter
delimiters. Coexists with reckon: true and reckon-isolated: true.
EOF
)"
```

---

## Task 2: Engine — `kind: "error"` + `EvaluateOptions` + catch-branch flip

**Files:**
- Modify: `src/engine.ts:47-69` (ResultRow union), `src/engine.ts:80-94` (export new EvaluateOptions interface), `src/engine.ts:111-204` (thread showErrors through evaluateRows + evaluateBlock), `src/engine.ts:221-269` (thread through public APIs), `src/engine.ts:272-322` (modify evaluateLine signature + flip catch branch)
- Test: `src/engine.test.ts` (append two new describe blocks at end of file)

- [ ] **Step 1: Write the failing tests**

Append to `src/engine.test.ts` (at the end of the file):

```ts
describe("engine.evaluate — show-errors mode", () => {
  it("flips the catch branch to `kind: 'error'` when showErrors=true", () => {
    const out = evaluate("5 +\n", { showErrors: true });
    expect(out.rows).toEqual([
      { kind: "error", line: 1, source: "5 +" },
    ]);
  });

  it("default (no opts) still produces `kind: 'comment'` (parity with V1)", () => {
    const out = evaluate("5 +\n");
    expect(out.rows).toEqual([
      { kind: "comment", line: 1, source: "5 +" },
    ]);
  });

  it("explicit showErrors=false still produces `kind: 'comment'`", () => {
    const out = evaluate("5 +\n", { showErrors: false });
    expect(out.rows).toEqual([
      { kind: "comment", line: 1, source: "5 +" },
    ]);
  });

  it("explicit `// foo` line stays `kind: 'comment'` even with showErrors=true", () => {
    const out = evaluate("// just a note\n", { showErrors: true });
    expect(out.rows).toEqual([
      { kind: "comment", line: 1, source: "// just a note" },
    ]);
  });

  it("explicit `# foo` (non-ATX, e.g. with no space) stays `kind: 'comment'` with showErrors=true", () => {
    const out = evaluate("#noheading\n", { showErrors: true });
    expect(out.rows).toEqual([
      { kind: "comment", line: 1, source: "#noheading" },
    ]);
  });

  it("ATX heading (`# Foo`) stays `kind: 'heading'` with showErrors=true", () => {
    const out = evaluate("# Section Title\n", { showErrors: true });
    expect(out.rows).toEqual([
      { kind: "heading", line: 1, depth: 1, text: "Section Title" },
    ]);
  });

  it("blank line stays `kind: 'blank'` with showErrors=true", () => {
    const out = evaluate("\n", { showErrors: true });
    expect(out.rows).toEqual([{ kind: "blank", line: 1 }]);
  });

  it("successful eval stays `kind: 'value'` with showErrors=true", () => {
    const out = evaluate("100 + 200\n", { showErrors: true });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[0].kind === "value" && out.rows[0].result).toBe("300");
  });

  it("`computeTotal` excludes error rows (Σ unchanged when an error sits among value rows)", () => {
    const out = evaluate("100\n5 +\n200\n", { showErrors: true });
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[1].kind).toBe("error");
    expect(out.rows[2].kind).toBe("value");
    expect(out.total).toEqual({ value: "300", clipboard: "300" });
  });

  it("cascading: lineN referencing an error line becomes another error row", () => {
    const out = evaluate("5 +\nline1 + 100\n", { showErrors: true });
    expect(out.rows[0].kind).toBe("error"); // the typo
    expect(out.rows[1].kind).toBe("error"); // line1 reference fails because line 1 didn't register
  });

  it("`ans` skips error rows (preserves last successful numeric)", () => {
    const out = evaluate("100\n5 +\nans + 50\n", { showErrors: true });
    expect(out.rows[2].kind).toBe("value");
    expect(out.rows[2].kind === "value" && out.rows[2].result).toBe("150");
  });
});

describe("engine.evaluatePageContinuous — show-errors mode", () => {
  it("propagates showErrors into each block's catch branch", () => {
    const text = "```reckon\n5 +\n```\n\n```reckon\nbad expr ?\n```\n";
    const result = evaluatePageContinuous(text, { showErrors: true });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].rows[0].kind).toBe("error");
    expect(result.blocks[1].rows[0].kind).toBe("error");
  });

  it("default (no opts) still produces comment rows in each block (parity)", () => {
    const text = "```reckon\n5 +\n```\n";
    const result = evaluatePageContinuous(text);
    expect(result.blocks[0].rows[0].kind).toBe("comment");
  });

  it("an error in block 1 doesn't crash block 2's evaluation", () => {
    const text = "```reckon\n5 +\nbill = 80\n```\n\n```reckon\nbill * 1.2\n```\n";
    const result = evaluatePageContinuous(text, { showErrors: true });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].rows[0].kind).toBe("error");
    expect(result.blocks[0].rows[1].kind).toBe("assignment"); // bill = 80 still parses
    expect(result.blocks[1].rows[0].kind).toBe("value");
    expect(result.blocks[1].rows[0].kind === "value" && result.blocks[1].rows[0].result).toBe("96");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/engine.test.ts -t "show-errors mode" --reporter verbose`

Expected: tests FAIL with TS errors — `evaluate` and `evaluatePageContinuous` don't accept a second arg, `kind: "error"` doesn't exist on `ResultRow`.

- [ ] **Step 3: Expand the `ResultRow` union**

Modify `src/engine.ts:47-69` — add the new `error` variant. Replace:

```ts
export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | { kind: "heading"; line: number; depth: number; text: string }
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
      clipboard: string;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
      clipboard: string;
    };
```

with:

```ts
export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | { kind: "error"; line: number; source: string }
  | { kind: "heading"; line: number; depth: number; text: string }
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
      clipboard: string;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      /** Always finite. Undefined for units, booleans, strings, etc. */
      numeric?: number;
      clipboard: string;
    };
```

- [ ] **Step 4: Add the `EvaluateOptions` interface**

Modify `src/engine.ts` — add after the `PageEvalResult` interface (around line 94):

```ts
/**
 * Options accepted by `evaluate` and `evaluatePageContinuous`. Currently
 * carries only `showErrors` (issue #2): when true, the failed-mathjs-parse
 * branch in `evaluateLine` returns `kind: "error"` instead of the silent
 * `kind: "comment"` fallback. Default false preserves V1 behavior.
 */
export interface EvaluateOptions {
  showErrors?: boolean;
}
```

- [ ] **Step 5: Modify `evaluateLine` — accept `showErrors` and flip the catch branch**

Modify `src/engine.ts:272-322`. Find the function signature:

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
): ResultRow {
```

Replace with:

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
  showErrors = false,
): ResultRow {
```

Then find the catch block (around line 318-322):

```ts
  let value: unknown;
  try {
    value = parser.evaluate(exprToEvaluate);
  } catch {
    return { kind: "comment", line: raw.line, source: raw.text };
  }
```

Replace with:

```ts
  let value: unknown;
  try {
    value = parser.evaluate(exprToEvaluate);
  } catch {
    // Failed mathjs parse. Default = silent comment fallback (V1 behavior).
    // With showErrors flag set (#2), surface as kind: "error" instead so
    // the renderer can highlight the typo.
    return showErrors
      ? { kind: "error", line: raw.line, source: raw.text }
      : { kind: "comment", line: raw.line, source: raw.text };
  }
```

The explicit-comment branch (line 303) and ATX heading branch (line 290-296) remain untouched — they always return their original kind regardless of the flag.

The new `showErrors = false` default means the existing internal callers in `evaluateRows` keep compiling (they pass 6 args; the 7th defaults to false). Steps 6-8 update those callers to forward the real value.

- [ ] **Step 6: Thread `showErrors` through `evaluateRows`**

Modify `src/engine.ts:111-171` — add `showErrors` as the last parameter and forward it to all three `evaluateLine` call sites (pre-total, pass 1, pass 2). Replace the entire `evaluateRows` function with:

```ts
function evaluateRows(
  rawLines: RawLine[],
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
  showErrors = false,
): { rows: ResultRow[]; total: TotalRow | null } {
  const hasTotal = rawLines.some((r) => /\btotal\b/.test(r.text));

  if (!hasTotal) {
    const rows: ResultRow[] = [];
    for (const raw of rawLines) {
      rows.push(
        evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames, showErrors),
      );
    }
    return { rows, total: computeTotal(rows) };
  }

  // Two-pass: snapshot parser scope, run pass 1, restore, preset `total`, run pass 2.
  // Pass 1 lets us compute Σ from rows that don't reference `total` (the rows
  // referencing it throw and classify as comment OR error per showErrors). Pass 2 with
  // `total` in scope re-evaluates everything; rows that reference `total` resolve cleanly.
  const snapshot = parser.getAll();

  const pass1Rows: ResultRow[] = [];
  for (const raw of rawLines) {
    pass1Rows.push(
      evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames, showErrors),
    );
  }
  let pass1Sum = 0;
  for (const row of pass1Rows) {
    if (row.kind === "value" && row.numeric !== undefined && Number.isFinite(row.numeric)) {
      pass1Sum += row.numeric;
    }
  }

  // Roll the parser back to its pre-block state, then preset `total` to the
  // pass-1 sum. percVars/mwVars/identifierNames/multiWordNames intentionally
  // are NOT rolled back — pass 2 will re-add the same entries (idempotent
  // Set.add / Map.set), so the final accumulator state matches pass 2.
  parser.clear();
  for (const [k, v] of Object.entries(snapshot)) {
    parser.set(k, v);
  }
  parser.set("total", pass1Sum);

  const pass2Rows: ResultRow[] = [];
  for (const raw of rawLines) {
    pass2Rows.push(
      evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames, showErrors),
    );
  }

  // Σ rule: rows whose source mentions `total` are derived — they display
  // their resolved value but do not contribute to Σ. This guarantees
  // Σ === total (the property we chose two-pass for).
  return { rows: pass2Rows, total: computeTotal(pass2Rows, { excludeTotalRefs: true }) };
}
```

- [ ] **Step 7: Thread `showErrors` through `evaluateBlock`**

Modify `src/engine.ts:183-204` — add `showErrors = false` as the last param and forward to `evaluateRows`. Replace the `evaluateBlock` function with:

```ts
export function evaluateBlock(
  parser: ReturnType<MathJsInstance["parser"]>,
  body: string,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
  lineOffset = 0,
  showErrors = false,
): { rows: ResultRow[]; total: TotalRow | null } {
  const rawLines = splitIntoLines(body);
  const offsetLines: RawLine[] = lineOffset === 0
    ? rawLines
    : rawLines.map((r) => ({ line: r.line + lineOffset, text: r.text }));
  return evaluateRows(
    offsetLines,
    parser,
    percentageVars,
    multiWordVars,
    identifierNames,
    multiWordNames,
    showErrors,
  );
}
```

- [ ] **Step 8: Thread `showErrors` through the public APIs**

Modify `src/engine.ts:221-252` — replace `evaluatePageContinuous` with:

```ts
export function evaluatePageContinuous(
  text: string,
  options: EvaluateOptions = {},
): PageEvalResult {
  const showErrors = options.showErrors ?? false;
  const blocks = extractBlocks(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  const multiWordVars = new Map<string, string>();
  const identifierNames = new Set<string>();
  const multiWordNames = new Set<string>();
  const results: BlockEvalResult[] = [];
  let lineOffset = 0;

  for (const block of blocks) {
    const { rows, total } = evaluateBlock(
      parser,
      block.body,
      percentageVars,
      multiWordVars,
      identifierNames,
      multiWordNames,
      lineOffset,
      showErrors,
    );
    parser.remove("total");
    results.push({
      rows,
      total,
      body: block.body,
      startLine: block.startLine,
    });
    lineOffset += rows.length;
  }

  return { blocks: results, identifierNames, multiWordNames };
}
```

Modify `src/engine.ts:254-270` — replace `evaluate` with:

```ts
export function evaluate(text: string, options: EvaluateOptions = {}): EvaluateResult {
  const showErrors = options.showErrors ?? false;
  const lines = extractMathLines(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  const multiWordVars = new Map<string, string>();
  const identifierNames = new Set<string>();
  const multiWordNames = new Set<string>();
  const { rows, total } = evaluateRows(
    lines,
    parser,
    percentageVars,
    multiWordVars,
    identifierNames,
    multiWordNames,
    showErrors,
  );
  return { rows, total, identifierNames, multiWordNames };
}
```

- [ ] **Step 9: Run the new tests to verify pass**

Run: `npx vitest run src/engine.test.ts -t "show-errors mode" --reporter verbose`

Expected: all 14 new tests PASS.

- [ ] **Step 10: Run the full engine test suite to verify no regressions**

Run: `npx vitest run src/engine.test.ts --reporter verbose`

Expected: 120 tests passing (106 prior + 14 new).

- [ ] **Step 11: Run the full repo test suite**

Run: `npm test`

Expected: 275 passing (252 + 9 from Task 1 + 14 from this task).

- [ ] **Step 12: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(engine): kind: 'error' ResultRow + EvaluateOptions for #2

Threads optional { showErrors } from evaluate / evaluatePageContinuous
through evaluateBlock, evaluateRows, evaluateLine. When true, the
failed-mathjs-parse catch branch returns kind: 'error' instead of
the silent kind: 'comment' fallback. Explicit comment escapes (//, #),
ATX headings, blanks, and successful evals are unaffected. Default
behavior unchanged.
EOF
)"
```

---

## Task 3: Render — `tr.error` row HTML + CSS

**Files:**
- Modify: `src/render.ts:32-44` (CSS — add tr.error rules near tr.comment), `src/render.ts:96-107` (CSS — dark mode tr.error rules), `src/render.ts:240-256` (rowHtml switch — add `case "error":`)
- Test: `src/render.test.ts` (append a new describe block; potentially extend the canonical fixture)

- [ ] **Step 1: Write failing tests**

Append to `src/render.test.ts` (at the end of the file):

```ts
describe("renderSheet — error rows", () => {
  const withError: EvaluateResult = {
    rows: [
      { kind: "value", line: 1, source: "100", result: "100", numeric: 100, clipboard: "100" },
      { kind: "error", line: 2, source: "5 +" },
      { kind: "value", line: 3, source: "200", result: "200", numeric: 200, clipboard: "200" },
    ],
    total: { value: "300", clipboard: "300" },
    identifierNames: new Set(),
    multiWordNames: new Set(),
  };

  it("renders an error row with class 'error' and data-line", () => {
    const out = renderSheet(withError);
    expect(out.html).toContain('<tr class="error" data-line="2">');
  });

  it("error row source cell uses colspan=2 (no result column)", () => {
    const out = renderSheet(withError);
    expect(out.html).toMatch(/<tr class="error" data-line="2"><td class="gutter">2<\/td><td class="source" colspan="2">5 \+<\/td><\/tr>/);
  });

  it("error row gutter is non-referenceable (no 'referenceable' class)", () => {
    const out = renderSheet(withError);
    // The error row's gutter td should be class="gutter", not class="gutter referenceable".
    expect(out.html).toMatch(/<tr class="error" data-line="2"><td class="gutter">2<\/td>/);
    expect(out.html).not.toMatch(/<tr class="error"[^>]*><td class="gutter referenceable"/);
  });

  it("error row has no data-references attribute", () => {
    const out = renderSheet(withError);
    const errorRowMatch = out.html.match(/<tr class="error"[^>]*>/);
    expect(errorRowMatch).not.toBeNull();
    expect(errorRowMatch![0]).not.toContain("data-references");
  });

  it("error row has no data-clipboard-value", () => {
    const out = renderSheet(withError);
    const errorRowSlice = out.html.match(/<tr class="error"[^>]*>.*?<\/tr>/);
    expect(errorRowSlice).not.toBeNull();
    expect(errorRowSlice![0]).not.toContain("data-clipboard-value");
  });

  it("escapes HTML in error source (XSS-safe)", () => {
    const out = renderSheet({
      rows: [{ kind: "error", line: 1, source: "<script>alert(1)</script>" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  it("includes tr.error CSS rule in STYLE block", () => {
    const out = renderSheet(withError);
    expect(out.html).toContain("tr.error td.source");
    expect(out.html).toContain("tr.error td {");
  });

  it("computeTotal-fed Σ row still renders (errors don't suppress total)", () => {
    const out = renderSheet(withError);
    expect(out.html).toContain('class="total"');
    expect(out.html).toContain("300");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/render.test.ts -t "error rows" --reporter verbose`

Expected: tests FAIL — no `case "error":` in `rowHtml`'s switch (TS error: switch is non-exhaustive over the discriminated union now that `kind: "error"` exists), and no CSS rules for `tr.error`.

- [ ] **Step 3: Add the `case "error":` branch in `rowHtml`**

Modify `src/render.ts:240-256`. Find:

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

Replace with (insert `case "error":` between `comment` and `heading`):

```ts
function rowHtml(row: ResultRow, options: TokenizeOptions): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank" data-line="${row.line}"><td class="gutter">${row.line}</td><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "error":
      return `<tr class="error" data-line="${row.line}"><td class="gutter">${row.line}</td><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
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

- [ ] **Step 4: Add the light-mode CSS rules**

Modify `src/render.ts` STYLE constant. Find the existing `tr.comment td.source` line (around line 32):

```css
  tr.comment td.source { opacity: 0.6; color: #72696a; font-style: italic; }
```

Insert two new rules immediately after it:

```css
  tr.comment td.source { opacity: 0.6; color: #72696a; font-style: italic; }
  tr.error td { background: rgba(225, 71, 117, 0.08); }
  tr.error td.source { color: #e14775; font-style: italic; }
```

- [ ] **Step 5: Add the dark-mode CSS rules**

In the same STYLE constant, find the `@media (prefers-color-scheme: dark)` block. Find the dark-mode comment rule (around line 96):

```css
    tr.comment td.source { color: #727072; }
```

Insert two new rules immediately after it:

```css
    tr.comment td.source { color: #727072; }
    tr.error td { background: rgba(255, 97, 136, 0.12); }
    tr.error td.source { color: #ff6188; }
```

- [ ] **Step 6: Run the new tests to verify pass**

Run: `npx vitest run src/render.test.ts -t "error rows" --reporter verbose`

Expected: all 8 new tests PASS.

- [ ] **Step 7: Run the full render test suite to verify no regressions**

Run: `npx vitest run src/render.test.ts --reporter verbose`

Expected: 46 tests passing (38 prior + 8 new).

- [ ] **Step 8: Run the full repo test suite**

Run: `npm test`

Expected: 283 passing (275 + 8).

- [ ] **Step 9: Commit**

```bash
git add src/render.ts src/render.test.ts
git commit -m "$(cat <<'EOF'
feat(render): tr.error row with pink wash + red italic source for #2

Adds case 'error' to rowHtml's switch, structurally identical to comment
rows (gutter + spanning source cell, no data-references, no clipboard).
CSS reuses the existing .t-kw Monokai Pro red (#e14775 light, #ff6188
dark) plus a faint pink row background for at-a-glance visibility.
Italic source mirrors the comment-row treatment cue; no opacity so
errors stand out instead of fading.
EOF
)"
```

---

## Task 4: Plug — read flag and pass through

**Files:**
- Modify: `src/plug.ts:2-12` (imports), `src/plug.ts:35-54` (reckonBlockWidget), `src/plug.ts:99-108` (runPanelRefresh)

This task has no unit tests — `plug.ts` integrates with SilverBullet syscalls (`editor.getText`, `editor.showPanel`) that aren't easily mockable. The verification page in Task 5 exercises this code live. Same precedent as `isReckonIsolated` and the async block-widget dispatch.

- [ ] **Step 1: Update the import**

Modify `src/plug.ts:2-6`. Find:

```ts
import {
  isReckonSheet,
  isReckonIsolated,
  toggleReckonFrontmatter,
} from "./frontmatter";
```

Replace with:

```ts
import {
  isReckonSheet,
  isReckonIsolated,
  isReckonShowErrors,
  toggleReckonFrontmatter,
} from "./frontmatter";
```

- [ ] **Step 2: Wire the flag into `reckonBlockWidget`**

Modify `src/plug.ts:35-54`. Find:

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
    return renderSheet(evaluate(bodyText));
  }
  return renderSheet({
    rows: block.rows,
    total: block.total,
    identifierNames: pageResult.identifierNames,
    multiWordNames: pageResult.multiWordNames,
  });
}
```

Replace with:

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
```

- [ ] **Step 3: Wire the flag into `runPanelRefresh`**

Modify `src/plug.ts:99-108`. Find:

```ts
async function runPanelRefresh(): Promise<void> {
  const text = await editor.getText();
  if (!isReckonSheet(text)) {
    await editor.hidePanel(PANEL_LOCATION);
    return;
  }
  const result = evaluate(text);
  const { html, script } = renderSheet(result);
  await editor.showPanel(PANEL_LOCATION, PANEL_MODE, html, script);
}
```

Replace with:

```ts
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

- [ ] **Step 4: Type-check the build**

Run: `npm run build`

Expected: build succeeds; `dist/reckon.plug.js` is regenerated. No TypeScript errors. Bundle size delta should be ~negligible (a few hundred bytes for the new helper + rowHtml branch + CSS).

- [ ] **Step 5: Run the full test suite to verify no regressions**

Run: `npm test`

Expected: 283 passing (no new tests in this task; existing tests unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/plug.ts
git commit -m "$(cat <<'EOF'
feat(plug): read isReckonShowErrors and pass to engine entry points

Both runPanelRefresh and reckonBlockWidget now consult
isReckonShowErrors(text) and pass { showErrors } to evaluate /
evaluatePageContinuous. All three call sites updated (panel,
isolated path, continuous path, defensive fallback).
EOF
)"
```

---

## Task 5: Closeout — verification page, Changelog, issue comment

**Files:**
- Create: `infra/space-seed/Tests/Visible Errors Verification.md`
- Create: `infra/space/Tests/Visible Errors Verification.md` (gitignored runtime mirror — produced by `npm run dev:link`)
- Modify: `infra/space-seed/Changelog.md` (prepend new entry above existing #13 entry)

This task has no unit tests — verification is performed live in SilverBullet by the user.

- [ ] **Step 1: Create the verification page (seed)**

Write `infra/space-seed/Tests/Visible Errors Verification.md`:

```markdown
---
reckon: true
reckon-show-errors: true
---

# Visible Errors — Live Verification

This page has `reckon-show-errors: true` in frontmatter. Lines that
fail mathjs parse should render as **error rows**: pink row wash +
red italic source. Compare with the silent grey treatment of
explicit `//` comments.

To verify default behavior, edit the frontmatter to remove
`reckon-show-errors: true`, run `Plugs: Reload`, and reload the page
— the same lines should now render as silent grey comment rows.

## 1. A typo flagged as error

Line 2 of the block below is a math-shaped typo (`5 +` with no RHS).
With the flag on, it should render red:

```reckon
100
5 +
// expected line 2: error row (pink wash, red italic source)
ans + 50
// expected line 4: 150 (ans = 100, since the typo at line 2 didn't register)
```

## 2. Explicit comments stay grey

Even with `reckon-show-errors: true`, lines that start with `//` or `#`
are explicit prose, not errors. They render the way they always have:

```reckon
// this is intentional prose — should be grey, not red
# this is also intentional prose — same treatment
100 + 200
// expected: line 1 grey, line 2 grey, line 3 → 300
```

## 3. Σ excludes error rows

Error rows don't contribute to Σ (same as comment rows today). The
displayed total below should be **300**, not "300 plus the unknown
contribution of `5 +`":

```reckon
100
5 +
200
// expected Σ: 300 (line 2's error excluded)
```

## 4. Cascading: lineN referencing an error becomes another error

When a typo prevents a line from registering as a `lineN` binding,
references from later rows fail too — they cascade into more error
rows. The block below has a typo at line 1 and a reference to line 1
at line 2; both should render red:

```reckon
5 +
line1 + 100
// expected line 1: error (typo)
// expected line 2: error (line1 didn't register, so the reference fails)
```

## 5. ATX headings unaffected

`# Section Title` shapes (ATX heading syntax) stay as headings, not
errors:

```reckon
# This is a heading
100
// expected: line 1 heading (default styling), line 2 → 100
```
```

- [ ] **Step 2: Mirror to runtime space**

Run: `npm run dev:link`

Expected: copies `Library/` and `Tests/` from `infra/space-seed/` into `infra/space/`. The new verification page is mirrored into the runtime space.

- [ ] **Step 3: Prepend the Changelog entry**

Modify `infra/space-seed/Changelog.md`. Find the current top entry (cross-block, issue #13). Prepend before it:

```markdown
## What's new — Visible errors (issue #2)

**Date:** 2026-05-05

Opt in via `reckon-show-errors: true` in frontmatter. Lines that fail
to parse render with a pink wash + red italic source instead of the
silent grey comment fallback. Explicit comments (`//`, `#`) and ATX
headings (`# Foo`) are unaffected — only failed-parse lines flip to
errors.

```reckon
100
5 +
// the line above is now a visible error row (was silent comment by default)
```

The flag works on both surfaces: fenced ` ```reckon ``` ` block widgets
*and* the page panel. Authors of prose-rich `reckon: true` pages who
turn it on must comment-escape narrative paragraphs with `//` to avoid
red rows.

See `Tests/Visible Errors Verification.md` for live demos of every
case (typos, explicit comments staying grey, cascading, Σ exclusion,
ATX headings).

---

```

(Use the same heading depth and trailing `---` separator as the existing entries — verify by reading the file's current top section first.)

- [ ] **Step 4: Mirror Changelog if needed**

If `infra/space/Changelog.md` exists as a copy, run `npm run dev:link` again. Otherwise the seed Changelog is the source of truth and the runtime space syncs it.

- [ ] **Step 5: Build and reload in SilverBullet for live verification**

```bash
npm run build
npm run dev:link
```

Then in the running SilverBullet instance:
1. Run `Plugs: Reload` (Cmd-K → "Plugs: Reload" or equivalent slash command).
2. Open `Tests/Visible Errors Verification.md`.
3. Confirm:
   - Section 1: line 2 of the first block is a red error row; line 4 shows 150.
   - Section 2: both `//` and `#` lines render grey, not red.
   - Section 3: Σ shows 300 (excluding the error row).
   - Section 4: both lines of the cascading-error block render red.
   - Section 5: the heading line renders as a heading; the math line renders normally.
4. Edit frontmatter to remove `reckon-show-errors: true`. Reload the page (no plug reload needed). Confirm error rows revert to silent grey comment rows.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`

Expected: 283 passing (no test changes in this task).

- [ ] **Step 7: Commit**

```bash
git add infra/space-seed/Tests/Visible\ Errors\ Verification.md infra/space-seed/Changelog.md
git commit -m "$(cat <<'EOF'
docs(infra): #2 verification page + Changelog entry for visible errors

Adds Tests/Visible Errors Verification.md with five sections covering
typo highlighting, explicit-comment parity, Σ exclusion, cascading
errors, and ATX-heading parity. Each example uses fenced reckon
blocks with inline // expected-value annotations per project rule.
Changelog gets a top-of-file 'What's new — Visible errors' entry.
EOF
)"
```

- [ ] **Step 8: Comment on the issue and request live verification**

```bash
gh issue comment 2 --body "$(cat <<'EOF'
Implementation done on `main`. Five commits:

1. `feat(frontmatter)`: `isReckonShowErrors` helper.
2. `feat(engine)`: `kind: "error"` ResultRow + `EvaluateOptions` + catch-branch flip.
3. `feat(render)`: `tr.error` row HTML + pink-wash CSS reusing the `.t-kw` palette.
4. `feat(plug)`: read flag and pass through to `evaluate` / `evaluatePageContinuous`.
5. `docs(infra)`: verification page + Changelog entry.

Test count: 252 → 283 (+31).

To verify live:
- Run `npm run build && npm run dev:link` and `Plugs: Reload` in SilverBullet.
- Open `Tests/Visible Errors Verification.md` in the dev space.
- Toggle `reckon-show-errors: true` in the page frontmatter and reload to see the contrast between flag-on (red errors) and default (silent grey comments).

Closing once you've confirmed in-browser.
EOF
)"
```

- [ ] **Step 9: Leave the issue OPEN**

Do not run `gh issue close 2`. The user closes after live verification.

---

## Verification — Final test count

After all five tasks, expected counts:

| File | Before | After | Delta |
|---|---|---|---|
| `frontmatter.test.ts` | 24 | 33 | +9 (Task 1) |
| `engine.test.ts` | 106 | 120 | +14 (Task 2) |
| `render.test.ts` | 38 | 46 | +8 (Task 3) |
| `lexer.test.ts` | 34 | 34 | 0 |
| `parser.test.ts` | 50 | 50 | 0 |
| **Total** | **252** | **283** | **+31** |

Final `npm test` should show **283 passing**.

---

## Notes for the executor

- **Work on `main`, not a worktree.** Per the user's persistent preference for this repo (auto-memory: `feedback_main_branch.md`).
- **Commit after every task.** Five commits total. Don't squash.
- **Don't skip `npm run dev:link`.** Easy to forget, costs an hour staring at a stale plug.
- **Stick to fenced ` ```reckon ``` ` blocks for examples.** Bare 4-space-indented or full-page sheets are not the project style.
- **Inline expected-value annotations use `//`, never `#`.** A leading `#` becomes an ATX heading; `# foo` mid-line breaks the math expression.
- **Issue stays OPEN until the user verifies live.** Do not close it.

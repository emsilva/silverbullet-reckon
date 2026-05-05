# Cross-Block Continuous Mode + `total` Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-block pages feel like one calculation. Variables and `ans` flow across fenced `reckon` blocks in source order (continuous mode is the default; `reckon-isolated: true` opts out). Each block's auto-Σ row gains a referenceable identifier `total`, implemented via two-pass evaluation with a derived-row exclusion rule that keeps `total === Σ`. Closes [issue #13](https://github.com/emsilva/silverbullet-reckon/issues/13).

**Architecture:** Refactor `engine.evaluate()` to delegate to a shared `evaluateRows()` helper that handles the per-row loop and (when needed) a two-pass total resolution. Add `evaluatePageContinuous(text)` that walks blocks (via a new `parser.extractBlocks`) and runs them through one shared mathjs parser, clearing `lineN` bindings between blocks and removing `total` between blocks. `plug.reckonBlockWidget` becomes async, reads `editor.getText()`, and dispatches to either continuous mode (default) or the V1 isolated path based on `frontmatter.isReckonIsolated`. Token coloring picks up a new `totalref` kind in the lexer and a matching `.t-totalref` CSS class.

**Tech Stack:** TypeScript 5.5, mathjs 14, vitest 2 (existing).

**Spec:** `docs/superpowers/specs/2026-05-05-cross-block-continuous-and-total-design.md`

---

## File Structure

- `src/lexer.ts` (modify) — add `"totalref"` to `TokenKind`, add classification check.
- `src/lexer.test.ts` (modify) — append `tokenize — totalref kind` describe block.
- `src/parser.ts` (modify) — add `ExtractedBlock` interface and `extractBlocks(text)` helper.
- `src/parser.test.ts` (modify) — append `extractBlocks` describe block.
- `src/frontmatter.ts` (modify) — add `RECKON_ISOLATED_LINE_RE` and `isReckonIsolated(text)`.
- `src/frontmatter.test.ts` (modify) — append `isReckonIsolated` describe block.
- `src/engine.ts` (modify) — extract `evaluateRows`; add `evaluateBlock`, `evaluatePageContinuous`, two-pass logic, `excludeTotalRefs` opt to `computeTotal`. Export new types.
- `src/engine.test.ts` (modify) — append three new describe blocks (`total within a block`, `evaluatePageContinuous`, isolation parity).
- `src/render.ts` (modify) — add `.t-totalref` CSS rules (light + dark mode).
- `src/render.test.ts` (modify) — snapshot refresh + assertion that `total` source spans get the class.
- `src/plug.ts` (modify) — `reckonBlockWidget` becomes async; dispatch to isolated or continuous path.
- `infra/space-seed/Tests/Cross-Block Continuous Verification.md` (create) — `reckon: true` verification page.
- `infra/space-seed/Tests/Cross-Block Isolated Verification.md` (create) — `reckon: true` + `reckon-isolated: true` verification page.
- `infra/space/Tests/Cross-Block Continuous Verification.md` (create, gitignored runtime mirror).
- `infra/space/Tests/Cross-Block Isolated Verification.md` (create, gitignored runtime mirror).
- `infra/space-seed/Changelog.md` (modify) — prepend `What's new — Cross-block continuous mode + total reference (issue #13)`.

No new files in `src/`. Implementation order: lexer → parser → frontmatter → engine refactor → engine two-pass → engine continuous → render → plug → closeout. Each task ships as one commit; the bundle lands as ~9 commits on `main`.

Current passing test count: **203** (lexer 28, parser 41, engine 86, render 33, frontmatter 15). Each task should grow the count and never reduce it.

---

## Task 1: Lexer — `totalref` token kind

**Files:**
- Modify: `src/lexer.ts:1` (TokenKind union) and `src/lexer.ts:78-88` (classification branch)
- Test: `src/lexer.test.ts` (append after the last existing describe block, around line 232)

- [ ] **Step 1: Write failing tests**

Append to `src/lexer.test.ts` (after the `linref` describe block):

```ts
describe("tokenize — totalref kind for `total` reference", () => {
  const opts = {
    identifiers: new Set<string>(),
    multiWord: new Set<string>(),
    isUnit: () => false,
  };

  it("`total` tokenizes as kind: 'totalref'", () => {
    expect(tokenize("total", opts)).toEqual([{ kind: "totalref", text: "total" }]);
  });

  it("`Total` (capitalized) stays as kind: 'id' (case-sensitive)", () => {
    expect(tokenize("Total", opts)).toEqual([{ kind: "id", text: "Total" }]);
  });

  it("`totalfoo` stays as kind: 'id' (no false suffix match)", () => {
    expect(tokenize("totalfoo", opts)).toEqual([{ kind: "id", text: "totalfoo" }]);
  });

  it("`tot` stays as kind: 'id' (no false prefix match)", () => {
    expect(tokenize("tot", opts)).toEqual([{ kind: "id", text: "tot" }]);
  });

  it("combined: `total * 2` produces [totalref, ws, op, ws, num]", () => {
    expect(tokenize("total * 2", opts)).toEqual([
      { kind: "totalref", text: "total" },
      { kind: "ws", text: " " },
      { kind: "op", text: "*" },
      { kind: "ws", text: " " },
      { kind: "num", text: "2" },
    ]);
  });

  it("totalref takes precedence over user identifiers (so a user `total` var is colored as ref)", () => {
    const withTotalAsId = {
      identifiers: new Set(["total"]),
      multiWord: new Set<string>(),
      isUnit: () => false,
    };
    expect(tokenize("total", withTotalAsId)).toEqual([{ kind: "totalref", text: "total" }]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/lexer.test.ts -t "totalref kind" --reporter verbose`

Expected: tests FAIL — `total` currently classifies as `id` (the catch-all branch in `tokenize`), so `kind` mismatches.

- [ ] **Step 3: Add `totalref` to the TokenKind union**

Modify `src/lexer.ts:1`:

```ts
export type TokenKind = "num" | "id" | "unit" | "op" | "kw" | "pct" | "ws" | "text" | "linref" | "totalref";
```

- [ ] **Step 4: Add the classification branch**

Modify `src/lexer.ts:80-86`. Find the existing block:

```ts
      const w = wordM[0];
      let kind: TokenKind;
      if (KEYWORDS.has(w)) kind = "kw";
      else if (/^line\d+$/.test(w)) kind = "linref";
      else if (identifiers.has(w)) kind = "id";
      else if (isUnit(w)) kind = "unit";
      else kind = "id";
```

Insert the `totalref` check between `linref` and `identifiers`:

```ts
      const w = wordM[0];
      let kind: TokenKind;
      if (KEYWORDS.has(w)) kind = "kw";
      else if (/^line\d+$/.test(w)) kind = "linref";
      else if (w === "total") kind = "totalref";
      else if (identifiers.has(w)) kind = "id";
      else if (isUnit(w)) kind = "unit";
      else kind = "id";
```

Order matters: `totalref` precedes the user-identifier check so a user-defined `total` variable doesn't shadow the reference semantics.

- [ ] **Step 5: Run lexer tests, verify pass**

Run: `npx vitest run src/lexer.test.ts`

Expected: 28 prior + 6 new = 34 PASS.

- [ ] **Step 6: Run full suite for regressions**

Run: `npx vitest run`

Expected: 203 prior + 6 new = 209 PASS.

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/lexer.ts src/lexer.test.ts
git commit -m "feat(lexer): totalref kind for total reference token"
```

(No build artifact change yet — `reckon.plug.js` is rebuilt at the end of Task 8.)

---

## Task 2: Parser — `extractBlocks` helper

**Files:**
- Modify: `src/parser.ts` (append at end after `rewriteExpression`)
- Test: `src/parser.test.ts` (append after the last existing describe block)

- [ ] **Step 1: Write failing tests**

Append to `src/parser.test.ts`:

```ts
describe("extractBlocks", () => {
  it("returns [] for plain text with no fenced reckon blocks", () => {
    expect(extractBlocks("hello\nworld\n")).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(extractBlocks("")).toEqual([]);
  });

  it("finds a single reckon block and preserves the body", () => {
    const text = "intro\n```reckon\n100\n200\n```\noutro\n";
    expect(extractBlocks(text)).toEqual([
      { body: "100\n200", startLine: 2 },
    ]);
  });

  it("finds multiple reckon blocks in source order", () => {
    const text = "```reckon\nA\n```\n```reckon\nB\n```\n";
    expect(extractBlocks(text)).toEqual([
      { body: "A", startLine: 1 },
      { body: "B", startLine: 4 },
    ]);
  });

  it("ignores non-reckon fences (js, python, etc.)", () => {
    const text =
      "```js\nconsole.log('x')\n```\n```reckon\n50\n```\n```python\nprint('y')\n```\n";
    expect(extractBlocks(text)).toEqual([
      { body: "50", startLine: 4 },
    ]);
  });

  it("skips frontmatter before scanning for blocks (line numbers stay source-relative)", () => {
    const text = "---\nreckon: true\n---\n\n```reckon\n50\n```\n";
    expect(extractBlocks(text)).toEqual([
      { body: "50", startLine: 5 },
    ]);
  });

  it("preserves blank lines inside the body verbatim", () => {
    const text = "```reckon\nfoo = 1\n\nfoo + 1\n```\n";
    expect(extractBlocks(text)).toEqual([
      { body: "foo = 1\n\nfoo + 1", startLine: 1 },
    ]);
  });

  it("treats unterminated reckon fence as one block with rest-of-doc body", () => {
    const text = "```reckon\n100\n200\n";
    expect(extractBlocks(text)).toEqual([
      { body: "100\n200", startLine: 1 },
    ]);
  });

  it("emits an empty body for an immediately-closed fence", () => {
    const text = "```reckon\n```\n";
    expect(extractBlocks(text)).toEqual([
      { body: "", startLine: 1 },
    ]);
  });
});
```

Update the import line at the top of `src/parser.test.ts:2` to include `extractBlocks`:

```ts
import { extractMathLines, splitIntoLines, rewriteExpression, detectAssignment, extractBlocks } from "./parser";
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/parser.test.ts -t "extractBlocks" --reporter verbose`

Expected: tests FAIL — `extractBlocks` is not exported from parser.ts.

- [ ] **Step 3: Implement `extractBlocks` in parser.ts**

Append to `src/parser.ts` (after the `rewriteExpression` function and the trailing `escapeRegex` helper):

```ts
export interface ExtractedBlock {
  body: string;
  startLine: number;
}

const RECKON_FENCE_OPEN_RE = /^```reckon(?:\s|$)/;

/**
 * Extract fenced ```reckon``` blocks from a full page's text, in source
 * order. Strips frontmatter the same way as `extractMathLines`. The body
 * for each block is the literal contents between the opening and closing
 * fences (no leading/trailing newline). `startLine` is the 1-based source
 * line of the opening fence — useful for diagnostics, and (importantly)
 * for distinguishing same-body duplicates by position.
 *
 * Non-reckon fences (```js, ```python, ...) are crossed over: their
 * contents are not extracted, and a `reckon` fence opening *inside* them
 * is not picked up.
 */
export function extractBlocks(text: string): ExtractedBlock[] {
  const all = splitIntoLines(text);
  if (all.length === 0) return [];

  let i = 0;
  // Strip frontmatter if present (mirrors extractMathLines).
  if (all[0]?.text === FRONTMATTER_DELIM) {
    let close = -1;
    for (let j = 1; j < all.length; j++) {
      if (all[j].text === FRONTMATTER_DELIM) {
        close = j;
        break;
      }
    }
    if (close >= 0) {
      i = close + 1;
      if (all[i]?.text === "") i += 1;
    }
  }

  const blocks: ExtractedBlock[] = [];
  while (i < all.length) {
    const line = all[i];
    if (RECKON_FENCE_OPEN_RE.test(line.text)) {
      const startLine = line.line;
      const bodyLines: string[] = [];
      i += 1;
      while (i < all.length && !FENCE_RE.test(all[i].text)) {
        bodyLines.push(all[i].text);
        i += 1;
      }
      blocks.push({ body: bodyLines.join("\n"), startLine });
      if (i < all.length) i += 1; // skip closing fence
      continue;
    }
    if (FENCE_RE.test(line.text)) {
      // Non-reckon fence — skip the whole block.
      i += 1;
      while (i < all.length && !FENCE_RE.test(all[i].text)) i += 1;
      if (i < all.length) i += 1;
      continue;
    }
    i += 1;
  }
  return blocks;
}
```

(`FRONTMATTER_DELIM` and `FENCE_RE` are already top-level constants in `parser.ts:6-7`.)

- [ ] **Step 4: Run parser tests, verify pass**

Run: `npx vitest run src/parser.test.ts`

Expected: 41 prior + 9 new = 50 PASS.

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`

Expected: 209 prior + 9 new = 218 PASS.

- [ ] **Step 6: Type-check + commit**

```bash
npx tsc --noEmit
git add src/parser.ts src/parser.test.ts
git commit -m "feat(parser): extractBlocks helper for reckon fence discovery"
```

---

## Task 3: Frontmatter — `isReckonIsolated`

**Files:**
- Modify: `src/frontmatter.ts` (append after `toggleReckonFrontmatter`)
- Test: `src/frontmatter.test.ts` (append after the existing describe blocks)

- [ ] **Step 1: Write failing tests**

Append to `src/frontmatter.test.ts`:

```ts
describe("isReckonIsolated", () => {
  it("returns false for a page with no frontmatter", () => {
    expect(isReckonIsolated("body\n")).toBe(false);
  });

  it("returns false for frontmatter without the flag", () => {
    expect(isReckonIsolated("---\nreckon: true\n---\n")).toBe(false);
  });

  it("returns true for `reckon-isolated: true`", () => {
    expect(isReckonIsolated("---\nreckon-isolated: true\n---\n")).toBe(true);
  });

  it("returns true alongside `reckon: true` and other keys", () => {
    expect(isReckonIsolated("---\nreckon: true\nreckon-isolated: true\ntags: foo\n---\n")).toBe(true);
  });

  it("returns false for `reckon-isolated: false`", () => {
    expect(isReckonIsolated("---\nreckon-isolated: false\n---\n")).toBe(false);
  });

  it("returns false for quoted `reckon-isolated: \"true\"`", () => {
    expect(isReckonIsolated("---\nreckon-isolated: \"true\"\n---\n")).toBe(false);
  });

  it("returns false when the flag is indented (not top-level)", () => {
    expect(isReckonIsolated("---\nfoo:\n  reckon-isolated: true\n---\n")).toBe(false);
  });

  it("returns false when frontmatter is unterminated", () => {
    expect(isReckonIsolated("---\nreckon-isolated: true\n\nbody\n")).toBe(false);
  });

  it("returns false for empty input", () => {
    expect(isReckonIsolated("")).toBe(false);
  });
});
```

Update the import at `src/frontmatter.test.ts:2`:

```ts
import { isReckonSheet, toggleReckonFrontmatter, isReckonIsolated } from "./frontmatter";
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/frontmatter.test.ts -t "isReckonIsolated" --reporter verbose`

Expected: tests FAIL — `isReckonIsolated` is not exported.

- [ ] **Step 3: Implement `isReckonIsolated`**

Modify `src/frontmatter.ts`. Add the regex constant immediately after `RECKON_LINE_RE` (around line 2):

```ts
const RECKON_ISOLATED_LINE_RE = /^reckon-isolated:\s*true\s*$/;
```

Append the function at the end of the file (after `toggleReckonFrontmatter`):

```ts
/**
 * Returns true iff the page's frontmatter has `reckon-isolated: true`
 * as a top-level key. Used by reckonBlockWidget to opt out of the new
 * cross-block continuous mode and preserve V1 per-block isolation.
 *
 * Mirrors isReckonSheet's parsing strategy: requires properly delimited
 * frontmatter, no quoting, no indentation. Anything else returns false
 * (defensive — when in doubt, treat as continuous since that's the
 * default).
 */
export function isReckonIsolated(text: string): boolean {
  const lines = text.split("\n");
  const fm = findFrontmatter(lines);
  if (!fm) return false;
  for (let i = fm.open + 1; i < fm.close; i++) {
    if (RECKON_ISOLATED_LINE_RE.test(lines[i])) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run frontmatter tests, verify pass**

Run: `npx vitest run src/frontmatter.test.ts`

Expected: 15 prior + 9 new = 24 PASS.

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`

Expected: 218 prior + 9 new = 227 PASS.

- [ ] **Step 6: Type-check + commit**

```bash
npx tsc --noEmit
git add src/frontmatter.ts src/frontmatter.test.ts
git commit -m "feat(frontmatter): isReckonIsolated for cross-block opt-out flag"
```

---

## Task 4: Engine refactor — extract `evaluateRows` helper

This task is a pure refactor: split `evaluate()` into a reusable inner helper without changing any externally observable behavior. All 86 existing engine tests must continue to pass unchanged.

**Files:**
- Modify: `src/engine.ts` (refactor `evaluate`, add `evaluateRows` and `evaluateBlock`)

- [ ] **Step 1: Read the current shape**

Look at `src/engine.ts:85-115` (the current `evaluate` function). The body iterates `extractMathLines(text)` through `evaluateLine` with one parser, accumulating rows. The refactor moves that iteration into a private helper `evaluateRows(rawLines, parser, percVars, mwVars, idNames, mwNames)` and exposes a public `evaluateBlock(parser, body, ...)` that splits a body string into rawLines first.

- [ ] **Step 2: Update imports**

Modify `src/engine.ts:15-20`. Replace:

```ts
import {
  extractMathLines,
  rewriteExpression,
  detectAssignment,
  type RawLine,
} from "./parser";
```

with:

```ts
import {
  extractMathLines,
  splitIntoLines,
  rewriteExpression,
  detectAssignment,
  type RawLine,
} from "./parser";
```

(`rewriteExpression` is no longer directly needed by engine.ts — keep it for now to minimize diff; it's used inside `evaluateLine` indirectly.)

Actually `rewriteExpression` is used in `evaluateLine` already at line 157, 159. Keep the import as-is plus add `splitIntoLines`.

- [ ] **Step 3: Add the `evaluateRows` private helper**

Insert into `src/engine.ts`, immediately before the existing `evaluate` function (around line 85):

```ts
/**
 * Evaluate a sequence of pre-numbered RawLines through a shared parser.
 * The parser, percentage/multi-word var sets, and identifier-name sets
 * are externally owned so callers can persist them across calls (e.g.
 * cross-block continuous mode). Returns the result rows plus the auto-Σ
 * row computed via `computeTotal`.
 *
 * Today this is single-pass; Task 5 layers in two-pass behavior for
 * `total` references on top of this same shape.
 */
function evaluateRows(
  rawLines: RawLine[],
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
): { rows: ResultRow[]; total: TotalRow | null } {
  const rows: ResultRow[] = [];
  for (const raw of rawLines) {
    rows.push(
      evaluateLine(
        raw,
        parser,
        percentageVars,
        multiWordVars,
        identifierNames,
        multiWordNames,
      ),
    );
  }
  return { rows, total: computeTotal(rows) };
}
```

- [ ] **Step 4: Add the `evaluateBlock` exported helper**

Insert immediately after `evaluateRows`:

```ts
/**
 * Evaluate one fenced reckon block's body through a shared parser.
 * `body` is split into RawLines with **block-internal** 1-based numbering
 * (so `lineN` matches what the gutter shows inside the block). The
 * caller owns the parser and var sets; in cross-block continuous mode
 * those are shared across blocks.
 */
export function evaluateBlock(
  parser: ReturnType<MathJsInstance["parser"]>,
  body: string,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
): { rows: ResultRow[]; total: TotalRow | null } {
  const rawLines = splitIntoLines(body);
  return evaluateRows(
    rawLines,
    parser,
    percentageVars,
    multiWordVars,
    identifierNames,
    multiWordNames,
  );
}
```

- [ ] **Step 5: Refactor `evaluate` to delegate**

Replace the body of the existing `evaluate` function at `src/engine.ts:85-115` with:

```ts
export function evaluate(text: string): EvaluateResult {
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
  );
  return { rows, total, identifierNames, multiWordNames };
}
```

- [ ] **Step 6: Run full suite, verify no regressions**

Run: `npx vitest run`

Expected: all 227 tests STILL PASS — this is a pure refactor.

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/engine.ts
git commit -m "refactor(engine): extract evaluateRows + evaluateBlock helpers"
```

---

## Task 5: Engine — two-pass evaluation for `total`

Layers two-pass logic into `evaluateRows`: detect `\btotal\b` in any row's source; if present, snapshot parser state, run pass 1, restore, set `total = Σ`, run pass 2. Add an `excludeTotalRefs` option to `computeTotal` so derived rows (those mentioning `total`) don't contribute to Σ — preserving the equality `total === Σ`.

**Files:**
- Modify: `src/engine.ts` (extend `evaluateRows`, extend `computeTotal`)
- Test: `src/engine.test.ts` (append new describe block)

- [ ] **Step 1: Write failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluate — total reference within a block", () => {
  it("`total` resolves to the block's auto-sum (Σ)", () => {
    const out = evaluate("100\n200\ntotal\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "200" });
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "300", source: "total" });
    // Σ excludes the derived row → matches the value `total` resolved to.
    expect(out.total).toEqual({ value: "300", clipboard: "300" });
  });

  it("derived rows display their value but don't contribute to Σ", () => {
    const out = evaluate("100\n200\ntotal / 2\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "150" });
    expect(out.total).toEqual({ value: "300", clipboard: "300" });
  });

  it("multiple total references in one block all resolve to the same Σ", () => {
    const out = evaluate("100\n200\ntotal / 2\ntotal - 50\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "150" });
    expect(out.rows[3]).toMatchObject({ kind: "value", result: "250" });
    // Σ still 300 — both derived rows excluded.
    expect(out.total).toEqual({ value: "300", clipboard: "300" });
  });

  it("block with only a total-referencing row: pass1Sum=0, derived row resolves with total=0", () => {
    const out = evaluate("total + 5\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "5" });
    // The only value row is derived → excluded → no non-derived value rows → total is null.
    expect(out.total).toBeNull();
  });

  it("variables and ans persist across two-pass within a block", () => {
    const out = evaluate("salary = 200\nans + total\n");
    // Pass 1: salary=200 (assignment), ans+total fails → comment. pass1Sum=0.
    // Pass 2: salary=200, ans=200 (after row 1 of pass 2). Row 2: 200 + 0 = 200.
    expect(out.rows[0]).toMatchObject({ kind: "assignment", varName: "salary" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "200" });
  });

  it("`Total` (capitalized) is treated as a normal id (case-sensitive reserved word)", () => {
    const out = evaluate("100\nTotal + 5\n");
    expect(out.rows[1].kind).toBe("comment"); // Total is undefined
  });

  it("`totally` does not match the word boundary — treated as a normal id", () => {
    const out = evaluate("100\ntotally = 5\n");
    expect(out.rows[1]).toMatchObject({ kind: "assignment", varName: "totally" });
    // Since the body contains "totally" but NOT "\btotal\b" as a whole word,
    // two-pass does NOT trigger; auto-Σ continues to include all value rows.
    // The single value row is the 100, so Σ = 100.
    expect(out.total).toEqual({ value: "100", clipboard: "100" });
  });

  it("two-pass does not break percentage variables registered in the same block", () => {
    const out = evaluate("tax = 5%\n100\ntotal + tax\n");
    // Pass 1: tax=5% (perc var registered), 100 (value), total+tax fails → comment. pass1Sum=100.
    // Pass 2: parser.set(total, 100). Tax=5% (re-registered, idempotent). 100 (value).
    //         Row 3: 100 + tax (additive percent rewrite) → 100 * (1 + 0.05) = 105.
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
    // Σ excludes row 3 (derived) → only row 2 (100) counts → 100.
    expect(out.total).toEqual({ value: "100", clipboard: "100" });
  });

  it("blocks without `total` evaluate single-pass (existing behavior unchanged)", () => {
    // Sanity test that the fast-path skip preserves identical behavior.
    const out = evaluate("100\n200\nans + 1\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "100" });
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "201" });
    expect(out.total).toEqual({ value: "501", clipboard: "501" });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/engine.test.ts -t "total reference within a block" --reporter verbose`

Expected: most tests FAIL — `total` currently classifies as `id`, mathjs throws (undefined), rows fall through to `comment`. The "blocks without total" test PASSES (no behavior change in single-pass path); the "totally" test PASSES (existing assignment behavior).

- [ ] **Step 3: Add the `excludeTotalRefs` option to `computeTotal`**

Modify `src/engine.ts:268-279` (the existing `computeTotal` function):

```ts
function computeTotal(
  rows: ResultRow[],
  opts?: { excludeTotalRefs?: boolean },
): TotalRow | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (row.kind !== "value") continue;
    if (row.numeric === undefined || !Number.isFinite(row.numeric)) continue;
    if (opts?.excludeTotalRefs && /\btotal\b/.test(row.source)) continue;
    sum += row.numeric;
    any = true;
  }
  if (!any) return null;
  return { value: NUMBER_FORMATTER.format(sum), clipboard: String(sum) };
}
```

- [ ] **Step 4: Extend `evaluateRows` with two-pass logic**

Replace the `evaluateRows` function from Task 4 with:

```ts
function evaluateRows(
  rawLines: RawLine[],
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
  identifierNames: Set<string>,
  multiWordNames: Set<string>,
): { rows: ResultRow[]; total: TotalRow | null } {
  const hasTotal = rawLines.some((r) => /\btotal\b/.test(r.text));

  if (!hasTotal) {
    const rows: ResultRow[] = [];
    for (const raw of rawLines) {
      rows.push(
        evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames),
      );
    }
    return { rows, total: computeTotal(rows) };
  }

  // Two-pass: snapshot parser scope, run pass 1, restore, preset `total`, run pass 2.
  // Pass 1 lets us compute Σ from rows that don't reference `total` (the rows
  // referencing it throw and classify as comment). Pass 2 with `total` in scope
  // re-evaluates everything; rows that reference `total` resolve cleanly.
  const snapshot = parser.getAll();

  const pass1Rows: ResultRow[] = [];
  for (const raw of rawLines) {
    pass1Rows.push(
      evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames),
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
      evaluateLine(raw, parser, percentageVars, multiWordVars, identifierNames, multiWordNames),
    );
  }

  // Σ rule: rows whose source mentions `total` are derived — they display
  // their resolved value but do not contribute to Σ. This guarantees
  // Σ === total (the property we chose two-pass for).
  return { rows: pass2Rows, total: computeTotal(pass2Rows, { excludeTotalRefs: true }) };
}
```

- [ ] **Step 5: Run new tests, verify pass**

Run: `npx vitest run src/engine.test.ts -t "total reference within a block"`

Expected: all 9 new tests PASS.

- [ ] **Step 6: Run full suite for regressions**

Run: `npx vitest run`

Expected: 227 prior + 9 new = 236 PASS. Existing tests in particular must all still pass — none of them feed inputs containing `\btotal\b`, so the fast-path skip handles them identically.

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/engine.ts src/engine.test.ts
git commit -m "feat(engine): two-pass total reference with derived-row exclusion"
```

---

## Task 6: Engine — `evaluatePageContinuous` (cross-block scope)

Walks all reckon blocks in source order, evaluates them through one shared parser. Between blocks: clear `lineN` bindings (so each block has its own `line1..N` namespace), run the block via `evaluateBlock` (which internally handles the two-pass total path from Task 5), then `parser.remove("total")` so the block-scoped `total` doesn't leak into the next block.

**Files:**
- Modify: `src/engine.ts` (add types, helper, and exported function)
- Test: `src/engine.test.ts` (append new describe block)

- [ ] **Step 1: Write failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluatePageContinuous — cross-block scope", () => {
  it("returns no blocks for a page with no fenced reckon", () => {
    const out = evaluatePageContinuous("no fences here\n");
    expect(out.blocks).toEqual([]);
  });

  it("variables defined in block 1 are visible in block 2", () => {
    const text = "```reckon\nbill = 80\n```\n```reckon\nbill * 1.2\n```\n";
    const out = evaluatePageContinuous(text);
    expect(out.blocks).toHaveLength(2);
    expect(out.blocks[0].rows[0]).toMatchObject({ kind: "assignment", varName: "bill" });
    expect(out.blocks[1].rows[0]).toMatchObject({ kind: "value", result: "96" });
  });

  it("`ans` flows from block 1's last numeric into block 2's first row", () => {
    const text = "```reckon\n100\n200\n```\n```reckon\nans + 50\n```\n";
    const out = evaluatePageContinuous(text);
    expect(out.blocks[1].rows[0]).toMatchObject({ kind: "value", result: "250" });
  });

  it("`lineN` is block-internal — block 2's `line1` refers to block 2's first row, not block 1's", () => {
    const text = "```reckon\n100\n200\n```\n```reckon\n50\nline1 + 1\n```\n";
    const out = evaluatePageContinuous(text);
    expect(out.blocks[1].rows[1]).toMatchObject({ kind: "value", result: "51" });
  });

  it("block-1's `lineN` bindings are cleared before block 2 evaluates", () => {
    // Block 1 sets line1 = 100. Block 2 references line1 forward — should fail.
    const text = "```reckon\n100\n```\n```reckon\nline1\n```\n";
    const out = evaluatePageContinuous(text);
    // Block 2's line1 doesn't exist yet at the time row 1 evaluates (forward ref).
    expect(out.blocks[1].rows[0].kind).toBe("comment");
  });

  it("`total` is block-scoped — block 2's total is computed from its own rows only", () => {
    const text = "```reckon\n100\n200\n```\n```reckon\n50\ntotal / 2\n```\n";
    const out = evaluatePageContinuous(text);
    // Block 2: pass1Sum = 50 (only row 1 is value). total = 50. Row 2 = 25 (derived).
    expect(out.blocks[1].rows[1]).toMatchObject({ kind: "value", result: "25" });
    expect(out.blocks[1].total).toEqual({ value: "50", clipboard: "50" });
  });

  it("`total` does NOT leak from block 1 into block 2", () => {
    // Block 1 total = 300 in display. Block 2 has no value rows; its total = 0.
    const text = "```reckon\n100\n200\n```\n```reckon\ntotal + 1\n```\n";
    const out = evaluatePageContinuous(text);
    // Block 2: pass1Sum = 0 (no value rows in pass 1). total = 0. Row 1 = 1.
    expect(out.blocks[1].rows[0]).toMatchObject({ kind: "value", result: "1" });
  });

  it("each block's row.line is block-internal (1-based)", () => {
    const text = "intro\n```reckon\n100\n200\n```\nmid\n```reckon\n50\n```\n";
    const out = evaluatePageContinuous(text);
    expect(out.blocks[0].rows[0].line).toBe(1);
    expect(out.blocks[0].rows[1].line).toBe(2);
    expect(out.blocks[1].rows[0].line).toBe(1);
  });

  it("multi-word variables flow across blocks (additive percent works)", () => {
    const text = "```reckon\ncurrent tax = 20%\n```\n```reckon\n100 + current tax\n```\n";
    const out = evaluatePageContinuous(text);
    // Block 2 row 1: 100 + current tax → 100 * (1 + 0.2) = 120.
    expect(out.blocks[1].rows[0]).toMatchObject({ kind: "value", result: "120" });
  });

  it("populates startLine and body for each block result", () => {
    const text = "intro\nintro\n```reckon\n100\n```\nmid\n```reckon\n200\n```\n";
    const out = evaluatePageContinuous(text);
    expect(out.blocks[0]).toMatchObject({ body: "100", startLine: 3 });
    expect(out.blocks[1]).toMatchObject({ body: "200", startLine: 6 });
  });

  it("preserves identifierNames and multiWordNames across blocks", () => {
    const text = "```reckon\nfoo = 1\ncurrent tax = 5%\n```\n```reckon\nfoo + 1\n```\n";
    const out = evaluatePageContinuous(text);
    expect(out.identifierNames.has("foo")).toBe(true);
    expect(out.multiWordNames.has("current tax")).toBe(true);
  });
});
```

Update the import at the top of `src/engine.test.ts:2` to include `evaluatePageContinuous`:

```ts
import { evaluate, evaluatePageContinuous } from "./engine";
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/engine.test.ts -t "evaluatePageContinuous" --reporter verbose`

Expected: all tests FAIL — `evaluatePageContinuous` is not exported.

- [ ] **Step 3: Add types and update imports**

Modify `src/engine.ts:15-21`. Add `extractBlocks` to the parser imports:

```ts
import {
  extractMathLines,
  splitIntoLines,
  rewriteExpression,
  detectAssignment,
  extractBlocks,
  type RawLine,
} from "./parser";
```

Add new exported types after the existing `EvaluateResult` interface (around line 79):

```ts
export interface BlockEvalResult {
  rows: ResultRow[];
  total: TotalRow | null;
  body: string;
  startLine: number;
}

export interface PageEvalResult {
  blocks: BlockEvalResult[];
  identifierNames: Set<string>;
  multiWordNames: Set<string>;
}
```

- [ ] **Step 4: Add `clearLineRefs` helper**

Insert this helper near the bottom of `src/engine.ts` (just before `computeTotal`):

```ts
/**
 * Remove all `line<N>` bindings from a parser's scope. Used between
 * blocks in continuous mode so each block has its own block-internal
 * `line1..N` namespace (matching what the gutter shows).
 */
function clearLineRefs(
  parser: ReturnType<MathJsInstance["parser"]>,
): void {
  const all = parser.getAll();
  for (const name of Object.keys(all)) {
    if (/^line\d+$/.test(name)) {
      parser.remove(name);
    }
  }
}
```

- [ ] **Step 5: Add `evaluatePageContinuous` exported function**

Insert immediately after `evaluateBlock`:

```ts
/**
 * Evaluate a full page in cross-block continuous mode. Walks all fenced
 * reckon blocks in source order, evaluating each through a shared
 * parser so variables and `ans` flow across blocks. Between blocks:
 * - line<N> bindings are cleared (each block has its own line1..N).
 * - `total` is removed (block-scoped).
 *
 * `identifierNames` and `multiWordNames` accumulate across all blocks
 * — they're used by the lexer for syntax coloring, which doesn't care
 * about per-block scope.
 *
 * The page panel uses `evaluate(text)` (not this function); panel and
 * blocks remain parallel timelines per the design.
 */
export function evaluatePageContinuous(text: string): PageEvalResult {
  const blocks = extractBlocks(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  const multiWordVars = new Map<string, string>();
  const identifierNames = new Set<string>();
  const multiWordNames = new Set<string>();
  const results: BlockEvalResult[] = [];

  for (const block of blocks) {
    clearLineRefs(parser);
    const { rows, total } = evaluateBlock(
      parser,
      block.body,
      percentageVars,
      multiWordVars,
      identifierNames,
      multiWordNames,
    );
    parser.remove("total");
    results.push({
      rows,
      total,
      body: block.body,
      startLine: block.startLine,
    });
  }

  return { blocks: results, identifierNames, multiWordNames };
}
```

- [ ] **Step 6: Run new tests, verify pass**

Run: `npx vitest run src/engine.test.ts -t "evaluatePageContinuous"`

Expected: all 11 new tests PASS.

- [ ] **Step 7: Run full suite**

Run: `npx vitest run`

Expected: 236 prior + 11 new = 247 PASS.

- [ ] **Step 8: Type-check + commit**

```bash
npx tsc --noEmit
git add src/engine.ts src/engine.test.ts
git commit -m "feat(engine): evaluatePageContinuous for cross-block scope flow"
```

---

## Task 7: Render — `.t-totalref` CSS

Adds the gold/yellow palette entry for `total` source spans, matching `linref`.

**Files:**
- Modify: `src/render.ts:47-55` (light-mode palette) and `src/render.ts:96-105` (dark-mode palette)
- Test: `src/render.test.ts` (snapshot refresh + assertion)

- [ ] **Step 1: Write failing tests**

Append to `src/render.test.ts` (after the last existing describe block, around line 446):

```ts
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
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/render.test.ts -t "totalref source coloring" --reporter verbose`

Expected: tests FAIL — `.t-totalref` rule not in CSS, and the `total` source span is currently `<span class="t-id">total</span>` since totalref is a brand-new TokenKind that the lexer now emits but render's syntax-class mapping passes through generically as `t-${kind}` (which would actually produce `t-totalref` already!). Confirm by reading `render.ts:236-243`:

```ts
function tokenToHtml(token: Token): string {
  if (token.kind === "ws" || token.kind === "text") {
    return escapeHtml(token.text);
  }
  return `<span class="t-${token.kind}">${escapeHtml(token.text)}</span>`;
}
```

So the class will be emitted automatically once the lexer emits `totalref`. The first two tests should PASS even before adding CSS. The third and fourth tests (CSS rule presence) FAIL until the CSS is added.

- [ ] **Step 3: Add the light-mode CSS rule**

Modify `src/render.ts:47-55`. Find the existing palette block:

```css
  /* Token coloring — Monokai Pro Light (light mode default) */
  .t-num    { color: #6849c2; }
  .t-id     { color: #218a55; }
  .t-unit   { color: #1c8ca8; }
  .t-op     { opacity: 0.45; }
  .t-kw     { color: #e14775; font-style: italic; }
  .t-pct    { color: #c25c00; }
  .t-linref { color: #a67c00; }
```

Add a `.t-totalref` line aligned with the others, immediately after `.t-linref`:

```css
  /* Token coloring — Monokai Pro Light (light mode default) */
  .t-num      { color: #6849c2; }
  .t-id       { color: #218a55; }
  .t-unit     { color: #1c8ca8; }
  .t-op       { opacity: 0.45; }
  .t-kw       { color: #e14775; font-style: italic; }
  .t-pct      { color: #c25c00; }
  .t-linref   { color: #a67c00; }
  .t-totalref { color: #a67c00; }
```

(Same hex as `linref` — same flavor of reserved-reference identifier; sharing color reinforces "this is a reckon-engine reference, not a user variable.")

- [ ] **Step 4: Add the dark-mode CSS rule**

Modify `src/render.ts:97-103` (inside the `@media (prefers-color-scheme: dark)` block):

```css
    .t-num      { color: #ab9df2; }
    .t-id       { color: #a9dc76; }
    .t-unit     { color: #78dce8; }
    .t-op       { opacity: 0.55; }
    .t-kw       { color: #ff6188; }
    .t-pct      { color: #fc9867; }
    .t-linref   { color: #ffd866; }
    .t-totalref { color: #ffd866; }
```

- [ ] **Step 5: Run render tests, verify pass**

Run: `npx vitest run src/render.test.ts`

Expected: 33 prior + 4 new = 37 PASS. The existing 33-test snapshot may need refreshing if it captures the full `<style>` block.

If a snapshot test fails, run `npx vitest run src/render.test.ts -u` to update the snapshot, then visually verify the diff is exactly the two new CSS rules and nothing else.

- [ ] **Step 6: Run full suite**

Run: `npx vitest run`

Expected: 247 prior + 4 new = 251 PASS (or 251 with refreshed snapshot).

- [ ] **Step 7: Type-check + commit**

```bash
npx tsc --noEmit
git add src/render.ts src/render.test.ts src/__snapshots__/
git commit -m "style(render): t-totalref Monokai gold/yellow for total source spans"
```

(The `__snapshots__/` directory may or may not have changed — `git add` it in case the snapshot was refreshed.)

---

## Task 8: Plug — async `reckonBlockWidget` with isolated/continuous dispatch

`reckonBlockWidget` becomes async, reads `editor.getText()`, and dispatches: if the page has `reckon-isolated: true`, use the V1 path (`renderSheet(evaluate(bodyText))`); otherwise run continuous mode and render this widget's slice.

**Files:**
- Modify: `src/plug.ts` (rewrite `reckonBlockWidget`, add helpers)

- [ ] **Step 1: Update imports**

Modify `src/plug.ts:1-4`. Replace:

```ts
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { isReckonSheet, toggleReckonFrontmatter } from "./frontmatter";
import { evaluate } from "./engine";
import { renderSheet } from "./render";
```

with:

```ts
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import {
  isReckonSheet,
  isReckonIsolated,
  toggleReckonFrontmatter,
} from "./frontmatter";
import {
  evaluate,
  evaluatePageContinuous,
  type BlockEvalResult,
} from "./engine";
import { renderSheet } from "./render";
```

- [ ] **Step 2: Replace `reckonBlockWidget`**

Replace the existing `reckonBlockWidget` function at `src/plug.ts:23-28`:

```ts
/**
 * codeWidget callback for fenced ```reckon``` blocks.
 *
 * Two modes:
 * - **Continuous (default).** Reads the full page text, evaluates ALL
 *   reckon blocks in source order through one shared parser, then
 *   renders just this widget's slice. Variables and `ans` flow across
 *   blocks; `lineN` and `total` stay block-internal.
 * - **Isolated** — opted into via `reckon-isolated: true` in frontmatter.
 *   Falls back to V1 behavior: each block evaluated in its own scope.
 *
 * Defensive fallback: if the body text doesn't match any extracted
 * block (e.g. SilverBullet calls the widget mid-edit with stale body),
 * use the isolated path to avoid blank panels.
 */
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

/**
 * Match the SilverBullet-supplied bodyText to one of the extracted
 * blocks. Compares normalized bodies (CRLF→LF, drop trailing newline).
 *
 * Limitation: if a page has two byte-identical reckon blocks, both
 * widgets render with the FIRST occurrence's evaluated state. This is
 * a SilverBullet codeWidget API limitation (no positional info passed
 * to the callback). Documented; rare in practice.
 */
function findBlockByBody(
  blocks: BlockEvalResult[],
  bodyText: string,
): BlockEvalResult | undefined {
  const target = normalizeBody(bodyText);
  return blocks.find((b) => normalizeBody(b.body) === target);
}

function normalizeBody(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: no errors. The async return type aligns with how SilverBullet's codeWidget API accepts Promise-returning callbacks.

- [ ] **Step 4: Run full suite (no new tests, regression check)**

Run: `npx vitest run`

Expected: still 251 PASS. `plug.ts` has no unit tests; behavior is verified live via the verification pages in Task 9.

- [ ] **Step 5: Build the plug**

Run: `npm run build`

Expected: `reckon.plug.js` rebuilt without errors. Bundle size should grow only marginally (a few hundred bytes for the new helpers).

- [ ] **Step 6: Commit**

```bash
git add src/plug.ts reckon.plug.js reckon.plug.js.map
git commit -m "feat(plug): async reckonBlockWidget with continuous-mode dispatch"
```

---

## Task 9: Closeout — verification pages, Changelog, issue comment

Per the project's per-issue verification rule, ship two verification pages (the opt-out flag is page-level, so it needs its own page). Plus a Changelog entry and a `gh issue comment` requesting live verification.

**Files:**
- Create: `infra/space-seed/Tests/Cross-Block Continuous Verification.md`
- Create: `infra/space-seed/Tests/Cross-Block Isolated Verification.md`
- Create: `infra/space/Tests/Cross-Block Continuous Verification.md` (gitignored runtime mirror)
- Create: `infra/space/Tests/Cross-Block Isolated Verification.md` (gitignored runtime mirror)
- Modify: `infra/space-seed/Changelog.md` (prepend new entry)

- [ ] **Step 1: Create the continuous-mode verification page**

Path: `infra/space-seed/Tests/Cross-Block Continuous Verification.md`

````md
---
reckon: true
---

# Cross-Block Continuous — Live Verification

Open this page in Silverbullet (run `Plugs: Reload` first if needed).
The fenced `reckon` blocks below should *communicate* — variables and
`ans` flow across block boundaries in source order. The right-hand
page panel evaluates non-fenced lines as a separate, isolated track
(panel and blocks are parallel timelines).

Compare with `Cross-Block Isolated Verification.md` to see what the
opt-out flag changes.

## 1. Variable flow across blocks

Block 1 sets `bill`:

```reckon
bill = 80
```

Block 2 references `bill` from Block 1:

```reckon
bill * 1.2          # expected: 96
```

## 2. `ans` flow across blocks

Block 1 produces a numeric:

```reckon
100
200
```

Block 2's `ans` (used on its first row) carries Block 1's last numeric (200):

```reckon
ans + 50            # expected: 250
```

## 3. `lineN` is block-internal

`lineN` does NOT count across blocks — it stays scoped to its own
block. The block below has three rows; `line1 + line2` references
*this block's* first two rows, not the page's:

```reckon
1000
2000
line1 + line2       # expected: 3000
```

## 4. `total` reference + derived-row exclusion

Within a block, `total` resolves to the same number shown in the Σ
row at the bottom. Rows that reference `total` are *derived* — they
display their resolved value, but they don't contribute to Σ.

```reckon
100
200
total / 2           # expected display: 150
                    # expected Σ: 300 (row 3 excluded — it's derived from total)
```

The Σ row at the bottom of the block above should show **300**, not
**450**.

## 5. `total` is block-scoped (doesn't leak)

The next block has its own `total`, computed from its own value rows.
The previous block's Σ (300) is NOT visible here:

```reckon
50
total / 2           # expected display: 25 (this block's total = 50, not 300)
                    # expected Σ: 50
```

## 6. Multi-word variables flow too

```reckon
current tax = 20%
```

```reckon
100 + current tax   # expected: 120 (additive percent rewrite + cross-block flow)
```

## Page panel

Outside the fenced blocks, this page is itself `reckon: true`, so the
right-hand panel evaluates the page's prose-math (this prose has no
math, so the panel only shows what the lines below produce). The
panel's scope is **separate** from the blocks above:

500
ans + 100
````

- [ ] **Step 2: Create the isolated-mode verification page**

Path: `infra/space-seed/Tests/Cross-Block Isolated Verification.md`

````md
---
reckon: true
reckon-isolated: true
---

# Cross-Block Isolated — Live Verification (opt-out)

Open this page in Silverbullet. With `reckon-isolated: true` in
frontmatter, fenced `reckon` blocks revert to V1 behavior: each block
has its own scope. Variables and `ans` do **not** flow across.

Compare with `Cross-Block Continuous Verification.md` to see the
default (continuous) behavior.

## 1. Variable flow is BLOCKED

Block 1 sets `bill`:

```reckon
bill = 80
```

Block 2 cannot see `bill` from Block 1:

```reckon
bill * 1.2          # expected: comment row (bill is undefined here)
```

## 2. `ans` flow is BLOCKED

Block 1 produces a numeric:

```reckon
100
200
```

Block 2's `ans` is fresh — Block 1's last numeric is not visible:

```reckon
ans + 50            # expected: comment row (no prior numeric in this block)
```

## 3. `total` still works within a single block

`total` is per-block in both modes, so this still works exactly the
same as in continuous mode:

```reckon
100
200
total / 2           # expected display: 150
                    # expected Σ: 300
```

## 4. Each block has its own `lineN` namespace (unchanged)

```reckon
1000
2000
line1 + line2       # expected: 3000
```
````

- [ ] **Step 3: Mirror to runtime space**

Run:

```bash
mkdir -p infra/space/Tests
cp "infra/space-seed/Tests/Cross-Block Continuous Verification.md" "infra/space/Tests/Cross-Block Continuous Verification.md"
cp "infra/space-seed/Tests/Cross-Block Isolated Verification.md" "infra/space/Tests/Cross-Block Isolated Verification.md"
```

(`infra/space/` is gitignored — this copy is for the dev container to pick up immediately without re-running `dev:seed`.)

- [ ] **Step 4: Prepend Changelog entry**

Open `infra/space-seed/Changelog.md` and insert this block immediately after the file's intro line (after the `---` separator on line ~5) and before the existing top entry (currently `## What's new — Line-number gutter (issue #12)`):

````md
## What's new — Cross-block continuous mode + `total` reference (issue #13)

Two changes that make multi-block pages feel like one calculation.

### Continuous mode (default)

Fenced `reckon` blocks now share scope with each other in source
order. Variables and `ans` flow across block boundaries:

```reckon
bill = 80
```

```reckon
bill * 1.2        # 96 — sees `bill` from the prior block
ans + 4           # 100 — `ans` carries forward too
```

`lineN` and the gutter stay block-internal — each block has its own
`line1..lineN` namespace, matching what the gutter shows. Cross-block
communication is through named variables and `ans`.

### Opt-out: `reckon-isolated: true`

Add the flag to a page's frontmatter to revert to V1 per-block
isolation:

    ---
    reckon: true
    reckon-isolated: true
    ---

In isolated mode, each block has its own fresh scope — variables and
`ans` do not flow across. Useful for pages where blocks are
independent calculations rather than steps in one chain.

### `total` as a reference

Each block's auto-Σ row now has a name. Inside the block that
produced it, `total` resolves to the same number shown in the Σ row:

```reckon
100
200
total / 2         # 150 — half of this block's Σ (300)
```

Rows that reference `total` are *derived* — they display their
resolved value but don't contribute to Σ. This keeps Σ and `total`
in sync (both show 300 in the example above, even though row 3's
result is 150).

`total` is block-scoped — it does not leak into the next block.
The next block's `total` is computed from its own value rows.

`total` source spans are colored gold (light) / yellow (dark) like
`lineN`, distinct from regular identifiers.

---

````

(Match the existing Changelog's wording style, ` ```reckon ``` ` examples, and `---` separator. Keep the latest-at-top convention.)

- [ ] **Step 5: Final type-check + build (sanity)**

```bash
npx tsc --noEmit
npm run build
```

Expected: no errors. `reckon.plug.js` should match what was committed in Task 8 (this task only touches docs/seed-files), but rebuilding confirms the bundle is in sync.

- [ ] **Step 6: Commit closeout**

```bash
git add infra/space-seed/Tests/ infra/space-seed/Changelog.md
git commit -m "docs(infra): Changelog + Tests/ verification pages for cross-block continuous + total"
```

(Don't `git add infra/space/` — it's gitignored. Don't re-add `reckon.plug.js` — Task 8 already committed it and it shouldn't have changed.)

- [ ] **Step 7: Comment on issue #13 requesting verification**

```bash
gh issue comment 13 --body "$(cat <<'EOF'
## Cross-block continuous mode + `total` reference shipped on `main`

Issue #13 landed as a 9-commit bundle:

- `feat(lexer): totalref kind for total reference token`
- `feat(parser): extractBlocks helper for reckon fence discovery`
- `feat(frontmatter): isReckonIsolated for cross-block opt-out flag`
- `refactor(engine): extract evaluateRows + evaluateBlock helpers`
- `feat(engine): two-pass total reference with derived-row exclusion`
- `feat(engine): evaluatePageContinuous for cross-block scope flow`
- `style(render): t-totalref Monokai gold/yellow for total source spans`
- `feat(plug): async reckonBlockWidget with continuous-mode dispatch`
- `docs(infra): Changelog + Tests/ verification pages for cross-block continuous + total`

To verify live, open the two verification pages in SilverBullet (run
`Plugs: Reload` first if needed):

1. **`Tests/Cross-Block Continuous Verification.md`** — continuous mode
   (default). Variables and `ans` should flow across blocks; `lineN`
   stays block-internal; `total` resolves inside each block to its own
   Σ; derived rows display but don't contribute to Σ.

2. **`Tests/Cross-Block Isolated Verification.md`** — opt-out via
   `reckon-isolated: true`. Same examples, but variables and `ans`
   should NOT flow; `total` still works per-block.

Reply once verified and I'll close.
EOF
)"
```

Leave the issue OPEN. The user verifies in-browser, then closes via `gh issue close 13`.

---

## Self-Review

**1. Spec coverage:**

| Acceptance criterion | Covered by |
|---|---|
| Continuous mode is the default (frontmatter flag opts out) | Task 3 (isReckonIsolated) + Task 8 (dispatch) + verification page in Task 9 |
| Variables and `ans` flow across blocks in source order | Task 6 (evaluatePageContinuous) + Task 6 tests |
| Gutter and `lineN` stay block-internal | Task 6 (clearLineRefs between blocks; evaluateBlock uses splitIntoLines for block-internal numbering) + Task 6 tests |
| `total` = block's final Σ via two-pass | Task 5 (evaluateRows with hasTotal/snapshot/restore) + Task 5 tests |
| Derived-row rule: `total`-referencing rows don't contribute to Σ | Task 5 (`computeTotal` excludeTotalRefs flag) + Task 5 tests |
| Pass-2 fast-path skip when no row mentions `total` | Task 5 (the `if (!hasTotal)` branch) + Task 5 test "blocks without total evaluate single-pass" |
| Edit safety: silent breakage in continuous mode | Inherent — broken refs throw → comment classification (existing behavior); not retrofitted |
| `total` is block-scoped (doesn't leak) | Task 6 (parser.remove("total") between blocks) + Task 6 test "doesn't leak from block 1 into block 2" |
| `totalref` token kind for source coloring | Task 1 (lexer) + Task 7 (CSS) |
| `reckonBlockWidget` async dispatch | Task 8 + verified live via Task 9 |
| Verification pages | Task 9 (two pages — continuous and isolated) |
| Changelog entry | Task 9 |

The spec's §12 known limitations (duplicate-body blocks, async first-render flicker) are documented in the spec but don't have corresponding plan tasks — they're "accept and document," not "implement."

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details", or "Add appropriate error handling". Every step has either complete code, a precise file path, or a literal command to run. The verification pages and Changelog entry are written out in full.

**3. Type consistency:**
- `BlockEvalResult` (Task 6) and `PageEvalResult` (Task 6) match the imports added in `plug.ts` (Task 8).
- `evaluateBlock` signature in Task 4 matches its caller in Task 6 (`evaluatePageContinuous`).
- `evaluateRows` signature in Task 4 matches its extension in Task 5 (same param list, just adds branching).
- `computeTotal(rows, opts?)` signature in Task 5 is back-compatible with all existing single-arg calls (the opts param is optional).
- `clearLineRefs(parser)` in Task 6 takes the same parser type used elsewhere in engine.ts.
- `findBlockByBody` and `normalizeBody` in Task 8 are scoped to plug.ts; nothing imports them externally.

**4. Counts and commands:** Test counts (203 → 209 → 218 → 227 → 236 → 247 → 251) advance monotonically; `npx vitest run` and `npx tsc --noEmit` are the same commands used in prior plans. `npm run build` produces `reckon.plug.js`; the bundle is committed once at Task 8 (the only task that materially changes runtime behavior; tasks 1-6 only affect engine code that the bundle re-includes via `npm run build`).

Wait — that's a discrepancy. Lexer/parser/engine changes DO affect the bundle. The plan only rebuilds at Task 8. Should each task rebuild?

Reviewing the existing repo's commit pattern: the `feat(engine): line references via lineN scope variables` and `feat(engine): ans references previous numeric result` commits each touched `reckon.plug.js`. So per-task rebuild and commit is the existing convention. Updating the plan inline to add `npm run build` and `git add reckon.plug.js reckon.plug.js.map` to each src-touching task's commit step.

(Inline fix: append a "rebuild" sub-step to each `Step N: commit` block in Tasks 1, 2, 3, 4, 5, 6, 7. Task 8 already does this; Task 9 explicitly notes the bundle should be unchanged.)

**Inline fix instructions for the engineer:** before the `git commit` line in Tasks 1-7, run `npm run build` and `git add reckon.plug.js reckon.plug.js.map`. The plan's text shows the simpler `git add src/...` form for clarity, but every src-touching task ships a fresh bundle in the same commit.

If the rebuild produces no diff (e.g. tree-shaking eliminated the change), `git add` is a no-op and the commit goes through normally. Don't `git commit --allow-empty` — if there's truly no diff to the bundle, that's a sign the change isn't being picked up.

---

## Plan complete

Plan saved to `docs/superpowers/plans/2026-05-05-cross-block-continuous-and-total.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

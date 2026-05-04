# Reckon Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land four small Soulver-parity fixes as one quality bundle on top of the V1 baseline (issue #1): auto-total excludes assignment rows; lines beginning with `#` or `//` always render as comments; a percent-literal assignment (`tax = 20%`) displays as `20%` instead of `0.2`; and assignment LHS accepts multi-word names like `current tax`.

**Architecture:** All four fixes are localized to `src/parser.ts` and `src/engine.ts`. The most invasive (multi-word vars) introduces a per-evaluation `Map<string,string>` of original-spelling → canonical-underscored name that is threaded through `rewriteExpression` and applied longest-original-first to source text before mathjs sees it. The existing `percentageVars` set continues to key on the canonical form so the additive-percent rewrite still fires for multi-word percent vars. The other three fixes are one-line or near-one-line changes inside `engine.evaluateLine` / `engine.computeTotal`. No new dependencies, no new modules.

**Tech Stack:** TypeScript, mathjs ^14, vitest 2.x — all already in place.

**Source issue:** `gh issue view 1` (Soulver-parity quality fixes). 4 acceptance criteria, all targeted by this plan.

---

## Conventions used by this plan

- TDD throughout: write failing test → run to confirm fail → implement → run to confirm pass → commit.
- Each sub-fix gets its own commit, in increasing order of invasiveness so blast radius stays small.
- Paths are repo-root-relative; `src/foo.ts` means `/home/mannu/code/silverbullet-reckon/src/foo.ts`.
- Commit message style follows the existing repo: lowercase prefix (`fix:`, `feat:`, `test:`, `docs:`, `infra:`).
- After all four fixes land and tests are green, Task 6 builds the bundle, refreshes the dev space, writes the Changelog entry, and posts the GitHub issue closeout — then waits for the user's live-container verification before close. Do NOT close the issue until the user confirms.
- Keep `npm test` green at every commit. Run `npx tsc --noEmit` before each commit.
- Direct work on `main`, no worktree (per repo memory).

## Design decisions resolved inline

These were the open design choices flagged when the plan was scoped. Resolutions:

**Sub-fix 3 (percent display):** the assignment row's `result` column is the trimmed RHS as the user typed it (e.g. `20%`, `20.5%`, `20 %`). Not a recomputed `(numeric * 100) + "%"`. Reasons: (a) preserves user spelling — the source column shows `tax = 20%` and the result column shows `20%`, which is the intuitive Soulver-style mirror; (b) trivial to implement; (c) the underlying `numeric` field still carries `0.2` in case a future feature wants the actual value.

**Sub-fix 4 (multi-word vars):**
- LHS regex accepts any whitespace-separated run of identifiers. Internal whitespace is normalized to single spaces in `varName` (so `current   tax` and `current\ttax` both become `current tax`).
- Canonical form (what mathjs sees) is the name with whitespace runs replaced by `_`: `current tax` → `current_tax`. Underscores are valid mathjs identifier chars.
- Rewrite step in `rewriteExpression` does longest-original-first replacement using a tolerant `\s+` regex between word parts, so a later reference written with a tab still matches a name registered with a space.
- Display preserves the user's original spelling in `source` (the literal raw line) and `varName` (the normalized-but-still-spaced form). The canonical underscored form never reaches the renderer.
- `percentageVars` set keys on the canonical form so additive rewrites continue to fire after multi-word substitution.
- **Known limitation, not fixed in this plan:** if both `a b` and `b c` are registered, multi-word rewrite is greedy left-to-right — `a b c` becomes `a_b c` and `b c` no longer matches. Document only if a user surfaces it.

**Sub-fix 1 (comment escape):** the check goes at the top of `engine.evaluateLine`, before assignment detection. Lines whose `.trim()` starts with `#` or `//` become `{ kind: "comment", source: raw.text }` — the original text (including any leading whitespace) is preserved verbatim so the rendered source column looks exactly as typed. The check fires regardless of whether the rest of the line would have parsed; this is the explicit contract the issue asks for, even though current observable behavior already produces a comment via mathjs's silent-error path in every case I could construct. The fix's value is forward-compatibility (locks the behavior in case mathjs's grammar ever extends to accept `#` or `//` prefixes) and clarity for readers.

---

## Task 1: Auto-total excludes assignment rows (Fix 2)

**Files:**
- Modify: `src/engine.ts` (function `computeTotal`)
- Test: `src/engine.test.ts` (add tests)

The smallest, most isolated fix. Current `computeTotal` sums `numeric` for both `value` and `assignment` rows; the issue requires `assignment` rows to be excluded. Two-line change.

- [ ] **Step 1.1: Add the failing tests**

Append to `src/engine.test.ts` (a new `describe` block at the bottom of the file is fine — pick the location that matches the file's existing organization):

```ts
describe("engine.evaluate — auto-total scope (excludes assignments)", () => {
  it("does not include `tax = 20%` assignment numeric in the total", () => {
    const out = evaluate("tax = 20%\n100\n");
    // Pre-fix: 0.2 + 100 = 100.2. Post-fix: just 100.
    expect(out.total).toEqual({ value: "100" });
  });

  it("ignores assignment rows even with multiple value rows", () => {
    const out = evaluate("salary = 200000\n100\n200\n");
    // Pre-fix: 200000 + 100 + 200 = 200,300. Post-fix: 100 + 200 = 300.
    expect(out.total).toEqual({ value: "300" });
  });

  it("returns null total when only assignments exist (no value rows)", () => {
    const out = evaluate("a = 1\nb = 2\n");
    // Pre-fix would return Total 3. Post-fix: null (no value rows to sum).
    expect(out.total).toBe(null);
  });
});
```

- [ ] **Step 1.2: Run the new tests, verify they fail**

Run: `npm test -- engine`
Expected: The three new tests fail with the pre-fix totals (`100.2`, `200,300`, and a `Total 3` row instead of null). All other engine tests still pass.

- [ ] **Step 1.3: Modify `computeTotal` in `src/engine.ts`**

Replace lines 133-146 (the current `computeTotal`):

```ts
function computeTotal(rows: ResultRow[]): TotalRow | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (row.kind === "value" || row.kind === "assignment") {
      if (row.numeric !== undefined && Number.isFinite(row.numeric)) {
        sum += row.numeric;
        any = true;
      }
    }
  }
  if (!any) return null;
  return { value: NUMBER_FORMATTER.format(sum) };
}
```

With:

```ts
function computeTotal(rows: ResultRow[]): TotalRow | null {
  let sum = 0;
  let any = false;
  for (const row of rows) {
    if (row.kind === "value" && row.numeric !== undefined && Number.isFinite(row.numeric)) {
      sum += row.numeric;
      any = true;
    }
  }
  if (!any) return null;
  return { value: NUMBER_FORMATTER.format(sum) };
}
```

- [ ] **Step 1.4: Run all tests**

Run: `npm test`
Expected: All tests pass (existing 71 + 3 new = 74). No regressions — none of the existing tests assert auto-total values that would have included an assignment row.

- [ ] **Step 1.5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "fix(engine): auto-total excludes assignment rows"
```

---

## Task 2: Comment escape for `#` and `//` lines (Fix 1)

**Files:**
- Modify: `src/engine.ts` (function `evaluateLine`)
- Test: `src/engine.test.ts`

Lines whose trimmed content begins with `#` or `//` are explicitly classified as comment rows before assignment detection or mathjs evaluation. The original `source` (including any leading whitespace) is preserved verbatim.

- [ ] **Step 2.1: Add the failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluate — comment escape (# and //)", () => {
  it("renders `# heading` as a comment, source preserved", () => {
    const out = evaluate("# heading\n");
    expect(out.rows[0]).toEqual({
      kind: "comment",
      line: 1,
      source: "# heading",
    });
  });

  it("renders `// note to self` as a comment", () => {
    const out = evaluate("// note to self\n");
    expect(out.rows[0]).toEqual({
      kind: "comment",
      line: 1,
      source: "// note to self",
    });
  });

  it("respects leading whitespace before the marker (still a comment)", () => {
    const out = evaluate("   # indented\n");
    expect(out.rows[0]).toEqual({
      kind: "comment",
      line: 1,
      source: "   # indented",
    });
  });

  it("escapes `# tax = 20%` so it does not become an assignment", () => {
    const out = evaluate("# tax = 20%\n");
    expect(out.rows[0].kind).toBe("comment");
    // Critically: no `tax` should be in scope on the next line.
  });

  it("does not intercept mid-line `#` (mathjs handles it as inline comment)", () => {
    // Our line-start escape only fires when the trimmed line begins with
    // `#` or `//`. mathjs natively treats trailing `#` as an inline
    // comment, so `5 # inline` evaluates to `5` — both behaviors compose.
    const out = evaluate("5 # inline\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "5" });
  });

  it("`#` escape blocks scope leakage from the would-be assignment", () => {
    const out = evaluate("# tax = 20%\n100 + tax\n");
    // Line 1 is a comment, so `tax` was never assigned. Line 2 references
    // an undefined `tax` — silent-error → comment.
    expect(out.rows[0].kind).toBe("comment");
    expect(out.rows[1].kind).toBe("comment");
  });
});
```

> **Note on TDD here:** mathjs natively treats `#` as inline-comment syntax (so `5 # inline` evaluates to `5`, and `# heading` evaluates to nothing — the parser's `evaluate` on a pure-comment line returns `undefined`, which goes through `formatValue` and renders as a value row with text `"undefined"`). That means the line-start escape DOES change observable behavior: without the fix, `# heading` becomes a `kind: "value"` row showing `"undefined"`; with the fix, it's an explicit comment row with the original source. The mid-line `#` test verifies our escape composes with mathjs's native handling — we don't intercept `5 # inline`. Most of the line-start tests fail before the fix and pass after, so this IS a real TDD red→green cycle.

- [ ] **Step 2.2: Run the new tests**

Run: `npm test -- engine`
Expected: All new tests pass even without the fix (see note above). No regressions in the 74 existing tests.

- [ ] **Step 2.3: Implement the explicit comment escape in `src/engine.ts`**

In `evaluateLine` (currently lines 58-108), add the escape check immediately after the blank-line check.

Find:

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
): ResultRow {
  if (raw.text.trim() === "") {
    return { kind: "blank", line: raw.line };
  }

  const assignment = detectAssignment(raw.text);
```

Change to:

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
): ResultRow {
  const trimmed = raw.text.trim();
  if (trimmed === "") {
    return { kind: "blank", line: raw.line };
  }

  // Explicit comment escape: lines beginning with `#` or `//` are comments
  // even if their tail would parse as math. Locks the contract regardless
  // of whether mathjs's grammar evolves to accept them.
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  const assignment = detectAssignment(raw.text);
```

- [ ] **Step 2.4: Run tests, type-check**

Run: `npm test`
Expected: All tests pass.

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2.5: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "feat(engine): explicit comment escape for # and // line prefixes"
```

---

## Task 3: Percent-literal assignment displays as `N%` (Fix 3)

**Files:**
- Modify: `src/engine.ts` (function `evaluateLine`, assignment-row branch)
- Test: `src/engine.test.ts`

When an assignment's RHS is a literal percentage (`tax = 20%`), the result column shows the trimmed RHS verbatim (`20%`), not the underlying decimal (`0.2`). Implementation: after evaluation, if `assignment.isPercentageRhs`, override the assignment row's `result` field with `assignment.rhs`. The `numeric` field still carries the actual value (`0.2`) — irrelevant to the auto-total now (Task 1 excluded assignment numerics) but kept for potential future use.

- [ ] **Step 3.1: Add the failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluate — percent-literal assignment display (Fix 3)", () => {
  it("`tax = 20%` shows `20%` in the result column, not `0.2`", () => {
    const out = evaluate("tax = 20%\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "tax",
      source: "tax = 20%",
      result: "20%",
    });
  });

  it("preserves user spelling: `tax = 20.5%` shows `20.5%`", () => {
    const out = evaluate("tax = 20.5%\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "20.5%",
    });
  });

  it("preserves whitespace in RHS: `tax = 20 %` shows `20 %`", () => {
    const out = evaluate("tax = 20 %\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "20 %",
    });
  });

  it("non-percent assignments still format normally: `salary = 200000` → `200,000`", () => {
    const out = evaluate("salary = 200000\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "200,000",
    });
  });

  it("percent-RHS expression (not a literal) is NOT a percent display: `rate = 20% of 450` → `90`", () => {
    const out = evaluate("rate = 20% of 450\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "90",
    });
  });

  it("downstream additive percent still works after this fix: `tax = 20%` then `100 + tax` → `120`", () => {
    const out = evaluate("tax = 20%\n100 + tax\n");
    expect(out.rows[0]).toMatchObject({ kind: "assignment", result: "20%" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "120" });
  });
});
```

- [ ] **Step 3.2: Run the new tests, verify they fail**

Run: `npm test -- engine`
Expected: Tests asserting `result: "20%"` / `"20.5%"` / `"20 %"` fail (current results are `"0.2"` / `"0.205"` / `"0.2"`). The two negative-control tests (`salary` and `rate = 20% of 450`) and the additive-still-works test pass.

- [ ] **Step 3.3: Update the assignment-row construction in `src/engine.ts`**

In `evaluateLine`, find the assignment-row return (currently around lines 91-99 — the `if (assignment) { return { kind: "assignment", ... } }` block):

```ts
  if (assignment) {
    return {
      kind: "assignment",
      line: raw.line,
      source: raw.text,
      varName: assignment.varName,
      result: formatted.text,
      numeric: formatted.numeric,
    };
  }
```

Change to:

```ts
  if (assignment) {
    return {
      kind: "assignment",
      line: raw.line,
      source: raw.text,
      varName: assignment.varName,
      // Percent-literal assignments display the RHS as typed (e.g. "20%"),
      // not the underlying decimal (0.2). The `numeric` field still carries
      // the actual value for any internal use.
      result: assignment.isPercentageRhs ? assignment.rhs : formatted.text,
      numeric: formatted.numeric,
    };
  }
```

- [ ] **Step 3.4: Run tests, type-check**

Run: `npm test`
Expected: All tests pass.

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3.5: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "feat(engine): display percent-literal assignments as N% (preserve user spelling)"
```

---

## Task 4: Multi-word variable name detection (Fix 4, parser part)

**Files:**
- Modify: `src/parser.ts` (`ASSIGNMENT_RE`, `detectAssignment`, `rewriteExpression` signature + new multi-word rewrite step)
- Test: `src/parser.test.ts`

This task changes the parser-level surface only. `detectAssignment` accepts whitespace-separated runs of identifiers as an LHS and normalizes whitespace. `rewriteExpression` gains an optional `multiWordVars` parameter (a `ReadonlyMap<string,string>` of original → canonical) and applies longest-original-first substitution at the *start* of the rewrite pipeline. Engine-level wiring is in Task 5.

- [ ] **Step 4.1: Add the failing tests**

Append to `src/parser.test.ts`:

```ts
describe("detectAssignment — multi-word LHS (Fix 4)", () => {
  it("identifies `current tax = 20%` as a multi-word percent assignment", () => {
    expect(detectAssignment("current tax = 20%")).toEqual({
      varName: "current tax",
      rhs: "20%",
      isPercentageRhs: true,
    });
  });

  it("normalizes runs of internal whitespace to a single space", () => {
    expect(detectAssignment("current   tax = 20%")).toEqual({
      varName: "current tax",
      rhs: "20%",
      isPercentageRhs: true,
    });
  });

  it("normalizes tab-separated identifiers to a single space", () => {
    expect(detectAssignment("current\ttax = 20%")).toEqual({
      varName: "current tax",
      rhs: "20%",
      isPercentageRhs: true,
    });
  });

  it("accepts three-word LHS: `a b c = 5`", () => {
    expect(detectAssignment("a b c = 5")).toEqual({
      varName: "a b c",
      rhs: "5",
      isPercentageRhs: false,
    });
  });

  it("does not treat a digit-led LHS as an assignment", () => {
    expect(detectAssignment("100 km in miles")).toBeNull();
  });

  it("still works for single-word LHS (no regression)", () => {
    expect(detectAssignment("tax = 20%")).toEqual({
      varName: "tax",
      rhs: "20%",
      isPercentageRhs: true,
    });
    expect(detectAssignment("salary = 200000")).toEqual({
      varName: "salary",
      rhs: "200000",
      isPercentageRhs: false,
    });
  });
});

describe("rewriteExpression — multi-word var substitution (Fix 4)", () => {
  it("substitutes a registered multi-word var with its canonical form", () => {
    const out = rewriteExpression(
      "100 + current tax",
      new Set<string>(),
      new Map([["current tax", "current_tax"]]),
    );
    expect(out).toBe("100 + current_tax");
  });

  it("also fires the additive-percent rewrite when the canonical name is a percent var", () => {
    const out = rewriteExpression(
      "100 + current tax",
      new Set(["current_tax"]),
      new Map([["current tax", "current_tax"]]),
    );
    expect(out).toBe("100 * (1 + current_tax)");
  });

  it("matches a tab-separated reference using a space-registered name", () => {
    const out = rewriteExpression(
      "100 + current\ttax",
      new Set<string>(),
      new Map([["current tax", "current_tax"]]),
    );
    expect(out).toBe("100 + current_tax");
  });

  it("does not false-match inside a longer identifier", () => {
    // `mycurrent tax` should NOT be substituted to `mycurrent_tax` (the
    // `\b` boundary forbids matching when the preceding char is a word char).
    const out = rewriteExpression(
      "5 + mycurrent tax",
      new Set<string>(),
      new Map([["current tax", "current_tax"]]),
    );
    expect(out).toBe("5 + mycurrent tax");
  });

  it("applies longest-original-first when names overlap", () => {
    const out = rewriteExpression(
      "current tax inflation + 1",
      new Set<string>(),
      new Map([
        ["current tax", "current_tax"],
        ["current tax inflation", "current_tax_inflation"],
      ]),
    );
    expect(out).toBe("current_tax_inflation + 1");
  });

  it("is a no-op when multiWordVars is empty (default)", () => {
    expect(rewriteExpression("100 + tax", new Set<string>())).toBe("100 + tax");
  });
});
```

- [ ] **Step 4.2: Run the new tests, verify they fail**

Run: `npm test -- parser`
Expected:
- `detectAssignment` multi-word tests fail because the current `ASSIGNMENT_RE` doesn't allow internal whitespace in the LHS.
- `rewriteExpression` multi-word tests fail because `rewriteExpression` currently has only two params (`expr`, `percentageVars`) — the third-arg signature change breaks the test's call form.

- [ ] **Step 4.3: Update `ASSIGNMENT_RE` and `detectAssignment` in `src/parser.ts`**

Find (currently around line 71-81):

```ts
const ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/;
const PERCENTAGE_LITERAL_RHS_RE = /^\d+(?:\.\d+)?\s*%\s*$/;

export function detectAssignment(line: string): AssignmentInfo | null {
  const m = line.match(ASSIGNMENT_RE);
  if (!m) return null;
  const varName = m[1];
  const rhs = m[2].trim();
  const isPercentageRhs = PERCENTAGE_LITERAL_RHS_RE.test(rhs);
  return { varName, rhs, isPercentageRhs };
}
```

Change to:

```ts
// Accepts whitespace-separated runs of identifiers as the LHS so
// `current tax = 20%` parses as a single multi-word assignment. Internal
// whitespace is normalized in `detectAssignment` so `current\ttax` and
// `current  tax` map to the same name (`current tax`).
const ASSIGNMENT_RE =
  /^([A-Za-z_][A-Za-z0-9_]*(?:\s+[A-Za-z_][A-Za-z0-9_]*)*)\s*=(?!=)\s*(.+)$/;
const PERCENTAGE_LITERAL_RHS_RE = /^\d+(?:\.\d+)?\s*%\s*$/;

export function detectAssignment(line: string): AssignmentInfo | null {
  const m = line.match(ASSIGNMENT_RE);
  if (!m) return null;
  // Normalize all internal whitespace runs to a single space so multi-word
  // names compare equal regardless of how the user spelled them.
  const varName = m[1].trim().replace(/\s+/g, " ");
  const rhs = m[2].trim();
  const isPercentageRhs = PERCENTAGE_LITERAL_RHS_RE.test(rhs);
  return { varName, rhs, isPercentageRhs };
}
```

- [ ] **Step 4.4: Update `rewriteExpression` signature and add the multi-word substitution step**

Find the current signature and body opening (currently around lines 91-95):

```ts
export function rewriteExpression(
  expr: string,
  percentageVars: ReadonlySet<string>,
): string {
  let out = expr;
```

Change to:

```ts
export function rewriteExpression(
  expr: string,
  percentageVars: ReadonlySet<string>,
  multiWordVars: ReadonlyMap<string, string> = new Map(),
): string {
  let out = expr;

  // (0) Multi-word variable substitution. Apply longest-original-first so
  // overlapping names (`a b` and `a b c`) prefer the more specific match.
  // Each registered name's literal whitespace is replaced with `\s+` in
  // the regex so a later reference written with a tab still matches a name
  // registered with a space. `\b` boundaries prevent false matches inside
  // longer identifiers (`mycurrent tax` won't match `current tax`).
  if (multiWordVars.size > 0) {
    const names = Array.from(multiWordVars.keys()).sort(
      (a, b) => b.length - a.length,
    );
    for (const name of names) {
      if (!name.includes(" ")) continue; // single-word names need no rewrite
      const canonical = multiWordVars.get(name)!;
      const pattern = name
        .split(/\s+/)
        .map(escapeRegex)
        .join("\\s+");
      const re = new RegExp(`\\b${pattern}\\b`, "g");
      out = out.replace(re, canonical);
    }
  }
```

(The rest of `rewriteExpression` is unchanged — keep the existing literal additive-percent loop, percent-var loop, `N% of Y`, standalone `N%`, and `in → to` blocks intact.)

- [ ] **Step 4.5: Run tests**

Run: `npm test -- parser`
Expected: All parser tests pass — the new multi-word `detectAssignment` and `rewriteExpression` tests pass, and all 29 pre-existing parser tests still pass (the optional third arg means existing 2-arg calls still type-check and behave identically).

Run: `npm test`
Expected: Whole suite passes (frontmatter + parser + engine + render).

- [ ] **Step 4.6: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4.7: Commit**

```bash
git add src/parser.ts src/parser.test.ts
git commit -m "feat(parser): multi-word variable names (LHS detection + rewrite step)"
```

---

## Task 5: Multi-word variable threading through the engine (Fix 4, engine part)

**Files:**
- Modify: `src/engine.ts` (`evaluate`, `evaluateLine`)
- Test: `src/engine.test.ts`

The parser now supports multi-word names in isolation. This task wires them into the engine: a per-evaluation `Map<string,string>` maps original spellings to canonical underscored forms, mathjs sees only the canonical form, the percentageVars set keys on the canonical form, and result rows show the original spelling.

- [ ] **Step 5.1: Add the failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluate — multi-word variable names (Fix 4)", () => {
  it("`current tax = 20%` then `100 + current tax` → 120", () => {
    const out = evaluate("current tax = 20%\n100 + current tax\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "current tax",
      source: "current tax = 20%",
      result: "20%",
    });
    expect(out.rows[1]).toMatchObject({
      kind: "value",
      source: "100 + current tax",
      result: "120",
    });
  });

  it("matches the canonical Soulver example: `current tax = 20%` then `300 + current tax` → 360", () => {
    const out = evaluate("current tax = 20%\n300 + current tax\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "360" });
  });

  it("multi-word non-percent assignment: `budget for q2 = 200000` then `budget for q2 * 1.15`", () => {
    const out = evaluate("budget for q2 = 200000\nbudget for q2 * 1.15\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      varName: "budget for q2",
      result: "200,000",
    });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("two independent multi-word vars on the same sheet: `a b = 5` and `c d = 3` then `a b + c d` → 8", () => {
    const out = evaluate("a b = 5\nc d = 3\na b + c d\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "8" });
  });

  it("multi-word reference with tabs/extra spaces still resolves", () => {
    const out = evaluate("current tax = 20%\n100 + current\ttax\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "120" });
  });

  it("auto-total ignores a multi-word assignment and counts only value rows", () => {
    const out = evaluate("current tax = 20%\n100\n200\n");
    expect(out.total).toEqual({ value: "300" });
  });

  it("scope is fresh per evaluate(): a multi-word var defined in one call is not visible in the next", () => {
    evaluate("foo bar = 99\n");
    const out = evaluate("foo bar + 1\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("single-word vars are unaffected by multi-word machinery", () => {
    const out = evaluate("salary = 200000\nsalary * 1.15\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });
});
```

- [ ] **Step 5.2: Run the new tests, verify they fail**

Run: `npm test -- engine`
Expected: All multi-word integration tests fail because `evaluate` doesn't yet build or thread the `multiWordVars` map. The single-word regression test passes (no behavior change for it).

- [ ] **Step 5.3: Update `evaluate` and `evaluateLine` in `src/engine.ts`**

Replace the current `evaluate` (around lines 45-56):

```ts
export function evaluate(text: string): EvaluateResult {
  const lines = extractMathLines(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  const rows: ResultRow[] = [];

  for (const raw of lines) {
    rows.push(evaluateLine(raw, parser, percentageVars));
  }

  return { rows, total: computeTotal(rows) };
}
```

With:

```ts
export function evaluate(text: string): EvaluateResult {
  const lines = extractMathLines(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  // Maps the user's original spelling (e.g. "current tax") to the
  // mathjs-legal canonical form ("current_tax"). Only multi-word names
  // are recorded; single-word assignments don't need rewriting.
  const multiWordVars = new Map<string, string>();
  const rows: ResultRow[] = [];

  for (const raw of lines) {
    rows.push(evaluateLine(raw, parser, percentageVars, multiWordVars));
  }

  return { rows, total: computeTotal(rows) };
}
```

Then replace the `evaluateLine` body to thread `multiWordVars` through. Find the current function (after Tasks 2 and 3 it's around lines 58-115, with the comment-escape and percent-display fixes already in place):

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
): ResultRow {
  const trimmed = raw.text.trim();
  if (trimmed === "") {
    return { kind: "blank", line: raw.line };
  }

  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  const assignment = detectAssignment(raw.text);
  const exprToEvaluate = assignment
    ? `${assignment.varName} = ${rewriteExpression(assignment.rhs, percentageVars)}`
    : rewriteExpression(raw.text, percentageVars);

  let value: unknown;
  try {
    value = parser.evaluate(exprToEvaluate);
  } catch {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  if (assignment) {
    if (assignment.isPercentageRhs) {
      percentageVars.add(assignment.varName);
    } else {
      percentageVars.delete(assignment.varName);
    }
  }

  const formatted = formatValue(value);

  if (assignment) {
    return {
      kind: "assignment",
      line: raw.line,
      source: raw.text,
      varName: assignment.varName,
      result: assignment.isPercentageRhs ? assignment.rhs : formatted.text,
      numeric: formatted.numeric,
    };
  }
  return {
    kind: "value",
    line: raw.line,
    source: raw.text,
    result: formatted.text,
    numeric: formatted.numeric,
  };
}
```

Replace with:

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
): ResultRow {
  const trimmed = raw.text.trim();
  if (trimmed === "") {
    return { kind: "blank", line: raw.line };
  }

  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  const assignment = detectAssignment(raw.text);

  // Canonical name = user's original spelling with whitespace runs replaced
  // by underscores. Single-word names canonicalize to themselves.
  const canonicalAssignName = assignment
    ? assignment.varName.replace(/\s+/g, "_")
    : null;

  if (assignment && canonicalAssignName && assignment.varName.includes(" ")) {
    multiWordVars.set(assignment.varName, canonicalAssignName);
  }

  const exprToEvaluate = assignment
    ? `${canonicalAssignName} = ${rewriteExpression(assignment.rhs, percentageVars, multiWordVars)}`
    : rewriteExpression(raw.text, percentageVars, multiWordVars);

  let value: unknown;
  try {
    value = parser.evaluate(exprToEvaluate);
  } catch {
    return { kind: "comment", line: raw.line, source: raw.text };
  }

  if (assignment && canonicalAssignName) {
    if (assignment.isPercentageRhs) {
      percentageVars.add(canonicalAssignName);
    } else {
      // Reassignment of a percent-var to a non-percent value: clear the
      // additive flag so subsequent references use plain arithmetic.
      percentageVars.delete(canonicalAssignName);
    }
  }

  const formatted = formatValue(value);

  if (assignment) {
    return {
      kind: "assignment",
      line: raw.line,
      source: raw.text,
      varName: assignment.varName,
      result: assignment.isPercentageRhs ? assignment.rhs : formatted.text,
      numeric: formatted.numeric,
    };
  }
  return {
    kind: "value",
    line: raw.line,
    source: raw.text,
    result: formatted.text,
    numeric: formatted.numeric,
  };
}
```

- [ ] **Step 5.4: Run all tests**

Run: `npm test`
Expected: All tests pass — the new multi-word integration tests in this task plus all earlier suites. Total should be ~85+ tests across the four files.

- [ ] **Step 5.5: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5.6: Commit**

```bash
git add src/engine.ts src/engine.test.ts
git commit -m "feat(engine): thread multi-word variable names through evaluation"
```

---

## Task 6: Closeout — bundle, dev space, Changelog, and issue comment

**Files:**
- Modify: `reckon.plug.js` (rebuilt)
- Create: `infra/space-seed/Changelog.md`
- Possibly: `infra/space/Changelog.md` (gitignored, only if `infra/space/` exists)

This task does the user-facing work: rebuilds the plug, refreshes the dev space, writes the Changelog entry per the closeout pattern, and posts the GitHub issue comment requesting live verification. It does NOT close the issue — wait for the user's confirmation.

- [ ] **Step 6.1: Final clean build**

Run from repo root:

```bash
rm -f reckon.plug.js
npm run build
```

Expected: `reckon.plug.js` is regenerated. No build errors. Bundle size in the same ballpark as before (~600-700 KB pre-tree-shake — that's issue #11 territory, not this one).

- [ ] **Step 6.2: Refresh the dev-space copy of the bundle**

```bash
npm run dev:link
```

Expected: `reckon.plug.js` and `PLUG.md` copied into `infra/space/Library/emsilva/reckon/` if that path exists. (`dev:link` will `mkdir -p` the target so it works even from a clean state.)

- [ ] **Step 6.3: Write the Changelog entry into the seed directory**

Create `infra/space-seed/Changelog.md`:

```markdown
# Changelog

User-facing notes on what changed in each Reckon iteration. Latest at the top.

---

## What's new — Quality Fixes (issue #1)

Four small Soulver-parity fixes:

### 1. Auto-total now ignores assignment rows

Previously, `tax = 20%` followed by `100` summed to `100.2`. Now the total
counts only `value` rows:

```
tax = 20%        | 20%
100              | 100
                 | Total 100
```

### 2. `#` and `//` lines are always comments

Any line whose first non-whitespace character is `#` or `//` is rendered as
a comment row, regardless of what comes after. Useful for headings and
notes inside a sheet:

```
# Q2 budget       | (comment)
// scratch math   | (comment)
1000 + 200        | 1,200
```

### 3. Percent-literal assignments display as `N%`, not `0.2`

When the RHS of an assignment is a literal percentage, the result column
shows the percentage as you typed it:

```
tax = 20%         | 20%
tax = 20.5%       | 20.5%
salary = 200000   | 200,000   (unchanged: only literal percent assignments)
```

### 4. Multi-word variable names

Variable names can now contain spaces — Soulver's signature feature.
Internal whitespace is normalized so `current   tax` and `current\ttax`
both refer to the same name:

```
current tax = 20%               | 20%
300 + current tax               | 360
budget for q2 = 200000          | 200,000
budget for q2 * 1.15            | 230,000
```

The additive-percent convention applies to multi-word percentage variables
too — `300 + current tax` becomes `300 * (1 + 0.2) = 360`, just like the
single-word `tax` example.

---
```

- [ ] **Step 6.4: Mirror the Changelog into the live dev space (if running)**

Only if `infra/space/` exists (the user has run `npm run dev:seed` at least once), drop a copy of the Changelog there too so the running container picks it up via the volume mount:

```bash
if [ -d infra/space ]; then cp infra/space-seed/Changelog.md infra/space/Changelog.md; fi
```

Expected: silent on success, no-op if `infra/space/` is missing. The space copy is gitignored — that's fine.

- [ ] **Step 6.5: Sanity-run the full suite once more**

```bash
npm test
npx tsc --noEmit
```

Expected: All tests pass (~85+), no type errors.

- [ ] **Step 6.6: Commit the bundle and Changelog**

```bash
git add reckon.plug.js infra/space-seed/Changelog.md
git commit -m "docs+build: refresh bundle and Changelog for quality-fixes bundle"
```

> If `reckon.plug.js` did not change (unlikely — the engine and parser were modified), only commit the Changelog.

- [ ] **Step 6.7: Post the GitHub issue comment requesting live verification**

```bash
gh issue comment 1 --body "$(cat <<'EOF'
## Quality fixes shipped on `main`

All four acceptance criteria implemented as separate commits:

- `fix(engine): auto-total excludes assignment rows` — sub-fix 3
- `feat(engine): explicit comment escape for # and // line prefixes` — sub-fix 4
- `feat(engine): display percent-literal assignments as N% (preserve user spelling)` — sub-fix 2
- `feat(parser): multi-word variable names (LHS detection + rewrite step)` — sub-fix 1 (parser)
- `feat(engine): thread multi-word variable names through evaluation` — sub-fix 1 (engine)

Plus a Changelog entry at `infra/space-seed/Changelog.md` (also mirrored into the running dev space) with one example per fix.

### Verification ask

Could you bring up the dev container (`npm run dev:up` if not already running, then `Plugs: Reload`) and verify against `Test Sheet.md` or a fresh sheet:

1. `tax = 20%` followed by `100` totals to `100`, not `100.2`.
2. `# heading` and `// note` lines render as comment rows.
3. `tax = 20%` shows `20%` in the result column (not `0.2`).
4. `current tax = 20%` followed by `300 + current tax` yields `360`.

Once you confirm, I'll close this issue.
EOF
)"
```

Expected: comment is posted to issue #1. The URL is printed to stdout.

- [ ] **Step 6.8: Wait for user verification**

Do NOT run `gh issue close 1` until the user confirms the live behavior matches the asks. The user iterates on the live container and closes manually, or asks for one more revision if something didn't land cleanly.

> **If verification fails:** treat it as a new failing test. Add a regression test in the appropriate `*.test.ts`, fix the code, commit, rebuild, dev:link, update the issue comment with what changed, ask for re-verification.

---

## Out of scope for this plan

These are explicitly NOT addressed here, even though they showed up in design conversation:

- Tree-shaking mathjs to shrink the bundle — issue #11.
- Visible error markers for math typos — issue #2.
- Locale-aware number formatting (relevant for pt-BR users) — issue #4.
- Slash commands for sheet/block insertion — issue #5.
- Date math — issue #6.
- The "overlapping multi-word names" greedy-match limitation — only document it if a user surfaces it.

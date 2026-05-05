# Line References (`lineN`, `ans`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lineN` (numeric value of source line N) and `ans` (most recent prior numeric result) usable inside any reckon expression, in both the page panel and the fenced `reckon` block widget. Closes [issue #8](https://github.com/emsilva/silverbullet-reckon/issues/8).

**Architecture:** After each successful row evaluation in `engine.evaluate`, when the row produced a *finite numeric value*, register two scope variables on the existing mathjs parser: `line<sourceLine>` and `ans`. Forward references and references to non-numeric/comment/heading/blank rows naturally fail because their scope variables were never set, falling through to the existing `kind: "comment"` classification. Per-surface scoping is automatic — each `evaluate()` call already creates its own mathjs parser with isolated scope, so the panel and each fenced block widget already have separate `ans`/`lineN` namespaces with no extra plumbing.

**Tech Stack:** TypeScript 5.5, mathjs 14, vitest 2 (existing).

**Semantic decisions baked into this plan:**
- `lineN` uses the **source line number** from `RawLine.line` (1-based, matches the user's editor line numbers, including any leading frontmatter offset). This matches "RawLine.line is already plumbed" from the issue context.
- `ans` resolves to the **most recent prior row that produced a finite numeric**. This effectively skips blank, comment, heading, unit, string, and boolean rows. The issue spec phrased it as "previous non-blank, non-comment row's value" with a failure clause for "non-numeric row" — modeling `ans` as "last numeric" satisfies both cleanly: non-numeric rows simply don't update `ans`, and if no prior numeric row exists, `ans` is undefined → mathjs throws → comment fallthrough.
- Both `line<N>` and `ans` are populated for **assignments too** (e.g. `salary = 200000` then `ans * 1.15` works), since assignments produce a numeric just like value rows.

---

## File Structure

- `src/engine.ts` (modify) — add 2 lines registering `line<raw.line>` and `ans` after each successful numeric eval, in `evaluateLine` between the `formatted`/`clipboard` computation and the row-return branch.
- `src/engine.test.ts` (modify) — append two new `describe` blocks: `engine.evaluate — line references (lineN)` and `engine.evaluate — line references (ans)`.
- `infra/space-seed/Tests/Line References Verification.md` (create) — `reckon: true` page with each behavior annotated inline. Per the project's per-issue verification rule.
- `infra/space/Tests/Line References Verification.md` (create, gitignored) — runtime mirror so the dev container picks it up without re-running `dev:seed`.
- `infra/space-seed/Changelog.md` (modify) — prepend "What's new — Line references (issue #8)".

No new files in `src/`. The custom symbol resolver mentioned in the issue context turns out to be unnecessary: mathjs's existing parser scope (set via `parser.set(name, value)`) is sufficient because evaluation is strictly top-to-bottom and each `evaluate()` call has an isolated parser.

---

## Task 1: `lineN` references

**Files:**
- Modify: `src/engine.ts:189-214` (insert two lines after `clipboard` computation)
- Test: `src/engine.test.ts` (append new `describe` block at end of file)

- [ ] **Step 1: Write failing tests**

Append to `src/engine.test.ts` (after the last existing `describe` block):

```ts
describe("engine.evaluate — line references (lineN)", () => {
  it("`line1` resolves to the numeric value of source line 1", () => {
    const out = evaluate("100\nline1 + 50\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", line: 1, result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", line: 2, result: "150" });
  });

  it("works with assignment rows: `salary = 200000` then `line1 * 1.15`", () => {
    const out = evaluate("salary = 200000\nline1 * 1.15\n");
    expect(out.rows[0]).toMatchObject({ kind: "assignment", varName: "salary" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("multiple lineN references in one expression", () => {
    const out = evaluate("100\n200\nline1 + line2\n");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "300" });
  });

  it("forward reference (lineN where N > current line) → comment", () => {
    const out = evaluate("line2 + 5\n100\n");
    expect(out.rows[0].kind).toBe("comment");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "100" });
  });

  it("reference to non-numeric (unit) row → comment", () => {
    const out = evaluate("100 km in miles\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to comment row → comment", () => {
    const out = evaluate("not math here\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("comment");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to heading row → comment", () => {
    const out = evaluate("# heading\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("heading");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to blank row → comment", () => {
    const out = evaluate("\nline1 + 5\n");
    expect(out.rows[0].kind).toBe("blank");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("reference to non-existent line (line99) → comment", () => {
    const out = evaluate("100\nline99 + 5\n");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("source line numbering accounts for frontmatter (lineN matches editor line)", () => {
    const out = evaluate("---\nreckon: true\n---\n\n100\nline5 + 50\n");
    // Frontmatter lines 1-3 + closing-delim consumes line 4 (blank). The first
    // math line is source line 5; second math line is source line 6.
    expect(out.rows[0]).toMatchObject({ kind: "value", line: 5, result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", line: 6, result: "150" });
  });

  it("isolation: each evaluate() call has a fresh scope (line1 not visible across calls)", () => {
    evaluate("99\n");
    const out = evaluate("line1 + 1\n");
    expect(out.rows[0].kind).toBe("comment");
  });
});
```

- [ ] **Step 2: Run tests, confirm failures**

Run: `npx vitest run src/engine.test.ts -t "line references \(lineN\)" --reporter verbose`

Expected: tests that compute a value (basic, assignment, multiple-refs, frontmatter-offset) FAIL with a comment row instead of the expected `kind: "value"`. The comment-fallback cases (forward ref, non-numeric ref, comment ref, heading ref, blank ref, line99, isolation) PASS trivially because `line1`/`line99` are unknown to mathjs and so the row already classifies as comment without any new code.

This mixed pass/fail is expected — TDD discipline here is to confirm the failures match the missing implementation.

- [ ] **Step 3: Implement lineN registration**

Modify `src/engine.ts`. Find the block in `evaluateLine` (around lines 189-191):

```ts
  const formatted = formatValue(value);

  const clipboard = computeClipboard(value, formatted);
```

Insert immediately after the `clipboard` line, **before** the `if (assignment) { ... return }` block:

```ts
  const formatted = formatValue(value);

  const clipboard = computeClipboard(value, formatted);

  // Register the numeric result for line references (lineN).
  // Only finite numerics are referenceable; unit values, strings, and
  // booleans don't get registered, so references to those rows throw and
  // fall through to the comment classification.
  if (formatted.numeric !== undefined && Number.isFinite(formatted.numeric)) {
    parser.set(`line${raw.line}`, formatted.numeric);
  }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run src/engine.test.ts -t "line references \(lineN\)"`

Expected: all `lineN` tests PASS.

- [ ] **Step 5: Run full test suite for regressions**

Run: `npx vitest run`

Expected: all 162 prior tests + 11 new `lineN` tests PASS (173 total).

- [ ] **Step 6: Type-check + build + commit**

```bash
npx tsc --noEmit
npm run build
git add src/engine.ts src/engine.test.ts reckon.plug.js
git commit -m "feat(engine): line references via lineN scope variables"
```

---

## Task 2: `ans` reference

**Files:**
- Modify: `src/engine.ts` (extend the same registration block from Task 1 — one extra `parser.set` call)
- Test: `src/engine.test.ts` (append second new `describe` block)

- [ ] **Step 1: Write failing tests**

Append to `src/engine.test.ts` (after the `lineN` describe block from Task 1):

```ts
describe("engine.evaluate — line references (ans)", () => {
  it("`ans` on row 2 resolves to row 1's numeric result", () => {
    const out = evaluate("100\nans + 50\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "150" });
  });

  it("`ans` chains: 100, ans * 2, ans + 1 → 100, 200, 201", () => {
    const out = evaluate("100\nans * 2\nans + 1\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "100" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "200" });
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "201" });
  });

  it("`ans` skips intervening non-numeric rows (unit) — keeps last numeric", () => {
    const out = evaluate("100\n200 km\nans + 5\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "100" });
    expect(out.rows[1].kind).toBe("value"); // unit row, numeric undefined
    expect(out.rows[1].kind === "value" && out.rows[1].numeric).toBeUndefined();
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` skips comment rows", () => {
    const out = evaluate("100\nnot math\nans + 5\n");
    expect(out.rows[1].kind).toBe("comment");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` skips blank rows", () => {
    const out = evaluate("100\n\nans + 5\n");
    expect(out.rows[1].kind).toBe("blank");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` skips heading rows", () => {
    const out = evaluate("100\n# heading\nans + 5\n");
    expect(out.rows[1].kind).toBe("heading");
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105" });
  });

  it("`ans` works with assignments: salary = 200000, ans * 1.15 → 230,000", () => {
    const out = evaluate("salary = 200000\nans * 1.15\n");
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "230,000" });
  });

  it("`ans` on the first line → comment (no prior result)", () => {
    const out = evaluate("ans + 5\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`ans` after only non-numeric rows → comment (no numeric to reference)", () => {
    const out = evaluate("100 km in miles\nans + 5\n");
    expect(out.rows[0].kind).toBe("value");
    expect(out.rows[1].kind).toBe("comment");
  });

  it("isolation: each evaluate() call has a fresh `ans`", () => {
    evaluate("99\n");
    const out = evaluate("ans + 1\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("realistic chain — bill, tip, total: 80, ans + 10%, ans * 1.2 → 80, 88, 105.6", () => {
    const out = evaluate("80\nans + 10%\nans * 1.2\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "80" });
    expect(out.rows[1]).toMatchObject({ kind: "value", result: "88" });
    expect(out.rows[2]).toMatchObject({ kind: "value", result: "105.6" });
  });
});
```

- [ ] **Step 2: Run tests, confirm failures**

Run: `npx vitest run src/engine.test.ts -t "line references \(ans\)" --reporter verbose`

Expected: success cases (all `ans + ...` chains) FAIL with comment rows. Comment-fallback cases (first line, after non-numeric only, isolation) PASS trivially.

- [ ] **Step 3: Implement ans registration**

Modify `src/engine.ts`. Extend the registration block from Task 1:

```ts
  // Register the numeric result for line references (lineN).
  // Only finite numerics are referenceable; unit values, strings, and
  // booleans don't get registered, so references to those rows throw and
  // fall through to the comment classification. `ans` carries the
  // most-recent numeric — non-numeric rows leave `ans` pointing at the
  // previous numeric result.
  if (formatted.numeric !== undefined && Number.isFinite(formatted.numeric)) {
    parser.set(`line${raw.line}`, formatted.numeric);
    parser.set("ans", formatted.numeric);
  }
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run src/engine.test.ts -t "line references \(ans\)"`

Expected: all `ans` tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`

Expected: 162 prior + 11 lineN + 11 ans = 184 PASS.

- [ ] **Step 6: Type-check + build + commit**

```bash
npx tsc --noEmit
npm run build
git add src/engine.ts src/engine.test.ts reckon.plug.js
git commit -m "feat(engine): ans references previous numeric result"
```

---

## Task 3: Verification page + Changelog

**Files:**
- Create: `infra/space-seed/Tests/Line References Verification.md`
- Create: `infra/space/Tests/Line References Verification.md` (runtime mirror, gitignored)
- Modify: `infra/space-seed/Changelog.md` (prepend new entry)

- [ ] **Step 1: Create verification page in seed**

Path: `infra/space-seed/Tests/Line References Verification.md`

Content (the file is itself a `reckon: true` sheet — opening it in SilverBullet shows the panel evaluation; the embedded fenced `reckon` block tests the block-widget surface):

````md
---
reckon: true
---

# Line References — Live Verification

Open this page in Silverbullet. The right-hand panel should match the
`# expected: ...` annotation under each section. The fenced `reckon`
block at the bottom verifies the block-widget surface in isolation.

## lineN — explicit row reference

100
200
line8 + line9
// expected (panel): 100, 200, 300
// (line numbers are source-relative — `line8` and `line9` reference the
// `100` and `200` rows above; adjust if you edit the page above this
// section.)

## ans — previous numeric result chain

50
ans * 2
ans + 1
// expected (panel): 50, 100, 101

## ans skips intervening non-numeric rows

100
not math here
ans + 5
// expected (panel): 100, comment row, 105

## Realistic chain — bill → tip → total

80
ans + 10%
ans * 1.2
// expected (panel): 80, 88, 105.6

## Failure modes (should be comments)

line99 + 5
// expected: comment (no source line 99)

## Per-block isolation

The fenced block below has its own `ans` and `lineN` scope, independent
of the page panel:

```reckon
40
ans + 1
line1 * 10
```

// expected (block widget at right of fenced block): 40, 41, 400
// The block's `line1 = 40` does not affect the page panel's `line1`.
````

- [ ] **Step 2: Mirror to runtime space**

```bash
mkdir -p infra/space/Tests
cp "infra/space-seed/Tests/Line References Verification.md" "infra/space/Tests/Line References Verification.md"
```

(`infra/space/` is gitignored — this copy is for the dev container to pick up immediately without re-running `dev:seed`.)

- [ ] **Step 3: Prepend Changelog entry**

Read `infra/space-seed/Changelog.md`, then insert this block immediately after the file's intro lines and before the existing top entry (currently `## What's new — Visual polish (issue #3)`).

The new entry to insert:

```md
## What's new — Line references (issue #8)

Two new built-in references make chained calculations possible without
re-typing or naming intermediate variables:

### `lineN` — explicit row reference

Refer to the numeric value of any earlier row by its source line number:

    100
    200
    line1 + line2     # 300

`lineN` is the **source** line number — the same one your editor shows.
For pages with frontmatter, that means the first math row may be
`line5` or `line6`, not `line1`. References to a non-existent or
non-numeric row (heading, comment, unit, blank, or a line that hasn't
been evaluated yet) silently classify as comment.

### `ans` — previous numeric result

Carries forward the most recent numeric result, skipping intervening
non-numeric rows (units, comments, headings, blanks). Useful for
narrative chains:

    80
    ans + 10%         # 88
    ans * 1.2         # 105.6

If the current line is the first numeric line, `ans` is undefined and
the line classifies as comment.

### Per-surface scope

Both work in the page panel and inside fenced ```reckon``` blocks. Each
surface has its own `ans`/`lineN` namespace — a block's `line1` is its
own first row, not the page's.
```

(Match the existing Changelog's wording style and `---` separator; keep the latest-at-top convention.)

- [ ] **Step 4: Final type-check + build (sanity)**

```bash
npx tsc --noEmit
npm run build
```

Expected: no errors. `reckon.plug.js` should be unchanged from Task 2's commit (this task only touches docs), but rebuilding confirms the bundle is in sync.

- [ ] **Step 5: Commit closeout (docs only — no plug rebuild needed)**

```bash
git add infra/space-seed/Tests/ infra/space-seed/Changelog.md
git commit -m "docs(infra): Changelog + Tests/ verification page for line references"
```

(Don't `git add infra/space/` — it's gitignored. Don't re-add `reckon.plug.js` — Task 2 already committed it and it shouldn't have changed.)

- [ ] **Step 6: Comment on issue #8 requesting verification**

```bash
gh issue comment 8 --body "$(cat <<'EOF'
## Line references shipped on `main`

Issue #8's two forms landed as a 3-commit bundle:

- `feat(engine): line references via lineN scope variables`
- `feat(engine): ans references previous numeric result`
- `docs(infra): Changelog + Tests/ verification page for line references`

To verify live, open `Tests/Line References Verification.md` in
SilverBullet — the panel should match the `# expected:` annotations,
and the fenced `reckon` block at the bottom should show isolated scope
(its `line1 = 40`, independent of the page panel).

Reply once verified and I'll close.
EOF
)"
```

Leave the issue OPEN. The user verifies in-browser, then closes via `gh issue close 8`.

---

## Self-Review

**1. Spec coverage:**

| Acceptance criterion | Covered by |
|---|---|
| `lineN` resolves to row N (1-based, panel-wide) | Task 1 Step 3 + Task 1 tests (basic, multiple-refs) |
| `ans` resolves to previous non-blank, non-comment row's value | Task 2 Step 3 + Task 2 tests (basic, chains, skips-intervening) |
| Non-existent / non-numeric row → comment (or error w/ #2) | Task 1 tests (forward, line99, unit, heading) + Task 2 tests (first-line, after-only-non-numeric) |
| Works in panel + fenced block, each scoped to its own row sequence | Inherent from `evaluate()` parser-per-call architecture; verified live by the embedded fenced block in Task 3's verification page. The `engine.test.ts` "isolation" tests (Task 1 last + Task 2 last) prove fresh-scope per `evaluate()`. |
| Existing tests still pass; new tests cover both forms + failure path | Task 1 Step 5 + Task 2 Step 5 (full-suite runs) |
| Verification page in `Tests/` per project convention | Task 3 |
| Changelog entry | Task 3 |
| `reckon.plug.js` rebuilt with each src-touching commit (CI bundle-drift check) | Task 1 Step 6 + Task 2 Step 6 |

The "(or error if visible-errors mode from #2 is on)" half of the failure-classification criterion is intentionally NOT covered — issue #2 is open and not yet implemented. When #2 lands, its plan will need to retrofit the comment fallthrough in `evaluateLine` to optionally produce an error row instead. This plan does NOT pre-emptively wire that up (YAGNI).

**2. Placeholder scan:** No "TBD", "TODO", "implement later", or under-specified tests. Every test has a complete assertion; the implementation block in Tasks 1 and 3 contains the literal code to insert.

**3. Type consistency:**
- `parser.set(name: string, value: unknown)` — mathjs's existing API, used identically in both Task 1 and Task 2.
- `formatted.numeric` — `number | undefined`, defined in `engine.ts`'s existing `FormattedValue` interface (no new types introduced).
- `raw.line` — `number`, defined in `parser.ts`'s `RawLine` interface.
- Test assertions use `toMatchObject({ kind, result })` consistently with the rest of the file.
- `kind: "value"` numeric-undefined check uses `out.rows[1].kind === "value" && out.rows[1].numeric` — matches the discriminated-union narrowing pattern used by every other test in the file (e.g. line 16: `out.rows[0].kind === "value" && out.rows[0].result`).

No drift between tasks.

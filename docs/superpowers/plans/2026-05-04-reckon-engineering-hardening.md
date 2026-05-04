# Reckon Engineering Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land three engineering-quality items from the V1 final review (issue #11) as a small bundle: (a) tree-shake `mathjs` to drop the bundled plug from ~654 KB to the 150–250 KB target by replacing `create(all)` with `create(parserDependencies)`; (b) add an integration snapshot test that exercises `evaluate(text) → renderSheet(...)` end-to-end so engine/renderer contract drift surfaces; (c) ship a GitHub Actions workflow that runs `npm test`, `npm run build`, and fails CI if the committed `reckon.plug.js` doesn't match a fresh rebuild.

**Architecture:** Each item is independent. Item (a) is a one-import-statement change in `src/engine.ts` plus a `package.json` no-op (mathjs already imported); the iteration is verifying the minimal dependency set still passes 107 tests. Item (b) is a new `it(...)` (snapshot test) appended to the existing `src/render.test.ts` — reuses the canonical input from the existing pure-render snapshot but runs it through `evaluate(...)` first. Item (c) is one new YAML file under `.github/workflows/`.

**Tech Stack:** TypeScript, mathjs ^14, vitest 2.x, GitHub Actions (ubuntu-latest, Node 20). No new dependencies.

**Source issue:** `gh issue view 11`. Three acceptance criteria, all targeted by this plan.

---

## Conventions used by this plan

- TDD where it applies. The integration snapshot test is genuinely TDD (write, run to populate snapshot, lock); the tree-shake task is iterative-empirical (replace import, run tests, add factories until green); the CI workflow has no test-driving but the workflow file's own correctness is verified by the run on `git push`.
- Each task is one commit. Order is least-risky first.
- Direct work on `main`, no worktree (per repo memory).
- Keep `npm test` green at every commit. Run `npx tsc --noEmit` before each.
- Closeout follows the per-issue verification convention from memory: a page lives at `infra/space-seed/Tests/Engineering Hardening Verification.md`. Since #11's items are mostly invisible to a Reckon sheet (bundle size, CI, snapshot files), this page is a plain markdown doc — not a `reckon: true` page — that lists external verification steps.

## Design decisions resolved inline

**Task 1 (tree-shake) target factory list:** the canonical mathjs custom-bundling recipe is to pass `*Dependencies` aggregators to `create({...})`. **Note from execution:** `parserDependencies` alone turned out to be only the Parser *class* — no math operators, no unit handling. The minimal Reckon set is `parserDependencies` + `unitDependencies` + `toDependencies` + per-operator aggregators (`addDependencies`, `subtractDependencies`, `multiplyDependencies`, `divideDependencies`, `powDependencies`, `unaryMinusDependencies`, `unaryPlusDependencies`) — 10 in total. Step 1.2 below still shows the original `parserDependencies`-only guess so the TDD red→green narrative reads cleanly; Step 1.4 (iteration recipe) records how to expand. The committed `src/engine.ts` has the full final spread.

**Task 2 (integration snapshot) location:** new test inside the existing `src/render.test.ts`. The issue's spec offers either `render.test.ts` or a new `integration.test.ts` — same-file is cheaper and keeps render-related coverage colocated. The new test imports `evaluate` from `./engine` (which is what `render.test.ts` previously avoided to keep the render layer pure). That coupling is intentional for the integration check.

**Task 3 (CI workflow) Node version:** Node 20 (current LTS). Use `actions/setup-node@v4` with `cache: 'npm'`. Run `npm ci` (not `npm install`) for reproducibility. The bundle drift check is `git diff --quiet reckon.plug.js` after `npm run build`; non-zero exit fails CI with a clear message.

---

## Task 1: Tree-shake mathjs to `parserDependencies`

**Files:**
- Modify: `src/engine.ts` (the `create(all)` line)
- No test changes (acceptance is "all existing tests still pass" + smaller bundle)

The current import in `src/engine.ts:1` reads:

```ts
import { create, all, type MathJsInstance } from "mathjs";
const math: MathJsInstance = create(all, {});
```

We replace `all` with the dependencies aggregator that covers what Reckon actually uses. The canonical mathjs recipe (per [`docs/custom_bundling.md`](https://github.com/josdejong/mathjs/blob/develop/docs/custom_bundling.md)) is to pass `*Dependencies` aggregators to `create({...})`.

**Reckon's mathjs surface area** (verify by grep before starting):
- `math.parser()` — used in `evaluate()` to obtain a fresh per-call parser scope.
- `parser.evaluate(string)` — used per line; supports arithmetic, parens, exponents, identifiers, assignment, unit literals, unit conversion via `to`.
- `value instanceof math.Unit` — used in `formatValue` to detect Unit values for special string formatting.

`parserDependencies` includes all of these.

- [ ] **Step 1.1: Confirm baseline bundle size and tests**

```bash
ls -la reckon.plug.js
npm test 2>&1 | tail -5
```

Expected baseline: ~654 KB, 107 tests passing. Record the exact size — it's the "before" number for the closeout commit.

- [ ] **Step 1.2: Replace the import in `src/engine.ts`**

Find lines 1-9 of `src/engine.ts`:

```ts
import { create, all, type MathJsInstance } from "mathjs";
import {
  extractMathLines,
  rewriteExpression,
  detectAssignment,
  type RawLine,
} from "./parser";

const math: MathJsInstance = create(all, {});
```

Replace with:

```ts
import { create, parserDependencies, type MathJsInstance } from "mathjs";
import {
  extractMathLines,
  rewriteExpression,
  detectAssignment,
  type RawLine,
} from "./parser";

// Tree-shaken mathjs: parserDependencies pulls the Parser plus arithmetic,
// units, and `to`-conversion factories — everything Reckon's per-line
// `parser.evaluate(...)` and the `value instanceof math.Unit` check need.
// Drops the bundled plug from ~654 KB (with `all`) to the 150–250 KB
// target. If a test fails after this swap, run the missing-factory recipe
// in the plan's Task 1 / Step 1.4.
const math: MathJsInstance = create(parserDependencies, {});
```

- [ ] **Step 1.3: Run tests + type-check**

```bash
npm test
npx tsc --noEmit
```

Expected (best case): all 107 tests still pass, type-check clean. Skip to Step 1.5.

- [ ] **Step 1.4: Iterate if tests fail**

If any test fails because mathjs throws "Function X is not defined" or similar, the missing factory needs to be added.

Recipe:
1. Read the failing test's input. Identify which mathjs function it implicitly uses.
2. Find the corresponding `*Dependencies` aggregator (e.g. `formatDependencies`, `numberDependencies`).
3. Spread it into the `create({...})` call:

```ts
import {
  create,
  parserDependencies,
  formatDependencies,  // example — only add what's actually missing
  type MathJsInstance,
} from "mathjs";

const math: MathJsInstance = create(
  { ...parserDependencies, ...formatDependencies },
  {},
);
```

4. Re-run `npm test`. Repeat until green.

If after iteration the bundle still exceeds 250 KB, that's an acceptable outcome for V1 — note the size in the commit body and move on. The 150–250 KB target is aspirational; passing tests is the hard requirement.

- [ ] **Step 1.5: Rebuild and confirm size drop**

```bash
npm run build
ls -la reckon.plug.js
```

Expected: bundle size in 150–300 KB range. Capture the new size.

- [ ] **Step 1.6: Sanity-check the live behavior end-to-end**

```bash
npx tsx --eval "import { evaluate } from './src/engine.ts'; const out = evaluate('1 + 1\n100 km in miles\ntax = 20%\n100 + tax\ncurrent tax = 20%\n300 + current tax\n'); console.log(JSON.stringify(out, null, 2));"
```

Expected: row 0 is `1 + 1` → `2`, row 1 is the unit conversion → `62.137… miles`, the percent rows produce 0.2 / 120 / 20% / 360, total computed correctly. This confirms the tree-shake didn't accidentally drop the Unit type or `to`-conversion factory.

- [ ] **Step 1.7: Commit**

```bash
git add src/engine.ts reckon.plug.js
git commit -m "perf(engine): tree-shake mathjs to parserDependencies (drops bundle from ~654 KB to <SIZE>)"
```

Substitute `<SIZE>` with the actual rebuilt size from Step 1.5 (e.g. `212 KB`). If you ended up adding extra `*Dependencies` in Step 1.4, list them in the commit body.

---

## Task 2: Integration snapshot test (`evaluate` + `renderSheet` end-to-end)

**Files:**
- Modify: `src/render.test.ts` (add one new `describe` block)
- Generated: `src/__snapshots__/render.test.ts.snap` (vitest will append the new snapshot on first run)

The existing `renderSheet` snapshot test in `render.test.ts` operates on a hand-built `EvaluateResult`. It catches accidental HTML changes but does NOT catch contract drift between `engine.evaluate` and `renderSheet`. The new integration test runs `evaluate(text)` first, then `renderSheet(result)`, snapshotting the rendered HTML. If anyone changes the shape of `ResultRow` or `EvaluateResult` without updating both sides, the snapshot diff will surface it.

- [ ] **Step 2.1: Append the new test to `src/render.test.ts`**

At the bottom of the existing file (after the closing `});` of the current `describe("renderSheet", ...)` block), add:

```ts
import { evaluate } from "./engine";

describe("integration — evaluate(text) → renderSheet(result)", () => {
  it("snapshots the full pipeline for a canonical mixed input", () => {
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

    const out = renderSheet(evaluate(input));
    expect(out).toMatchSnapshot();
  });
});
```

The input deliberately exercises every quality-bundle fix that's already shipped (auto-total scope, comment escape, percent display, multi-word vars) plus a unit conversion. Drift in any layer surfaces in the snapshot diff.

> **Note:** keep the `import { evaluate } from "./engine";` line near the existing `import { renderSheet } from "./render";` at the top of the file — vitest doesn't care about import order, but humans reading the file expect imports grouped at the top.

- [ ] **Step 2.2: Run tests to populate the snapshot**

```bash
npm test -- render
```

Expected: the new test passes on first run (vitest creates the snapshot file or appends to the existing one). All 107 prior tests + the new one = 108 passing.

- [ ] **Step 2.3: Verify the snapshot file**

```bash
ls src/__snapshots__/
cat src/__snapshots__/render.test.ts.snap | head -50
```

Expected: the new snapshot key `> "integration — evaluate(text) → renderSheet(result) > snapshots the full pipeline for a canonical mixed input"` is present. The HTML body should contain the rendered rows in the order the input listed (heading-comment, blank, 4 assignments, 1 percent value `120`, 1 unit value, 1 multi-word value `360`, 2 comment lines, 1 mid-line-`#` value `5`).

- [ ] **Step 2.4: Re-run to confirm stability**

```bash
npm test
```

Expected: 108 tests passing. The snapshot test now compares against the populated file — if anything drifts in a future change, this test will fail with a diff.

- [ ] **Step 2.5: Type-check**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 2.6: Commit**

```bash
git add src/render.test.ts src/__snapshots__/render.test.ts.snap
git commit -m "test: add integration snapshot for evaluate + renderSheet pipeline"
```

---

## Task 3: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

The workflow runs on every push and PR. It installs deps with `npm ci`, runs the test suite, rebuilds the plug, and verifies the committed `reckon.plug.js` matches the rebuild. If they differ, CI fails — preventing stale-bundle commits.

- [ ] **Step 3.1: Create the directory and workflow file**

```bash
mkdir -p .github/workflows
```

Then create `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  test:
    name: test + build + bundle drift check
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Type-check
        run: npx tsc --noEmit

      - name: Run tests
        run: npm test

      - name: Rebuild plug
        run: npm run build

      - name: Verify committed reckon.plug.js matches rebuild
        run: |
          if ! git diff --quiet reckon.plug.js; then
            echo "::error::reckon.plug.js is stale — run \`npm run build\` and commit the result."
            git diff --stat reckon.plug.js
            exit 1
          fi
```

> **Why `git diff --quiet` instead of `git status --porcelain`:** `--quiet` exits non-zero specifically when the working tree differs from HEAD for that path, which is exactly what we want to detect. The `--stat` line on failure tells the reader which file drifted (always `reckon.plug.js`, but the explicit message makes the failure mode obvious).

- [ ] **Step 3.2: Validate YAML locally (best-effort)**

The full workflow only runs when pushed, but you can sanity-check the syntax with `yamllint` if installed, or just open the file and confirm there are no tabs or accidental indentation issues.

```bash
node -e "console.log(JSON.stringify(require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml', 'utf8')), null, 2))" 2>/dev/null || echo "(js-yaml not in deps — skip syntax preview)"
```

Expected: either parsed JSON dump (if `js-yaml` is around) or the "skip" message. Either is fine; the real validation is the GitHub-side parse on push.

- [ ] **Step 3.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow with bundle drift check"
```

(The workflow runs on push, but since this plan is being executed locally on `main` and the user generally runs `git push` themselves, the user will see the first run after their next push. The closeout playback in Task 4 mentions this explicitly.)

---

## Task 4: Closeout — Changelog, verification doc, and issue comment

**Files:**
- Modify: `infra/space-seed/Changelog.md` (prepend a new section)
- Create: `infra/space-seed/Tests/Engineering Hardening Verification.md`

This task does the closeout per memory's per-issue verification convention. Since #11's items are not user-page-observable (bundle size, CI runs, internal snapshot file), the verification page is a plain doc listing external verification steps — it does NOT have `reckon: true` frontmatter.

- [ ] **Step 4.1: Prepend a Changelog entry**

Open `infra/space-seed/Changelog.md`. Find the existing "## What's new — Quality Fixes (issue #1)" header. Above it (after the top-of-file `# Changelog` and the intro line / horizontal rule), insert this new section:

```markdown
## What changed — Engineering hardening (issue #11)

These are mostly invisible to users — the math behavior is unchanged. The
three items here harden the project's distribution path:

### 1. Smaller plug bundle (faster install, faster load)

`reckon.plug.js` shrank from ~654 KB to ~<NEW_SIZE> KB by tree-shaking
`mathjs` to its `parserDependencies` aggregator (parser + arithmetic +
units only — no BigNumber, no Fraction, no matrices, no statistics). All
107 prior tests still pass, plus a new integration snapshot test (item 2)
makes 108.

### 2. Integration snapshot covers `evaluate → renderSheet`

A new test in `src/render.test.ts` runs a canonical mixed-input string
through `evaluate(...)` and `renderSheet(...)` end-to-end and snapshots
the rendered HTML. Catches contract drift between engine and renderer
that the existing pure-render snapshot would miss.

### 3. CI runs every push

A new GitHub Actions workflow at `.github/workflows/ci.yml` runs `npm
test`, type-checks, rebuilds the plug, and verifies the committed
`reckon.plug.js` matches the rebuild. Stale-bundle commits now fail CI.

---
```

Substitute `<NEW_SIZE>` with the actual rebuilt size from Task 1 (e.g. `~212`). Round to the nearest few KB.

- [ ] **Step 4.2: Create the verification doc**

Create `infra/space-seed/Tests/Engineering Hardening Verification.md` with:

```markdown
# Engineering Hardening — Verification

Issue #11 is about plumbing, not user-visible features, so this page is a
checklist instead of a `reckon: true` math sheet. Three things to verify:

## 1. Smaller `reckon.plug.js` bundle

```bash
ls -la reckon.plug.js
```

Expected: file size in the 150–300 KB range (was ~654 KB at V1). The exact
target was 150–250 KB; any drop into that band — or even slightly over —
counts as a pass.

## 2. New integration snapshot test passes

```bash
npm test -- render
```

Expected: a new test under `integration — evaluate(text) → renderSheet(result)`
is present and green. The snapshot file at
`src/__snapshots__/render.test.ts.snap` contains the locked HTML output.

## 3. GitHub Actions CI green on next push

After pushing this branch, open the repo's Actions tab on GitHub and look
for the `CI` workflow on the most recent commit. It should run four steps
(type-check, test, build, bundle drift check) and exit green. The bundle
drift check step is the new safety net — it fails CI if anyone commits a
stale `reckon.plug.js`.

If the workflow file itself has a YAML error, the run will fail at the
parse step with a clear message; fix and recommit.
```

- [ ] **Step 4.3: Mirror verification doc into the live space**

```bash
if [ -d infra/space ]; then
  mkdir -p infra/space/Tests
  cp "infra/space-seed/Tests/Engineering Hardening Verification.md" "infra/space/Tests/Engineering Hardening Verification.md"
fi
```

Silent on success. The live mirror is gitignored.

- [ ] **Step 4.4: Final sanity-check**

```bash
npm test
npx tsc --noEmit
ls -la reckon.plug.js
```

Expected: 108 tests passing, type-check clean, bundle size matches what was claimed in the Changelog.

- [ ] **Step 4.5: Commit Changelog and verification doc**

```bash
git add infra/space-seed/Changelog.md "infra/space-seed/Tests/Engineering Hardening Verification.md"
git commit -m "docs(infra): Changelog + Tests/ verification doc for engineering hardening"
```

- [ ] **Step 4.6: Post the GitHub issue comment**

```bash
gh issue comment 11 --repo emsilva/silverbullet-reckon --body "$(cat <<'EOF'
## Engineering hardening shipped on `main`

Three engineering items landed as one bundle:

- `perf(engine): tree-shake mathjs to parserDependencies` — bundle dropped from ~654 KB to ~<NEW_SIZE> KB. All 107 prior tests still pass.
- `test: add integration snapshot for evaluate + renderSheet pipeline` — new snapshot in `src/__snapshots__/render.test.ts.snap`. Now 108 tests.
- `ci: add GitHub Actions workflow with bundle drift check` — `.github/workflows/ci.yml` runs type-check + tests + build + verifies the committed `reckon.plug.js` matches the rebuild on every push and PR.

Plus a Changelog entry and a verification doc at `infra/space-seed/Tests/Engineering Hardening Verification.md` (also mirrored into the running dev space).

### Verification ask

Please verify before close:

1. `ls -la reckon.plug.js` shows the new (smaller) size.
2. After your next `git push`, open the repo's Actions tab — the `CI` workflow should run green.

Once you confirm, I'll close this issue.
EOF
)"
```

Substitute `<NEW_SIZE>` (same number as in the Changelog).

- [ ] **Step 4.7: Do NOT close the issue**

Wait for the user's confirmation per their workflow. The bundle is on local `main` until they push.

---

## Out of scope for this plan

- Changing the build tooling itself (esbuild config, plug-compile flags).
- Migrating from mathjs to a smaller library (out of issue #11; would be its own issue if the bundle goal isn't met).
- Adding test coverage beyond the one integration snapshot.
- Splitting the CI workflow across multiple jobs (single job is sufficient at this scale).

# Reckon Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land issue #3's three render-side improvements as one bundle on top of #11's hardening: tokenized source-side syntax coloring (Dracula in dark mode + Alucard in light), ATX-form Markdown headings rendered as section labels, and click-to-copy on result cells that copies the closest underlying numeric value with an `editor.flashNotification` confirmation.

**Architecture:** One new pure module (`src/lexer.ts`) for the tokenizer; `src/engine.ts` gains a `kind: "heading"` row variant, a `clipboard` field on numeric/assignment/total rows, and two `Set<string>` fields on `EvaluateResult` so the renderer can disambiguate identifiers vs unit names; `src/render.ts` updates its `<style>` block to ship both palettes (theme-swapped via `@media (prefers-color-scheme)`), wires the lexer into source-cell rendering, emits `data-clipboard-value` attributes, and populates the previously-empty `script` slot with a click-handler IIFE that calls `navigator.clipboard.writeText` plus the SB iframe-API bridge for the flash notification. After core implementation, the controller invokes `/redesign-skill medium` against the live panel and folds approved suggestions back into `render.ts` as a separate polish commit.

**Tech Stack:** TypeScript, mathjs ^14, vitest 2.x. No new dependencies. The lexer accepts an `isUnit(name) => boolean` callback so it stays decoupled from mathjs internals; the renderer constructs that callback from the engine's mathjs instance.

**Source spec:** `docs/superpowers/specs/2026-05-04-reckon-visual-polish-design.md` — read first if unfamiliar.

---

## Conventions used by this plan

- TDD throughout for source modules (lexer, engine, renderer). Manual smoke + redesign pass have no automated tests; their verification is visual.
- Each src-touching task commits both the source change AND a freshly rebuilt `reckon.plug.js` so the CI bundle-drift check (added in #11) stays green on every commit.
- Direct work on `main`, no worktree (per repo memory).
- Keep `npm test` green at every commit. Run `npx tsc --noEmit` before each.
- Closeout follows the per-issue verification convention from memory: a `reckon: true` page at `infra/space-seed/Tests/Visual Polish Verification.md` exercising headings + every token category + clickable rows. Mirror to `infra/space/Tests/`.
- Commit message style: lowercase prefix (`feat:`, `fix:`, `style:`, `test:`, `docs:`, `refactor:`, `ci:`).

## File structure

| File | Status | Responsibility |
|---|---|---|
| `src/lexer.ts` | NEW | Pure tokenizer: `tokenize(source, options) → Token[]`. Imports nothing from mathjs (takes `isUnit` callback). |
| `src/lexer.test.ts` | NEW | Vitest unit tests for `tokenize`. |
| `src/engine.ts` | MODIFY | Add `kind: "heading"` ResultRow variant; add `clipboard` field on value/assignment/total rows; expose `identifierNames` and `multiWordNames` on `EvaluateResult`; export the mathjs instance for the renderer to read units from. |
| `src/engine.test.ts` | MODIFY | New cases for headings, clipboard values, name-set population. |
| `src/render.ts` | MODIFY | New `<style>` (Dracula+Alucard via media query); heading row HTML; `tokenize`-driven source spans on value/assignment rows; `data-clipboard-value` attribute on result cells; non-empty `script` slot with click handler. |
| `src/render.test.ts` | MODIFY | Tokenized markup assertions; heading row markup; `data-clipboard-value` presence; non-empty script; updated snapshots. |
| `src/__snapshots__/render.test.ts.snap` | REGENERATE | Pure-render and integration snapshots refresh once. |
| `reckon.plug.js` | REBUILD | Committed alongside each source-touching task. |
| `infra/space-seed/Changelog.md` | MODIFY | Prepend "Visual polish (issue #3)" section at closeout. |
| `infra/space-seed/Tests/Visual Polish Verification.md` | NEW | `reckon: true` page exercising all features. |
| `infra/space/Tests/Visual Polish Verification.md` | NEW (gitignored) | Live-space mirror of the verification page. |

## Design decisions resolved inline (from spec)

- **Lexer takes `isUnit` callback** rather than importing mathjs. Keeps the lexer pure and testable in isolation; renderer wires it to `math.Unit.UNITS` via the engine's exported instance.
- **Engine exports `math`**: one-line addition. The renderer (and lexer caller) reads `math.Unit.UNITS` from the same singleton.
- **Heading regex**: `/^#{1,6}\s+\S/` — 1-6 hashes, whitespace, then non-whitespace content. Pinned. Tested with depth-1 through depth-6 plus rejection cases.
- **Clipboard value computation** (per row kind):
  - Plain number: `String(numeric)` (e.g., `150`, no thousand separators)
  - Percent literal assignment (`tax = 20%`): `String(numeric)` → `"0.2"`
  - Unit value: `String(unit.toNumber(unit.formatUnits()))` (mathjs API). Fallback: regex-extract the leading number from `formatted.text` if `toNumber` throws.
  - Total: `String(sum)` — unformatted
- **Token disambiguation** (lexer step 6): word in `identifiers` → `id`; else if `isUnit(word)` → `unit`; else `id` (fallback).

---

## Task 1: Lexer module

**Files:**
- Create: `src/lexer.ts`
- Test: `src/lexer.test.ts`

The lexer is pure: string in, token-array out. Imports nothing from the codebase. Receives identifier/multi-word/unit knowledge via the options object so it's testable without an engine instance.

- [ ] **Step 1.1: Write the failing tests**

Create `src/lexer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tokenize } from "./lexer";

const empty = {
  identifiers: new Set<string>(),
  multiWord: new Set<string>(),
  isUnit: () => false,
};

describe("tokenize — single categories", () => {
  it("returns one num token for a bare number", () => {
    expect(tokenize("100", empty)).toEqual([{ kind: "num", text: "100" }]);
  });

  it("returns one num token for a decimal", () => {
    expect(tokenize("3.14", empty)).toEqual([{ kind: "num", text: "3.14" }]);
  });

  it("emits one pct token for `%`", () => {
    expect(tokenize("%", empty)).toEqual([{ kind: "pct", text: "%" }]);
  });

  it("emits one op token for each operator char", () => {
    for (const op of ["+", "-", "*", "/", "^", "=", "(", ")"]) {
      expect(tokenize(op, empty)).toEqual([{ kind: "op", text: op }]);
    }
  });

  it("emits a kw token for the three keywords", () => {
    for (const kw of ["of", "in", "to"]) {
      expect(tokenize(kw, empty)).toEqual([{ kind: "kw", text: kw }]);
    }
  });

  it("emits an id token for a bare unknown word (fallback)", () => {
    expect(tokenize("foo", empty)).toEqual([{ kind: "id", text: "foo" }]);
  });

  it("emits a ws token for whitespace runs", () => {
    expect(tokenize("   ", empty)).toEqual([{ kind: "ws", text: "   " }]);
  });

  it("returns [] for empty input", () => {
    expect(tokenize("", empty)).toEqual([]);
  });
});

describe("tokenize — composite expressions", () => {
  it("tokenizes `100 + 20%` as num ws op ws num pct", () => {
    expect(tokenize("100 + 20%", empty)).toEqual([
      { kind: "num", text: "100" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "num", text: "20" },
      { kind: "pct", text: "%" },
    ]);
  });

  it("tokenizes `salary * 1.15` with identifier known", () => {
    const opts = { ...empty, identifiers: new Set(["salary"]) };
    expect(tokenize("salary * 1.15", opts)).toEqual([
      { kind: "id", text: "salary" },
      { kind: "ws", text: " " },
      { kind: "op", text: "*" },
      { kind: "ws", text: " " },
      { kind: "num", text: "1.15" },
    ]);
  });

  it("tokenizes `100 km in miles` with isUnit recognizing km/miles", () => {
    const opts = { ...empty, isUnit: (n: string) => n === "km" || n === "miles" };
    expect(tokenize("100 km in miles", opts)).toEqual([
      { kind: "num", text: "100" },
      { kind: "ws", text: " " },
      { kind: "unit", text: "km" },
      { kind: "ws", text: " " },
      { kind: "kw", text: "in" },
      { kind: "ws", text: " " },
      { kind: "unit", text: "miles" },
    ]);
  });

  it("tokenizes `20% of 450` with `of` as keyword", () => {
    expect(tokenize("20% of 450", empty)).toEqual([
      { kind: "num", text: "20" },
      { kind: "pct", text: "%" },
      { kind: "ws", text: " " },
      { kind: "kw", text: "of" },
      { kind: "ws", text: " " },
      { kind: "num", text: "450" },
    ]);
  });
});

describe("tokenize — multi-word longest-first", () => {
  it("treats a registered multi-word name as one id token", () => {
    const opts = { ...empty, multiWord: new Set(["current tax"]) };
    expect(tokenize("100 + current tax", opts)).toEqual([
      { kind: "num", text: "100" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "id", text: "current tax" },
    ]);
  });

  it("matches longest first when names overlap", () => {
    const opts = {
      ...empty,
      multiWord: new Set(["current tax", "current tax inflation"]),
    };
    expect(tokenize("current tax inflation + 1", opts)).toEqual([
      { kind: "id", text: "current tax inflation" },
      { kind: "ws", text: " " },
      { kind: "op", text: "+" },
      { kind: "ws", text: " " },
      { kind: "num", text: "1" },
    ]);
  });

  it("matches a tab-separated reference against a space-registered name", () => {
    const opts = { ...empty, multiWord: new Set(["current tax"]) };
    expect(tokenize("current\ttax", opts)).toEqual([
      { kind: "id", text: "current\ttax" },
    ]);
  });

  it("does not false-match inside a longer identifier", () => {
    const opts = { ...empty, multiWord: new Set(["current tax"]) };
    expect(tokenize("mycurrent tax", opts)).toEqual([
      { kind: "id", text: "mycurrent" },
      { kind: "ws", text: " " },
      { kind: "id", text: "tax" },
    ]);
  });
});

describe("tokenize — disambiguation", () => {
  it("prefers identifier over unit when name is in identifiers set", () => {
    const opts = {
      identifiers: new Set(["current"]),
      multiWord: new Set<string>(),
      isUnit: (n: string) => n === "current",  // would be a unit otherwise
    };
    expect(tokenize("current", opts)).toEqual([{ kind: "id", text: "current" }]);
  });

  it("returns id (fallback) when word is neither identifier nor unit", () => {
    expect(tokenize("xyz", empty)).toEqual([{ kind: "id", text: "xyz" }]);
  });
});

describe("tokenize — fallback text", () => {
  it("emits a text token for an unknown single character", () => {
    expect(tokenize("@", empty)).toEqual([{ kind: "text", text: "@" }]);
  });
});
```

- [ ] **Step 1.2: Run tests, verify they fail**

Run: `npm test -- lexer`
Expected: All tests fail with "Cannot find module './lexer'".

- [ ] **Step 1.3: Implement `src/lexer.ts`**

```ts
export type TokenKind = "num" | "id" | "unit" | "op" | "kw" | "pct" | "ws" | "text";
export interface Token {
  kind: TokenKind;
  text: string;
}

export interface TokenizeOptions {
  identifiers: Set<string>;
  multiWord: Set<string>;
  isUnit: (name: string) => boolean;
}

const KEYWORDS = new Set(["of", "in", "to"]);
const NUMBER_RE = /^\d+(?:\.\d+)?/;
const WORD_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const WS_RE = /^\s+/;
const OPERATOR_CHARS = new Set(["+", "-", "*", "/", "^", "=", "(", ")"]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMultiWordRegex(name: string): RegExp {
  const parts = name.split(/\s+/).map(escapeRegex).join("\\s+");
  return new RegExp(`^\\b${parts}\\b`);
}

export function tokenize(source: string, options: TokenizeOptions): Token[] {
  const { identifiers, multiWord, isUnit } = options;
  const sortedMultiWord = Array.from(multiWord).sort((a, b) => b.length - a.length);
  const compiledMultiWord = sortedMultiWord.map((name) => ({
    name,
    re: buildMultiWordRegex(name),
  }));

  const tokens: Token[] = [];
  let pos = 0;

  while (pos < source.length) {
    const rest = source.slice(pos);

    // 1. Multi-word names (longest first)
    let matched: string | null = null;
    for (const { re } of compiledMultiWord) {
      const m = re.exec(rest);
      if (m) {
        matched = m[0];
        break;
      }
    }
    if (matched !== null) {
      tokens.push({ kind: "id", text: matched });
      pos += matched.length;
      continue;
    }

    // 2. Number
    const numM = NUMBER_RE.exec(rest);
    if (numM) {
      tokens.push({ kind: "num", text: numM[0] });
      pos += numM[0].length;
      continue;
    }

    // 3. Percent
    if (rest[0] === "%") {
      tokens.push({ kind: "pct", text: "%" });
      pos += 1;
      continue;
    }

    // 4. Operators
    if (OPERATOR_CHARS.has(rest[0])) {
      tokens.push({ kind: "op", text: rest[0] });
      pos += 1;
      continue;
    }

    // 5. Word — could be keyword, identifier, or unit
    const wordM = WORD_RE.exec(rest);
    if (wordM) {
      const w = wordM[0];
      let kind: TokenKind;
      if (KEYWORDS.has(w)) kind = "kw";
      else if (identifiers.has(w)) kind = "id";
      else if (isUnit(w)) kind = "unit";
      else kind = "id";
      tokens.push({ kind, text: w });
      pos += w.length;
      continue;
    }

    // 6. Whitespace
    const wsM = WS_RE.exec(rest);
    if (wsM) {
      tokens.push({ kind: "ws", text: wsM[0] });
      pos += wsM[0].length;
      continue;
    }

    // 7. Fallback — single char as text
    tokens.push({ kind: "text", text: rest[0] });
    pos += 1;
  }

  return tokens;
}
```

> **Note on word/keyword precedence:** keywords (`of`, `in`, `to`) are checked inside the word branch (step 5). Since they match the word regex first and then the keyword set membership decides, keywords come out as `kind: "kw"` and never as `id`. This avoids a separate keyword regex pass and keeps the algorithm position-anchored.

- [ ] **Step 1.4: Run tests, verify they pass**

Run: `npm test -- lexer`
Expected: All ~15 lexer tests pass.

- [ ] **Step 1.5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 1.6: Build the bundle**

Run: `npm run build`
Expected: `reckon.plug.js` regenerated. Size unchanged (lexer is dead code at this point — esbuild will DCE it).

- [ ] **Step 1.7: Commit**

```bash
git add src/lexer.ts src/lexer.test.ts reckon.plug.js
git commit -m "feat: add pure tokenizer module (src/lexer.ts)"
```

---

## Task 2: Engine — heading row kind

**Files:**
- Modify: `src/engine.ts` (extend ResultRow, add heading detection in evaluateLine)
- Test: `src/engine.test.ts` (new cases)

Add the new `kind: "heading"` row variant. The detection regex `/^#{1,6}\s+\S/` runs in `evaluateLine` AFTER the blank check and BEFORE the existing `#`/`//` comment escape — so ATX-shaped lines (1-6 hashes, whitespace, content) are headings while everything else with `#` stays a comment.

- [ ] **Step 2.1: Add the failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluate — headings (ATX-form supersedes comment escape)", () => {
  it("`# Q2 budget` → heading depth 1, text `Q2 budget`", () => {
    const out = evaluate("# Q2 budget\n");
    expect(out.rows[0]).toEqual({
      kind: "heading",
      line: 1,
      depth: 1,
      text: "Q2 budget",
    });
  });

  it("`### sub` → depth 3", () => {
    const out = evaluate("### sub\n");
    expect(out.rows[0]).toMatchObject({ kind: "heading", depth: 3, text: "sub" });
  });

  it("`###### deepest` → depth 6", () => {
    const out = evaluate("###### deepest\n");
    expect(out.rows[0]).toMatchObject({ kind: "heading", depth: 6, text: "deepest" });
  });

  it("`####### too many` → comment (regex requires 1-6 hashes)", () => {
    const out = evaluate("####### too many\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`# ` (hash + space + nothing) → comment (no content after space)", () => {
    const out = evaluate("# \n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`#nospace` → comment (no whitespace before content)", () => {
    const out = evaluate("#nospace\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("`// note` → comment (no `#` at all)", () => {
    const out = evaluate("// note\n");
    expect(out.rows[0].kind).toBe("comment");
  });

  it("trims the heading text", () => {
    const out = evaluate("##   spacey   \n");
    expect(out.rows[0]).toMatchObject({ kind: "heading", depth: 2, text: "spacey" });
  });

  it("a heading does not register an identifier or multi-word var", () => {
    const out = evaluate("# tax = 20%\n");
    // `# tax = 20%` is a heading, NOT an assignment — `tax` is not in scope after.
    expect(out.rows[0].kind).toBe("heading");
    const out2 = evaluate("# tax = 20%\n100 + tax\n");
    expect(out2.rows[1].kind).toBe("comment"); // `tax` undefined → silent error → comment
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail**

Run: `npm test -- engine`
Expected: most heading tests fail (`comment` returned where `heading` expected).

- [ ] **Step 2.3: Implement in `src/engine.ts`**

In `src/engine.ts`, extend the `ResultRow` union (currently has `blank | comment | value | assignment`):

Find:

```ts
export type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      numeric?: number;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      numeric?: number;
    };
```

Replace with:

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
      numeric?: number;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      numeric?: number;
    };
```

Then in `evaluateLine`, add the heading detection right after the blank check and BEFORE the comment escape:

Find:

```ts
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
```

Replace with:

```ts
  const trimmed = raw.text.trim();
  if (trimmed === "") {
    return { kind: "blank", line: raw.line };
  }

  // ATX-form headings (`# foo`, `## bar`, ..., `###### deepest`) supersede
  // the comment escape for those shapes — Markdown convention. Any `#` line
  // that doesn't match the ATX shape (no whitespace, no content, more than
  // 6 hashes) falls through to the comment escape below.
  const headingMatch = /^(#{1,6})\s+(\S.*)$/.exec(trimmed);
  if (headingMatch) {
    return {
      kind: "heading",
      line: raw.line,
      depth: headingMatch[1].length,
      text: headingMatch[2].trim(),
    };
  }

  // Explicit comment escape: lines beginning with `#` or `//` are comments
  // even if their tail would parse as math. Locks the contract regardless
  // of whether mathjs's grammar evolves to accept them.
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return { kind: "comment", line: raw.line, source: raw.text };
  }
```

- [ ] **Step 2.4: Add a temporary `heading` stub in `rowHtml` to keep the exhaustive switch happy**

Adding a new `ResultRow` variant widens the union; `src/render.ts`'s `rowHtml` switch (which has no `default` and is implicitly exhaustive under `strict: true`) will now fail to type-check. Add a placeholder arm — Task 4's full rewrite replaces it.

In `src/render.ts`, find:

```ts
function rowHtml(row: ResultRow): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank"><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment"><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "value":
      return `<tr class="value"><td class="source">${escapeHtml(row.source)}</td><td class="result">${escapeHtml(row.result)}</td></tr>`;
    case "assignment":
      return `<tr class="assignment"><td class="source">${escapeHtml(row.source)}</td><td class="result">${escapeHtml(row.result)}</td></tr>`;
  }
}
```

Insert a `case "heading":` arm:

```ts
function rowHtml(row: ResultRow): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank"><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment"><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      // Stub — Task 4 replaces this with the real heading row markup.
      return `<tr class="heading"><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
      return `<tr class="value"><td class="source">${escapeHtml(row.source)}</td><td class="result">${escapeHtml(row.result)}</td></tr>`;
    case "assignment":
      return `<tr class="assignment"><td class="source">${escapeHtml(row.source)}</td><td class="result">${escapeHtml(row.result)}</td></tr>`;
  }
}
```

The stub markup is functionally identical to what Task 4 will produce for headings; the substantive changes in Task 4 are around tokenization, CSS, and click-to-copy on OTHER row kinds. Keeping the heading row right at this stage means the integration snapshot won't churn unnecessarily.

- [ ] **Step 2.5: Run tests + type-check**

Run: `npm test`
Expected: all tests pass (existing + 9 new heading tests).

Run: `npx tsc --noEmit`
Expected: clean. The stub satisfies exhaustiveness.

- [ ] **Step 2.6: Build**

Run: `npm run build`
Expected: bundle regenerates.

- [ ] **Step 2.7: Commit**

```bash
git add src/engine.ts src/engine.test.ts src/render.ts reckon.plug.js
git commit -m "feat(engine): heading row kind for ATX-form Markdown lines

Adds ResultRow `kind: heading` variant with depth (1-6) and trimmed
text. evaluateLine detects ATX-shape (regex `^#{1,6}\s+\S`) before
falling through to the comment escape from issue #1. Renderer's switch
gets a heading-row stub to keep the exhaustive type-check happy; Task 4
replaces it with the production form."
```

---

## Task 3: Engine — clipboard values + name sets on EvaluateResult

**Files:**
- Modify: `src/engine.ts` (extend ResultRow with `clipboard`, extend TotalRow with `clipboard`, extend EvaluateResult with two `Set<string>`, populate during evaluate; export `math`)
- Test: `src/engine.test.ts` (new cases)

Each `value`, `assignment`, and `total` row gets a precomputed `clipboard: string` — the canonical numeric form per spec §6's table. `EvaluateResult` gains `identifierNames` and `multiWordNames` so the renderer can hand them to the lexer for disambiguation. Engine also exports the `math` instance so the renderer can build an `isUnit` callback.

- [ ] **Step 3.1: Add the failing tests**

Append to `src/engine.test.ts`:

```ts
describe("engine.evaluate — clipboard values", () => {
  it("plain value row has clipboard equal to String(numeric)", () => {
    const out = evaluate("100 + 50\n");
    expect(out.rows[0]).toMatchObject({ kind: "value", result: "150", clipboard: "150" });
  });

  it("formatted value row strips thousand separators in clipboard", () => {
    const out = evaluate("100000 + 50\n");
    expect(out.rows[0]).toMatchObject({
      kind: "value",
      result: "100,050",
      clipboard: "100050",
    });
  });

  it("percent literal assignment clipboard is the underlying decimal", () => {
    const out = evaluate("tax = 20%\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "20%",
      clipboard: "0.2",
    });
  });

  it("non-percent assignment clipboard is unformatted number", () => {
    const out = evaluate("salary = 200000\n");
    expect(out.rows[0]).toMatchObject({
      kind: "assignment",
      result: "200,000",
      clipboard: "200000",
    });
  });

  it("unit value clipboard is the numeric portion only (no unit)", () => {
    const out = evaluate("100 km in miles\n");
    if (out.rows[0].kind !== "value") throw new Error("expected value row");
    // mathjs may format with full precision; clipboard should be the leading number.
    expect(out.rows[0].clipboard).toMatch(/^62\.\d+$/);
  });

  it("total row has clipboard equal to unformatted sum", () => {
    const out = evaluate("100000 + 50\n200\n");
    expect(out.total).toEqual({ value: "100,250", clipboard: "100250" });
  });
});

describe("engine.evaluate — identifier and multi-word name sets", () => {
  it("populates identifierNames with single-word assignments", () => {
    const out = evaluate("salary = 200000\ntax = 0.2\n");
    expect(out.identifierNames).toEqual(new Set(["salary", "tax"]));
    expect(out.multiWordNames).toEqual(new Set());
  });

  it("populates multiWordNames with multi-word assignments", () => {
    const out = evaluate("current tax = 20%\nbudget for q2 = 200000\n");
    expect(out.identifierNames).toEqual(new Set());
    expect(out.multiWordNames).toEqual(new Set(["current tax", "budget for q2"]));
  });

  it("an assignment that fails to evaluate does NOT register the name", () => {
    // `5 + ` makes mathjs throw — assignment is recorded as a comment row,
    // and the name is NOT pushed into either set.
    const out = evaluate("foo = 5 +\n");
    expect(out.rows[0].kind).toBe("comment");
    expect(out.identifierNames).toEqual(new Set());
    expect(out.multiWordNames).toEqual(new Set());
  });

  it("headings do not register names", () => {
    const out = evaluate("# tax = 20%\n");
    expect(out.identifierNames).toEqual(new Set());
    expect(out.multiWordNames).toEqual(new Set());
  });
});
```

- [ ] **Step 3.2: Run tests, verify they fail**

Run: `npm test -- engine`
Expected: new clipboard tests fail (field absent), name-set tests fail (fields absent).

- [ ] **Step 3.3: Implement in `src/engine.ts`**

Step 3.3a — export `math` (one-line addition near the top):

Find:

```ts
const math: MathJsInstance = create(
```

Replace with:

```ts
export const math: MathJsInstance = create(
```

Step 3.3b — extend `ResultRow` with `clipboard` on value/assignment:

Find:

```ts
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      numeric?: number;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      numeric?: number;
    };
```

Replace with:

```ts
  | {
      kind: "value";
      line: number;
      source: string;
      result: string;
      numeric?: number;
      clipboard: string;
    }
  | {
      kind: "assignment";
      line: number;
      source: string;
      varName: string;
      result: string;
      numeric?: number;
      clipboard: string;
    };
```

Step 3.3c — extend `TotalRow` and `EvaluateResult`:

Find:

```ts
export interface TotalRow {
  value: string;
}

export interface EvaluateResult {
  rows: ResultRow[];
  total: TotalRow | null;
}
```

Replace with:

```ts
export interface TotalRow {
  value: string;
  clipboard: string;
}

export interface EvaluateResult {
  rows: ResultRow[];
  total: TotalRow | null;
  identifierNames: Set<string>;
  multiWordNames: Set<string>;
}
```

Step 3.3d — populate name sets in `evaluate`:

Find:

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

Replace with:

```ts
export function evaluate(text: string): EvaluateResult {
  const lines = extractMathLines(text);
  const parser = math.parser();
  const percentageVars = new Set<string>();
  // Maps the user's original spelling (e.g. "current tax") to the
  // mathjs-legal canonical form ("current_tax"). Only multi-word names
  // are recorded; single-word assignments don't need rewriting.
  const multiWordVars = new Map<string, string>();
  const identifierNames = new Set<string>();
  const multiWordNames = new Set<string>();
  const rows: ResultRow[] = [];

  for (const raw of lines) {
    const row = evaluateLine(
      raw,
      parser,
      percentageVars,
      multiWordVars,
      identifierNames,
      multiWordNames,
    );
    rows.push(row);
  }

  return {
    rows,
    total: computeTotal(rows),
    identifierNames,
    multiWordNames,
  };
}
```

Step 3.3e — extend `evaluateLine` signature, populate name sets after a successful assignment evaluation, and compute `clipboard` for value/assignment rows:

Find the current `evaluateLine` signature:

```ts
function evaluateLine(
  raw: RawLine,
  parser: ReturnType<MathJsInstance["parser"]>,
  percentageVars: Set<string>,
  multiWordVars: Map<string, string>,
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
): ResultRow {
```

Find the post-evaluate name-tracking block (currently only updates `multiWordVars` and `percentageVars`):

```ts
  if (assignment) {
    // canonicalAssignName is non-null here because the outer `if (assignment)`
    // block initializes it; assert with `!` since TS can't see the dependency.
    // Both registries update only after a successful evaluate so a thrown
    // RHS doesn't leave a multi-word name registered with no mathjs binding.
    if (assignment.varName.includes(" ")) {
      multiWordVars.set(assignment.varName, canonicalAssignName!);
    }
    if (assignment.isPercentageRhs) {
      percentageVars.add(canonicalAssignName!);
    } else {
      // Reassignment of a percent-var to a non-percent value: clear the
      // additive flag so subsequent references use plain arithmetic.
      percentageVars.delete(canonicalAssignName!);
    }
  }
```

Replace with:

```ts
  if (assignment) {
    // canonicalAssignName is non-null here because the outer `if (assignment)`
    // block initializes it; assert with `!` since TS can't see the dependency.
    // Both registries update only after a successful evaluate so a thrown
    // RHS doesn't leave a multi-word name registered with no mathjs binding.
    if (assignment.varName.includes(" ")) {
      multiWordVars.set(assignment.varName, canonicalAssignName!);
      multiWordNames.add(assignment.varName);
    } else {
      identifierNames.add(assignment.varName);
    }
    if (assignment.isPercentageRhs) {
      percentageVars.add(canonicalAssignName!);
    } else {
      // Reassignment of a percent-var to a non-percent value: clear the
      // additive flag so subsequent references use plain arithmetic.
      percentageVars.delete(canonicalAssignName!);
    }
  }
```

Find the assignment-row return and the value-row return; replace both to include the new `clipboard` field. The assignment-row return:

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
  const clipboard = computeClipboard(value, formatted);
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
      clipboard,
    };
  }
  return {
    kind: "value",
    line: raw.line,
    source: raw.text,
    result: formatted.text,
    numeric: formatted.numeric,
    clipboard,
  };
}
```

Add the `computeClipboard` helper next to `formatValue`:

```ts
function computeClipboard(value: unknown, formatted: FormattedValue): string {
  // For finite-numeric values, the underlying number — no thousand separators,
  // no percent sign, no unit string. Matches the rule from issue #3 spec.
  if (formatted.numeric !== undefined && Number.isFinite(formatted.numeric)) {
    return String(formatted.numeric);
  }
  // For mathjs Unit values, extract the numeric part of the formatted text.
  // The formatted text is something like "62.13711922373339 miles" — the
  // leading number is what we want.
  if (value instanceof math.Unit) {
    const m = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(formatted.text);
    if (m) return m[0];
  }
  // Fallback: copy whatever the display string is.
  return formatted.text;
}
```

Update `computeTotal` to populate the `clipboard` field:

Find:

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

Replace with:

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
  return { value: NUMBER_FORMATTER.format(sum), clipboard: String(sum) };
}
```

- [ ] **Step 3.4: Update the canonical fixture in render.test.ts to satisfy the new EvaluateResult shape**

`EvaluateResult` now requires `identifierNames` and `multiWordNames`. The hand-built fixture at the top of `src/render.test.ts` (used by the pure-render snapshot test) doesn't have them yet — TypeScript will fail. Task 4 will fully refresh this fixture with heading rows + clipboard fields; for Task 3, only add the missing fields with empty sets so render.test.ts type-checks again. Also add the new `clipboard` field on the existing value/assignment row(s) in the fixture (use `"360"` and `"0.2"` for the existing rows, matching their displays).

Find:

```ts
const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    { kind: "assignment", line: 3, source: "tax = 20%", varName: "tax", result: "0.2" },
    {
      kind: "value",
      line: 4,
      source: "100 km in miles",
      result: "62.137 mi",
    },
    { kind: "value", line: 5, source: "300 + tax", result: "360", numeric: 360 },
  ],
  total: { value: "360" },
};
```

Replace with:

```ts
const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    {
      kind: "assignment",
      line: 3,
      source: "tax = 20%",
      varName: "tax",
      result: "0.2",
      clipboard: "0.2",
    },
    {
      kind: "value",
      line: 4,
      source: "100 km in miles",
      result: "62.137 mi",
      clipboard: "62.137",
    },
    {
      kind: "value",
      line: 5,
      source: "300 + tax",
      result: "360",
      numeric: 360,
      clipboard: "360",
    },
  ],
  total: { value: "360", clipboard: "360" },
  identifierNames: new Set(["tax"]),
  multiWordNames: new Set(),
};
```

(Task 4 will further refresh this fixture to add a heading row and update the snapshot. For Task 3, this minimal update is enough.)

- [ ] **Step 3.5: Run tests + type-check**

Run: `npm test`
Expected: all tests pass (existing + new clipboard + new name-set tests). The pure-render snapshot may show a tiny diff (e.g. `data-clipboard-value` doesn't appear yet because the renderer hasn't been updated; the snapshot still matches its previous form). If the snapshot fails because mathjs Unit row formatting differs slightly across builds, regenerate with `npm test -- render -u`; the diff should be confined to numeric formatting, not structural.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3.6: Build**

Run: `npm run build`
Expected: bundle regenerates.

- [ ] **Step 3.7: Commit**

```bash
git add src/engine.ts src/engine.test.ts src/render.test.ts src/__snapshots__/render.test.ts.snap reckon.plug.js
git commit -m "$(cat <<'EOF'
feat(engine): clipboard values + identifier/multi-word name sets on EvaluateResult

Each value/assignment/total row now carries a precomputed clipboard
string (canonical underlying number, no thousand separators / no percent
sign / no unit). EvaluateResult exposes identifierNames and multiWordNames
so the renderer (Task 4) can disambiguate identifiers vs unit names when
tokenizing.

The pure-render fixture in render.test.ts gets the minimal new fields
(empty name sets, clipboard strings on existing rows) to type-check.
Task 4 will refresh it further with heading rows and the regenerated
snapshot.
EOF
)"
```

(If the snapshot didn't actually change in step 3.5, drop `src/__snapshots__/render.test.ts.snap` from `git add`.)

---

## Task 4: Renderer — Dracula/Alucard CSS, token spans, heading row, click handler

**Files:**
- Modify: `src/render.ts` (full rewrite of STYLE block + rowHtml + script return)
- Modify: `src/render.test.ts` (new assertions; updated snapshots)
- Regenerate: `src/__snapshots__/render.test.ts.snap`

This is the biggest task — the renderer adapts to all of the new engine outputs at once. Tokenized source via `tokenize()`, heading row markup, `data-clipboard-value` attributes, full Dracula+Alucard stylesheet, and the click-handler IIFE in the previously-empty `script` slot.

- [ ] **Step 4.1: Add the failing tests**

Append to `src/render.test.ts`:

```ts
import { tokenize } from "./lexer";
import { math } from "./engine";

describe("render — heading row markup", () => {
  it("emits a tr.heading with colspan=2 for a heading row", () => {
    const out = renderSheet({
      rows: [{ kind: "heading", line: 1, depth: 1, text: "Q2 budget" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('<tr class="heading">');
    expect(out.html).toContain('<td class="source" colspan="2">Q2 budget</td>');
  });

  it("escapes HTML in heading text", () => {
    const out = renderSheet({
      rows: [{ kind: "heading", line: 1, depth: 1, text: "<b>x</b>" }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("render — tokenized source spans on value/assignment rows", () => {
  it("wraps numbers, operators, and percent in token spans", () => {
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "100 + 20%",
        result: "120",
        numeric: 120,
        clipboard: "120",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('<span class="t-num">100</span>');
    expect(out.html).toContain('<span class="t-op">+</span>');
    expect(out.html).toContain('<span class="t-num">20</span>');
    expect(out.html).toContain('<span class="t-pct">%</span>');
  });

  it("renders a known multi-word identifier as a single id span", () => {
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "300 + current tax",
        result: "360",
        numeric: 360,
        clipboard: "360",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(["current tax"]),
    });
    expect(out.html).toContain('<span class="t-id">current tax</span>');
  });

  it("uses unit class when isUnit-via-mathjs recognizes a name", () => {
    // Smoke test that mathjs does recognize "km".
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "100 km",
        result: "100 km",
        clipboard: "100",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('<span class="t-unit">km</span>');
  });
});

describe("render — clipboard data attributes", () => {
  it("emits data-clipboard-value on value result cells", () => {
    const out = renderSheet({
      rows: [{
        kind: "value",
        line: 1,
        source: "1+1",
        result: "2",
        numeric: 2,
        clipboard: "2",
      }],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('data-clipboard-value="2"');
  });

  it("emits data-clipboard-value on assignment result cells", () => {
    const out = renderSheet({
      rows: [{
        kind: "assignment",
        line: 1,
        source: "tax = 20%",
        varName: "tax",
        result: "20%",
        numeric: 0.2,
        clipboard: "0.2",
      }],
      total: null,
      identifierNames: new Set(["tax"]),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('data-clipboard-value="0.2"');
  });

  it("emits data-clipboard-value on the total row", () => {
    const out = renderSheet({
      rows: [],
      total: { value: "1,000", clipboard: "1000" },
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain('data-clipboard-value="1000"');
  });

  it("does NOT emit data-clipboard-value on comment or heading rows", () => {
    const out = renderSheet({
      rows: [
        { kind: "heading", line: 1, depth: 1, text: "section" },
        { kind: "comment", line: 2, source: "// note" },
      ],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    // No data-clipboard-value attribute should appear at all.
    expect(out.html).not.toContain("data-clipboard-value");
  });
});

describe("render — script slot contains the click handler", () => {
  it("returns a non-empty script", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.script.length).toBeGreaterThan(0);
  });

  it("script wires a click listener that uses navigator.clipboard.writeText", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.script).toContain("addEventListener");
    expect(out.script).toContain("data-clipboard-value");
    expect(out.script).toContain("navigator.clipboard.writeText");
    expect(out.script).toContain("flashNotification");
  });
});

describe("render — Dracula/Alucard CSS palette", () => {
  it("includes both light (Alucard) and dark (Dracula) palettes via media query", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toContain("@media (prefers-color-scheme: dark)");
    // Sentinel hex values from each palette
    expect(out.html).toContain("#bd93f9"); // Dracula purple (numbers, dark)
    expect(out.html).toContain("#644ac9"); // Alucard purple (numbers, light)
  });

  it("declares hover style on data-clipboard-value cells", () => {
    const out = renderSheet({
      rows: [],
      total: null,
      identifierNames: new Set(),
      multiWordNames: new Set(),
    });
    expect(out.html).toMatch(/td\.result\[data-clipboard-value\]:hover/);
    expect(out.html).toMatch(/cursor:\s*pointer/);
  });
});
```

The existing pure-render snapshot test (`renderSheet > matches the canonical snapshot`) and the integration snapshot test (`integration — evaluate(text) → renderSheet(result)`) will both fail because the HTML and CSS are about to change. They'll be regenerated in step 4.5.

For the existing pure-render snapshot, also extend its input fixture to include a heading row (Task 3 already added clipboard fields and name sets; Task 4 adds a heading row to exercise the new markup).

Find the canonical fixture in `src/render.test.ts` (post-Task-3 form):

```ts
const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    {
      kind: "assignment",
      line: 3,
      source: "tax = 20%",
      varName: "tax",
      result: "0.2",
      clipboard: "0.2",
    },
    {
      kind: "value",
      line: 4,
      source: "100 km in miles",
      result: "62.137 mi",
      clipboard: "62.137",
    },
    {
      kind: "value",
      line: 5,
      source: "300 + tax",
      result: "360",
      numeric: 360,
      clipboard: "360",
    },
  ],
  total: { value: "360", clipboard: "360" },
  identifierNames: new Set(["tax"]),
  multiWordNames: new Set(),
};
```

Replace with (adds a heading row at line 3, shifts subsequent line numbers):

```ts
const canonical: EvaluateResult = {
  rows: [
    { kind: "comment", line: 1, source: "Project budget for Q2" },
    { kind: "blank", line: 2 },
    { kind: "heading", line: 3, depth: 2, text: "Inputs" },
    {
      kind: "assignment",
      line: 4,
      source: "tax = 20%",
      varName: "tax",
      result: "20%",
      numeric: 0.2,
      clipboard: "0.2",
    },
    {
      kind: "value",
      line: 5,
      source: "100 km in miles",
      result: "62.137 mi",
      clipboard: "62.137",
    },
    {
      kind: "value",
      line: 6,
      source: "300 + tax",
      result: "360",
      numeric: 360,
      clipboard: "360",
    },
  ],
  total: { value: "360", clipboard: "360" },
  identifierNames: new Set(["tax"]),
  multiWordNames: new Set(),
};
```

Note: this also changes the existing assignment row's `result` from `"0.2"` to `"20%"` to reflect the percent-display rule from issue #1's Fix 3 (which the prior fixture predates). The `numeric` and `clipboard` fields are preserved.

Also, the old test `it("renders the total row when total is non-null", ...)` references `expect(out.html).toContain("360")` — still valid. The old `it("escapes HTML in source text...")` should still pass.

- [ ] **Step 4.2: Run tests, verify the right things fail**

Run: `npm test -- render`
Expected: new tests for token spans, heading row, data attrs, script, CSS palette FAIL. Old snapshot tests FAIL (about to refresh).

- [ ] **Step 4.3: Implement `src/render.ts`**

Replace the entire file:

```ts
import { math, type EvaluateResult, type ResultRow, type TotalRow } from "./engine";
import { tokenize, type Token, type TokenizeOptions } from "./lexer";

export interface RenderOutput {
  html: string;
  script: string;
}

const STYLE = `
<style>
  html { color-scheme: light dark; }
  body {
    font-family: var(--ui-font, ui-monospace, SFMono-Regular, Consolas, monospace);
    color: var(--root-color, #1f1f1f);
    background: var(--root-background-color, #f1f1f3);
    margin: 0; padding: 12px;
    font-size: 13px;
  }
  table.reckon { width: 100%; border-collapse: collapse; }
  td { padding: 2px 8px; vertical-align: top; white-space: pre-wrap; }
  td.source { color: inherit; }
  td.result { text-align: right; opacity: 0.85; }
  tr.blank td { height: 1.2em; }
  tr.comment td.source { opacity: 0.6; color: #635c81; font-style: italic; }
  tr.heading td.source {
    font-weight: 700;
    padding-top: 8px;
    padding-bottom: 5px;
    border-bottom: 1px solid currentColor;
  }
  tr.total td {
    border-top: 1px solid currentColor;
    padding-top: 6px;
    font-weight: 600;
  }
  tr.total td.label { text-align: left; }

  /* Token coloring — Alucard (light mode default) */
  .t-num  { color: #644ac9; }
  .t-id   { color: #14710a; }
  .t-unit { color: #036a96; }
  .t-op   { opacity: 0.45; }
  .t-kw   { color: #a3144d; font-style: italic; }
  .t-pct  { color: #a34d14; }

  /* Click-to-copy affordance */
  td.result[data-clipboard-value] { cursor: pointer; }
  td.result[data-clipboard-value]:hover { background: rgba(0, 0, 0, 0.06); }

  /* Dark mode — Dracula */
  @media (prefers-color-scheme: dark) {
    body {
      color: var(--root-color, #f8f8f2);
      background: var(--root-background-color, #282a36);
    }
    tr.comment td.source { color: #6272a4; }
    .t-num  { color: #bd93f9; }
    .t-id   { color: #50fa7b; }
    .t-unit { color: #8be9fd; }
    .t-op   { opacity: 0.55; }
    .t-kw   { color: #ff79c6; }
    .t-pct  { color: #ffb86c; }
    td.result[data-clipboard-value]:hover { background: rgba(255, 255, 255, 0.08); }
  }
</style>`.trim();

const SCRIPT = `
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
`.trim();

export function renderSheet(result: EvaluateResult): RenderOutput {
  const tokenOptions: TokenizeOptions = {
    identifiers: result.identifierNames,
    multiWord: result.multiWordNames,
    isUnit: makeIsUnit(),
  };
  const rowsHtml = result.rows.map((row) => rowHtml(row, tokenOptions)).join("\n");
  const totalHtml = result.total ? totalRowHtml(result.total) : "";
  const html = `${STYLE}
<table class="reckon">
${rowsHtml}
${totalHtml}
</table>`;
  return { html, script: SCRIPT };
}

function rowHtml(row: ResultRow, options: TokenizeOptions): string {
  switch (row.kind) {
    case "blank":
      return `<tr class="blank"><td colspan="2"></td></tr>`;
    case "comment":
      return `<tr class="comment"><td class="source" colspan="2">${escapeHtml(row.source)}</td></tr>`;
    case "heading":
      return `<tr class="heading"><td class="source" colspan="2">${escapeHtml(row.text)}</td></tr>`;
    case "value":
      return `<tr class="value"><td class="source">${tokensToHtml(tokenize(row.source, options))}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
    case "assignment":
      return `<tr class="assignment"><td class="source">${tokensToHtml(tokenize(row.source, options))}</td><td class="result" data-clipboard-value="${escapeHtml(row.clipboard)}">${escapeHtml(row.result)}</td></tr>`;
  }
}

function totalRowHtml(total: TotalRow): string {
  return `<tr class="total"><td class="label">Total</td><td class="result" data-clipboard-value="${escapeHtml(total.clipboard)}">${escapeHtml(total.value)}</td></tr>`;
}

function tokensToHtml(tokens: Token[]): string {
  return tokens.map(tokenToHtml).join("");
}

function tokenToHtml(token: Token): string {
  if (token.kind === "ws" || token.kind === "text") {
    return escapeHtml(token.text);
  }
  return `<span class="t-${token.kind}">${escapeHtml(token.text)}</span>`;
}

function makeIsUnit(): (name: string) => boolean {
  // mathjs's `Unit` class exposes a static UNITS dictionary on most builds.
  // Fall back to `isValuelessUnit` if UNITS isn't reachable.
  const UnitClass = math.Unit as unknown as {
    UNITS?: Record<string, unknown>;
    isValuelessUnit?: (s: string) => boolean;
  };
  if (UnitClass.UNITS) {
    const known = new Set(Object.keys(UnitClass.UNITS));
    return (name) => known.has(name);
  }
  if (typeof UnitClass.isValuelessUnit === "function") {
    return (name) => UnitClass.isValuelessUnit!(name);
  }
  return () => false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 4.4: Run tests**

Run: `npm test -- render`
Expected: all new direct-assertion tests pass. Snapshot tests still fail (expected — about to refresh).

- [ ] **Step 4.5: Refresh snapshots**

Run: `npm test -- render -u`
Expected: snapshots regenerate. Inspect `src/__snapshots__/render.test.ts.snap` and confirm:

- The pure-render snapshot includes `@media (prefers-color-scheme: dark)`, `#bd93f9` (Dracula purple), `#644ac9` (Alucard purple), `data-clipboard-value="..."` attributes, and a `tr.heading` row.
- The integration snapshot (table-only) shows: tokenized `<span class="t-num">`, `<span class="t-id">`, etc. spans on the source side, a `tr.heading` row for `# this is a heading` (NOTE: this row was previously a comment in the issue #11 integration snapshot — it's now a heading because of Task 2's heading rule), and `data-clipboard-value` on result cells.

Wait — the integration test in `render.test.ts` runs evaluate(...) on a fixed input. Re-read its input string: the line `# this is a heading` was a comment row pre-Task-2 and is now a heading row post-Task-2. Confirm the integration snapshot reflects this rule change correctly. If anything looks off, debug by running `npm test -- render` and inspecting the diff before regenerating.

- [ ] **Step 4.6: Run full suite + type-check**

Run: `npm test`
Expected: all tests green (lexer + engine + render + frontmatter + parser).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4.7: Build**

Run: `npm run build`
Expected: bundle regenerates, larger than before (lexer is now reachable).

- [ ] **Step 4.8: Commit**

```bash
git add src/render.ts src/render.test.ts src/__snapshots__/render.test.ts.snap reckon.plug.js
git commit -m "feat(render): tokenized source spans, headings, click-to-copy, Dracula/Alucard palette"
```

---

## Task 5: Manual smoke in live container

**Files:** none (verification step)

The plug-runtime smoke can't be automated. Bring the container up and confirm the visual behavior.

- [ ] **Step 5.1: Bring the container up + link the bundle**

Run: `npm run dev:link`
Expected: `reckon.plug.js` and `PLUG.md` copied into `infra/space/Library/emsilva/reckon/`.

If the container isn't already running, run: `npm run dev:up`

- [ ] **Step 5.2: In Silverbullet, force a plug reload**

Open http://localhost:3000 (login `dev:dev`), open command palette, run "Plugs: Reload".

- [ ] **Step 5.3: Open `Test Sheet` and verify**

Navigate to the existing `Test Sheet` page. The right-hand panel should now show:

1. Token coloring on every line — numbers in purple/blue, identifiers in green, units in cyan, etc.
2. The `current tax = 20%` line shows `tax` as a single id-colored token (multi-word).
3. Hover over a result cell — cursor changes to pointer, faint background tint appears.
4. Click a result cell — paste into another note or terminal to confirm the unformatted number landed.
5. Toggle SB dark mode (`Editor: Toggle Dark Mode` from command palette). Both palettes should look right.

- [ ] **Step 5.4: Open a new page and add a heading**

Create a new page with frontmatter `reckon: true`. Type:

```
# Q2 budget
1 + 1
```

The heading row should render bold, full-width, with a bottom border. The `1 + 1` row should be tokenized.

- [ ] **Step 5.5: Note any rough edges**

If anything is visually rough (e.g., colors clash with the SB theme, hover tint too strong/faint, heading border too heavy), note it as input for the `/redesign-skill` polish pass in Task 6. Don't tune by hand here — let the skill do its audit first.

This task does not commit anything. If the smoke surfaces a bug (not a polish issue), STOP and report so the underlying cause can be fixed.

---

## Task 6: `/redesign-skill medium` polish pass

**Files:** `src/render.ts` (CSS/markup edits per skill suggestions), possibly `src/__snapshots__/render.test.ts.snap` (regenerate), `reckon.plug.js` (rebuild).

**This is a controller-level task.** The plan documents what happens; the human controller (Claude) runs the skill rather than dispatching to a subagent — slash commands are user-driven.

- [ ] **Step 6.1: Invoke the skill**

In the controller session, invoke `/redesign-skill` with effort `medium`. The skill audits the rendered output (you may need to point it at the live panel HTML or paste the rendered output for it to evaluate). Capture the suggestions verbatim — color tweaks, spacing changes, hover/active feedback nuances, typography refinements.

- [ ] **Step 6.2: Triage the suggestions**

For each suggestion:
- If it's a CSS-level change (color tweak, spacing, font-weight) → apply it.
- If it's a markup change (e.g., adding a wrapper element for hover effect) → apply it; update tests if any structural assertion needs to follow.
- If it's a behavior change (e.g., adding animation, debouncing clicks) → defer unless trivial. Note it as a potential follow-up issue.

The default lean is "apply when it's a clear improvement and bounded to render.ts." Big architecture changes are out of scope for V1.x; bounce them to a follow-up.

- [ ] **Step 6.3: Apply approved suggestions to `src/render.ts`**

Edit the STYLE block (and/or rowHtml if markup changes were approved) to match the suggested redesign.

- [ ] **Step 6.4: Re-run tests + regenerate snapshot**

Run: `npm test`
Expected: all direct-assertion tests pass (the assertions in Task 4 were chosen to survive cosmetic CSS changes — they check for sentinel hex values, class names, and structural hooks). The snapshot WILL fail because the HTML changed.

Run: `npm test -- render -u`
Expected: snapshots regenerate. Read the diff to confirm the changes match what the redesign-skill suggested and didn't drop anything important (still has both palettes, still has data-clipboard-value, still has the heading rule).

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6.5: Build**

Run: `npm run build`
Expected: bundle regenerates.

- [ ] **Step 6.6: Manual re-smoke in the live container**

Repeat Task 5's checklist briefly to confirm the redesign didn't break anything visible.

- [ ] **Step 6.7: Commit**

```bash
git add src/render.ts src/__snapshots__/render.test.ts.snap reckon.plug.js
git commit -m "$(cat <<'EOF'
style(render): apply /redesign-skill medium polish pass

Folded approved redesign-skill suggestions back into src/render.ts:
[brief 1-2 line summary of what changed — e.g., "tightened heading
border, softened hover tint, reduced operator opacity for parity"].
Snapshot regenerated; sentinel-hex assertions still hold.
EOF
)"
```

If the skill produced no actionable suggestions, skip the commit and proceed to Task 7. Note in the closeout commit's body that the redesign pass ran and produced no actionable items.

---

## Task 7: Closeout — Changelog + verification page + issue comment

**Files:**
- Modify: `infra/space-seed/Changelog.md` (prepend section)
- Create: `infra/space-seed/Tests/Visual Polish Verification.md` (`reckon: true` page)
- Mirror: `infra/space/Tests/Visual Polish Verification.md` (gitignored)

Per memory's per-issue verification convention. Issue #3 IS observable in a Reckon panel (unlike #11), so the verification page is a `reckon: true` sheet exercising every feature.

- [ ] **Step 7.1: Prepend Changelog entry**

Open `infra/space-seed/Changelog.md`. Above the existing "## What changed — Engineering hardening (issue #11)" section (and after the top-of-file intro line + horizontal rule), insert:

```markdown
## What's new — Visual polish (issue #3)

The right-hand panel got three improvements that work together:

### 1. Source-side syntax coloring (Dracula in dark, Alucard in light)

Every source line is now tokenized and colored: numbers, identifiers,
unit names, operators, the keywords `of` / `in` / `to`, and `%`. The
palette swaps between Dracula (dark mode) and Alucard (light mode)
automatically — no config, follows SB's theme.

### 2. Markdown headings

A line shaped like `# foo`, `## bar`, etc. (1–6 `#`s, whitespace, content)
now renders as a bold full-width section label with a bottom border —
the way you'd expect from any Markdown surface. The rest of the comment
escape from issue #1 still applies (`# nospace`, `// notes`, `#######`
remain comments).

### 3. Click-to-copy on result cells

Click any result on the right and the closest underlying number lands
in your clipboard, plus a brief flash notification confirms it. Copy
rules: numbers without thousand separators, percent literals as
decimals, units stripped to the leading number. So clicking the result
of `100,000 + 50` copies `100050`; clicking `tax = 20%` copies `0.2`;
clicking `100 km in miles` copies the numeric portion without the unit.

---
```

(Don't drop the existing `---` separator at the bottom of the new section — it should fit cleanly between the intro and the existing #11 entry.)

- [ ] **Step 7.2: Create the verification sheet**

Create `infra/space-seed/Tests/Visual Polish Verification.md`:

```markdown
---
reckon: true
---

# Visual Polish — Live Verification

Open this page in Silverbullet to verify issue #3's changes. The
right-hand panel should show this page tokenized; headings should look
like section labels; clicking results should copy + flash.

## Headings

# Top-level heading (depth 1)
## Sub-section (depth 2)
### Even deeper (depth 3)

If these render as bold full-width labels with a bottom border, headings
work. If they show as comment rows, something's wrong.

## Token coloring

# Hover here, then click — try every category
salary = 200000
tax = 20%
current tax = 18%
salary * 1.15
500 - tax
20% of 450
100 km in miles
24 degC to degF

Verify in the panel:
- Numbers (200000, 20, 1.15, etc.) in one color (Dracula purple in dark, Alucard purple in light).
- Identifiers (salary, tax, current tax) in green.
- Unit names (km, miles, degC, degF) in cyan.
- Keywords (in, of, to) in pink (italic).
- `%` symbol in orange.
- Operators (`+`, `-`, `*`, `=`) faded.

## Click-to-copy

Click each result and paste into another note. Expected:

- `salary` → `200000` (no commas)
- `tax` → `0.2` (decimal, not `20%`)
- `current tax` → `0.2`
- `salary * 1.15` → `230000`
- `500 - tax` → `400`
- `20% of 450` → `90`
- `100 km in miles` → `62.13711922373339` (numeric only, no `miles`)
- Page total → unformatted sum

Hover should show a pointer cursor and a faint background tint.

## Theme swap

Toggle SB's dark mode (`Editor: Toggle Dark Mode`). Both palettes should
look balanced — neither washed out nor too vivid. If one mode looks
broken, that's a bug for the next iteration.
```

- [ ] **Step 7.3: Mirror to the live space**

```bash
if [ -d infra/space ]; then
  mkdir -p infra/space/Tests
  cp "infra/space-seed/Tests/Visual Polish Verification.md" "infra/space/Tests/Visual Polish Verification.md"
fi
```

The live mirror is gitignored; not committed.

- [ ] **Step 7.4: Final sanity-run**

Run: `npm test`
Expected: all tests green.

Run: `npx tsc --noEmit`
Expected: clean.

Run: `ls -la reckon.plug.js`
Capture the size for the issue comment.

- [ ] **Step 7.5: Commit Changelog + verification doc**

```bash
git add infra/space-seed/Changelog.md "infra/space-seed/Tests/Visual Polish Verification.md"
git commit -m "docs(infra): Changelog + Tests/ verification doc for visual polish"
```

- [ ] **Step 7.6: Post the GitHub issue comment**

```bash
gh issue comment 3 --repo emsilva/silverbullet-reckon --body "$(cat <<'EOF'
## Visual polish shipped on `main`

Issue #3's three render-side improvements landed as a bundle:

- `feat: add pure tokenizer module (src/lexer.ts)` — new module
- `feat(engine): heading row kind for ATX-form Markdown lines`
- `feat(engine): clipboard values + identifier/multi-word name sets on EvaluateResult`
- `feat(render): tokenized source spans, headings, click-to-copy, Dracula/Alucard palette`
- `style(render): apply /redesign-skill medium polish pass` (or skipped if no actionable suggestions)
- `docs(infra): Changelog + Tests/ verification doc for visual polish`

Plus a verification sheet at `infra/space-seed/Tests/Visual Polish Verification.md` (mirrored into the running dev space).

### Verification ask

In SB at localhost:3000, run `Plugs: Reload`, then open the new `Tests/Visual Polish Verification` page and walk through:

1. Headings render as bold full-width section labels (not comment rows).
2. Source tokens are colored: numbers, identifiers, units, keywords, `%`, operators each have their own color/style.
3. Clicking a result copies the closest underlying number (paste into another note to confirm), plus you get a flash notification.
4. Hovering shows a pointer cursor + faint background tint.
5. Toggle SB dark mode — both palettes look right.

Once you confirm, I'll close this issue.
EOF
)"
```

Capture and report the comment URL.

- [ ] **Step 7.7: Do NOT close the issue**

Wait for the user's verification. The bundle is on local `main` until they push.

---

## Out of scope for this plan

- **`between` keyword coloring** — deferred to issue #9 (NL sugar).
- **Locale-aware `result` formatting** — issue #4. Clipboard remains en-US-canonical regardless of display locale.
- **Visible-error rows** — issue #2. Comment rows continue to absorb parse failures.
- **Currency tokens** — issue #7.
- **Keyboard shortcut for copy** — not in scope.
- **Animated pulse on copy** — considered, dropped. SB's flashNotification is the canonical confirmation.

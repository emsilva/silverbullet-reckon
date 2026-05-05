# Changelog

User-facing notes on what changed in each Reckon iteration. Latest at the top.

---

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

---

## What's new — Visual polish (issue #3)

The right-hand panel got three improvements that work together:

### 1. Source-side syntax coloring (Monokai Pro)

Every source line is now tokenized and colored: numbers, identifiers,
unit names, operators, the keywords `of` / `in` / `to`, and `%`. The
palette swaps between Monokai Pro (dark mode) and Monokai Pro Light
(light mode) automatically — no config, follows SB's theme.

### 2. Markdown headings

A line shaped like `# foo`, `## bar`, etc. (1–6 `#`s, whitespace, content)
now renders as a bold full-width section label with a soft bottom
border — the way you'd expect from any Markdown surface. The rest of
the comment escape from issue #1 still applies (`# nospace`, `// notes`,
`#######` remain comments).

### 3. Click-to-copy on result cells

Click any result on the right and the closest underlying number lands
in your clipboard, plus a brief flash notification confirms it. Copy
rules: numbers without thousand separators, percent literals as
decimals, units stripped to the leading number. So clicking the result
of `100,000 + 50` copies `100050`; clicking `tax = 20%` copies `0.2`;
clicking `100 km in miles` copies the numeric portion without the unit.

---

## What changed — Engineering hardening (issue #11)

These are mostly invisible to users — math behavior is unchanged. The
three items here harden the project's distribution path:

### 1. Smaller plug bundle (faster install, faster load)

`reckon.plug.js` shrank from ~654 KB to ~326 KB by tree-shaking `mathjs`
to a curated set of `*Dependencies` aggregators (parser + arithmetic +
units + `to`-conversion only — no BigNumber, no Fraction, no matrices,
no statistics). All 107 prior tests still pass, plus a new integration
snapshot test (item 2) makes 108.

### 2. Integration snapshot covers `evaluate → renderSheet`

A new test in `src/render.test.ts` runs a canonical mixed-input string
through `evaluate(...)` and `renderSheet(...)` end-to-end and snapshots
the rendered table HTML. Catches contract drift between engine and
renderer that the existing pure-render snapshot would miss.

### 3. CI runs every push

A new GitHub Actions workflow at `.github/workflows/ci.yml` runs `npm
test`, type-checks, rebuilds the plug, and verifies the committed
`reckon.plug.js` matches the rebuild. Stale-bundle commits now fail CI.

---

## What's new — Quality Fixes (issue #1)

Four small Soulver-parity fixes, landed as one bundle.

### 1. Auto-total now ignores assignment rows

Previously, `tax = 20%` followed by `100` summed to `100.2` (the assignment's
underlying decimal value leaked into the running total). The total now counts
only `value` rows — assignments don't contribute:

```
tax = 20%        | 20%
100              | 100
                 | Total 100
```

### 2. `#` and `//` lines are always comments

Any line whose first non-whitespace token is `#` or `//` is rendered as a
comment row, regardless of what comes after. Useful for section breaks
and inline notes inside a sheet:

```
#nospace          | (comment)
// scratch math   | (comment)
1000 + 200        | 1,200
```

Mid-line `#` is unaffected — mathjs natively treats trailing `#` as an inline
comment, so `5 # inline` still evaluates to `5`. Both behaviors compose.

> **Updated by issue #3:** ATX-shaped lines (`# foo`, `## bar`, ..., 1–6 hashes
> followed by whitespace and content) now render as **headings** instead of
> comments — see "Visual polish" above. Use `//` or `#nospace` if you want a
> non-heading comment.

### 3. Percent-literal assignments display as `N%`, not `0.2`

When the right-hand side of an assignment is a literal percentage, the result
column now shows the percentage exactly as you typed it:

```
tax = 20%         | 20%
tax = 20.5%       | 20.5%
salary = 200000   | 200,000   (unchanged: only literal-percent assignments
                  |            display this way)
```

The underlying decimal is still used for arithmetic — `100 + tax` continues
to evaluate additively to `120`.

### 4. Multi-word variable names

Variable names can now contain spaces — Soulver's signature feature. Internal
whitespace is normalized so `current   tax` and `current\ttax` both refer to
the same name:

```
current tax = 20%               | 20%
300 + current tax               | 360
budget for q2 = 200000          | 200,000
budget for q2 * 1.15            | 230,000
```

The additive-percent convention applies to multi-word percentage variables
too — `300 + current tax` becomes `300 * (1 + 0.2) = 360`, just like the
single-word `tax` case.

---

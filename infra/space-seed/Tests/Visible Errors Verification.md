---
reckon: true
reckon-show-errors: true
reckon-isolated: true
---

# Visible Errors — Live Verification

This page has `reckon-show-errors: true` in frontmatter. Lines that
fail mathjs parse should render as **error rows**: pink row wash +
red italic source. Compare with the silent grey treatment of
explicit `//` comments.

The page also has `reckon-isolated: true` so each block has its own
scope and gutter — `line1` inside any section refers to the first
reckon row of that section's block, not the first reckon row of the
page. This keeps each section's expected-value annotations
self-contained.

To verify default behavior, edit the frontmatter to remove
`reckon-show-errors: true` and reload the page — the same lines
should now render as silent grey comment rows.

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

Even with `reckon-show-errors: true`, lines that start with `//` are
explicit prose, not errors. They render the way they always have:

```reckon
// this is intentional prose — should be grey, not red
// even if the next line is broken math, this line stays grey
5 +
100 + 200
// expected: line 1 grey, line 2 grey, line 3 error (red), line 4 → 300
```

(Lines starting with `#` followed by a space are ATX headings — see
section 5. Lines starting with `#` without a space are comments via
the explicit-escape rule, but that shape is unusual in practice.)

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

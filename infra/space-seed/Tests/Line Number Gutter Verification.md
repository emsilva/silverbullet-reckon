---
reckon: true
---

# Line-Number Gutter — Live Verification

Open this page in Silverbullet. The right-hand panel and each fenced
`reckon` block below should each show a left-side line-number gutter.

## What to look for in every panel/block

- Every row has a number on the left.
- Numbers on **value** and **assignment** rows are stronger; numbers on
  **comment**, **blank**, and **heading** rows are faded.
- The total row's gutter shows `Σ`.
- Hovering a referenceable row shows a faint background tint and a
  pointer cursor on the gutter cell.
- Clicking a referenceable gutter copies `line<N>` (e.g. `line1`) — paste
  somewhere to confirm.
- Hovering a row that contains `lineN` lights up the referenced row;
  hovering a row that's *referenced by* others lights up all rows that
  reference it.
- Source spans containing `lineN` are colored in Monokai gold (light) /
  yellow (dark) — distinct from regular identifiers and numbers.

## Block 1 — basic gutter shapes

```reckon
# Header (faded gutter)
salary = 200000
tax = 20%
salary * (1 + tax)
```

Expected:
- 4 rows total, gutters show 1, 2, 3, 4 (block-internal numbering).
- Row 1 (heading) has a faded gutter; rows 2-4 are stronger.
- Total `Σ` row appears below with the auto-sum.

## Block 2 — lineN references and forward-pair highlight

```reckon
100
200
line1 + line2
```

Expected:
- 3 rows, gutters 1-3.
- `line1` and `line2` in the source are colored gold (light) / yellow (dark).
- Hover the third row (`line1 + line2`) → rows 1 and 2 light up.
- Hover row 1 → row 3 lights up (reverse direction — row 3 references row 1).
- Click gutter on row 2 → `line2` lands in clipboard.

## Block 3 — chained ans (no highlight, ans not in scope)

```reckon
80
ans + 10%
ans * 1.2
```

Expected:
- 3 rows, gutters 1-3.
- All gutters strongly styled (all rows are value rows).
- Hovering row 2 or 3 does NOT light up row 1 — `ans` is excluded from
  hover-pair this iteration. (lineN-only highlighting per spec.)

## Block 4 — non-referenceable rows still numbered

```reckon
# Q2 budget
salary = 200000

salary * 1.15
```

Expected:
- 4 rows, gutters 1-4.
- Row 1 (heading), row 3 (blank) → faded gutters.
- Rows 2, 4 → stronger gutters, clickable.

## Page-mode verification (this whole page as a sheet)

Outside the fenced blocks, this page is itself a `reckon: true` sheet,
so the right-hand panel evaluates the whole page. The panel should
also show the gutter, with line numbers matching the source line of
each row in this Markdown file (likely starting in the teens because
of the headings and prose above).

500
ans + 100

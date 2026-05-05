---
reckon: true
---

# Cross-Block Continuous — Live Verification

Open this page in Silverbullet (run `Plugs: Reload` first if needed).
The fenced `reckon` blocks below should *communicate* — variables,
`ans`, and `lineN` all flow across block boundaries in source order.
The gutter counts continuously across blocks (block 1 starts at 1;
block 2 picks up where block 1 left off). The right-hand page panel
evaluates non-fenced lines as a separate, isolated track (panel uses
source-line numbers; blocks use the continuous block-row counter).

Compare with `Cross-Block Isolated Verification.md` to see what the
opt-out flag changes.

## 1. Variable flow across blocks

Block 1 sets `bill`:

```reckon
bill = 80
```

Block 2 references `bill` from Block 1:

```reckon
bill * 1.2
// expected: 96 (sees `bill` from prior block)
```

## 2. `ans` flow across blocks

Block 1 produces a numeric:

```reckon
100
200
```

Block 2's `ans` (used on its first row) carries Block 1's last numeric (200):

```reckon
ans + 50
// expected: 250 (ans = 200 from prior block's last row)
```

## 3. `lineN` flows across blocks (continuous gutter)

The gutter counts continuously across blocks, not from 1 inside each
block. Block 1 above shows gutter `1`; block 2 shows `2, 3`; this
block continues from there. `lineN` references that continuous
counter — `line1` from anywhere on the page resolves to the *first
reckon row in the page* (the `bill = 80` assignment).

```reckon
line1 + line2
// expected: 176 (= 80 from block 1's `bill = 80` + 96 from block 2's `bill * 1.2`)
```

## 4. `total` reference + derived-row exclusion

Within a block, `total` resolves to the same number shown in the Σ
row at the bottom. Rows that reference `total` are *derived* — they
display their resolved value, but they don't contribute to Σ.

```reckon
100
200
total / 2
// expected: 150 (= 300 / 2)
// expected Σ: 300 (the total/2 row is derived, excluded from Σ)
```

The Σ row at the bottom of the block above should show **300**, not
**450**.

## 5. `total` is block-scoped (doesn't leak)

The next block has its own `total`, computed from its own value rows.
The previous block's Σ (300) is NOT visible here:

```reckon
50
total / 2
// expected: 25 (this block's total = 50, not 300)
// expected Σ: 50
```

## 6. Multi-word variables flow too

```reckon
current tax = 20%
```

```reckon
100 + current tax
// expected: 120 (additive percent rewrite + cross-block flow)
```

## Page panel

Outside the fenced blocks, this page is itself `reckon: true`, so the
right-hand panel evaluates the page's prose-math (this prose has no
math, so the panel only shows what the lines below produce). The
panel's scope is **separate** from the blocks above — `ans` here
starts fresh:

500
ans + 100
// expected (panel): 500, 600

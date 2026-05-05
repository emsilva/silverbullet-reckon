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
line13 + line14
// expected (panel): 100, 200, 300 (lineN uses source line numbers — `line13` and `line14` here)

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

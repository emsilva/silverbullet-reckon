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

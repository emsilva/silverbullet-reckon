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

If these render as bold full-width labels with a soft bottom border,
headings work. If they show as comment rows, something's wrong.

## Token coloring

// Hover here, then click — try every category
salary = 200000
tax = 20%
current tax = 18%
salary * 1.15
500 - tax
20% of 450
100 km in miles
24 degC to degF

Verify in the panel:
- Numbers (200000, 20, 1.15, etc.) in purple (Monokai Pro `#ab9df2` in dark, Monokai Pro Light `#6849c2` in light).
- Identifiers (salary, tax, current tax) in green.
- Unit names (km, miles, degC, degF) in cyan.
- Keywords (in, of, to) in red (italic).
- `%` symbol in orange.
- Operators (`+`, `-`, `*`, `=`) faded.

## Click-to-copy

Click each result and paste into another note. Expected:

// salary → 200000 (no commas)
// tax → 0.2 (decimal, not 20%)
// current tax → 0.18
// salary * 1.15 → 230000
// 500 - tax → 400
// 20% of 450 → 90
// 100 km in miles → 62.13711922373339 (numeric only, no `miles`)
// Page total → unformatted sum

Hover should show a pointer cursor and a faint tinted background.

## Theme swap

Toggle SB's dark mode (`Editor: Toggle Dark Mode`). Both palettes
should look balanced — neither washed out nor too vivid. If one mode
looks broken, that's a bug for the next iteration.

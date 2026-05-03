# Reckon

A Soulver-style notepad calculator for [Silverbullet](https://silverbullet.md).

Tag a page with `reckon: true` in frontmatter for a live right-hand panel
that renders each line and its result side-by-side. Or drop a
` ```reckon ``` ` fenced block anywhere for an inline calc sheet.

## What works in V1

- Arithmetic with parens, exponents (`2 ^ 8`), and standard precedence.
- Variables: `salary = 200000`, then use `salary` on later lines.
- Percentages, including the Soulver convention:
  - `20% of 450` → `90`
  - `100 + 20%` → `120` (additive)
  - `tax = 20%` then `100 + tax` → `120` (additive on percentage variables too)
- Unit conversions: `100 km in miles` → `62.137 mi`. Anything mathjs
  understands as a unit works.
- Auto-total at the bottom of the panel: sums all dimensionless numeric
  results. Hidden if there are none (e.g. a sheet of pure unit
  conversions).
- Lines that don't parse become "comment" rows — they show in the source
  column with no result. This is how prose mixes with math.

## What's not in V1 (yet)

- Date math (`today + 3 weeks`, `days in February 2022`).
- Currency conversion (`100 USD to EUR`) — needs a network permission and
  a rates source.
- Line references (`line2`, `ans`).
- Soulver natural-language sugar (`midpoint between`,
  `random number between`, `time in New York`).
- Visible error markers — math typos render silently as comments.

## Install

In Silverbullet, run `Library: Install` and paste:

```
https://github.com/emsilva/silverbullet-reckon/blob/main/PLUG.md
```

## Known limitations

- **Panel coexistence.** `editor.showPanel("rhs", ...)` replaces whatever
  was in the right-hand slot. If another plug also uses the RHS panel,
  they'll fight on every navigation/edit. Silverbullet doesn't expose a
  way to share that slot from a single plug.
- **Silent error policy.** Math-shaped typos render blank, not red, so
  they look identical to prose. This is intentional in V1 to avoid noisy
  panels; a configuration flag for visible errors is on the roadmap.

## Development

See `infra/README.md` for the dev container setup and smoke checklist.

```bash
npm install
npm test               # vitest unit tests
npm run dev:seed       # one-time
npm run dev:up         # build + link + boot Silverbullet at :3000
```

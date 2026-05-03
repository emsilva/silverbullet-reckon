---
name: Library/emsilva/reckon/PLUG
tags: meta/library
files:
  - reckon.plug.js
---

# Reckon — Soulver-style notepad calculator for Silverbullet

Tag a page with `reckon: true` in frontmatter for a live right-hand panel
that renders each line and its result side-by-side. Or drop a
` ```reckon ``` ` fenced block anywhere for an inline calc sheet.

## Quick reference

| You type | You get |
|---|---|
| `1 + 1` | `2` |
| `tax = 20%` | (assignment, value `0.2`) |
| `100 + tax` (after `tax = 20%`) | `120` (additive) |
| `20% of 450` | `90` |
| `100 km in miles` | `62.137 mi` |
| `Anything that doesn't parse` | (treated as a comment, no result) |

The bottom of the panel shows the total of all dimensionless numeric
results; if there are none, it's hidden.

## Install

Run `Library: Install` and paste the URL of this `PLUG.md` on GitHub.

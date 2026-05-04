---
reckon: true
---

# Quality Fixes — Live Verification

Open the right-hand panel and compare each row's result column against the
expected value in its preceding comment. The four fixes from issue #1 are
each exercised in their own section below.

## Fix 1 — Auto-total excludes assignment rows

# `tax = 20%` should display as `20%` (Fix 3) and NOT contribute to the
# page total. Only the bare `100` row should be summed for this section.
tax = 20%
100

## Fix 2 — `#` and `//` lines are always comments

# This whole section should produce comment rows (no result column on
# the right) and contribute zero to the page total.

# Heading-style comment.
// Single-line slash comment.
//   Even with leading whitespace.
   # Indented `#` is still a comment.

# Mid-line `#` is mathjs's territory, not ours: this evaluates to 5.
5 # inline comment

## Fix 3 — Percent-literal assignments display as `N%`

# Each line should show the RHS as typed in the result column,
# preserving user spelling. Underlying values are still 0.2 and 0.205
# for arithmetic — only the display changes.
discount = 20%
rebate = 20.5%
spaced = 20 %

# Non-percent assignments still format normally:
flat = 200000

## Fix 4 — Multi-word variable names

# Assignment row should show varName `current tax` and result `20%`.
current tax = 20%

# Reference resolves additively: 300 * (1 + 0.2) = 360.
300 + current tax

# Multi-word non-percent assignment + reference.
budget for q2 = 200000
budget for q2 * 1.15

# Tab-separated reference still resolves to the space-registered name.
100 + current	tax

## Page total

# Sum of `value` rows only (assignments are excluded by Fix 1):
#   Fix 1:  100
#   Fix 2:  5
#   Fix 4:  360 + 230,000 + 120
# Expected page total: 230,585

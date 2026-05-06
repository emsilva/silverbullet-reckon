# Slash Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/reckon-sheet` and `/reckon-block` as slash templates under `infra/space-seed/Library/Reckon/Slash Commands/` so SilverBullet's std runner auto-discovers and registers them in the slash-command palette. Closes [issue #5](https://github.com/emsilva/silverbullet-reckon/issues/5).

**Architecture:** Two markdown pages tagged `meta/template/slash`. SB's bundled std runner (`Library/Std/Infrastructure/Slash Templates.md`) queries the index for that tag and calls `slashCommand.define{...}` for each match, using the page name's last `/`-separated component as the command name. No engine, render, plug-code, or `reckon.plug.yaml` change.

**Tech Stack:** Markdown only. Existing TypeScript / mathjs / vitest stack untouched.

**Spec:** `docs/superpowers/specs/2026-05-06-slash-commands-design.md`

---

## File Structure

- `infra/space-seed/Library/Reckon/Slash Commands/reckon-sheet.md` (create) — slash template for `/reckon-sheet`. Body inserts `reckon: true` frontmatter + a starter heading line.
- `infra/space-seed/Library/Reckon/Slash Commands/reckon-block.md` (create) — slash template for `/reckon-block`. Body inserts an empty fenced reckon block with cursor inside.
- `infra/space-seed/Tests/Slash Commands Verification.md` (create) — manual-test scratchpad describing the live verification flow.
- `infra/space-seed/Changelog.md` (modify) — prepend the `What's new — Slash commands (issue #5)` entry above the existing visible-errors entry.

The runtime mirror under `infra/space/...` is gitignored and gets populated by `npm run dev:link` in Task 4 (closeout).

No `src/` changes. No `reckon.plug.yaml` changes. No new tests in `src/`. Test count stays at **283** (lexer 34, parser 50, render 46, engine 120, frontmatter 33).

**Working directory:** `main` (per user's persistent preference for this repo — no worktree).

Three commits total (one per Task 1-3). Task 4 has no commit — only mirror, regression sanity checks, and an issue comment.

---

## Task 1: Create the two slash-template pages

**Files:**
- Create: `infra/space-seed/Library/Reckon/Slash Commands/reckon-sheet.md`
- Create: `infra/space-seed/Library/Reckon/Slash Commands/reckon-block.md`

This task creates only markdown content. No tests, no build, no plug change. Both files share the same `meta/template/slash` tag pattern; their bodies differ.

- [ ] **Step 1: Create the parent directory**

The `Library/` subtree does not yet exist under `infra/space-seed/`. Create the nested path:

```bash
mkdir -p "infra/space-seed/Library/Reckon/Slash Commands"
```

Verify:

```bash
ls -d "infra/space-seed/Library/Reckon/Slash Commands"
```

Expected: directory listed, no error.

- [ ] **Step 2: Create `reckon-sheet.md`**

Write `infra/space-seed/Library/Reckon/Slash Commands/reckon-sheet.md` with exactly this content:

````markdown
---
tags: "meta/template/slash"
description: Insert reckon-sheet frontmatter and a starter heading
---

---
reckon: true
---

# |^|
````

The body has two `---\n...\n---` blocks: the **first** is the slash-template's own frontmatter (telling SB this page is a slash template); the **second** is the literal text that gets inserted into the user's page when the command fires. After SB strips the slash-template frontmatter via `index.extractFrontmatter` and runs `string.trimStart`, the inserted text is exactly:

```
---
reckon: true
---

# |^|
```

`|^|` is consumed by `editor.insertAtCursor(..., true)` and the cursor lands at that position.

- [ ] **Step 3: Create `reckon-block.md`**

Write `infra/space-seed/Library/Reckon/Slash Commands/reckon-block.md` with exactly this content (note: the body literally contains triple-backticks):

`````markdown
---
tags: "meta/template/slash"
description: Insert an empty reckon block
---

```reckon
|^|
```
`````

`index.extractFrontmatter` operates on the raw page string, not parsed markdown, so the triple-backticks pass through as literal characters. The inserted text is exactly:

````
```reckon
|^|
```
````

- [ ] **Step 4: Verify file shapes**

```bash
ls -1 "infra/space-seed/Library/Reckon/Slash Commands/"
```

Expected output:
```
reckon-block.md
reckon-sheet.md
```

Sanity-check the body of each (look for the `tags:` line and the `|^|` placeholder):

```bash
grep -l "meta/template/slash" "infra/space-seed/Library/Reckon/Slash Commands/"*.md
```

Expected: both file paths printed (both have the tag).

```bash
grep -c '|\^|' "infra/space-seed/Library/Reckon/Slash Commands/"*.md
```

Expected: each file shows count `1` (one cursor placeholder per template).

- [ ] **Step 5: Commit**

```bash
git add "infra/space-seed/Library/Reckon/Slash Commands/reckon-sheet.md" "infra/space-seed/Library/Reckon/Slash Commands/reckon-block.md"
git commit -m "$(cat <<'EOF'
feat(slash): /reckon-sheet and /reckon-block slash templates for #5

Two markdown pages tagged meta/template/slash under
Library/Reckon/Slash Commands/. SilverBullet's std runner
auto-discovers them by tag and registers /reckon-sheet and
/reckon-block in the slash-command palette.

reckon-sheet body inserts reckon: true frontmatter + a starter
heading line. reckon-block body inserts an empty fenced reckon
block with the cursor placeholder inside. Both insert at cursor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create the verification page

**Files:**
- Create: `infra/space-seed/Tests/Slash Commands Verification.md`

This page is plain markdown — not a reckon sheet. It describes the live verification flow the user runs in SB to confirm the slash commands work end-to-end.

- [ ] **Step 1: Write the verification page**

Write `infra/space-seed/Tests/Slash Commands Verification.md` with exactly this content:

`````markdown
# Slash Commands — Live Verification

Verifies that `/reckon-sheet` and `/reckon-block` (issue #5) are
discoverable in SilverBullet's `/`-palette autocomplete and that
each inserts the correct scaffold at the cursor.

## Setup

1. From the repo root: `npm run build && npm run dev:link`.
2. In SilverBullet, run `Plugs: Reload` (Cmd-K → "Plugs: Reload").
3. Reload the current page once so SB re-indexes the space and
   picks up the new slash-template pages tagged
   `meta/template/slash`.

## Test 1: discovery

Open a fresh empty page, type `/reckon-`, and confirm autocomplete
offers both:

- `/reckon-sheet` — *Insert reckon-sheet frontmatter and a starter heading*
- `/reckon-block` — *Insert an empty reckon block*

The descriptions come from the templates' frontmatter `description:`
field. If the descriptions don't show, autocomplete is still pulling
from a stale index — reload the page and try again.

## Test 2: `/reckon-sheet` insertion

On a fresh empty page (cursor at the very top), select `/reckon-sheet`
from the dropdown.

Expected page contents (cursor lands at the position marked
`<cursor>`):

````
---
reckon: true
---

# <cursor>
````

Expected behavior:

- The right-hand panel becomes visible (frontmatter has `reckon: true`,
  so `isReckonSheet` returns true). Σ is empty because there are no
  math rows yet, but the panel is present.
- Type a page title at the cursor (e.g. `Q3 budget`); it appears
  inline as the H1 heading.
- Add a math line below the heading (e.g. `100 + 200`); the panel
  updates to show it with Σ = 300.

## Test 3: `/reckon-block` insertion

Open any page (with or without existing content). Place the cursor on
a blank line, type `/reckon-block`, and select it from the dropdown.

Expected inserted content (cursor lands at `<cursor>`):

````
```reckon
<cursor>
```
````

Expected behavior:

- Type `100 + 200` at the cursor and click out of the block; the
  reckon code widget renders below the closing fence with the
  value `300`.
- The page does NOT need `reckon: true` in frontmatter —
  `/reckon-block` works on any page.

## Test 4: existing palette command unchanged

Open the command palette (Cmd-K / Ctrl-K) and type `Reckon`. Confirm
the command `Reckon: Convert page to sheet` still appears (from
issue #1) and still toggles `reckon: true` on the current page when
run. This is a regression check — no code changed for it, but
verifying nothing was accidentally shadowed by the new slash-command
entries.

## At-cursor contract — known limitation

Both slash commands insert at the user's cursor (this is the SB
slash-template default). Implications:

- `/reckon-sheet` works cleanly only when the cursor is at the very
  top of an empty (or near-empty) page. If invoked mid-content, the
  inserted `---\nreckon: true\n---` lands mid-page; SB does not parse
  mid-page `---` as frontmatter, so the panel will not activate.
  **Use the existing `Reckon: Convert page to sheet` palette command
  instead to retrofit `reckon: true` to a page that already has
  content.**
- `/reckon-block` works anywhere. Invoking it inside an existing
  ` ```reckon ` fence breaks the outer block; undo and try again
  outside the fence.

## Distribution note

This page and the slash templates ship in `infra/space-seed/`.
`npm run dev:link` mirrors them to `infra/space/` (the runtime
space). End users who install the plug from a URL do **not** get
the slash templates — that's tracked in [issue #15](https://github.com/emsilva/silverbullet-reckon/issues/15).
`````

- [ ] **Step 2: Verify the file is in place**

```bash
ls "infra/space-seed/Tests/Slash Commands Verification.md"
```

Expected: file listed, no error.

```bash
grep -c "## Test " "infra/space-seed/Tests/Slash Commands Verification.md"
```

Expected: `4` (four test sections).

- [ ] **Step 3: Commit**

```bash
git add "infra/space-seed/Tests/Slash Commands Verification.md"
git commit -m "$(cat <<'EOF'
docs(infra): #5 verification page for slash commands

Tests/Slash Commands Verification.md describes the live verification
flow: discovery via /reckon- autocomplete, /reckon-sheet insertion
on a fresh page (panel activates), /reckon-block insertion anywhere
(widget renders), and a regression check that the existing
Reckon: Convert page to sheet palette command still works.

Footer documents the at-cursor contract and the dev-space-only
distribution (tracked in #15).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Prepend the Changelog entry

**Files:**
- Modify: `infra/space-seed/Changelog.md` — prepend a new `## What's new — Slash commands (issue #5)` entry above the existing #2 visible-errors entry.

- [ ] **Step 1: Confirm the existing top of the Changelog**

Read the first 10 lines of `infra/space-seed/Changelog.md` to confirm the existing top boundary (what we're prepending to).

Expected: the file starts with:
```
# Changelog

User-facing notes on what changed in each Reckon iteration. Latest at the top.

---

## What's new — Visible errors (issue #2)
```

If the top differs (e.g. someone has prepended another entry first), adjust the Edit's `old_string` accordingly to match the actual current top — the goal is to insert the #5 entry between the file's leading separator and the first existing `##` entry.

- [ ] **Step 2: Prepend the new entry**

Use the Edit tool. `old_string`:

```markdown
# Changelog

User-facing notes on what changed in each Reckon iteration. Latest at the top.

---

## What's new — Visible errors (issue #2)
```

`new_string`:

```markdown
# Changelog

User-facing notes on what changed in each Reckon iteration. Latest at the top.

---

## What's new — Slash commands (issue #5)

**Date:** 2026-05-06

Two new slash commands surface reckon in SilverBullet's `/`-palette
autocomplete:

- `/reckon-sheet` — inserts `reckon: true` frontmatter and a heading,
  ready to start a sheet on a fresh page.
- `/reckon-block` — inserts an empty fenced reckon block, ready for
  inline math anywhere in a page.

Both insert at the cursor — natural for fresh pages where the cursor
starts at the top. For converting an existing page to a reckon sheet
(cursor mid-content), the existing `Reckon: Convert page to sheet`
palette command still works.

See `Tests/Slash Commands Verification.md` for the live verification
flow.

---

## What's new — Visible errors (issue #2)
```

The new entry uses the same heading depth (`##`), `**Date:**` line, and trailing `---` separator pattern as the existing entries. Body wraps at ~70 chars to match the existing style.

- [ ] **Step 3: Verify the prepend**

```bash
head -25 infra/space-seed/Changelog.md
```

Expected output begins (line numbers may differ slightly):
```
# Changelog

User-facing notes on what changed in each Reckon iteration. Latest at the top.

---

## What's new — Slash commands (issue #5)

**Date:** 2026-05-06

Two new slash commands surface reckon in SilverBullet's `/`-palette
autocomplete:
...
```

Also confirm the visible-errors entry is still intact further down:

```bash
grep -c "^## What's new — Visible errors" infra/space-seed/Changelog.md
```

Expected: `1` (the visible-errors header still appears exactly once).

- [ ] **Step 4: Commit**

```bash
git add infra/space-seed/Changelog.md
git commit -m "$(cat <<'EOF'
docs(infra): #5 Changelog entry for slash commands

Prepended above the visible-errors entry. Describes both commands,
notes the at-cursor contract, points users at the verification page
and the existing Reckon: Convert page to sheet palette command for
the retrofit-existing-page case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Mirror to runtime + regression checks + closeout

**Files:** None modified. This task runs commands and updates the issue.

This task is the verification gate. It mirrors the new content into the runtime space, runs build + test regression checks, asks the user to verify live in SB, and posts an issue comment requesting closeout. **No commit** — only mirror, sanity checks, and the issue comment.

- [ ] **Step 1: Mirror the seed to the runtime space**

```bash
npm run dev:link
```

Expected: command exits 0. The Library/, Tests/, and Changelog updates from Tasks 1-3 are now reflected under `infra/space/`.

Verify the mirror:

```bash
ls -1 "infra/space/Library/Reckon/Slash Commands/"
```

Expected:
```
reckon-block.md
reckon-sheet.md
```

```bash
ls "infra/space/Tests/Slash Commands Verification.md"
```

Expected: file listed, no error.

```bash
head -10 infra/space/Changelog.md
```

Expected: top entry is `## What's new — Slash commands (issue #5)`.

- [ ] **Step 2: Build regression check**

```bash
npm run build
```

Expected: build succeeds, no TypeScript errors. Since no `src/` files changed, the rebuilt `reckon.plug.js` should be byte-identical to the committed copy.

```bash
git diff --stat reckon.plug.js
```

Expected output: empty (no diff). If non-empty, something in the build pipeline produced a non-deterministic output — investigate before continuing. (Common cause: timestamp embedding. If the diff is purely cosmetic and the build chain is known to be non-deterministic, document and proceed; otherwise stop.)

- [ ] **Step 3: Test regression check**

```bash
npm test
```

Expected: **283 passing**. Breakdown:
- `lexer.test.ts` — 34
- `parser.test.ts` — 50
- `render.test.ts` — 46
- `engine.test.ts` — 120
- `frontmatter.test.ts` — 33

No new tests; no test count change. If the count dropped, regression — investigate before continuing.

- [ ] **Step 4: Live verification in SilverBullet**

In the running SilverBullet instance pointed at `infra/space/`:

1. Run `Plugs: Reload` (Cmd-K → "Plugs: Reload" or via the slash command).
2. Reload the current page so SB re-indexes the space and picks up the new `meta/template/slash`-tagged pages.
3. Open `Tests/Slash Commands Verification.md` in SB and follow each test in order:
   - **Test 1:** `/reckon-` autocomplete shows both commands with descriptions.
   - **Test 2:** `/reckon-sheet` on a fresh page inserts the frontmatter + heading scaffold; the right-hand panel becomes visible.
   - **Test 3:** `/reckon-block` on any page inserts the empty fenced block; typing `100 + 200` inside renders the widget with `300`.
   - **Test 4:** `Reckon: Convert page to sheet` palette command still works.

If any test fails, stop and diagnose. Do not move to Step 5.

- [ ] **Step 5: Comment on the issue and request live verification**

```bash
gh issue comment 5 --body "$(cat <<'EOF'
Implementation done on `main`. Three commits:

1. `feat(slash)`: `/reckon-sheet` and `/reckon-block` slash templates under `Library/Reckon/Slash Commands/`.
2. `docs(infra)`: `Tests/Slash Commands Verification.md`.
3. `docs(infra)`: `Changelog.md` `What's new — Slash commands (issue #5)` entry.

No `src/` changes — pure markdown content. Test count unchanged at 283. Plug bundle unchanged (no rebuild diff).

Two follow-ups filed during brainstorming:

- #14 — starter content inside the inserted frames (deferred from #5; revisit when richer features ship).
- #15 — plug-bundled distribution for end users (templates currently ship only in `infra/space-seed/`).

To verify live:
- Run `npm run build && npm run dev:link`.
- In SilverBullet: `Plugs: Reload`, then reload the page so the index picks up the new `meta/template/slash` pages.
- Open `Tests/Slash Commands Verification.md` and walk through tests 1-4.

Closing once you've confirmed in-browser.
EOF
)"
```

- [ ] **Step 6: Leave the issue OPEN**

Do not run `gh issue close 5`. The user closes after live verification.

---

## Verification — final file inventory

After all four tasks, the repo should have:

| Path | Status |
|---|---|
| `infra/space-seed/Library/Reckon/Slash Commands/reckon-sheet.md` | new file (Task 1) |
| `infra/space-seed/Library/Reckon/Slash Commands/reckon-block.md` | new file (Task 1) |
| `infra/space-seed/Tests/Slash Commands Verification.md` | new file (Task 2) |
| `infra/space-seed/Changelog.md` | modified (Task 3) |
| `infra/space/Library/Reckon/Slash Commands/...` | created/refreshed by `dev:link` in Task 4 |
| `infra/space/Tests/Slash Commands Verification.md` | created/refreshed by `dev:link` in Task 4 |
| `infra/space/Changelog.md` | refreshed by `dev:link` in Task 4 (if mirrored) |

Three commits total (Tasks 1-3). Task 4 has no commit — only mirror, sanity checks, and the issue comment.

Final `npm test`: **283 passing**. `git diff reckon.plug.js` after `npm run build`: empty.

---

## Notes for the executor

- **Work on `main`, not a worktree.** Per the user's persistent preference for this repo (auto-memory: `feedback_main_branch.md`).
- **One commit per task (Tasks 1-3).** Three commits total. Don't squash.
- **The runtime space is gitignored.** `infra/space/...` is not committed. `dev:link` mirrors `infra/space-seed/...` into it.
- **No `src/` files change.** If you find yourself editing `src/`, you've gone off-plan.
- **No `reckon.plug.yaml` change.** The slash commands ride on SB's std slash-template runner, not on the plug manifest.
- **Inline annotations rule still applies.** If you add any reckon code examples inside other markdown content (e.g. in the Changelog body, the verification page body, or the issue comment), inline annotations must use `// foo`, never `# foo` — the latter shape becomes an ATX heading and breaks the engine.
- **Project rule: fenced reckon blocks for examples.** When showing `reckon` content as an example to the user, wrap it in a fenced ` ```reckon ` block, never bare 4-space-indented or full-page-sheet bodies.
- **Issue stays OPEN until the user verifies live.** Do not close it.

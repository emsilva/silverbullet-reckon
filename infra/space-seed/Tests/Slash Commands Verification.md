# Slash Commands — Live Verification

Verifies that `/reckon-sheet` and `/reckon-block` (issue #5) are
discoverable in SilverBullet's `/`-palette autocomplete and that
each inserts the correct scaffold at the cursor.

## Setup

1. From the repo root: `npm run build && npm run dev:link`.
2. In SilverBullet, run `Plugs: Reload` (Cmd-K / Ctrl-K → "Plugs: Reload").
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

- Confirm the right-hand panel is now visible, even though there are
  no math lines yet. Frontmatter `reckon: true` is what activates the
  panel; an empty Σ is expected here. (`isReckonSheet` returns true,
  the panel mounts.)
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

- Type `100 + 200` at the cursor, then move the cursor outside the
  block (e.g. arrow down past the closing fence, or press Escape);
  the reckon code widget renders below the closing fence with the
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

## At-cursor contract — known limitations

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

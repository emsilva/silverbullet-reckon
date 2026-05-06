# Slash Commands — Design

**Status:** Design accepted (interactive brainstorming session), ready for implementation plan.
**Date:** 2026-05-06
**Author:** Mannu Silva (with Claude)
**Repo:** `github.com/emsilva/silverbullet-reckon`
**Issue:** #5 — "Slash commands: /reckon-sheet and /reckon-block"

## 1. Goal

Surface reckon in SilverBullet's `/`-palette autocomplete — the editor's natural discovery affordance. Today users have to know either the `reckon: true` frontmatter shape or the triple-backtick fence syntax. Two slash commands give them inline-discoverable scaffolds:

- `/reckon-sheet` — inserts `reckon: true` frontmatter + a heading line, ready to start a panel-mode sheet on a fresh page.
- `/reckon-block` — inserts an empty fenced reckon block, ready for inline math anywhere in a page.

Both commands ship as **bare scaffolds** (no example content inside). The starter-content / feature-showcase variant is tracked separately in [#14](https://github.com/emsilva/silverbullet-reckon/issues/14).

## 2. Decisions log

| # | Decision | Choice |
|---|---|---|
| Q1 | Defer (saved memory says "ship #5 last after richer features") vs. design now | **Design now.** The two commands ship as bare frames — no aspirational feature showcase to embed. Saved memory's spirit (don't ship aspirational examples) is preserved. The starter-content variant is filed as #14 for later. |
| Q2 | Mechanism: legacy plug-manifest `slashCommand:` key, Space Lua, or Slash Templates | **Slash Templates** for both commands. Modern SB has no plug-manifest slash-command registration; the issue's "two `slashCommand` entries in `reckon.plug.yaml`" is outdated. SB docs explicitly recommend Slash Templates for simple insertion-only cases. Both commands are pure text insertion → no need for Space Lua's programmability. |
| Q3 | Distribution: ship in plug bundle vs. space-seed only vs. hybrid | **Space-seed only for #5.** The plug today has no end-user distribution path beyond the dev space; bundling templates with the plug needs a research spike (filed as #15). Space-seed unblocks dev verification today; plug-bundled distribution is its own problem worth its own issue. |
| Q4 | `/reckon-sheet` insert position: at-cursor (slash-template default) vs. always-top-of-page | **At-cursor.** Slash templates always insert at the user's cursor. On a fresh empty page (cursor at line 1, col 0), this equals top-of-page — the natural fresh-sheet workflow. For converting an existing page (cursor mid-content), the existing `Reckon: Convert page to sheet` palette command from #1 is the fallback. Going Space-Lua just to force top-of-page would split the implementation across two mechanisms for marginal value. |
| Q5 | Verification: unit tests vs. manual-test markdown page only | **Manual-test page only.** The feature is pure markdown content (slash-template bodies). Existing precedent: visible-errors `plug.ts` flag-read was also verified live, not unit-tested. Test count stays at 283. |

## 3. Architecture & components

Two markdown pages tagged `meta/template/slash` under `infra/space-seed/Library/Reckon/Slash Commands/`. SilverBullet's std runner (`Library/Std/Infrastructure/Slash Templates.md`, shipped with every SB install) auto-discovers them via index query and registers each as a `/`-palette command. **No engine, render, plug-code, or `reckon.plug.yaml` change.**

```
infra/space-seed/
├── Library/                                    ← NEW directory
│   └── Reckon/                                 ← NEW
│       └── Slash Commands/                     ← NEW (folder name uses spaces, mirrors std's Library/Std/Slash Commands/)
│           ├── reckon-sheet.md                 ← NEW
│           └── reckon-block.md                 ← NEW
├── Tests/
│   └── Slash Commands Verification.md          ← NEW
└── Changelog.md                                ← MODIFIED — prepended #5 entry
```

The page name's last `/`-separated component becomes the command name, per the std runner:

```lua
local components = st.name:split("/")
local name = components[#components]
slashCommand.define { name = name, ... }
```

So `Library/Reckon/Slash Commands/reckon-sheet.md` registers `/reckon-sheet`, and `Library/Reckon/Slash Commands/reckon-block.md` registers `/reckon-block`.

## 4. How the std runner consumes a slash-template page

```lua
run = function()
  local tpl = template.fromPage(st.name, st.raw)
  editor.insertAtCursor(tpl(), false, true)
end
```

`template.fromPage(name, raw)` reads the page via `space.readPage(name)` (raw string), strips frontmatter via `index.extractFrontmatter(text, {removeFrontMatterSection: true, removeTags: true})`, and returns `string.trimStart(fm.text)` — the body, leading-whitespace stripped, **as a literal string**. Triple-backticks in the body pass through verbatim.

`editor.insertAtCursor(text, false, true)` inserts the string at the cursor and treats `|^|` as the post-insert cursor placeholder.

Result: whatever literal text we put in the body (after frontmatter) is what the user gets, with `|^|` consumed and the cursor parked there.

## 5. Template — `reckon-sheet.md`

```markdown
---
tags: "meta/template/slash"
description: Insert reckon-sheet frontmatter and a starter heading
---

---
reckon: true
---

# |^|
```

After firing on a fresh empty page (cursor at line 1, col 0), the page becomes:

```
---
reckon: true
---

# <cursor>
```

The right-hand panel activates immediately because frontmatter has `reckon: true` (`isReckonSheet` returns true). Σ is empty (no math rows yet), but the panel is visible. The user types the page title at the cursor, then continues into math lines below.

## 6. Template — `reckon-block.md`

```markdown
---
tags: "meta/template/slash"
description: Insert an empty reckon block
---

```reckon
|^|
```
```

After firing anywhere in a page, the cursor lands inside the fence:

```
```reckon
<cursor>
```
```

User types math at the cursor; the codeWidget renders results in-line below the closing fence, per the existing `reckonBlockWidget` callback wired in `reckon.plug.yaml`.

## 7. Behavior contract — at-cursor insertion

Slash templates always insert at the user's cursor. Implications:

- **`/reckon-sheet` works cleanly only at the page top.** When invoked on a fresh empty page, cursor at (1,0), the inserted `---\nreckon: true\n---\n\n# ` lands at the very top → frontmatter parses → panel activates. When invoked mid-content (existing page with prose above), the inserted `---\nreckon: true\n---` appears mid-page; SilverBullet does not parse mid-page `---` as frontmatter, so the panel will not activate — the user sees literal text. **Fallback:** the existing `Reckon: Convert page to sheet` palette command from #1 toggles `reckon: true` at the top of the file regardless of cursor position. The slash command is the *fresh-sheet convenience*; the palette command is the *retrofit existing page* path.
- **`/reckon-block` works anywhere.** Nested invocation inside an existing ` ```reckon ` fence inserts a literal ` ```reckon\n|^|\n``` ` mid-fence, which closes the outer block prematurely with the inserted ` ``` ` and creates a malformed second fence. Undefined behavior; user undoes. Suppressing this via `exceptContexts: FencedCode:reckon` is out of scope (future polish).

These boundaries are surfaced in the verification page footer.

## 8. Discovery dependency

The runner at `Library/Std/Infrastructure/Slash Templates.md` is part of std SilverBullet's bundled libraries — present in every SB install by default. No bundling concern on our end. After `npm run dev:link` and `Plugs: Reload`, SB re-indexes the space, the runner picks up the two new pages tagged `meta/template/slash`, and registers `/reckon-sheet` / `/reckon-block` automatically.

If a user has somehow disabled or removed the std slash-template runner, our commands will not register. We don't try to detect or compensate — the same dependency applies to the std `/frontmatter`, `/space-lua`, and other built-in commands.

## 9. Verification page

`infra/space-seed/Tests/Slash Commands Verification.md` — plain markdown, no `reckon: true` frontmatter (this is a manual-test scratchpad, not a sheet).

Sections:

1. **Setup** — `npm run build && npm run dev:link`, then `Plugs: Reload` in SB, then a one-time page reload so the std runner re-indexes the space (the runner is itself Space Lua, so its slash-command definitions take effect after the next index pass).
2. **Test 1: discovery** — open a fresh empty page, type `/reckon-`, expect both `/reckon-sheet` and `/reckon-block` in the autocomplete dropdown with their `description:` strings.
3. **Test 2: `/reckon-sheet` insertion** — on a fresh empty page, select `/reckon-sheet` from the dropdown. Expect the page to become exactly:
   ```
   ---
   reckon: true
   ---

   # <cursor>
   ```
   and the right-hand panel to be visible (empty Σ — no math rows yet — but present).
4. **Test 3: `/reckon-block` insertion** — open any page (with or without existing content), place cursor on a blank line, select `/reckon-block`. Expect:
   ```
   ```reckon
   <cursor>
   ```
   ```
   inserted at cursor. Type `100` and confirm the codeWidget renders `100`.
5. **Test 4: existing palette command unchanged** — confirm `Reckon: Convert page to sheet` still appears in the command palette (Cmd-K) and still toggles `reckon: true` on the current page (regression check for #1's existing command — no new code touched it, but verifying it didn't get accidentally shadowed by the new entries).
6. **Footer** — at-cursor contract, palette-command fallback for retrofitting existing pages, std-runner dependency note.

The page uses no fenced reckon blocks itself (it's a manual-test scratchpad). Where it shows expected post-insert content, it uses 4-backtick wrappers around 3-backtick examples per CommonMark fence-nesting.

## 10. Changelog entry

Prepended to `infra/space-seed/Changelog.md` above the visible-errors entry, matching the existing changelog style:

```markdown
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
```

## 11. Testing

No new unit tests. The feature is pure markdown content (slash-template bodies). Verification is the markdown verification page (manual test in SB).

Existing test count stays at **283** (lexer 34, parser 50, render 46, engine 120, frontmatter 33). `npm test` should pass unchanged after this issue ships. `npm run build` is also a no-op for `reckon.plug.js` — no `src/` changes. (We still run both as a regression check.)

## 12. Project rule check

- **Inserted frame uses fenced ` ```reckon ` block.** Yes — `reckon-block.md` is a fenced block; `reckon-sheet.md` is panel-mode (no fence). Both align with the project rule "user-facing calc examples are fenced ```reckon``` blocks."
- **No inline `#` annotations inside frames.** The frames have no annotations; the verification page uses `//` for any inline expected-value notes. (The frame bodies happen to contain `# |^|` for the heading line, which is an ATX heading shape — the engine treats it as `kind: "heading"`, not a `#`-comment.)
- **Verification page format.** Created under `infra/space-seed/Tests/`, mirrored to runtime via `dev:link`, with expected values inline.
- **Working directory.** `main`, no worktree (per saved memory `feedback_main_branch.md`).
- **Inline annotations.** Verification page footer uses `//` for any ad-hoc reckon snippets, never `#`.

## 13. Out of scope

- **Plug-bundled distribution** for end users — tracked in [#15](https://github.com/emsilva/silverbullet-reckon/issues/15). Without it, only users running the dev space (i.e. anyone running `npm run dev:link`) gets the slash commands. Documented in the verification page footer.
- **Starter content inside the inserted frames** — tracked in [#14](https://github.com/emsilva/silverbullet-reckon/issues/14). When more reckon features ship (#4 locale, #6 dates, #7 currency, #9 NL sugar, #10 format hints), the frame bodies could carry a 1–3 line worked example. For now, both ship as bare scaffolds.
- **Conditional / programmatic logic** (e.g. detect existing frontmatter and skip vs. update vs. append; detect existing reckon block and refuse to nest). Slash templates are pure text insertion. Adding logic would require promoting one or both commands to Space Lua (`slashCommand.define` with a `run` callback). Not justified by the current acceptance criteria.
- **`onlyContexts` / `exceptContexts` restrictions** — SB slash-template frontmatter supports AST-context filtering (e.g. `exceptContexts: FencedCode:reckon` would suppress `/reckon-block` from the autocomplete when the cursor is already inside a reckon fence). Out of scope; future polish. Note this mechanism filters by AST node type, not by frontmatter state — there is no built-in way to hide `/reckon-sheet` conditionally on whether the page already has `reckon: true` frontmatter.
- **Keyboard binding** for either command — not in the issue.
- **Telemetry / usage tracking.**

## 14. Known limitations

- **At-cursor-only insertion for `/reckon-sheet`.** Mid-page invocation produces a malformed page (mid-page `---\nreckon: true\n---` not parsed as frontmatter). The fallback (`Reckon: Convert page to sheet` palette command) is documented in the verification page footer and the changelog entry. We accept this rather than splitting implementation across slash-template + Space-Lua.
- **No nested-block protection for `/reckon-block`.** Invoking inside an existing ` ```reckon ` fence breaks the outer block. User undoes; documented in verification footer. Future polish via `exceptContexts`.
- **Std-runner dependency.** Removing or disabling `Library/Std/Infrastructure/Slash Templates.md` removes the slash commands. Same dependency as every other built-in slash command (`/frontmatter`, `/space-lua`, etc.). Not a regression we introduce.
- **End-user distribution gap.** Templates ship only in `infra/space-seed/`, mirrored to runtime via `dev:link`. End users who install the plug from a URL do not get the templates. Tracked in #15.

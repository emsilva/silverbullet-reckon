# Reckon — Soulver-style notepad calculator for Silverbullet

**Status:** Design accepted, ready for implementation plan.
**Date:** 2026-05-03
**Author:** Mannu Silva (with Claude)
**Repo:** `github.com/emsilva/silverbullet-reckon`

## 1. Goal

Build a Silverbullet plug that turns any markdown page into a Soulver-style
calculation surface: type natural-feeling math (`1 + 1`, `tax = 20%`,
`100 km in miles`, `$300 + tax`) and see results render live in a
right-hand panel, line by line, without ever mutating the page text.

Soulver's "magic" is that results live in a separate column from the
source — typing on the left, evaluation on the right, perfectly aligned.
That decoupling is what makes the experience feel live without disturbing
your typing. Reckon is the faithful translation of that pattern into
Silverbullet's plug API.

## 2. Decisions log

The following choices were made during brainstorming and are now fixed:

| # | Decision | Choice |
|---|---|---|
| Q1 | Where math lives | **C** — both: page-level Soulver-style panel *and* a fenced ```` ```reckon ```` codeWidget for inline calc sheets in any page |
| Q2 | How the panel renders | **C2** — panel mirrors the source itself (renders both columns inside the right-hand panel iframe), instead of trying to align with the editor's wrapped lines |
| Q3 | V1 feature scope | **T2** — arithmetic, variables, percentages, comments, units, auto-total. No currency, dates, or line refs in V1 |
| Q4 | Whole-page activation | **A** — top-level frontmatter `reckon: true` |
| Q5 | Variable scope | **A** — isolated: page panel and each fenced block are independent calc sheets |

Approaches that were considered and rejected:

- **Whole-page text mutation** (chainsync-style — listen to `editor:pageModified`,
  rewrite document text to insert ` = result`). Rejected as fragile: every keystroke
  is a change event, undo gets noisy, race conditions.
- **Inline `${...}` Lua expressions.** Rejected: redundant syntax (you have to write
  the math twice — once raw, once inside `${...}`); also hides on cursor entry, same
  visual constraint as the codeWidget approach but with worse ergonomics.
- **Pure Lua library, no plug.** Rejected: no way to surface a side panel; would only
  give us inline-`${...}` rendering, which doesn't get us a Soulver experience.

## 3. Architecture & components

Single Silverbullet plug (`reckon`) with three plug functions wired into Silverbullet's
hook system, plus a pure TypeScript engine that does all the math.

```
silverbullet-reckon/
├── reckon.plug.yaml              # manifest: function → hook bindings
├── src/
│   ├── plug.ts                   # plug entry points (panel + block + commands)
│   ├── engine.ts                 # pure math engine over mathjs (no SB deps)
│   ├── engine.test.ts
│   ├── parser.ts                 # line classification, percentage rewriting,
│   │                             # `in` → `to` rewriting
│   ├── parser.test.ts
│   ├── render.ts                 # two-column HTML/CSS for panel and block
│   ├── render.test.ts            # snapshot test
│   ├── frontmatter.ts            # isReckonSheet + toggleReckonFrontmatter
│   └── frontmatter.test.ts
├── infra/
│   ├── compose.yaml              # Silverbullet container, port 3000
│   ├── space-seed/               # tracked in git; seeded into ./space on first run
│   │   ├── index.md              # welcome page with install + smoke-test instructions
│   │   └── Test Sheet.md         # canonical Soulver-style inputs as a smoke test
│   ├── space/                    # gitignored; SB's space root, populated by dev:link
│   └── README.md                 # how to bring the stack up
├── PLUG.md                       # library distribution metadata
├── README.md                     # user-facing docs
├── package.json                  # build scripts + mathjs dep
├── reckon.plug.js                # built artifact, committed (per SB convention)
└── .gitignore
```

### Plug functions (registered in `reckon.plug.yaml`)

1. **`reckonBlockWidget`** — `codeWidget: reckon` hook. Renders a fenced
   ```` ```reckon ```` block as an iframe two-column widget. Self-contained;
   one fresh engine instance per render.
2. **`onPageEvent`** — `events: [editor:pageLoaded, editor:pageModified]`.
   Decides whether the current page is a Reckon sheet (frontmatter check)
   and shows/hides the right-hand panel via `editor.showPanel("rhs", ...)`/
   `editor.hidePanel("rhs")`. On modify, debounces and re-renders.
3. **`toggleSheetCommand`** — `command: "Reckon: Convert page to sheet"`.
   Inserts/removes `reckon: true` frontmatter on the current page.

### Module responsibilities

- **`engine.ts`** is a pure function `evaluate(text) → { rows, total }`.
  No syscall imports. Throw-away `mathjs` parser per call → fresh scope.
  This is the entire testable surface — feed it any string, get structured
  results back.
- **`parser.ts`** does line classification (math vs comment), percentage
  rewriting (`20% of 450` → `(20/100) * 450`, `100 + 20%` → `100 * (1 + 20/100)`),
  assignment detection (`name = expr`), and `in` → `to` rewriting for unit
  conversions. Hands cleaned expressions to `engine.ts`.
- **`render.ts`** takes engine output and produces iframe HTML+CSS used by
  both the panel and the block widget. One renderer, two callers.
- **`frontmatter.ts`** — narrow, regex-based scan. No YAML library.
  Exports `isReckonSheet(text)` and `toggleReckonFrontmatter(text)`.
- **`plug.ts`** is the only module that imports from
  `@silverbulletmd/silverbullet/syscalls`. Everything underneath is plain
  TypeScript that runs in unit tests with no SB harness.

**Key consequence:** the math/parsing/render logic is all behind a SB-free
boundary, so unit tests cover ~95% of the risk. The plug layer is mostly
wiring (~150 lines).

## 4. Data flow

Three runtime paths through the plug. Each is independent.

### Path A — Page panel (the live Soulver view)

```
editor:pageLoaded ─┐
editor:pageModified┴─► onPageEvent ─► frontmatter.isReckonSheet(text)?
                                          │
                              ┌───────────┴───────────┐
                              ▼ true                  ▼ false
                    debounce 150ms               editor.hidePanel("rhs")
                    (immediate on pageLoaded)    (idempotent)
                              │
                              ▼
                    parser.extractMathLines(text)
                    (skips ALL fenced code blocks,
                     including ```reckon — those have
                     their own widget; skips frontmatter)
                              │
                              ▼
                    engine.evaluate(lines) → { rows, total }
                              │
                              ▼
                    render.toPanelHtml(rows, total)
                              │
                              ▼
                    editor.showPanel("rhs", 2, html, script)
```

`onPageEvent` always reads `editor.getCurrentPage()` and `editor.getText()`
fresh. Navigation away from a sheet fires `editor:pageLoaded` for the new
page; `isReckonSheet` returns false; we hide the panel. No "stale panel
from previous page" class of bugs.

**Debounce.** Module-scoped timer in `plug.ts`:
```ts
let modifyDebounce: number | undefined;
const DEBOUNCE_MS = 150;
```
On `editor:pageModified`, clear and reset the timer. On `editor:pageLoaded`,
clear the timer and run immediately so opening a sheet feels instant.
Plugs run in a per-plug Web Worker that stays alive across invocations,
so module-level state persists. `setTimeout` works in workers.

### Path B — Fenced ```` ```reckon ```` block

```
User cursor leaves a ```reckon block
        │
        ▼
Silverbullet's CodeMirror widget machinery fires
codeWidget callback automatically — no plug
event subscription needed
        │
        ▼
reckonBlockWidget(bodyText, pageName)
        │
        ▼
parser.extractMathLines(bodyText)
        │
        ▼
engine.evaluate(lines)  ← fresh engine, isolated scope
        │
        ▼
render.toBlockHtml(rows, total)
        │
        ▼
return { html, script }
```

We don't subscribe to anything for this path — Silverbullet handles refresh
on cursor-leave automatically because we registered `codeWidget: reckon`.
Built-in `codeWidget.refreshAll()` is available if a user wants to force a
refresh; we don't wrap it.

**Isolation.** Every block-widget invocation creates its own engine instance.
No state shared with the panel, no state shared between blocks, no state
shared across renders. Mutable state is bounded to one `evaluate()` call's
top-to-bottom processing.

### Path C — Toggle command

```
User runs "Reckon: Convert page to sheet"
        │
        ▼
toggleSheetCommand
        │
        ▼
read editor.getText()
        │
        ├─ has `reckon: true`? remove that line
        │   (and strip frontmatter block if it becomes empty)
        └─ no `reckon: true`?  insert into existing frontmatter,
                                or create new frontmatter at top
        │
        ▼
editor.setText(newText)   ← minimal-diff, preserves cursor
        │
        ▼
(editor:pageModified fires naturally; Path A runs;
 panel appears or disappears)
```

We do not call `showPanel`/`hidePanel` from the toggle command — the
resulting `editor:pageModified` handles it through Path A. One source of
truth for panel visibility.

### Path interactions

- A `reckon: true` page that contains a ```` ```reckon ```` block runs both
  Path A and Path B. The panel evaluates the page text *with all fenced
  code blocks stripped*; the block renders inline as its own widget with
  its own scope. They don't interfere.
- On plug load (`plugs:loaded` fires once), `editor:pageLoaded` will also
  fire for the current page — we lean on that, no separate subscription
  to `plugs:loaded`.
- `reckon: false` or missing key — treated identically as "not a sheet."

## 5. Math engine

Pure function `evaluate(text: string) → { rows: ResultRow[], total: TotalRow | null }`.
No syscalls, no DOM, no async. All heavy lifting comes from `mathjs`.

### mathjs configuration

Default `mathjs` build (we want units). Per-evaluation parser instance:

```ts
const parser = math.parser();   // isolated scope, dies at end of evaluate()
```

This is the isolation guarantee from Q5: panel and each block call
`evaluate()` independently, so they cannot see each other's variables.

BigNumber is **not** enabled for V1 — it changes the `toString()` shape
of every result and we don't have a use case yet. Plain Number is fine.

### Per-line evaluation pipeline

```
raw line
  │
  ▼  (1) early classification
  ├─ blank line? → ResultRow{kind: "blank"}
  └─ proceed
  │
  ▼  (2) preprocess (parser.ts)
  │   • rewrite ` in ` → ` to ` in unit-conversion contexts
  │     (e.g. `100km in miles` → mathjs's `100km to miles`)
  │   • rewrite percentage idioms:
  │       `X% of Y`     → `(X/100) * Y`
  │       `Y + X%`      → `Y * (1 + X/100)`     (additive)
  │       `Y - X%`      → `Y * (1 - X/100)`
  │       standalone `X%` → `X/100`
  │
  ▼  (3) parser.evaluate(preprocessed)   ← mathjs
  │   • throws on parse errors → caught as comment row
  │   • assignment lines (`name = expr`) succeed AND mutate scope
  │
  ▼  (4) format (engine.ts)
  │   • Unit value → mathjs's own toString (e.g. "62.137 mi")
  │   • Number → format with thousands separators, 2-6 decimals trimmed
  │   • Boolean / string / object → toString
  │
  ▼  ResultRow
```

If step (3) throws, the line becomes `ResultRow{kind: "comment", source: rawLine}`
— Soulver's silent-fail behavior.

**No red error markers in V1.** Documented limitation: typos in
math-shaped lines render blank, same as prose. If users complain, V1.1
adds an "errors visible" config.

### Result row shape

```ts
type ResultRow =
  | { kind: "blank"; line: number }
  | { kind: "comment"; line: number; source: string }
  | { kind: "value"; line: number; source: string; result: string; numeric?: number }
  | { kind: "assignment"; line: number; source: string; varName: string; result: string; numeric?: number };

type TotalRow = { value: string };  // formatted, e.g. "8,636.14"
```

`numeric` is set only when the underlying value is a finite, unitless
number — the auto-total uses it.

### Auto-total

Sum every row that has a `numeric` field. Display as `Total <value>` with
thousands separators. **If there are zero numeric rows, the total row is
omitted entirely** (don't show `Total 0` for a sheet of unit conversions).

V1 is single dimensionless total; V2 with currency widens to per-currency
totals (a non-breaking extension of `TotalRow`).

### Engine test surface (`src/engine.test.ts`, minimum)

1. Arithmetic: `1 + 1` → `2`, parens, precedence, `^`.
2. Assignment + use: `tax = 20%` then `100 + tax` → `120` (additive).
3. Percentages: all four idioms (`of`, `+`, `-`, standalone).
4. Units: `100 km in miles` round-trips correctly via `in → to` rewrite.
5. Comment fallthrough: prose lines yield `kind: "comment"` rows, don't crash.
6. Variable shadowing across lines.
7. Auto-total: mixed prose + numbers + units → counts only dimensionless
   numbers.
8. Auto-total: sheet with only units → no total row.
9. Empty input → `{ rows: [], total: null }`.

## 6. Activation, rendering, panel HTML

### Frontmatter detection (`frontmatter.ts`)

Hand-rolled regex scan, no YAML library. The rule for "is this a Reckon sheet"
is intentionally narrow:

1. First line of the page text is exactly `---`.
2. There exists a closing `---` line later.
3. Between those two `---` lines, at least one top-level (non-indented) line
   matches `^reckon:\s*true\s*$`.

Anything else — `reckon: "true"`, `reckon: 1`, `reckon: false`, missing key,
no frontmatter — is **not** a sheet. We don't try to be clever about parsing
truthy strings. Misclassifying a page (showing the panel when the user didn't
want it, or hiding it when they did) is more annoying than rejecting a
slightly-wrong frontmatter syntax. The toggle command always inserts the
canonical form.

Two pure exports, both unit-testable:
```ts
isReckonSheet(text: string): boolean
toggleReckonFrontmatter(text: string): string
```

`toggleReckonFrontmatter`:
- No frontmatter at all → prepend `---\nreckon: true\n---\n\n`.
- Frontmatter exists, no `reckon:` key → insert `reckon: true` as a new line
  just before the closing `---`.
- Frontmatter exists with `reckon: true` → remove that one line. If the
  frontmatter block is now empty (`---\n---\n`), strip it entirely.

### Panel and block rendering (`render.ts`)

One renderer used in two places. Output is `{ html, script }` — the same
shape `editor.showPanel(...)` accepts and the same shape codeWidget functions
return.

Layout is a single two-column `<table>`:

```html
<style>
  body {
    font-family: var(--editor-font, ui-monospace, SFMono-Regular, monospace);
    color: var(--editor-text, inherit);
    background: var(--editor-bg, transparent);
    margin: 0; padding: 12px;
    font-size: 13px;
  }
  table.reckon { width: 100%; border-collapse: collapse; }
  td { padding: 2px 8px; vertical-align: top; white-space: pre-wrap; }
  td.source { color: var(--editor-text, inherit); }
  td.result { text-align: right; color: var(--accent, #5b8def); }
  tr.blank td { height: 1.2em; }
  tr.comment td.source { color: var(--muted, #8a8a8a); }
  tr.total td {
    border-top: 1px solid var(--border, currentColor);
    padding-top: 6px;
    font-weight: 600;
  }
  tr.total td.label { text-align: left; }
</style>
<table class="reckon">
  <!-- one <tr> per ResultRow -->
  <tr class="value"><td class="source">100 km in miles</td><td class="result">62.137 mi</td></tr>
  <tr class="assignment"><td class="source">tax = 20%</td><td class="result">0.2</td></tr>
  <tr class="comment"><td class="source" colspan="2">Project budget for Q2</td></tr>
  <tr class="blank"><td colspan="2"></td></tr>
  <!-- final total row, omitted if no numeric rows -->
  <tr class="total"><td class="label">Total</td><td class="result">8,636.14</td></tr>
</table>
```

**Theme integration:** read CSS variables from the surrounding editor
(`--editor-font`, `--editor-text`, etc.) with sane fallbacks. The iframe
inherits the theme so dark mode works automatically — same trick mermaid
and attribute-chart use.

**Two callers, one renderer:**
- Path A (`onPageEvent`): `editor.showPanel("rhs", 2, html, "")`. Mode `2`
  matches mindmap's working precedent — fixed-fraction right-hand panel.
- Path B (`reckonBlockWidget`): returns `{ html, script: "" }` to
  Silverbullet's iframe code-widget machinery. Same HTML, sized to its
  block.

The `script` string is empty for V1. We have it on the API surface in case
we later need to call `updateHeight()` (block widget needs to size itself) —
leaving the slot wired but blank avoids a refactor when we add it.

### Show/hide logic

```ts
async function runPanelRefresh() {
  const text = await editor.getText();
  if (!isReckonSheet(text)) {
    await editor.hidePanel("rhs");
    return;
  }
  const result = evaluate(text);
  const { html, script } = renderPanel(result);
  await editor.showPanel("rhs", 2, html, script);
}
```

### Known UX limitations (document in README)

- **Panel coexistence.** `editor.showPanel("rhs", ...)` replaces whatever
  was in the right-hand slot. If the user also has a plug like mindmap whose
  RHS panel is enabled, the two will fight on every navigation/edit. We
  hide on non-sheet pages so mindmap's `pageLoaded` will re-show; on sheet
  pages, ours wins. SB limitation, can't fix from a single plug.
- **Silent error policy** (see §5).
- **No `requiredPermissions`** declared. Engine and parser run entirely
  in-worker, no network. When currency lands, `fetch` gets added.

## 7. Build, distribution, infrastructure, testing

### Build tooling

Use the official `silverbullet-plug-template` layout (proven, matches
ecosystem expectations) as a reference but diverge where we need to:

- **Take from template:** `*.plug.yaml` manifest format,
  `npx plug-compile <file>.plug.yaml` build command, `package.json` shape
  with `@silverbulletmd/silverbullet` dependency, `PLUG.md` frontmatter
  format with `name`/`tags: meta/library`/`files`, `.gitignore` patterns,
  convention of committing `*.plug.js`.
- **Diverge:** multi-file `src/` layout (proven valid by editor + mindmap
  plugs), `vitest` for tests, `mathjs` dep, `infra/` for integration,
  Docker-based dev workflow instead of host-symlink.

`package.json`:
```json
{
  "name": "silverbullet-reckon",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build":     "npx plug-compile reckon.plug.yaml",
    "watch":     "npx plug-compile reckon.plug.yaml -w",
    "test":      "npx vitest run",
    "dev:link":  "mkdir -p infra/space/Library/emsilva/reckon && cp reckon.plug.js PLUG.md infra/space/Library/emsilva/reckon/",
    "dev:up":    "npm run build && npm run dev:link && (cd infra && docker compose up -d)",
    "dev:down":  "(cd infra && docker compose down)",
    "dev:logs":  "(cd infra && docker compose logs -f)"
  },
  "dependencies": {
    "@silverbulletmd/silverbullet": ">=2.5.3",
    "mathjs": "^14.0.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

### Infrastructure (`infra/`)

`infra/compose.yaml`:
```yaml
services:
  silverbullet:
    image: ghcr.io/silverbulletmd/silverbullet:latest
    restart: unless-stopped
    environment:
      - SB_USER=dev:dev
    volumes:
      - ./space:/space
    ports:
      - "3000:3000"
```

`infra/space/` is gitignored — that's user-generated SB state. On first
run, `dev:up` script copies `infra/space-seed/*` into `infra/space/` if
the latter doesn't exist (or is empty). `infra/space-seed/` is tracked
in git and contains:

- `index.md` — welcome page with "open Test Sheet" link and `Library: Install` instructions.
- `Test Sheet.md` — a `reckon: true` page seeded with the canonical
  Soulver-screenshot inputs (`1+1`, `20% of 450`, `100km in miles`, etc.)
  for use as a fixed reference during manual smoke testing.

**Live plug pickup is built in:** SB scans `*.plug.js` files in the space
and reloads automatically within ~20s. After `npm run dev:link` recopies
the artifacts, "Plugs: Reload" inside SB hot-reloads without page refresh.

The CLAUDE.md note about Dockge / one-shot migrate services doesn't apply —
this is a single long-running service, no migrations.

### Distribution

End users install via Silverbullet's `Library: Install` command with the
URL of `PLUG.md` on GitHub.

`PLUG.md`:
```markdown
---
name: Library/emsilva/reckon/PLUG
tags: meta/library
files:
  - reckon.plug.js
---

# Reckon — Soulver-style notepad calculator for Silverbullet

Tag a page with `reckon: true` in frontmatter for the live side panel,
or drop a ` ```reckon ``` ` block anywhere for an inline calc sheet.
```

The compiled `reckon.plug.js` IS committed — that's standard for SB plugs
(the install flow fetches it directly).

### Testing

**Three tiers:**

1. **Unit tests (vitest)** — the only meaningful automated coverage.

   | Module | What we test |
   |---|---|
   | `engine.test.ts` | the 9 cases listed in §5 |
   | `parser.test.ts` | percentage rewrites are syntactically correct (`100 + 20%` → `100 * (1 + 20/100)`); `in` → `to` only fires in unit-conversion contexts; non-math lines pass through cleanly |
   | `frontmatter.test.ts` | `isReckonSheet` accepts/rejects canonical cases (no frontmatter, frontmatter without key, `reckon: true`, `reckon: false`, `reckon: "true"`, indented key); `toggleReckonFrontmatter` round-trips |
   | `render.test.ts` | snapshot test on a canonical input — guards against accidental HTML/CSS regressions |

2. **Integration smoke** — bring up the dev container, open
   `Test Sheet.md`, walk through the manual checklist in `infra/README.md`:

   1. Open a fresh page, run "Reckon: Convert page to sheet" → frontmatter inserted, panel appears.
   2. Type lines from the Soulver screenshot one at a time → results update on pause.
   3. Insert a ` ```reckon ``` ` block → cursor in shows source, cursor out shows the same two-column rendering.
   4. Verify block scope is isolated (define `x = 5` in panel-prose, `x` in the block fails to resolve).
   5. Run the toggle command on a sheet → frontmatter removed, panel hides.
   6. Navigate to a non-sheet page → panel hides.
   7. Dark mode toggle → panel re-themes correctly.

3. **Plug-runtime tests are out of scope.** Building a local SB harness
   that fakes events + syscalls is more code than the plug itself. Same
   trade-off every published SB plug makes.

### Versioning

- `package.json` `version: 0.1.0` for V1.
- `PLUG.md` does not carry a version (SB's library system reads from the
  source repo).
- Post-V1: 0.2 = currency or dates; 0.3 = line references; 1.0 when
  feature-complete.

## 8. Out of V1 (deferred features, design accommodates each)

- **Date math** (`today + 3 weeks`, `days in February 2022`).
  New `dates.ts` module, plugged in before the percentage rewrite step.
- **Currency conversion** (`100 USD to EUR`).
  New `currency.ts`; needs `requiredPermissions: fetch` and a rates source.
- **Line references** (`line2`, `ans`).
  Custom mathjs symbol resolver that looks up prior `ResultRow`s. The
  pipeline already produces ordered `ResultRow`s with line numbers — easy
  hook to add later.
- **Per-currency totals.**
  Additive extension to `TotalRow` (currently single value, becomes a list
  keyed by currency).
- **Soulver natural-language sugar** (`midpoint between A and B`,
  `random number between A and B`, `pi to 5 digits`, `time in New York`).
  Per-feature additions to `parser.ts` rewrite step.
- **Visible errors config** for users who want red markers instead of
  silent-fail on math-shaped typos.

None of these require structural changes to V1's design. Each is additive.

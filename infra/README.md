# Reckon dev infrastructure

Self-contained Silverbullet container for developing and smoke-testing
the Reckon plug.

## First-time setup

```bash
npm run dev:seed
```

Copies `infra/space-seed/` into `infra/space/`. Refuses to overwrite a
non-empty space.

## Up

```bash
npm run dev:up
```

Builds the plug, copies the artifacts into the dev space's
`Library/emsilva/reckon/`, and brings up the Silverbullet container on
http://localhost:3000 (login: `dev:dev`).

> The `SB_USER=dev:dev` credential is hardcoded for local development
> only. Do not expose port 3000 to a network interface — anyone reaching
> it would have full read/write access to the space.

## Logs / down

```bash
npm run dev:logs
npm run dev:down
```

## Iteration loop

1. Edit code in `src/`.
2. Run `npm run build && npm run dev:link` (or `npm run dev:up` to
   rebuild + relink + ensure the container is up). The `dev:link` step
   copies the freshly built `reckon.plug.js` and the published `PLUG.md`
   into `infra/space/Library/emsilva/reckon/`.
3. In Silverbullet, run `Plugs: Reload` (no page reload needed).
4. Refresh or navigate to retrigger the plug's `editor:pageLoaded`.

## Manual smoke checklist (run before tagging a release)

1. **Toggle command.** Open a fresh page (no frontmatter). Run
   `Reckon: Convert page to sheet` from the command palette. Expected:
   frontmatter `reckon: true` is inserted; the right-hand panel
   appears.
2. **Live evaluation.** Type the canonical inputs from `Test Sheet.md`
   one line at a time. Expected: results update in the right-hand panel
   on a brief pause (~150ms after the last keystroke).
3. **Block widget.** Insert a fenced block:
   ````
   ```reckon
   tax = 20%
   $300 + tax
   ```
   ````
   Move cursor outside the block. Expected: block renders inline as a
   two-column sheet.
4. **Block isolation.** On a `reckon: true` page, define `x = 5` in the
   prose. Inside a ` ```reckon ``` ` block on the same page, write `x`.
   Expected: the block's `x` is unresolved and renders as a comment row,
   confirming scope isolation.
5. **Toggle off.** Run `Reckon: Convert page to sheet` again on a sheet.
   Expected: frontmatter is removed; the panel hides.
6. **Navigation.** Navigate from a sheet to a non-sheet page. Expected:
   the panel hides immediately on `editor:pageLoaded`.
7. **Plugs reload.** Rebuild + `npm run dev:link`, then run `Plugs: Reload`
   in Silverbullet. Expected: the panel re-renders cleanly (this exercises
   the `editor:pageReloaded` event we subscribe to).
8. **Theme.** Toggle Silverbullet's dark mode (`Editor: Toggle Dark Mode`).
   Expected: the panel re-themes to match — text and background colors
   follow the editor.

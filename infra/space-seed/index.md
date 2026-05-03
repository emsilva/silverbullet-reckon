# Reckon dev space

Welcome. This is a fresh Silverbullet space wired up for Reckon
development. Useful next steps:

- Open [[Test Sheet]] to see Reckon in action with canonical inputs.
- The plug is loaded from `Library/emsilva/reckon/reckon.plug.js` —
  copied into the space by `npm run dev:link` (which `npm run dev:up`
  runs for you).
- After each rebuild, re-run `npm run dev:link` (or just `npm run dev:up`)
  to copy the new artifact into the space, then run `Plugs: Reload` here
  to pick up changes (no full page reload needed).

## Login

Default credentials are `dev:dev` (set in `infra/compose.yaml` via
`SB_USER`).

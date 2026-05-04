# Engineering Hardening — Verification

Issue #11 is about plumbing, not user-visible features, so this page is
a checklist instead of a `reckon: true` math sheet. Three things to
verify:

## 1. Smaller `reckon.plug.js` bundle

```bash
ls -la reckon.plug.js
```

Expected: ~334 KB (was 668,970 bytes / ~654 KB at V1). The aspirational
target was 150–250 KB; we landed at ~326 KB, which is acceptable per
the issue ("bundle size drops" is the hard requirement, the range is
aspirational).

## 2. New integration snapshot test passes

```bash
npm test -- render
```

Expected: under `integration — evaluate(text) → renderSheet(result)` the
test "snapshots the full pipeline for a canonical mixed input" appears
green. The snapshot file at `src/__snapshots__/render.test.ts.snap`
holds the locked table HTML.

## 3. GitHub Actions CI green on next push

After pushing this branch, open the repo's Actions tab on GitHub and
look for the `CI` workflow on the most recent commit. It should run
five steps (type-check, test, build, bundle drift check) and exit
green. The bundle drift step is the new safety net — if anyone commits
a stale `reckon.plug.js`, that step fails CI with a clear message
pointing at the file.

If the workflow file itself has a YAML error, the run will fail at the
parse step with a clear message; fix and recommit.

# RankPilot release 20.1 (hotfix)

Release marker: `2026-10-01-release-20.1`. No database migration and no new Shopify permission.

## Problem

After release 20, pages took 9–16 s to load, and Render returned 502s while /health went unanswered. Release 19 loaded in 4–5 s. The page loader (`loadUI`), which also serves the live-state refresh, did synchronous CPU work on every request:

1. It re-ran the whole catalogue audit for the per-type scores, which release 20 had made much heavier.
2. It read and parsed the whole catalogue a second time to work out which pages are live.
3. It read the full findings of the last 24 audits.
4. It worked out finding state three times.

In addition, each "Same text on many products" finding stored up to 1,000 product IDs.

## Fix

- **Per-type catalogue scores** are calculated by the worker during the audit and stored with it (`coverage.healthScores`). The page reads them. Audits made before 20.1 fall back to one calculation, which is cached until the resources or the audit change.
- **Not-live paths** are built from the resources already loaded and cached. They are worked out only on the Dashboard and Results & history. Learned title rules are loaded only on Settings.
- **Only the latest audit's findings** are read. Finding state is worked out once per load.
- **Repeated-text findings** store at most 200 product IDs. The count stays exact.
- **Protected pages (RP-603)**:
  - The check skips parsing the findings when there is no "changed outside" finding.
  - Findings from before release 20 have no side-by-side diff, so they are re-checked with the formatting-aware comparison. Formatting-only false alarms therefore no longer lock pages until the next audit.
- **Release tag** is `2026-10-01-release-20.1`, so tags are in date order again.
- **The fix panel** opens even when saved facts are malformed.

## Checks

- `tests/r201-performance.test.ts` covers the cache, the loader guards, the stored per-type scores and the protected-page re-check. The stored scores equal the old per-type calculation.
- The full suite, lint, typecheck, production build and worker build pass.
- A full catalogue audit of 319 realistic products takes about 600 ms of blocking CPU on a fast machine, and more on Render's shared 0.5 CPU. Page loads no longer do this work.

# RankPilot 14.2 — availability and clear measurements

## Confirmed findings and scope

The 14.1 merchant report describes an app-wide input freeze after indexation and opening URL evidence. The reported live freeze has not been reproduced in an authenticated Shopify session here: the available browser is at Shopify sign-in. Do not mark that acceptance item closed from HTTP health alone.

Source inspection established that URL evidence was already paginated in 14.1. There was no persisted open accordion state in that component. The confirmed inefficiency was that each indexation progress revision caused a complete workspace download, rebuilding catalogue, audit and report data on every route. Local stress testing also reproduced a separate Results render failure when App Bridge was unavailable: the download component called useAppBridge while rendering.

## Changes

- Indexation progress uses a compact status update. Job state transitions still refresh the workspace and complete draft/review handoff. Unchanged data retains its references. Full refreshes are spaced, requests never overlap, failures back off without forcing full downloads.
- Indexation evidence is excluded from workspace/status responses. An authenticated, store-scoped endpoint returns at most 50 rows; the default is 10. Evidence only mounts after opening the disclosure and refreshes on explicit request. Every new page load starts it closed.
- Imported URL, daily evidence and score-history tables are paginated.
- Restored Products, Collections and Content navigation in both the embedded admin navigation and local navigation.
- Export controls no longer depend on App Bridge during rendering. Live downloads still require a fresh ID token and normal server authorization; missing bridge errors are contained to the action.
- Indexation headline compares indexed with inspected URLs; sitemap coverage, unknown URLs and dates are separate. The checking button keeps an action label, with progress displayed separately.
- Catalogue scores explicitly say setup. Observed search visibility remains separate. The underlying score formula is unchanged; an evidence cap warning appears only when it reduces the result.
- Unsuccessful crawler checks are not labelled as confirmed broken customer pages. HTTP status groups, sample URLs, timestamps and recheck guidance are shown.
- Structured-data counts distinguish missing markup from incomplete/invalid markup and show leading validation reasons. Historical changes are not attributed without retained evidence. Site population labels distinguish sitemap, scan and Search Console coverage.
- Trend controls explain insufficient history and singular day wording is corrected.

## Verification

- 276 tests across 29 test files passed; TypeScript, ESLint and production build passed.
- Full workflow browser suite passed: review entry, accept/reject, generation completion, link repair/removal, settings, mobile/laptop layouts and selection with 320 catalogue items.
- Real-Polaris iframe checks passed at 1024×768, 1280×800 and 1440×900 outer viewports with a 910×713 frame.
- A 15-minute isolated stress run with 5,000 URL evidence records completed 60 route checks and 301 status polls with zero full workspace refreshes during indexation progress, two paged evidence requests, and no browser exceptions. The maximum measured navigation-plus-interaction step was 247 ms in this fixture, not a production latency guarantee. New tabs and reloads stayed responsive; a failed job restored the next-batch button.
- Final deployment overlay was compared byte-for-byte with the working app and tests. No dependencies or migrations changed. Automated browser tests use isolated local databases and simulated jobs/writes, with the real Polaris CDN script. They are not authenticated Shopify acceptance.

Shopify toolkit navigation search completed. Its standalone validator could not resolve the s-app-nav intrinsic/runtime in its virtual environment, even after installing its required host packages; application typechecking and browser validation are separate checks.

## Outstanding acceptance

- Reproduce the original trigger and verify the fix in signed-in Shopify, including existing persisted job state.
- Controlled live accept, Shopify read-back, rejection and undo.
- Theme extension publication and storefront schema rescan remain separate and unchanged.

Check-all/scheduled indexation, score formula redesign and expanded AI actions are deferred as agreed. This release adds no database migration and does not automatically edit merchant content. Rollback uses the prior Docker/source commit; retain the persistent data volume.

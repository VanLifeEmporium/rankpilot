# Release 14 — operability and evidence safeguards

## Why this release

The release-13 audit found that the product could not be used reliably in Shopify's constrained iframe. The earlier tests did not reproduce that host constraint and did not load the real Polaris script. In particular, the indexation form posted to `/app`, whose parent route had no POST action. That 405 was reproduced before changing the code.

## Changes

- Parent route accepts actions; dashboard forms explicitly target the index action. Indexation stays in-app, reports progress after each saved URL, resumes unfinished batches and schedules a read-only URL recheck after an accepted write. Unknown URLs are not counted as failures.
- Natural document scrolling replaces the fixed-height workspace scroll trap. Real Polaris iframe tests exercise search, selection, details, dirty-modal cancellation, visible save buttons, wheel/End scrolling and first-click indexation at 1024×768, 1280×800 and 1440×900 with a 910×713 frame. This does not pretend to implement a nonexistent public App Bridge resize API.
- Modal close releases the lock and returns focus. Typed unsaved edits prompt before closing. Saved/rejected decisions reset the dirty state. Batch entry scrolls/focuses the labelled review panel.
- Removed the obsolete five-word policy from generation; legacy proposals mentioning it require a new review. Generated metadata preserves page identity, punctuation, brand and good existing summaries. Only positive rubric deltas survive; 30–60 title characters and 150–160 summary characters are guards for changed generated fields. An unchanged field can remain outside the target. Merchant edits are separately confirmed and previewed before acceptance.
- "Current content is better" suppresses automatic replacements for that unchanged page, across the full retained rejection history. A source draft remains available for an explicit merchant edit.
- Conflict checks re-read and display live/expected/proposed values for metadata and other fields. New previews use the refreshed Shopify value. Rechecking never repeats an acknowledged write. Per-row undo and dated, reviewed sets (up to 25 loaded changes) retain field-level conflict guards.
- External broken links offer exactly replace/remove/mark expected; external replacements are HTTPS-validated. Shopify redirect controls and arbitrary product suggestions are hidden. Known HTTP status and check date are retained.
- Score snapshots retain timestamps and method versions. Older history is not discarded at deploy; dense history is reduced to first/last daily samples for display. The separate 55-point low-evidence cap is explained beside the score; missing measurements are rescaled, not an 85-point mathematical ceiling.
- One schema verdict drives the inventory and technical score. Structured data has a 30% technical-health weight. Required template types, missing properties and dates are visible. CollectionPage, ItemList and BreadcrumbList are supported in the optional theme extension source.
- Search positions below 10 impressions are hidden; reporting identifies dates/property/all-country/all-device scope and links to a live search. Main phrases use page-specific Search Console queries, preserving manual overrides. Product/collection/blog tiles explain their health formula and measured traffic.
- AI samples show engine, date, prompt, answer and citations with pagination; the headline names sampled engines. Robots checks show tested URLs and retained directives. Failures remain unmeasured.
- Link generation uses cached text embeddings after subject/season checks, suppresses similarity below 0.55, and stops if the provider is unavailable. No token-only fallback is published. Destination search evidence informs priority; expected ranking impact is not invented.
- Bulk extraction previews clearly labelled specification text as unconfirmed facts, protects confirmed facts, and shows potential core-fact coverage only if the merchant checks and confirms it. Shopping-feed property completeness is separate from verified product facts; account-level policy fields remain explicit checks.
- Speed opportunities have dashboard access, duplicate-theme guidance and measured time-saving estimates. Lighthouse does not supply an honest score-point gain per change, so that remains unmeasured.
- Results show saved changes followed by increased clicks only when a complete, non-overlapping reporting period and an actual baseline exist. No causal attribution is claimed.

## Completed release gates

- 271 tests across 28 test files passed on the reconstructed Docker source.
- Production build, TypeScript and clean-cache ESLint passed on that reconstruction.
- Full local workflow browser suite passed, including 390–1440 px layouts, first-click requests, automatic completion, review/reject/accept, link replacement/removal, settings persistence and two-tab use.
- The reconstructed build also passed the real-Polaris 910×713 iframe test at all three requested outer viewport sizes, with no browser exceptions.
- Shopify Liquid toolkit validation passed for the theme block. The standalone Polaris validator could not resolve the full React application’s imports in its virtual type environment; application typechecking and real-component browser tests passed instead.

## Validation boundary

Automated checks cover local fixtures and production-built code. Shopify writes, provider responses and job completion are simulated in the workflow suite; the actual Polaris CDN script is used in the iframe tests. The App Bridge token flow is tested with an explicit stub, not a signed-in merchant session. Exact deployment reconstruction is checked separately before push.

The Shopify browser is at sign-in, and CLI device authorization failed through the environment's network proxy. Therefore authenticated Shopify interaction, live provider permissions, and real merchant write/readback are NOT verified here. The main web/worker deployment does NOT publish the Shopify theme extension.

## Not claimed as finished

- Theme extension publication/activation, followed by a real storefront schema rescan, requires working Shopify authentication. Collection schema source is validated locally but is not declared live.
- Genuine QAPage markup is not generated from merchant-authored FAQs. QAPage needs a real question/answer page. Product FAQ generation remains grounded in confirmed facts; a new collection/blog FAQ publishing workflow is not included.
- Bulk undo groups loaded changes by date, not an historical app-release ID (older records do not retain one).
- Product/collection dead controls were not reproducible with the real Polaris script locally. The constrained-frame regression now passes; the actual Shopify host still needs signed-in acceptance testing.
- No universal five-second completion guarantee: Shopify/provider latency can exceed it. Requests acknowledge promptly and progress continues automatically.

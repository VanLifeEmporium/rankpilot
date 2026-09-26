# RankPilot release 13 — reliability and useful recommendations

Release marker: `2026-09-26-backlog-13`.

Implements the findings in the latest v12 testing report. The approval requirement, source evidence, genuine-fact checks, per-change undo and three primary navigation destinations remain in place.

## Changes and evidence

| Reported issue | Update | Verification |
| --- | --- | --- |
| Dashboard scroll lock around 1290px | The workspace owns a viewport-height scroll region, including keyboard focus. It remains scrollable when the iframe host locks document scrolling. Removed costly backdrop blur. | Browser wheel, End, modal-close recovery at 390, 768, 1024, 1150, 1290 and 1440px, including locked document styles. |
| Collection guide says a successful save failed | Compare parsed HTML structure, entities, whitespace, equivalent emphasis tags and the old RankPilot-only guide wrapper. Links, numbers, images and genuine styling remain significant. New guide uses plain compatible HTML. Existing acknowledged failed writes receive a read-only recheck. | Integration test builds an Off Grid guide, approves, simulates Shopify editor normalisation, verifies without a second write, then undoes. Genuine content/target changes still fail comparison. |
| Misleading “no content changed” verification message | A mismatch now explains that the read-only check made no further changes and the prior write may have saved. | Verification regression tests; approval/undo UI tests. |
| Renderer stalls | Paged reporting and Merchant rows (15 per page); send comparable analytics snapshots rather than every old large payload; retain full score/impact history. Stable fact form during revalidation; no backdrop blur. | Browser tests with 320 extra catalogue records, simultaneous tabs and large feed fixture. This is a local reproduction environment, not proof that every production freeze is resolved. |
| Writing always falls back | Removed the four-second writing timeout. Writing uses a 45-second request budget and one bounded transient retry; content review still must pass. Fallback only for unavailable providers, never rejected factual review. | Simulated response after five seconds completes as reviewed copy; transient and final failure tests. |
| AI sampling failures shown as zero | Low-effort grounded OpenAI requests, a 90-second request budget, two rotating questions per provider and concurrent independent providers. Persist complete/partial/failed results separately. Failed or incomplete requests never become observations. | Completed, incomplete, timeout and partial provider fixtures; unavailable results excluded from score. Legacy failed jobs are labelled unavailable. Live account/model access remains to be confirmed in the signed-in store. |
| Merchant IDs and incorrect missing attributes | Read Merchant API v1 `productAttributes` and `gtins`; preserve identifier exemptions. Named products, clear field labels, account-shipping caveat, source review and Merchant Center actions. Old imports show a refresh action rather than an incorrect ID list. | Current API response fixtures; named/paginated browser table. |
| Blog aliases show an empty shell | `/app/blogs` and `/app/articles` redirect to `/app/content`; unknown sections return 404. | Browser navigation checks. |
| Auto-fill no-op and scroll jump | Keep the form mounted during revalidation, apply each returned extraction once, preserve entered fields, show the number filled or why none were found. Extracted facts remain unconfirmed. | Browser extraction fills a cleared Materials field, preserves typed Power text and modal scroll, and leaves confirmation unchecked. |
| Confusing counts/labels | Separate pages, deduplicated fixes and underlying checks. “Save collection plan” / “Save blog plan”. Remove duplicated Settings help. | Browser and type checks. |
| Schema fraction, weak traffic hidden by tidy scores | Schema health is /100 and flags poor coverage. Catalogue tiles show limited search visibility beside technical scores. Three additional metrics use a responsive grid. | Score fixtures and responsive UI. |
| Indexation empty | Visible “Check next 20 URLs” action. First connected analytics refresh queues a deduplicated initial inspection. Unknown URLs remain unknown. | Existing indexation batching/retention/error tests; no index submission or storefront mutation. |
| Reporting noise/overflow | Default gains table includes positive changes only; all-pages option and pagination. Canonicalise variant/tracking URLs. Best observed query position beside average. Wrapped table cells keep click rate visible. | Aggregation tests, real CTR calculations, pagination and column-visibility browser tests. |
| Rejection has no feedback | Optional reason retained with page/change identity and used as context for subsequent AI copy proposals. | Browser rejection persists exact reason and resource identity. |
| Weak summaries, arbitrary products and irrelevant links | Prefer substantive complete source passages; exclude series-number/newsletter boilerplate. Rank real collection members by topic. Topic/season gates suppress northern/projector and winter/summer false matches. Priority reflects match strength and available traffic evidence. | Regression cases from the report; collection apply lifecycle. Matching remains a conservative rules-based recommendation, subject to merchant review. |
| Fabricated blog searches | All page kinds use page-specific Search Console queries when available. Source-derived alternatives are labelled unmeasured; preserve custom saved phrases. | Integration fixture for blog queries and saved preference. |

## Scoring method, version 2

The six Store Score weights remain 30/20/15/10/15/10. Technical health now combines catalogue setup (70%), measured mobile lab speed (10%), indexed share of inspected URLs (10%) and scanned schema coverage (10%). Missing signals are excluded and the available weights rescaled. An inspected sample never represents all submitted URLs. Speed/index evidence expires after 28 days; structured-data coverage is from the latest imported scan. Failed AI sampling is unavailable, not 0% visibility. Partial results are labelled.

Version 1 snapshots remain stored; version 2 trends use only like-for-like method snapshots. A score can move when evidence or its method changes without a storefront edit. Search positions are Search Console observations, not a live universal Google ranking. No attribution or ranking gain is promised.

## Validation and release boundary

- 260 automated tests across 26 files passed.
- Production build, TypeScript and clean-cache ESLint passed.
- Full isolated browser regression passed, including approval/reject/undo flows, embedded token refresh, simulated status outage recovery, large catalogue selection, form persistence, aliases, reporting and scrolling.
- Shopify AI Toolkit validated the collection update/read fields against the current Admin schema.
- API references used: [Merchant Product](https://developers.google.com/merchant/api/reference/rest/products_v1/accounts.products), [ProductAttributes](https://developers.google.com/merchant/api/reference/rest/products_v1/ProductAttributes), [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search).
- No production merchant content or credentials were used in tests. Shopify writes were exercised through isolated fixtures and API adapters; provider success/failure was simulated. Production account/model access and actual collection readback need an authenticated merchant test.
- Main app and worker deploy through the existing GitHub-to-Render pipeline. Both health endpoints must return 200 and the release marker after rollout. No database migration or permission expansion.
- The optional collection ItemList theme extension remains unpublished as documented in release 12; this Render update does not publish Shopify extensions.

# Workflow stabilisation — 24 September 2026

Autopilot remains disabled. Generation creates a proposal; acceptance queues an application. Application now reads the relevant Shopify field back and only marks a change applied when it matches. Rejection does not write to Shopify. Verified local field changes refresh catalogue findings while retaining crawl findings until re-audited.

Generation jobs are deduplicated, persist per-resource results and resume without repeating completed resources. Scheduler errors no longer prevent queue processing. Exhausted interrupted jobs become visible failures. Finding progress survives navigation. Metadata review uses snippet-specific requirements; description rewrites preserve image tags. FAQ findings route to sourced facts before generation.

Validation: 119 tests passed across 11 files, plus two added queue regression tests passed in the 20-test workflow suite. Typecheck and production build passed. Shopify responses and AI output were simulated in integration tests; no paid provider calls were made. Authenticated production verification remains outstanding. External Shopify validation was blocked by automatic approval review because it would transmit operation definitions to Shopify; it was not bypassed.

Release marker: X-RankPilot-Release: 2026-09-24-workflow-1 on /health.

Not all findings support automatic writes. Theme-specific schema, image delivery, GTIN and other unsupported findings provide guidance. This release does not establish that every reported issue is automatically fixable.

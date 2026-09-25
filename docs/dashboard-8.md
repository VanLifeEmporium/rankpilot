# Dashboard and audit release 8

## Delivered
- Three primary navigation entries: Dashboard, Results & history, Settings. Product, collection and blog health tiles and AI/FAQ access sit on the dashboard.
- Five prioritised issue groups, in-dashboard individual and explicit batch approval, real metrics, dated traffic history and coverage explanations. Missing measurements are not fabricated.
- Broader live-page checks: all discovered HTTPS links up to 3,000 unique destinations, bounded concurrent requests, reusable page status checks, missing live alt attributes (decorative empty alt preserved), titles/descriptions, image loading and intentional nofollow notices, sitemap and crawler rules. Current catalogue and historical 404s are separate.
- Avada-compatible URL import, rechecking, row-level redirect preparation and removal from monitoring. Removal does not delete a Shopify page, an existing redirect or a search-engine record. Redirects require a confirmed missing source, a working same-store destination and merchant approval. Transactional routes are excluded.
- PageSpeed results with dates, mobile lab score, available field measurements and prioritised actionable diagnostics, plus a link to the full Google report.
- Schema coverage across scanned product/collection/article page families. This is presence plus local validation, not Google rich-result certification or a full template registry.
- Search queries at positions 8–20, a 90-day Google clicks series, identifiable AI-referral revenue from GA4 and a source-grounded brand-voice setting.

## Boundaries and remaining work
- Google AI Overviews supports existing manual observations; automated consumer-result sampling is not configured. API answer samples are not consumer search rankings.
- GA4 attributed revenue is not matched to individual Shopify orders. AI referrals without an identifying referrer are unmeasurable by this report.
- Image compression and theme/robots/schema fixes are guided actions, not automated image replacement or theme publication.
- Ratings, GTINs and customer questions must have real sources. No invented reviews or specifications are generated. Collection FAQ automation, cross-service brand consistency and a calibrated citation-worthiness score remain future work.
- Existing weekly scans and approval safeguards remain. New-image automatic draft generation and alert delivery need further implementation/configuration; automatic publishing remains off.
- Paid tiers, Billing API setup and Built for Shopify certification are not implemented or claimed by this release. Plan prices and provider access are not invented.
- No production Shopify admin session was available for interactive verification. Local browser tests use an isolated demo database and a controlled embedded-auth fixture.

## Verification
196 unit/integration tests; TypeScript, ESLint and production build. Browser regression covers filtering, automatic job refresh, source-backed CSV facts, approval groups, dashboard navigation, imported URL removal and redirect selection, and authenticated iframe polling with outage recovery. Shopify component validator could not resolve its injected preact/jsx-runtime dependency; normal project typechecking succeeds.

Deployment: release8 overlays after release7. No database migration and no bulk merchant content approval. Health marker: 2026-09-25-dashboard-8.

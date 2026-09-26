# RankPilot release 11 — deep-dive review

Release marker: `2026-09-26-backlog-11`.
Base: release 10, commit `4275be34cb87216fde05b44bb75b3c78df56292d`.

This release addresses the supplied deep-dive review. It does not assign itself an 80/100 user-research rating; that needs a fresh independent review.

## What merchants see

- **Discovery readiness** replaces the technical checklist as the headline score. Technical health and Google search visibility have their own definitions and scores. Missing or stale search evidence stays “Not measured”. Products, collections and blogs retain technical health out of 100 and also show their own search performance.
- Google titles no longer have a five-word cap. Titles aim for 50–60 characters and summaries for 150–160, with soft warnings for longer copy. Useful shorter wording is allowed. The longer example from the review passes. Existing valid drafts are not rewritten merely for containing six or more words.
- Preview generation has its own worker lane, independent of full scans and approved writes. Two source-grounded text-generation/review calls each have a 20-second timeout. Progress updates automatically, partial batches retain their completed results, and genuine failures provide a retry. Grounding and approval remain required.
- Shared broken destinations produce one dashboard group. If the missing destination itself is also flagged, new structured evidence lets it join the same group. The affected-page count and number of checks are labelled separately.
- When a broken destination matches an existing catalogue page, restoration is the first recommendation. Collections include their product count. The fix page links to Shopify to check availability; redirects remain secondary.
- Redirect suggestions come from pages seen working in the most recent scan, ranked by shared topic words. The homepage is explicitly a last resort. A destination is checked again before saving.
- External broken links can be replaced or removed from the source page's editable description. Removal retains the text. Shopify redirects are not offered for another site's address.
- A saved redirect queues a focused destination check. A saved link replacement/removal queues a check of the source's live HTML. Only confirmed resolved findings are cleared. The historical URL list and dashboard counts update together. Undo queues a full scan to rediscover any restored problem.
- Batch review supports rejecting one suggestion while retaining the rest. Dashboard fixes continue to use the reusable Before/After, explanation, approval and rejection flow.

## Backlog disposition

| Ticket | Delivered | Boundaries for re-audit |
|---|---|---|
| A1 | Visibility-weighted headline, low-click cap, visible formula | Indexation coverage is not available from the current query report and is explicitly unmeasured. No invented rank or coverage data. |
| A2 | Separate technical and visibility scores with immediate explanations | These are RankPilot indicators, not Google ratings. |
| A3 | Category-specific measured visibility alongside technical health | Page-one blog fixtures outrank weak product fixtures on visibility. Real Wales-post evidence must be checked in the merchant's fresh snapshot. |
| B1 | Word cap removed throughout generation, review, approval, repairs and Settings | Character ranges are editorial targets, not Google limits. Structural guards remain at 255 title/500 summary characters. |
| B2 | Independent generation lane, bounded provider calls, live progress and retry | An under-ten-second live-provider SLA is not proven. Copy generation plus semantic source review can take about 40 seconds, plus queue/transport time. |
| B3 | Same-type batch approval with individual rejection | Up to 25 ready suggestions, one per page, with explicit approval and version checks. |
| C1 | Shared destination groups, including a matching destination 404 | Grouping uses actual URL evidence; unrelated template findings are not assumed to share a cause. |
| C2 | Existing-page and collection-product-count diagnosis, restore-first action | Current permissions do not expose publication status. The app says to check Online Store availability, rather than claiming it has proved the collection is unpublished. Publishing is completed in Shopify. |
| C3 | Scanned live-page picker, topic ranking, homepage last | Keyword overlap is a suggestion, not a semantic guarantee. Chosen destinations are verified again. |
| D1 | Unique affected-page counts, separate check totals and explicit review-step counts | The open review retains its selection; the current remaining-page count is labelled separately when findings change. |
| D2 | Dated HTTP evidence and explicit fresh-check messages | An earlier 404 and a later non-404 can coexist as history. Soft-404 classification is not claimed. |
| E1 | Plain-language impact and effort on priority rows | No promised ranking uplift. |
| E2 | Human-readable long-title labels and a safe fallback for unknown findings | Internal link-recheck markers are not shown as proposal rationale. |
| E3 | Community relevance, disclosure and backfire guidance before outreach drafts | Outreach is not automatically sent. |
| F1 | Focused live checks, bounded clearing, historical-list reconciliation and rollback rescan | A failed or blocked check retains the finding. Theme-owned links are retained when still present in live HTML. |

## Score method

Search visibility uses the current Search Console page/query report: 70% of the score is the share of reported impressions at average positions 1–10, and 30% is CTR scaled against a declared 5% reference. That reference is a product convention, not an industry benchmark. Positions are impression-weighted; raw clicks, impressions, observed pages and dates are visible.

Discovery readiness is 35% technical health and 65% observed visibility. When at least ten AI observations exist within the last 28 days, the visibility portion is 80% search and 20% recorded AI citations. Otherwise it uses search alone. Fewer than ten reported clicks caps readiness at 55. Search evidence older than 45 days, missing dates, or no impressions leaves the score unmeasured. Category visibility uses the same formula restricted to that category's URLs.

This is deliberately conservative, not a claim that a store with a certain score must rank on page one. Query reports omit some searches; branded queries and small samples can dominate. Unobserved pages are not assumed to be unindexed. Traffic and revenue do not establish causation.

## Verification

- 223 automated tests across 22 files passed, including product/article save verification, no duplicate writes during read-back retries, long-title acceptance, six-to-one shared-link clearing, failed checks retaining findings, scoped source edits, visibility calculations, batch version protection and the independent generation lane.
- TypeScript, ESLint and the production build passed.
- Local browser regression passed: dashboard review opens immediately; batch per-item rejection; approve/reject; live polling including outage recovery; editable and saved brand voice; responsive selection with 320 additional catalogue items; visible Save/Cancel and wheel scrolling on desktop/mobile; generation receipt/completion/failure; broken-link redirect/removal; restore-first collection with 13 products; ranked target picker; distinct scores and row-derived CTR. Browser run recorded selection feedback at approximately 172 ms. Fixtures and authenticated-iframe stubs were used; this is not a claim of authenticated live Shopify testing.
- Shopify AI Toolkit validated the full changed collections query against its Admin schema with `read_products`. No new permission or database migration is required.
- The separate Polaris component validator could not start because its host package lacks TypeScript. The app's own TypeScript build, lint and browser checks passed; a Polaris-validator pass is not claimed.

## Release and re-audit

Deploy through the existing main-branch Render pipeline, then confirm the release header and `/health?worker=1`. Keep Autopilot off.

After deployment, a fresh store scan populates collection counts and structured link evidence for old findings; refreshing connected analytics supplies current visibility evidence. Re-audit the reported campsites title, the festival collection and the source pages against live Shopify. Generation never publishes content, and this release does not silently republish collections or approve pending suggestions.

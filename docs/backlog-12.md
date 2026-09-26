# RankPilot release 12 — sourced fixes and measurable progress

Release marker: `2026-09-26-backlog-12`.

This release follows the merchant backlog supplied on 26 September 2026. It preserves the three main navigation destinations and the shared before/after approval workflow. Generation and opening a suggestion do not publish content.

## Backlog coverage

| Area | Delivered | Limits made visible |
| --- | --- | --- |
| A: Dashboard | Store Score hero; 7/28/90-day recorded trends; ordered search/technical, discovery/AI/revenue and catalogue tiles; compact metric explanations; speed, indexation and schema tiles; progress beneath the fix queue | Missing components are unmeasured, not fabricated. Limited search evidence caps the headline. History starts with saved measurements in this release. |
| B: Products | Title/summary suggestions from existing source text; editable drafts with provenance; labelled specification extraction; retained image descriptions; feature/FAQ seeds; supplier import below the catalogue | Extracted specifications remain unconfirmed. Missing image descriptions require review of the image. Merchant confirmation is required before reviewing edited wording. |
| C: Collections | Primary/secondary phrase suggestions; existing-source Google listing draft; introduction/product guide using real collection members; relevant incoming/outgoing link plans; suggested handle; schema guidance | Query suggestions require connected Search Console data. Copy is not padded to an invented ranking word count. Theme schema publishing is separate; see below. |
| D: Blog links | Topical relevance gate, commercial destination preference, observed search evidence, duplicate suppression, maximum three links and incoming-link recommendations | Incoming counts cover imported editable descriptions, not navigation or the entire website. No invented ranking lift or search demand. |
| E: Fix reliability | Bounded provider calls and retry; safe source-text fallback for Google listings; immediate source-draft action; refreshed broken-link evidence; existing shared issue grouping retained | A rejected factual/content review does not invoke the fallback. Fresh non-404 or uncertain responses do not permit a redirect. Source fallback cannot manufacture image descriptions or specifications. |
| F: Stability | Single main scroll owner; responsive modal/viewport handling; non-overlapping, bounded live requests; backoff; full-state polling fallback after repeated status failures | An unavailable worker is reported separately from an available app. Provider outages cannot guarantee a five-second completion time. |
| G: Impact | Immutable pre-apply baseline per change; targeted metric labels; complete later-period comparisons in the shared change review; Store Score component movement and applied fixes | Historical fixes without a baseline are labelled. Changes and traffic movement are shown together without claiming causation. Incomplete following periods remain waiting/unmeasured. |

## Score and measurement contract

- Proposed weights are search 30%, technical 20%, readiness 15%, AI visibility 10%, organic revenue 15%, and catalogue coverage 10%. Available components are reweighted; measured coverage is disclosed.
- Missing/stale search evidence or fewer than ten search clicks caps Store Score at 55. Fewer than ten AI observations is insufficient to measure that component.
- Organic revenue index compares the latest complete 28 days' daily average against the preceding 90 days' daily average. An unchanged positive baseline scores 50 and doubling scores 100. An incomplete or zero baseline is unmeasured.
- PageSpeed distinguishes Lighthouse lab performance from available real-user LCP, CLS and INP. Missing field data is not displayed as zero.
- URL inspection is read-only, twenty URLs per job, with bounded same-origin sitemap discovery. Previously inspected URLs are retained for 28 days; uninspected URLs remain unknown. It does not submit URLs to Google.
- Schema health is local validation coverage, not a Google rich-results eligibility guarantee.
- Daily Store Score snapshots and change baselines use the existing Metric table; no schema migration or permission expansion is needed.

## Validation

- 241 tests across 24 files passed, including new score/source/link and indexation batch tests.
- Production build, TypeScript checks and ESLint passed.
- Browser regression passed for shared fix review, approvals/rejections, source drafts, saved impact baseline, finding filters, job feedback/completion, source-derived click rates, editable brand voice, broken-link redirect/removal, and explicit batch approval.
- Product selection updated in 115 ms with 320 extra catalogue rows in the isolated test fixture.
- Responsive browser checks passed at 390, 768, 1024 and 1440 pixels, including wheel scrolling and scroll recovery after closing the product modal.
- The authenticated iframe test uses a local App Bridge token fixture and an isolated demo database. It includes a temporary status outage and recovery. It is not a live merchant Shopify write test.
- Shopify AI Toolkit validated the product source query and the collection Liquid schema block. Its standalone Polaris validator could not complete because dependencies were missing in the toolkit host; application TypeScript and browser checks passed independently.

## Deployment boundary

The main application is released through the existing GitHub-to-Render pipeline. Confirm both `/health` and `/health?worker=1` return HTTP 200 with the release marker above after rollout.

The optional collection ItemList extension is prepared, locally validated, off by default, and avoids adding a second ItemList when the theme already supplies one. **It is not published by the Render release.** Shopify CLI could not reach its developer sign-in endpoint from this workspace. Publishing this extension needs working Shopify developer access and validation of the linked app configuration; do not treat its presence in the application image as a live theme deployment.

No customer credentials or real product specifications were entered for testing. No live merchant proposals were approved as part of this release test.

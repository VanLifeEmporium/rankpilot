# Release 18

Fixes the spec-fields bug and makes RankPilot's scores honest. Release marker: `2026-09-29-release-18`. No database migration, no new Shopify scopes, no theme extension publish.

## Must-haves

- **Spec extraction (item 1).** New rule reader (`app/core/spec-extract.ts`): a wide label list (Height, Diameter, Capacity, Open, Folded, Approximate size, Includes, Set includes, Fabric, Max wattage…), several labels on one line, specification tables, and house-style section headings followed by a list ("What is included", "What size is it?", "Check the fit"). Height/width/depth/diameter/open/folded are combined into Dimensions. New **Capacity** field.
  - **Grounded AI pass** for what rules cannot read ("Supports up to 100kg"). Uses the store's OpenAI key. A proposal is dropped unless its quoted sentence appears in the description, every number in the value appears in that sentence, and every word of the value comes from the quote.
  - Each suggestion's source sentence is shown next to the field. Suggestions fill empty fields only and stay unconfirmed.
  - **Fill specs for all products** (Products page) runs as a background job and produces a review list: product, field, value, source sentence, with **Confirm all** and **Discard** per product. AI reading in bulk is opt-in (checkbox) and runs ten products per turn.
  - `GET /api/agent/spec-coverage` reports products with no rule-based suggestion against the 29 Sept baseline (241 of 315).
- **"5 words" note bug (item 2).** The retired five-word rule now matches only its original wording; "83 → 135 words" no longer matches (it did because "13**5 word**s" contains "5 word"). Agent notes now read "word count 83 to 135".
- **Honest scores (item 3).** The audit checklist is labelled **Catalogue checks**. Technical health (method 4) = index coverage 30%, speed 25%, catalogue checks 25%, structured data 20%, with its parts shown on the tile. Method-3 history is kept and not compared with method 4.
- **Index coverage report (item 4).** Audit page and dashboard: every inspected page not indexed, grouped by Google's reason (crawled/discovered not indexed, duplicate, redirect, not found, noindex, robots, unknown…) with a next step. Filter to all pages or products and collections. "Check up to 200 more" runs a larger inspection batch.

## Should-haves

- **Real-visitor speed (item 5).** Chrome UX Report field data (LCP, INP, CLS, 75th percentile, mobile) for the home page, a collection and a product; falls back to whole-site data, and says clearly when none exists. Uses the PageSpeed key (the Chrome UX Report API must be enabled for it). Technical health uses field data when present, otherwise the lab sample, labelled.
- **Keep Shopify's version (item 6).** Action on "Changed outside RankPilot" findings. Records acceptance in store settings; the flag clears with no Shopify write and the original change keeps its undo.
- **Confirmed no barcode (item 7).** Per-product action on the GTIN finding, plus a bulk list on Products. Stored as a confirmed `barcode: none` decision; never used in generated copy or FAQs.
- **Snooze (item 8).** Any finding can be hidden until a date with a reason; Snoozed findings are listed on the Audit page with "Show again", and return automatically after the date. The agent API respects snoozes.
- **Theme leftovers (item 9).** The crawl flags known SEO-app code (AVADA, Plug In SEO, SEO Manager, Smart SEO, Booster, TinyIMG, JSON-LD for SEO, Schema Plus, SearchPie, Yoast, SEO King), "Failed to render app block", printed Liquid errors, and duplicate `<title>`/meta description tags. Reported once per store with example pages. Duplicate JSON-LD entities were already reported as schema errors.
- **Supplier HTML clean-up (item 10).** New `supplier-markup` finding and a **Clean supplier formatting** proposal: H1 becomes H2, buttons/forms/scripts/styles/inline styles/app attributes/unsafe links are removed, and the proposal is refused unless every word of visible text is unchanged. Agent: `POST clean-formatting` (dry run by default).
- **Crawl rate limits (item 11).** The first 429 doubles request spacing (up to 4 s). Pages still rate-limited after their retries are rechecked one at a time at the end of the crawl and reported only if they still fail. Counts are kept in `discoveries.rateLimit`.
- **Supplier copy check (item 12).** Originals are stored per product (metric rows, no migration) from Store Operations via `POST /api/agent/supplier-originals`, or a CSV (handle, original, source) on the Products page. Products whose description still shares 50%+ of the original's five-word sequences are listed. `GET /api/agent/supplier-copy`.

## Could-haves

- **Bulk FAQs (item 13).** "Add FAQs from confirmed facts" queues FAQ proposals for products with 3+ confirmed facts and no FAQs (up to 100 per run). Uses the existing fact-only FAQ builder; nothing publishes until accepted.
- **AI answers breakdown (item 16).** AI visibility page: per tracked question, how often the store was cited, who was cited instead, and a content gap suggestion.

## Not in this release

- Collection consolidation helper (item 14) and Shopify category metafields (item 15). Item 15 needs product-taxonomy mapping and a metafield write path; item 14 remains covered by the agent's description and redirect endpoints.
- The supplier copy check does not fetch supplier listing URLs; originals must be supplied (open decision).

## Validation

- 323 automated tests across 33 files pass, including `tests/release18.test.ts` and `tests/release18-network.test.ts` (mocked OpenAI and storefront: 429 recovery, AVADA snippet detection). `tests/backlog13.test.ts` updated for the method-4 weights.
- TypeScript and production build pass. ESLint passes apart from the existing `autoFocus` rule in `AgentAccess.tsx` (release 17, unchanged).
- Local demo browser check: Dashboard, Products (fill specs → review list with source sentences → confirm all; bulk no-barcode), Audit (index coverage report), AI visibility (answers by question); no page errors.
- Live checks still to run after deploy: spec coverage against the 241 baseline, the 135-word mug save, two audits without rate-limit findings, and a planted AVADA-style snippet in an unpublished theme copy (note the crawl reads the live theme only, so this check needs the snippet on a published preview or a live page).

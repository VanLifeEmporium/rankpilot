# RankPilot release 20

Release marker: `2026-09-30-release-20`. The goal is findings you can trust. There is no database migration and no new Shopify permission; barcode writes use the existing product write access. The next sync also reads variant ids and smart collection rules.

## Sprint 1: stop the noise

- **RP-101 Variants.** Products inside one ProductGroup (`hasVariant`) count as one product. Two separate top-level Products still raise "product-schema-multiple", naming both script sources.
- **RP-103 Changed outside.** Differences that are only formatting no longer raise a finding. These include `<br />` versus `<br>`, whitespace, empty attributes, editor spans and `b` versus `strong`. A real edit shows both versions side by side, including any links added or removed. You can then choose "Keep Shopify version" or "Restore RankPilot version".
- **RP-301 Unpublished pages.** Findings on unpublished pages move to a separate "Unpublished pages" list with a Draft badge. They do not count in catalogue checks or answer readiness. Approving a change to one warns that the page is not live.
- **RP-303 Opportunities.** Opportunities now list only live, published and indexable pages. The agent endpoint reports what it left out and why.
- **RP-601 Alt-text job.** The generate-alt job now targets duplicate alt text. It lists the proposals made for each product, or says why none were made.
- **RP-602 Database errors.** A busy database no longer shows raw Prisma errors. Writes wait longer, and each item returns "pending" or a plain message.
- **RP-603 Protected pages.** A page with an open "changed outside" finding refuses every write (description, clean formatting, FAQ, headings) until you resolve the finding.

## Sprint 2: fix the score and find the gaps

- **RP-102 No Product data.** A published product page with no Product structured data is a critical finding. The finding names the template in use, e.g. “product.alternate”.
- **RP-104 Answer readiness.** Answer readiness now reads variant options, such as "Rectangle 80 X 150Cm". It asks only the questions that fit the product type, so rugs are not asked about fit and books are not asked about care. Delivery is judged once for the whole store.
- **RP-302 Dead pages in Google.** A URL that returns 404 but still gets impressions raises "404-with-impressions" with the closest live product or collection. If nothing matches, the finding says to leave the 404 rather than redirect to the home page. An unpublished page that still gets impressions offers Republish or Redirect.
- **RP-501 Capitals.** Technical terms (MIMO, MPPT and more) and the product's own vendor are allowed in capitals. You can add your own words in Settings › Words allowed in capitals.
- **RP-502 Units.** Imperial units are accepted when a metric value is given nearby. Otherwise the finding proposes the conversion, e.g. "17 to 22 inches → 43 to 56 cm".
- **RP-503 Negation.** A denied claim such as "not a waterproof layer" is no longer read as a waterproof claim.
- **RP-604 Changes by page.** `GET /api/agent/changes?resourceId=…&offset=…` pages through one page's full history. Changed-outside findings include their `changeId`.

## Sprint 3: brand and content

- **RP-201 Real brands.** When the vendor is your store, RankPilot looks for the manufacturer. It checks the title, a "Brand:" line and the handle, and shows the evidence and a confidence level. "Propose vendor" makes one pending change, and "Propose for every product" makes them in bulk. The proposal warns you if a smart collection uses the vendor in its rules. Products tagged `own-label` are left alone. Every change waits for your approval and can be undone.
- **RP-202 Search terms in titles.** When Search Console shows people searching a brand and model that the title lacks (for example "andes nevado 400"), RankPilot suggests adding them. A new title that drops the brand is blocked, whether RankPilot, you or an agent wrote it.
- **RP-203 Book flow.** For a book, "Find publisher and ISBN" looks in the description and then Open Library. You confirm the edition, and RankPilot then prepares two pending changes: the publisher as vendor and the ISBN as barcode.
- **RP-401 Repeated template text.** A sentence that appears on many products raises one store-level finding with the phrase and page count. Affected pages are ranked by Google impressions. Short shared delivery blocks are not raised.
- **RP-402 FAQ quality.** An FAQ section in the description counts as product FAQs. If the only questions are the store-wide template, "generic-faq" suggests questions whose answers come from facts on the page or confirmed facts, with each source named.

## Sprint 4: learn and polish

- **RP-403 Learning from rejections.** If you reject three or more SEO titles that removed "| Van Life Emporium", new titles keep the store name. Settings › Learned from your decisions shows the rule and has a reset button. A title with no separator before the store name, or with the product name changed, is blocked before it is proposed.
- **RP-504 Word-count guard.** Only unique sentences are counted, so a rewrite that removes repeated paragraphs or bullets is accepted.
- **RP-605 No-ops explained.** Every write that changes nothing says why, e.g. "No change: value already set".

## Agent API

New:

- `GET book`
- `POST brands`
- `POST book`
- `POST restore`
- `GET changes?resourceId=&offset=`, which returns a paged `{total, offset, limit, hasMore, items}`

Changed:

- `findings` items include `changeId` for changed-outside findings.
- `opportunities` returns `excluded`.
- Writes to protected pages return the status `protected`.
- `unchanged` results carry a "No change: …" message.

The release is `20`, and the agent workspace page documents every endpoint.

## Checks

- Every Gherkin scenario is an automated test, in `tests/r20-sprint1.test.ts` to `tests/r20-sprint4.test.ts`. The full suite passes, as do lint and typecheck.
- Comparing with the release 19 baseline needs a fresh audit on Van Life Emporium after deploy. Findings, answer readiness and brand counts are recalculated on that first audit.

# RankPilot release 19

Release marker: `2026-10-01-release-19`. The final RankPilot update. No database migration and no new Shopify permissions.

## P0

- **R19-00 Memory.** RankPilot now runs as two lean processes with a memory cap each. Audits read 50 pages at a time, and crawls wait while changes are being saved. Memory is shown at /health. On the local build, idle use is about 235 MB of the 512 MB plan.

## P1

- **R19-01 Rendered pages.** Every audit opens each published page as shoppers see it. It flags pages that show "Page not found", products with no image, brand or product data, and pages with two sets of product data.
- **R19-02 Agents.** Agent edits now arrive as proposals for you to approve. Invented ratings, reviews, certifications, waterproof ratings, barcodes, prices and marketplace links are refused unless they are confirmed facts. So are big cuts in word count.
- **R19-03 Brand rules.** One list of house rules applies to every writer and every check. It blocks "!", sales phrases ("hot sale", "buy now"…), 【】 brackets, words in capitals and inches or pounds. US spellings are flagged as warnings.
- **R19-04 Answer readiness.** One number shows how many of 7 shopper questions each product page answers: size, material, what's included, weight, care, fit and delivery. There is one finding per missing answer, with a product count.
- **R19-05 Template FAQs.** Questions copied onto many products no longer count as that product's own FAQs.
- **R19-06 Barcodes.** Barcodes with a wrong check digit are flagged, and so are books without an ISBN. RankPilot never suggests a barcode.
- **R19-07 Brands.** RankPilot flags placeholder brands ("N/A", "Unbranded"), brands spelt two ways, and books that list the store as their brand. It also flags titles that name a different brand from the vendor.
- **R19-08 Honest scores.** Each check counts once. Advisory notices no longer lower the score, so confirming "no barcode" no longer raises it. AI samples are shown but left out of the Store Score. Each score has one name and a tooltip explaining it.
- **R19-09 Agent link.** The agent link opens first time from Shopify admin, and a link can only be used once, even if it is opened twice at the same moment.
- **R19-10 Workflow fixes.** Saving Product details no longer wipes the main search phrase. "Keep Shopify's version" can be reached. Dialogs no longer dead-end after an undo or reject, and a failed undo says "Undo failed" with the reason.

## P2

- **R19-11 Agent parity.** Agents can now do what you can in the app:
  - undo a change, keep Shopify's version, confirm or undo "no barcode", and snooze a finding;
  - confirm facts, write FAQs, and change a product's title or brand;
  - page through every product and read its barcodes, variants and facts.
- **R19-12 Speed job.** Agents can start the real-visitor speed check.
- **R19-13 No speed data.** "Not enough Chrome visitors yet" is shown as a normal state, and speed-check errors appear on the dashboard.
- **R19-14 AI score.** The AI answer sample is labelled as a sample and kept out of the Store Score.
- **R19-15 Guides.** Opening dates, "open all year", postcodes and prices in guides raise a "Check before [season]" reminder with a date.
- **R19-16 Guide layout.** Agents can edit guides and pages without their existing layout (boxes, figures, dividers) being refused.
- **R19-17 Merchant listings.** RankPilot flags when product data has no shipping details or return policy. That fix is in the theme.
- **R19-18 More checks.** RankPilot flags imperial units, page addresses over 60 characters, the same image description used twice, and internal links that go through a redirect.
- **R19-19 Job results.** A job where everything failed now shows as failed, in error colours, and old status messages clear.
- **R19-20 Phones.** On a phone, the header folds away, and product rows show their checkbox and Product details button without scrolling sideways.
- **R19-21 Agent batches.** Batches of 10 now return within 10 seconds, and agents check back for anything still saving.
- **R19-22 Supplier copy.** The empty "supplier copy" panel is gone. Supplier-style wording is now caught by the house rules.

## P3

- **R19-23 Polish.**
  - "Clean supplier formatting" also removes "BUY NOW" and switches http:// links to https://.
  - Confirmations appear on the page instead of browser pop-ups.
  - Wording is tidier: proper plurals, no internal codes.
  - The app checks for updates less often when nothing is running.
  - You tick each suggested fact before confirming it.
  - Messages no longer disappear, and "no barcode" can be undone.
  - The CSV import names any columns it does not recognise and keeps existing values.
- **R19-24 Product fields.** Shopify's own product fields (such as material or size) are read as facts. They are read only; nothing is written back.

## Dropped

- Collection consolidation helper: there are 9 collections and no overlap problem.
- Fetching supplier web addresses: live-page checks and house rules catch supplier text without it.

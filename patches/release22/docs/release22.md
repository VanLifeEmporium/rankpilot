# RankPilot release 22

Release 22 ships in four sprints, as `patches/release22/` plus one Dockerfile `COPY` line after release 21. It needs no database migration and no new Shopify permission.

## Sprint 1: make applied work count, safely

Release marker: `2026-10-01-release-22-s1`.

### R22-000 Release 21 first

PR #6 (Release 21) was rebuilt on 20.1 and passed all 442 tests. It was merged and deployed before any release 22 work. Release 22 layers on top of it.

### R22-200 Database: WAL, busy timeout, one connection per process

The "database busy" errors were reproduced here. They came from one Prisma client holding a pool of SQLite connections. When an approval held a write transaction and other saves in the same process waited for SQLite's lock, those waits tied up the engine. The transaction could not commit until the waits gave up after the timeout, and then half the saves failed with "database is locked". The worker runs three job lanes in one process, and the web process serves concurrent requests, so both could hit this.

What changed:

- Each process now uses a single connection (`connection_limit=1`), so queries queue inside Prisma instead of inside SQLite. In the reproduction this took 8 concurrent saves plus an open transaction from "half failed after 10 s" to "all saved in 1.2 s".
- The database runs in WAL mode, so the web process can read while the worker writes.
- `busy_timeout` is 10 s and `pool_timeout` is 30 s.

The settings are added to `DATABASE_URL` in code, and WAL is switched on once at start-up. Each process logs `RankPilot database: journal_mode=wal busy_timeout=10000`, and `/health` shows `database.journalMode`.

**Backup.** Before the first switch to WAL, the app writes a consistent copy of the database next to it, as `<file>.pre-wal-YYYY-MM-DD.bak` (made with `VACUUM INTO`, which is safe while the app runs).

**Rollback.** Revert the merge. The database stays in WAL mode, which every SQLite version used here supports.

### R22-201 Automatic retries

Database writes retry up to 3 times with backoff when SQLite is still busy. After a Shopify write, only the database step is retried, never the Shopify write. If every retry fails, the message says the item was not saved and that it is safe to send it again.

### R22-203 Batch results that are safe to resend

`POST /api/agent/approve` reports what happened to each id:

- already applied ids: "No change: already applied";
- ids still saving: their current status;
- failures: the reason.

Resending the same ids re-queues only the ones whose apply failed. Resending an identical proposal returns the one already waiting instead of creating a duplicate.

### R22-502 FAQ answers use the right fact

One rule set (`app/core/faq-facts.ts`) now feeds the FAQ suggestions, the fact-based FAQ generator and the review of saved FAQs:

- A size answer needs a length or volume.
- A load such as "Max load 204 kg" is asked as "How much weight does it hold?".
- A weight needs a weight unit.
- "Store in a dry place" never answers "How do I clean it?".
- A part's material keeps the part: "Cover: Fleece" becomes "The cover is Fleece."

### R22-106 Saved FAQs reviewed before go-live

Every saved answer is re-checked with these rules:

- **One-time check after this deploy:** the worker re-checks every store's saved FAQs once.
- **On demand:** the dashboard's "Prepare corrected FAQs for review" button runs the check again.
- **On every audit:** a "FAQ answer does not fit the question" finding is raised.

Each failing product gets a pending corrected list. A wrong answer is replaced by the right fact, or moved to the load question when the page calls it a load, or removed. Nothing is published until you approve it.

### R22-101, R22-102 RankPilot FAQ app block

There is a new **RankPilot FAQ** app block (`extensions/rankpilot-schema/blocks/faq.liquid`) for product templates:

- It reads RankPilot's own product field (`$app` namespace), so there is no namespace setting.
- Each question shows as an expandable row.
- It outputs exactly one `FAQPage` in the page HTML, written in Liquid, so crawlers that don't run JavaScript can read it.
- It renders nothing for a product without FAQs.

Settings:

- heading text;
- open the first question;
- optional text and background colours.

Shopify doesn't allow colour-scheme settings in app blocks, so the block uses the section's colour scheme by default.

The "RankPilot schema" embed no longer renders FAQs or adds `FAQPage` with JavaScript. Its namespace setting is gone. With the embed and the block both on, FAQs show once, from the block.

### R22-103 "FAQs that aren't on your store"

The dashboard banner reads "N products have FAQs that aren't on your store". It says how many products need their answers reviewed first, and has a button that opens the theme editor at the product template with the block ready to add.

This uses the live page HTML, not the theme files, because reading theme files would need a new `read_themes` permission. Every audit re-checks the live pages. If a newly published theme drops the block, the warning comes back.

### R22-104 FAQ changes verified on the live page

After an FAQ change is saved, the worker fetches the live product page. It looks for the block and every question, at 20 s, and again after 2 and 4 minutes if the storefront is still catching up.

The change then reads either:

- **Applied and verified**, or
- **Saved, not live**, with the reason.

The agent API's `verified` is false and `live` is false for "Saved, not live". FAQ changes marked verified before this release are re-checked and re-labelled once after the deploy.

### Deploying the FAQ block (you do this; Render doesn't deploy theme extensions)

1. Run `tools/reconstruct.sh` from the repo root. It builds the full source tree in `rankpilot-app/`, the same way the Dockerfile does.
2. In `rankpilot-app/`, check that `shopify.app.toml` has your live app URL and client ID. `shopify app deploy` also releases the app configuration, so a placeholder URL there would replace the live one. If it is a placeholder, run `shopify app config link` first.
3. Run `shopify app deploy`, logged in to the RankPilot Partner account.
4. Before adding the block, review the corrected FAQ proposals (dashboard banner) and approve or reject them.
5. In the theme editor, duplicate the live theme. On the copy's product template, choose Add block › Apps › RankPilot FAQ, preview a product with FAQs, then publish.
6. Run a store audit. The banner clears once the live pages show the FAQs.

**Rollback:**

- Theme: remove the block.
- FAQ data: Results & history.

## Sprint 2: accuracy and speed

Release marker: `2026-10-01-release-22-s2`.

### R22-202 Single write under 3 seconds

**Measured.** After R22-200, the remaining cost of each write was a full catalogue re-audit run inside every apply and every dashboard or agent action. That was about 1 s of CPU per write on a fast machine, several times longer on Render's shared CPU, plus the Shopify round trips.

**What changed.** Writes now schedule one background re-audit per 20-second window. It runs just after the window closes, so it includes every write made in it.

**Result.** 20 single FAQ writes on a 150-product catalogue: the 95th percentile is well under 3 s. Locally it is about 60 ms, plus Shopify's own write and read-back on the live store. That is an automated test. Findings update a few seconds after a write, through the live refresh.

### R22-105 Duplicate FAQ sources

A `duplicate-faq-source` finding is raised for:

- another app's FAQ data (for example `faqs.settings`) next to RankPilot's FAQs;
- an FAQ section in the description while the block shows the FAQs. "Remove the description FAQ section" prepares a reviewed change that removes it.
- two FAQPage entities on the live page, naming the sources and which to keep;
- RankPilot's questions shown outside the block, for example a stopgap Custom Liquid block reading the same field. RankPilot asks for it to be removed.

### R22-302 Units converted by what they measure

Ounces on a flask, bottle, mug, cup, jug or thermos are a volume: "16oz" becomes "470 ml". "Weighs 16oz" is a weight: "454 g". A unit in the title gets its own title proposal, for example "16oz Thermos Food Flask" → "470ml Thermos Food Flask".

### R22-303 Repeated text counted by its pattern

The product's name is taken out of each sentence, so every product with "What should I check before buying the <product name>?" counts towards one finding. The finding shows the placeholder, not one product's version.

### R22-304 Changed outside ignores formatting

**Reproduced first.** Inline `style="margin:28px 0"` versus `margin: 28px 0` already compared equal. The false alarm came from CSS inside a `<style>` block, which was compared as text. That CSS is now compared without spacing. Real edits still show the two phrases side by side.

### R22-401 Brands not on the list

Brand detection now learns brands from three signals:

- words repeated at the start of store-branded titles ("Betron …" on 3 products);
- handle words repeated across products, or matching a title word elsewhere;
- unusual words at the start of both the title and the handle, words in capitals ("GADLANE"), and vendors already in the store, even later in the handle ("…-outsunny").

Ordinary product words ("Folding", "Portable", "Seagrass") are never brands. Brands you approve become vendors, so they are matched like listed brands afterwards.

**Confidence:**

- **High** confidence goes into the bulk proposal.
- **Medium** confidence is shown as "Possible brand: check", because handles often start with product-line or design names.

**Measured on the Van Life Emporium catalogue** (all 263 store-branded products, `tests/fixtures/vle-store-branded.json`): 36 of 37 brands and 52 of 53 branded products are found. There are no high-confidence proposals for products without a brand, and no wrong brands.

### R22-402 Proposal already pending

A brand finding with a vendor change waiting shows "Proposal pending" and the change to review. `POST /brands` returns `exists` instead of creating a second change. In the agent API, findings carry `pendingChangeId`.

### R22-305 Brand names in capitals

The house-style capitals check allows:

- the product's vendor;
- the brand in its title;
- every vendor already in the store (approved brands);
- listed brands;
- brands in pending vendor proposals.

So "NETGEAR" and "AFERIY" are no longer flagged.

## Sprint 3: better suggestions

Release marker: `2026-10-01-release-22-s3`.

### R22-301 Every product template sampled

**Reported page checked first.** These checks used the Shopify Admin API (read-only) and the live theme:

- `/products/led-camping-lantern-power-bank` uses the default product template (no template suffix).
- The live theme's main product section outputs `{{ product | structured_data }}` without a condition, so the default template does output Product data.

The live HTML can't be fetched from the build environment, because the storefront is blocked there. The deployed audit fetches it, as described below.

**What changed:**

- The rendered-page sample now fetches one product per product template in use before the rest, so an alternate template is never skipped by the crawl limit.
- Products now carry their template suffix.
- `product-schema-missing` names the template the page uses (for example "product.bundle").

### R22-501 Redirects match the product type

- When a sync deletes a product or collection, its handle, title and product type are kept (the last 1,000).
- A dead product is redirected only to a live product **of the same type**, or to a collection. A picnic table is never sent to a camping toilet.
- A dead collection is redirected only to a collection.
- When a product and a collection score the same, the collection is suggested.
- When nothing shares the type or a search term, the finding says to leave the 404.

### R22-503 What a missing search term is

The "title missing search terms" finding now says whether each missing word is:

- the brand;
- a model name or number;
- a description ("stainless steel" is a description, not a brand or model).

The example title:

- keeps the brand first;
- converts units by what they measure;
- puts the words where the search has them, for example "Thermos 470ml Stainless Steel Food Flask";
- never starts with a bracket.

### R22-504 Book suggestions

Open Library candidates must:

- share most of the book's significant title words;
- be from 1980 or later.

So "In Morocco" (1920) is no longer offered for "Morocco – A Vanlife Guide". The result says no confident match was found. Each candidate shows its author, year and cover, so you can pick between editions (Ulysses Press or Pavilion Books).

### R22-505 Every image's alt text checked

Generate alt text now also rewrites alts that are:

- keyword-stuffed, image 1 included ("20L Cool Box, Ice Box, Large Cool Box, …");
- in capitals ("FALCON round Pie Dish White 26CM");
- generic ("Product image 3").

The model reports whether a van, campsite or outdoor scene is actually visible. Otherwise phrases such as "in a van-life setting" are removed. Alts are written in sentence case, and acronyms such as LED and USB are kept.

### R22-601 Questions by product type

Readiness only asks the questions that fit the product type:

| Product | Material and care asked? | Power asked? | Battery or sensor life asked? |
|---|---|---|---|
| Safety device (CO, smoke or gas alarm, detector, fire extinguisher) | No | Yes | Yes |
| Electrical product | Yes | Yes | No |

For tents, sleeping bags and other camping gear, the fit question is "What is the packed size?", and FAQ suggestions use a packed or folded size.

### R22-602 Live FAQ answers count

RankPilot FAQ answers count towards answer readiness once they are on the live page. They don't count while the FAQ change reads "Saved, not live", or while the live theme has no FAQ block. So the score rises when the block is added.

### R22-403 Confirm a brand once

On a brand finding, "Confirm “Polarbox” for every product that names it" does three things:

1. It remembers the brand. From the next audit it is matched like a listed brand and allowed in capitals.
2. It creates a pending vendor change for every product that names the brand but lists the store (or no brand) as its vendor.
3. It shows smart-collection warnings in the result and in each change, before anything is approved.

Confirming again creates no duplicates. The same action is available to the agent as `POST /api/agent/confirm-brand`.

## Sprint 4: bulk content and polish

Release marker: `2026-10-01-release-22`.

### R22-204 Alerts for restarts and server errors

The process that starts the web app and the worker (`scripts/start.mjs`) now watches both:

- **Server errors.** More than 3 responses with a 5xx status within 5 minutes raises one alert. The alert lists the failing routes with their counts and the first and latest times. It then waits 15 minutes before alerting again.
- **Restarts outside a deploy.** A small state file next to the database (`/data/rankpilot-monitor.json`) records the code version, the last time the app was seen running and the last 30 log lines (health checks left out). Three cases raise an alert, with the time and the last log lines:
  - a web or worker process stops on its own, for example a crash or running out of memory: the alert goes out straight away;
  - the app starts after a stop that wasn't a normal shutdown;
  - the app restarts with the same code. A manual redeploy of the same commit is reported too, and labelled as such.

  A normal deploy (new commit, clean shutdown) raises nothing.

**Where alerts go:**

- Always: an error-level log line starting `RankPilot ALERT`.
- To get them on your phone or in chat, set **`ALERT_WEBHOOK_URL`** in the Render environment to a Slack, Discord or Teams incoming webhook, or any URL that accepts a JSON POST. The body has `text` (Slack), `content` (Discord) and the full `alert`.

Until that variable is set, alerts only appear in the Render logs.

Checked locally against the production build: a killed worker sent an alert to a test webhook, with the cause and the last log lines. The restart after it didn't send a second one. A same-code restart was reported, and a new-commit start was not.

### R22-306 Index coverage smoothed

Each Google index check keeps its result. The Store Score's "Inspected Google index coverage" uses the average of the last 3 checks. For example, 70% then 60% gives 65%, not a 10-point drop. The label shows how many pages were inspected, for example "(20 pages inspected, average of the last 3 checks)".

### R22-603 Rewrite a repeated template in reviewed batches

On a "Same text on many products" finding, **"Rewrite on the next 25 pages (most-viewed first)"** prepares a product-specific replacement for each page:

- A template question ("What should I check before buying the <product name>?") and its answer paragraph are replaced by a question this product's facts answer, with the fact as the answer. For example, "How big is it? 52 x 50 x 66 cm" or "How much weight does it hold? 145 kg". Every answer passes the R22-502 rules.
- Each change quotes the fact it used and its source, and says how many Google impressions the page had.
- A page with no usable fact only has the template text removed, and the change says so. Nothing is made up.
- Pages Google shows most come first.
- Running it again moves on to the next 25. Pages with a description change already waiting are skipped.

Nothing is published until you approve each change, and every change can be undone in Results & history. The agent can do the same with `POST /api/agent/template-rewrite`.

### R22-604 Unpublished guides that still get impressions

The finding offers two one-click fixes:

- **Republish:** for pages and blog posts. It is logged and undoable: undo unpublishes the page again. Products are republished in Shopify admin, because RankPilot doesn't request the publications permission.
- **Redirect to the closest live guide:** a dead blog post or page is now matched against live guides and collections.

The finding also lists details that may have gone out of date while the page was unpublished, to check before republishing: past years, prices, opening times, "currently".

### R22-701 Findings in progress

A finding with a matching change already waiting is shown under **In progress**, not with the open findings:

- **Redirect pending**, for a 404 or unpublished page with a redirect waiting;
- **Proposal pending**, for any other change waiting.

Each row has Approve, Reject and Review buttons. These findings are left out of the open findings count. In the agent API, items carry `status` and `pendingChangeId`, and each group has `openPages`.

### R22-702 Book screen

"Find publisher and ISBN" now shows the product photo next to each matching edition's cover. Each edition has its author, publisher, year and ISBN, and a "Use this edition" button. Saving still needs the "This is the edition I sell" box ticked, and then creates pending vendor and barcode changes.

### R22-703 Redirected pages

When a page's address redirects elsewhere, only its "Page address redirects elsewhere" finding is kept. Thin content and other findings for that page are dropped.

## Comparing with the 1 October review

| Measure | 1 Oct review | After release 22 |
|---|---|---|
| Saved FAQs on the live page | 0 of 17 | Checked on every audit. They show once the RankPilot FAQ block is added (theme step above), after the corrected answers are reviewed. |
| Saved FAQ answers that use the wrong fact | "204 kg" found | All saved answers are re-checked; wrong ones become pending corrections. New suggestions use one rule set. |
| Database busy or 5xx during a review | 9 | Cause reproduced and fixed (R22-200). WAL is on in production for both processes. Retries cover the rest, and 5xx bursts now alert. |
| Single write, 95th percentile | Up to 20 s | Re-audit moved out of the write: about 60 ms locally, plus Shopify's own write and read-back. |
| Store-branded products (brands found) | 263 | 52 of 53 branded products, 36 of 37 brands, with no wrong high-confidence proposals. Confirm-brand-once covers the rest in one click per brand. |

The review score itself needs a fresh store audit and review on the live app. Run an audit after this deploy and after adding the FAQ block.

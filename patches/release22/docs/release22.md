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

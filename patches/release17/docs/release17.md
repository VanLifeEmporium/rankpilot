# Release 17

Folds the proposed release 16 (heading repair) into a wider release that makes RankPilot's view of the live store accurate, cuts noisy findings, and extends the agent workspace.

## Accuracy

- **Storefront title check** (`served-title-mismatch`): the crawl compares the `<title>` the storefront serves with the Shopify SEO title, allowing for the " – {shop name}" suffix Dawn adds. A mismatch means a market-specific title, a translation or theme code is overriding the SEO title, so RankPilot edits will not show. Found on the live store for pages such as the Indoor / Outdoor Rug.
- **Changed outside RankPilot** (`changed-outside`): after each sync, fields whose newest RankPilot change was applied but no longer match Shopify are flagged with both values. RankPilot never overwrites them.
- **Redirects**: the crawl records redirect chains. A catalogue page that redirects to the home page is flagged `redirects-home` (soft 404) instead of the misleading "canonical differs"; other redirects are `redirected`. A path that currently redirects home can now be re-pointed with the redirect tool.
- **Unpublished products**: an active product with no Online Store URL is treated as unpublished and is no longer crawled as a live page.
- **History hygiene**: failed, conflicted and unconfirmed changes that a later applied change replaced are marked superseded after each audit, and on demand ("Clear failed items…" in Results & history). Rows that did not save and conflicts can be dismissed; unconfirmed saves are re-read instead, because they are probably live.

## Noise removed

- Shopify's own nofollow links (customer login, "Powered by Shopify") are no longer reported on every page.
- Products that already answer questions under an FAQ heading in the description are not flagged "Answer customer questions".
- Source image dimensions are no longer flagged; Shopify's CDN serves resized images.
- The crawl spaces requests (400 ms, `CRAWL_SPACING_MS`), retries 429/503 three times, and times only the final attempt, so back-off waits are not reported as slow pages.
- The long-title finding explains when the theme's store-name suffix is what makes the title long.

## Heading repair (from release 16, hardened)

- Only heading tags are rewritten, in place; the rest of the HTML is untouched (release 16 re-serialised the whole body, adding empty paragraphs and `<tbody>` to messy HTML).
- Empty headings become paragraphs and are ignored when working out levels.
- Unclosed or badly nested headings are left alone and reported.
- Busy check, de-duplicated ids, and pending description/link previews are superseded so an older preview cannot undo the repair.

## Agent workspace

- Links are single use; access can be switched off per store; "Revoke all agent sessions" signs out every session and cancels unused links.
- Writes default to `dryRun: true` (SEO now matches headings).
- New: `POST description`, `POST redirects`, `POST dismiss`, `GET readiness` (go-live check for Store Operations, by Shopify GID), `GET opportunities` (Search Console pages at positions 8–20).
- `POST recheck-pages` runs as a background job and refreshes the Store Score; results appear in `GET jobs`.
- `GET lookup` accepts full URLs, trailing slashes, capitals, locale prefixes and `/collections/x/products/y`.
- `GET pages?full=1` includes the body HTML; `seoLengths.servedTitle` shows the length Google sees.

## Not in this release

- Reading market-specific SEO titles through the Admin API (needs the translations and markets scopes). The storefront check finds the pages; the override is removed in Shopify.
- Collection consolidation helper and the AI-answers breakdown. The new description and redirect endpoints cover the consolidation work through the agent in the meantime.

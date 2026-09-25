# RankPilot workflow 6 — merchant feedback corrections

## Save and verify
- Retry delayed read-back twice (250 ms and 750 ms), without repeating the write.
- Compare display-equivalent SEO metadata (entities, Unicode NFC and whitespace), retaining punctuation, case and numbers.
- Add a read-only Verify in Shopify action for accepted page/product changes, including previous false failures and conflicts. Matching live fields reconcile status, audit and applied count without another mutation.
- A true mismatch remains visible and is never reported as applied.

## Workflow and interface
- Stable lightweight polling runs independently of fetcher transitions; checks on returning to the tab and detects jobs missed between loader snapshots.
- Finding filters are URL-backed and survive revalidation and reload.
- Ready-to-accept totals exclude blocked previews. Review views separate ready, needs attention, generating and history.
- Keep old drafts until a replacement exists. Failed generation preserves the previous proposal. Modal progress identifies replacement generation.
- Friendly status labels; unavailable fact metrics display a dash rather than a malformed percentage.

## Content and facts
- Separate brand-story, editorial, product and information-page guidance. Preserve narrative and original details.
- Supplier wording check is low-confidence, requires multiple signals, and only applies to products/collections.
- Store-configurable brand suffix; all generated search titles still have a total maximum of five words AND 60 characters.
- CSV import with header mapping instructions, exact handle matching, sources, preview, validation and transactional rechecking. Never overwrites confirmed facts; all imported suggestions remain unconfirmed.

## Validation
174 automated tests passed, including delayed read-back, true mismatch, read-only recovery of an accepted live save, replacement failure, protected facts and malformed CSV. Typecheck, lint and production build passed.
Local demo-browser tests cover filtering/reload, polling completion, sourced CSV preview/import, metric rendering, and saving title preferences. This is not authenticated live Shopify testing.

## Limits
The exact production Voyager response has not been captured. The correction covers delayed/display-equivalent reads and allows safe reconciliation; an unrelated mismatch still needs its actual response diagnosed. External Shopify latency cannot be guaranteed below five seconds. No existing live content or unreviewed proposals were bulk-applied. Supplier feeds must be exported/mapped to CSV; direct feed connectors are not included. Autopilot remains off.

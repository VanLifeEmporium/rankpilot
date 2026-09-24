# Workflow 5 — 24 September 2026

Repair the audit → generate → review → accept/reject → verified Shopify update workflow.

- Accepted changes run independently of slow generation, with a durable immediate apply attempt, faster status refresh and worker health checks.
- Saved proposals are validated. Titles are limited to five words/60 characters; legacy repair cannot certify an unreviewed description.
- Rejected/obsolete proposals and failed generation can be retried explicitly. FAQ policy inputs invalidate dependent previews. Completed image descriptions are cached.
- Shopify writes are read back before Applied. Changes to the same resource are serialized and newer edits are protected.
- Blog generation creates a local preview; acceptance creates a verified unpublished Shopify draft.
- Exports use embedded authentication. Related links are idempotent. Reporting distinguishes rolled-back changes and preserves analytics failures.
- Each section and its panels explain their purpose, importance and use. Connection forms are separate by provider and saved keys are concealed. Product facts can be suggested from labelled existing product information for review.
- Catalogue responses are compact and completed history is paginated. All active jobs remain visible.
- Autopilot stays disabled. Webhooks only sync; weekly scheduling does not implicitly run paid AI visibility.

Validation: 159 tests passed, plus TypeScript, lint, production build, clean SQLite migration and local Liquid/schema checks. Local HTTP checks returned 200 for all nine pages and worker health. One-item approval timing was approximately 1.08 seconds with 350 ms simulated Shopify responses while generation was blocked. This is not a live-store timing guarantee.

Remaining acceptance: authenticated Shopify interactions and actual approval latency. Shopify throttling, slow responses and multi-image batches can exceed five seconds. Existing duplicates produced by other theme/apps require source-specific repair; the app explains that boundary.

Deployment adds GenerationCache through Prisma migrations and preserves existing data. Keep the persistent /data volume. This release does not modify live theme files or storefront content.

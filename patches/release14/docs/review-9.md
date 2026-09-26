# Review and usability release 9 — 25 September 2026

## Changes

- Dashboard priority actions open a focused fix arena without navigation. A ready proposal shows the shared `ChangeReview` component, with Before/After, visible rationale, explicit Accept/Reject and persistent decision controls.
- Review ready fixes opens the first ready preview immediately; Next/Previous and a selector move through the captured queue. Empty queues explain the next step. Batch review remains available separately.
- Findings without a prepared change show the source evidence and next action. Missing addresses can prepare a redirect and review it in the same arena, or remove an imported address from tracking. Unsupported theme edits remain explicitly manual; no invented auto-fix or deletion of Shopify resources.
- Catalogue generation has its own request state, inline receipt/progress/error feedback, duplicate-submit protection while running, automatic single-preview opening and a route to review multiple results.
- Catalogue row rendering is memoized, with cached payloads/issue counts, functional selection updates and lazy images with fixed dimensions. Browser coverage includes more than 320 products.
- Product details has a bounded scrolling body and always-visible Save/Cancel; submissions retain scroll position.
- Brand voice has an explicit accessible label, editable-field guidance and a larger writing area. Input rejection was not reproduced locally; typing, persistence during polling, saving and reload are covered rather than claiming an unproven root cause.
- Google search clicks and search-engine sessions explicitly identify different measurements and sources. Query rows show clicks, impressions and calculated click rate, preserving true zeros, tiny positive rates and unavailable values. No live Search Console data was altered or fabricated.
- Title guidance explicitly says up to five words, max 60 characters, including suffixes.

## Verification and boundaries

Run TypeScript, ESLint, Vitest, production build and `tests/feedback-ui.mjs`.
Browser regression uses an isolated local database, demo writes and a controlled embedded-frame authentication fixture. No live Shopify product edits or API charges are part of the test.

The Shopify App Home validator cannot resolve its virtual `preact/jsx-runtime`; its bundled script also requires host dependencies. The existing app uses React. Project TypeScript/build and browser tests are the verification gates; this is not a claim of Built for Shopify certification.

Production release marker: `2026-09-25-review-9`. Deployment must confirm app/database and worker health at `/health?worker=1`.

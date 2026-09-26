# Workflow 7 — retest corrections and merchant guidance

## Scope

The merchant verified five workflow-6 fixes and reported three remaining defects: product SEO verification disagreed with saved Shopify fields, generation completion required a refresh, and finding filters reverted in the embedded app. Additional merchant testing asked for outcome-led language, fewer decisions and automatic confirmation.

## Changes

- Product and collection reads explicitly request global title_tag and description_tag. Stored values take precedence independently, including empty values. The successful product write mutation is unchanged. Articles retain their existing metadata path. Public Shopify GraphQL schema validation passed for the metadata query.
- Acknowledged writes enter a read-only confirmation phase before readback. Bounded background retries cannot repeat the mutation. Old failed confirmations receive one read-only recovery pass. Verified results update the resource, audit and applied count; genuine mismatches stay unresolved and expose exact accepted/saved fields when requested.
- Native authenticated JSON polling obtains a fresh App Bridge token, checks response type, times out and recovers automatically. Completed jobs load a fresh workspace snapshot without depending on router revalidation. No visibility gate suppresses polling inside a frame.
- Filters use local state and preserve the URL without triggering authenticated navigation. Background refresh cannot reset the selected filter.
- Plain-language feature, metric, navigation and section labels; Google result preview precedes optional exact-field details; confirmed results explain Google controls its own refresh schedule.
- Small priority list excludes subjective wording/short-content suggestions. Existing original brand-story protection remains. Wording suggestions are explicitly optional and low confidence.
- Grouped approval for up to 25 ready Google-listing or image-description proposals, one per page. An explicit checkbox authorizes the exact displayed set; changed/stale/blocked drafts are rejected server-side. Individual undo remains available.
- Search reporting describes clicks and compares consecutive periods without claiming unique visitors or causation. Product-details guidance emphasises checked facts and the existing supplier CSV import, which never marks imported facts as verified automatically.

## Verification and limits

Unit/integration tests cover product-versus-article read paths, display normalization, true mismatches, idempotent reconciliation, bounded read-only retries, stale batch approval, token refresh and invalid JSON/login responses. Browser regression exercises filtering, background completion, CSV confirmation rules, review counts and a simulated iframe with token-required polling, a temporary outage, and automatic generation completion.

These are controlled local tests, not an authenticated production Shopify session. Access to the live Shopify admin remains blocked by its sign-in challenge. The precise historical product response cannot be inspected from here; explicit stored-field reads address the identified resource-path difference and exact-field diagnostics make remaining discrepancies observable. Do not claim a production merchant workflow has been personally verified or guarantee Shopify response times.

Deployment: append release7 overlays after release6 in the existing Docker build. No schema migration, provider generation request or bulk merchant approval is performed by deployment. Release health marker: 2026-09-25-workflow-7.1.

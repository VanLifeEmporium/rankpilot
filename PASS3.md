# Section guidance, facts assistance and responsive status

Every navigation section has an expandable purpose and usage guide. Existing invalid title proposals are visibly blocked and offer explicit regeneration. Facts can be suggested from labelled table rows and description paragraphs/list items; no provider call is made. Suggestions fill only empty inputs, include source labels and remain unconfirmed. Saving errors leave the form visible.

Progress polling now uses an authenticated, store-scoped resource route with compact job revisions, rather than reloading the entire catalogue every five seconds. A changed status or processed-item count causes a full refresh. Hidden tabs do not poll. This reduces unnecessary response payloads; no authenticated production timings have been measured.

Validation: complete 125-test suite passed, then three added fact/guidance/revision regressions passed in the nine-test finding suite. Typecheck and production build passed. Autopilot remains off. Release marker: 2026-09-24-workflow-3. Actual accepted store changes remain unverified in this session.

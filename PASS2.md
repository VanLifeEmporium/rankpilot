# Approval, navigation and latency update

Accepted writes and rollbacks have priority over generation. Generation yields after each resource and checkpoints results, allowing accepted writes to run between resources. An in-flight provider request is not cancelled. Titles must contain at most five whitespace-separated words and 60 characters. This applies to proposed visible titles and SEO titles at generation/approval/application boundaries. Existing long proposals require regeneration. Short deterministic title cleanups remain free; longer title rewrites use source-reviewed generation.

Review & apply is a dedicated route with all proposal states. Navigation labels and page explanations describe their purpose. SEO previews distinguish search metadata from the visible title. Non-report routes fetch only the latest audit instead of twelve complete audit histories. Polling pauses in hidden tabs and uses a five-second interval. Batch messages report processed counts.

123 tests passed in the complete suite; two further queue regressions passed in the 22-test workflow suite. Typecheck and production build passed. No paid generation calls used. Production approval of user content and actual latency improvements have not been measured in an authenticated session. Do not claim all live failures are resolved. Autopilot remains off. Release header: 2026-09-24-workflow-2.

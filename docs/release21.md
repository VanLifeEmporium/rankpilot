# Release 21: scoring and suggestion accuracy

Checked against the live Van Life Emporium catalogue (319 products, 10 collections, 4 pages, 25 articles) before and after.

## Scoring
- Every published page now has the same 7 scored checks (title, description, content, images, uniqueness, product data, house style) and fails each at most once. Previously each warning was one failure against a fixed 7 checks, so one bad page could use up clean pages' checks.
- Title and summary checks use what Google receives: the saved SEO value, or Shopify's fallback (page title; start of the page text). An empty SEO field with a usable fallback is a notice, not a failed check. Duplicates compare these effective values, case-insensitively.
- Drafts no longer make a live page a "duplicate".
- One set of limits: title over 60 characters, summary under 70 or over 160. New `short-meta-description` warning.
- Thin content by page type: products 80 words, collections 50, pages 80, articles 300. About, FAQ, delivery and refund pages count as utility pages.
- A recheck keeps the rendered-page checks from the last full scan, so the score no longer jumps after "Recheck". Both paths use `combinedScore` (failures capped at checks; nothing measured is null).

## Answer readiness
- "What's included" no longer matches "including" (every product matched it through the delivery line). "Care" no longer matches "we care"; "material" no longer matches "packs down".
- On this store answer readiness moves from 55 to 39. This is a correction: 245 products don't say what comes in the box.

## Schema
- Collections need BreadcrumbList, ItemList or CollectionPage (any one, not all three).
- The home page needs Organization or WebSite.
- Articles accept BlogPosting.
- The AI crawler list adds Claude-SearchBot, Claude-User and Applebot-Extended.

## Suggestions
- Findings name the failing value: the effective title and its length, the fallback summary Google sees, the word count against the limit, and how many images lack alt text.

import type { LoaderFunctionArgs } from "react-router";
import { agentContext, exchange, overview, findings } from "../core/agent.server";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const page = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>RankPilot agent workspace</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#1a3d2b;background:#fbfaf6}code,pre{background:#eef1ea;padding:2px 4px;border-radius:4px}pre{padding:12px;overflow:auto}h1{font-size:22px}li{margin:2px 0}</style></head><body>${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", ...headers } },
  );

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t");
  if (token) {
    try {
      const cookie = await exchange(token);
      // Release 19: a 200 page that then navigates. The next request starts from this origin, so the
      // session cookie is sent even when the link was opened from Shopify admin.
      return page('<h1>Opening the agent workspace…</h1><p><a href="/agent">Continue to the agent workspace</a></p><meta http-equiv="refresh" content="0;url=/agent">', 200, { "Set-Cookie": cookie });
    } catch {
      return page("<h1>Link expired</h1><p>Open a fresh link from RankPilot › Settings › Agent workspace.</p>", 401);
    }
  }
  let store;
  try { ({ store } = await agentContext(request)); } catch (e) {
    if (e instanceof Response) return page(`<h1>Agent workspace</h1><p>${esc(await e.text())}</p>`, e.status);
    throw e;
  }
  const o = await overview(store.id);
  const groups = await findings(store.id);
  const body = `
<h1>RankPilot agent workspace · release ${esc(o.release)}</h1>
<p>Store: ${esc(o.store)} · Latest audit: ${esc(o.audit?.at)} · Catalogue checks ${esc(o.audit?.catalogueChecks)} · Answer readiness ${esc(o.audit?.answerReadiness)}</p>
<p>Session active for up to 2 hours. All writes are logged, verified in Shopify and can be undone in Results &amp; history.</p>
<h2>Change counts</h2><ul>${Object.entries(o.changes).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>
<h2>Open findings</h2>
${groups.map((g) => `<h3>${esc(g.name)} — ${g.openPages} open of ${g.pages} pages <small>(key: ${esc(g.key)})</small></h3><ul>${g.items.slice(0, 200).map((i) => `<li>${esc(i.title)} · <code>${esc(i.resourceId)}</code> · ${esc(i.kind)} · ${esc(i.code)}${"status" in i && i.status ? ` · <strong>${esc(i.status)}</strong>` : ""} · ${esc(i.detail)}</li>`).join("")}</ul>`).join("")}
<h2>API</h2>
<p>Writes are dry runs by default ("dryRun":false to save) and arrive as pending proposals for the merchant unless you send "apply":true. Brand rules and claim checks apply: no "!", sales phrases, capitals for emphasis, 【】, imperial units, invented ratings, certifications, waterproof ratings, barcodes, prices or marketplace links unless they are confirmed facts. Batches return within about 10 seconds; poll GET changes?ids= for anything still applying.</p>
<pre>GET  /api/agent/overview                      store, audit (catalogue checks, answer readiness), Store Score, change counts
GET  /api/agent/findings?group=KEY            open findings by group (snoozed, accepted and unpublished-page findings are left out); changed-outside items carry changeId; items with a proposal or redirect already waiting carry pendingChangeId and status "Proposal pending" or "Redirect pending" (in progress, not open: each group's openPages leaves them out); repeated-template items carry template (use with POST template-rewrite)
GET  /api/agent/pages?kind=product&amp;limit=50&amp;offset=0   {total, offset, limit, hasMore, items}
GET  /api/agent/pages?ids=a,b&amp;full=1          adds html, variants (sku, barcode, price), productFields, confirmedFacts, faqs
GET  /api/agent/changes?status=pending|verified&amp;actor=claude-agent&amp;ids=a,b&amp;limit=100   latest first, as a list
GET  /api/agent/changes … FAQ changes carry "live": true when the questions are in the live page HTML, false when "Saved, not live" (verified is then false)
GET  /api/agent/changes?resourceId=a,b&amp;offset=0&amp;limit=100   one page's changes, paged: {total, offset, limit, hasMore, items}
GET  /api/agent/changes … feature "published" (release 22) is a page or blog post republished from an unpublished-with-impressions finding; undo unpublishes it again. GET /api/agent/book candidates are also saved with the ISBN suggestion (facts.isbn.options: isbn, publisher, year, author, cover)
GET  /api/agent/jobs · /api/agent/settings
GET  /api/agent/lookup?paths=/pages/faq,https://shop/products/x
GET  /api/agent/opportunities?limit=25        live, published, indexable pages at Google positions 8–20; "excluded" lists the rest with a reason
GET  /api/agent/readiness?gids=gid://shopify/Product/1&amp;refresh=1   go-live check (max 50), includes brand rules
GET  /api/agent/spec-coverage                 products with no readable specification
GET  /api/agent/supplier-copy
GET  /api/agent/book?resourceId=a            publisher and ISBN suggestions for a book (description, then Open Library); saved as unconfirmed facts. Open Library candidates must match the title and be from 1980 or later; each has author and cover. Up to 5, or "No confident match" when none fit
POST /api/agent/seo            {"items":[{"resourceId","title","description"}], "dryRun", "apply"}   max 25
POST /api/agent/description    {"items":[{"resourceId","html"}], "dryRun", "apply"}   max 10; articles and pages keep their own layout markup
POST /api/agent/faq            {"items":[{"resourceId","faqs":[{"question","answer"}]}], "dryRun", "apply"}   max 5
POST /api/agent/product        {"items":[{"resourceId","title"?,"vendor"?}], "dryRun", "apply"}   max 10; a new title must keep the brand
POST /api/agent/brands         {"ids"?:[...], "minConfidence"?:"high"}   pending vendor changes from brand-is-store findings, with evidence and smart-collection warnings; a product with a proposal already waiting returns status "exists" (never a duplicate). Medium confidence = possible brand to check
POST /api/agent/confirm-brand  {"brand":"Polarbox"}                  confirm a brand once: it is remembered (matched like a listed brand from the next audit) and every product that names it but lists the store or no brand as vendor gets a pending vendor change, with smart-collection warnings. Returns {brand, results}
POST /api/agent/template-rewrite {"template":"What should I check before buying the <product name>?","size"?:25}   rewrites a repeated-template finding (its "template" field) on the next 25 pages, most Google impressions first. Each pending description change quotes the fact it used; a page with no usable fact only has the repeated text removed (status "removed-only"). Returns {total, inReview, remaining, items}
POST /api/agent/book           {"resourceId","isbn","publisher","editionConfirmed":true}   pending vendor (publisher) and barcode (ISBN) changes
POST /api/agent/headings       {"ids":[...], "dryRun", "apply"}   max 25
POST /api/agent/clean-formatting {"ids":[...], "dryRun", "apply"}   max 20
POST /api/agent/redirects      {"items":[{"path","target"}], "dryRun", "apply"}   max 20
POST /api/agent/approve        {"ids":[...]}   approve pending proposals (max 25). Safe to resend: applied ids report "No change: already applied", failed ones are retried, each failure says why
POST /api/agent/reject         {"stale":true} or {"ids":[...]}
POST /api/agent/undo           {"ids":[changeId,...]}   applied changes only; queued
POST /api/agent/keep-shopify   {"changeIds":[...]}   accept the Shopify value for a changed-outside finding
POST /api/agent/restore        {"changeIds":[...]}   propose RankPilot's applied version again for a changed-outside finding (pending)
POST /api/agent/no-barcode     {"ids":[...], "undo":false}   own-label products with no manufacturer barcode
POST /api/agent/snooze         {"items":[{"resourceId","code","until":"2027-06-01","reason"}]} or {"items":[...], "unsnooze":true}
POST /api/agent/confirm-facts  {"items":[{"resourceId","keys":["weight",...]}]}   after checking the values
POST /api/agent/dismiss        {"stale":true} or {"ids":[...], "reason"}
POST /api/agent/recheck-pages  {"limit":20}   queued; read the result from GET jobs
POST /api/agent/job            {"kind":"audit"|"indexation"|"refresh-audit"|"generate-alt"|"recheck-pages"|"crux","ids":[...]} generate-alt checks every image's alt (empty, duplicate, keyword-stuffed, capitals, generic) and never names a scene the image does not show
POST /api/agent/verify         {"id":"changeId"}
POST /api/agent/supplier-originals {"items":[{"handle","text","source"}]}
Pages with an open changed-outside finding are protected: every write returns status "protected" until it is resolved.
All POSTs need header X-RankPilot-Agent: 1 and JSON body.</pre>`;
  return page(body);
}

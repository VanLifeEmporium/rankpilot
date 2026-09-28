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
      return new Response(null, { status: 302, headers: { Location: "/agent", "Set-Cookie": cookie, "Referrer-Policy": "no-referrer" } });
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
<p>Store: ${esc(o.store)} · Latest audit: ${esc(o.audit?.at)} · SEO score ${esc(o.audit?.score)} · Answer-readiness ${esc(o.audit?.aeoScore)}</p>
<p>Session active for up to 2 hours. All writes are logged, verified in Shopify and can be undone in Results &amp; history.</p>
<h2>Change counts</h2><ul>${Object.entries(o.changes).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul>
<h2>Open findings</h2>
${groups.map((g) => `<h3>${esc(g.name)} — ${g.pages} pages <small>(key: ${esc(g.key)})</small></h3><ul>${g.items.slice(0, 200).map((i) => `<li>${esc(i.title)} · <code>${esc(i.resourceId)}</code> · ${esc(i.kind)} · ${esc(i.code)} · ${esc(i.detail)}</li>`).join("")}</ul>`).join("")}
<h2>API</h2>
<pre>GET  /api/agent/overview
GET  /api/agent/findings?group=google-listings
GET  /api/agent/pages?ids=a,b&amp;full=1   (or ?kind=product&amp;limit=50&amp;offset=0; full=1 adds html)
GET  /api/agent/changes?status=pending&amp;actor=claude-agent&amp;limit=100
GET  /api/agent/jobs · /api/agent/settings
GET  /api/agent/lookup?paths=/pages/faq,https://shop/products/x
GET  /api/agent/opportunities?limit=25   pages at Google positions 8–20, by impressions
GET  /api/agent/readiness?gids=gid://shopify/Product/1&amp;refresh=1   (or ?ids=a,b)   go-live check, max 50
POST /api/agent/seo            {"items":[{"resourceId","title","description"}], "dryRun":true, "apply":true}   max 25
POST /api/agent/description    {"items":[{"resourceId","html"}], "dryRun":true, "apply":true}   max 10
POST /api/agent/headings       {"ids":[...], "dryRun":true}   max 25
POST /api/agent/redirects      {"items":[{"path","target"}], "dryRun":true}   max 20
POST /api/agent/approve        {"ids":[...]}   max 25
POST /api/agent/reject         {"stale":true} or {"ids":[...]}   pending previews only
POST /api/agent/dismiss        {"stale":true} or {"ids":[...], "reason"}   failed, conflicted or pending rows
POST /api/agent/recheck-pages  {"limit":20}   queued; read the result from GET jobs
POST /api/agent/job            {"kind":"audit"|"indexation"|"refresh-audit"|"generate-alt"|"recheck-pages","ids":[...]}
POST /api/agent/verify         {"id":"changeId"}
Writes default to dryRun:true; send "dryRun":false to save.
All POSTs need header X-RankPilot-Agent: 1 and JSON body.</pre>`;
  return page(body);
}

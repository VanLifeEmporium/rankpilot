import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  agentContext, requireAgentWrite, overview, findings, pages, changes, bulkSeo, bulkApprove, bulkReject,
  queueJob, jobs, recheckChange, brandSettings, bulkHeadings, lookup, dismiss, bulkDescription, bulkRedirects, readiness, opportunities,
} from "../core/agent.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
export const ENDPOINTS = [
  "GET overview", "GET findings", "GET pages", "GET changes", "GET jobs", "GET settings", "GET lookup", "GET readiness", "GET opportunities",
  "POST seo", "POST description", "POST headings", "POST redirects", "POST approve", "POST reject", "POST dismiss", "POST recheck-pages", "POST job", "POST verify",
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { store } = await agentContext(request);
  const q = new URL(request.url).searchParams;
  try {
    switch (params.action) {
      case "overview": return json(await overview(store.id));
      case "findings": return json(await findings(store.id, q.get("group") || undefined));
      case "pages": return json(await pages(store.id, { ids: list(q.get("ids")), kind: q.get("kind") || undefined, limit: Number(q.get("limit")) || undefined, offset: Number(q.get("offset")) || undefined, full: q.get("full") === "1" }));
      case "changes": return json(await changes(store.id, { status: q.get("status") || undefined, ids: list(q.get("ids")), limit: Number(q.get("limit")) || undefined, actor: q.get("actor") || undefined }));
      case "jobs": return json(await jobs(store.id));
      case "settings": return json(await brandSettings(store.id));
      case "lookup": return json(await lookup(store.id, list(q.get("paths")) || []));
      case "readiness": return json(await readiness(store.id, { ids: list(q.get("ids")), gids: list(q.get("gids")), refresh: q.get("refresh") === "1" }));
      case "opportunities": return json(await opportunities(store.id, Number(q.get("limit")) || undefined));
      default: return json({ error: "Unknown endpoint", endpoints: ENDPOINTS }, 404);
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    return json({ error: (e as Error).message }, 400);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  requireAgentWrite(request);
  const { store } = await agentContext(request);
  try {
    const body = await request.json().catch(() => ({}));
    switch (params.action) {
      case "seo": return json(await bulkSeo(store.id, body));
      case "description": return json(await bulkDescription(store.id, body));
      case "headings": return json(await bulkHeadings(store.id, body));
      case "redirects": return json(await bulkRedirects(store.id, body));
      case "approve": return json(await bulkApprove(store.id, body));
      case "reject": return json(await bulkReject(store.id, body));
      case "dismiss": return json(await dismiss(store.id, body));
      // Release 17: page rechecks run as a background job; poll GET jobs for the result.
      case "recheck-pages": {
        const b = body as { resourceIds?: string[]; ids?: string[]; limit?: number };
        return json(await queueJob(store.id, { kind: "recheck-pages", ids: b.ids || b.resourceIds, limit: b.limit }));
      }
      case "job": return json(await queueJob(store.id, body));
      case "verify": return json(await recheckChange(store.id, String((body as { id?: string }).id || "")));
      default: return json({ error: "Unknown endpoint", endpoints: ENDPOINTS }, 404);
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    return json({ error: (e as Error).message }, 400);
  }
}

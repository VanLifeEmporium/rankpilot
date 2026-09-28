import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  agentContext, requireAgentWrite, overview, findings, pages, changes, bulkSeo, bulkApprove, bulkReject,
  recheckPages, queueJob, jobs, recheckChange, brandSettings,
} from "../core/agent.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

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
      default: return json({ error: "Unknown endpoint", endpoints: ["overview", "findings", "pages", "changes", "jobs", "settings", "POST seo", "POST approve", "POST reject", "POST recheck-pages", "POST job", "POST verify"] }, 404);
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
      case "approve": return json(await bulkApprove(store.id, body));
      case "reject": return json(await bulkReject(store.id, body));
      case "recheck-pages": return json(await recheckPages(store.id, body));
      case "job": return json(await queueJob(store.id, body));
      case "verify": return json(await recheckChange(store.id, String((body as { id?: string }).id || "")));
      default: return json({ error: "Unknown endpoint" }, 404);
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    return json({ error: (e as Error).message }, 400);
  }
}

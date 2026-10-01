import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  agentContext, requireAgentWrite, overview, findings, pages, changes, bulkSeo, bulkApprove, bulkReject,
  queueJob, jobs, recheckChange, brandSettings, bulkHeadings, lookup, dismiss, bulkDescription, bulkRedirects, readiness, opportunities,
  supplierOriginals, supplierCopy, cleanFormatting, specCoverageReport,
  undoChanges, keepShopifyVersion, noBarcode, AGENT_ACTOR, snoozeFindings, confirmFacts, bulkFaq, bulkProduct,
} from "../core/agent.server";
import { proposeBrands, confirmBrand, suggestBook, applyBook } from "../core/brand-proposals.server";
import { z } from "zod";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 1), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
export const ENDPOINTS = [
  "GET overview", "GET findings", "GET pages", "GET changes", "GET jobs", "GET settings", "GET lookup", "GET readiness", "GET opportunities", "GET supplier-copy", "GET spec-coverage", "GET book",
  "POST seo", "POST description", "POST headings", "POST redirects", "POST approve", "POST reject", "POST dismiss", "POST recheck-pages", "POST job", "POST verify", "POST supplier-originals", "POST clean-formatting", "POST undo", "POST keep-shopify", "POST no-barcode", "POST snooze", "POST confirm-facts", "POST faq", "POST product", "POST brands", "POST book", "POST restore",
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { store } = await agentContext(request);
  const q = new URL(request.url).searchParams;
  try {
    switch (params.action) {
      case "overview": return json(await overview(store.id));
      case "findings": return json(await findings(store.id, q.get("group") || undefined));
      case "pages": return json(await pages(store.id, { ids: list(q.get("ids")), kind: q.get("kind") || undefined, limit: Number(q.get("limit")) || undefined, offset: Number(q.get("offset")) || undefined, full: q.get("full") === "1" }));
      case "changes": return json(await changes(store.id, { status: q.get("status") || undefined, ids: list(q.get("ids")), resourceIds: list(q.get("resourceId")), limit: Number(q.get("limit")) || undefined, offset: q.has("offset") ? Number(q.get("offset")) || 0 : undefined, actor: q.get("actor") || undefined }));
      case "jobs": return json(await jobs(store.id));
      case "settings": return json(await brandSettings(store.id));
      case "lookup": return json(await lookup(store.id, list(q.get("paths")) || []));
      case "readiness": return json(await readiness(store.id, { ids: list(q.get("ids")), gids: list(q.get("gids")), refresh: q.get("refresh") === "1" }));
      case "opportunities": return json(await opportunities(store.id, Number(q.get("limit")) || undefined));
      case "supplier-copy": return json(await supplierCopy(store.id));
      case "spec-coverage": return json(await specCoverageReport(store.id));
      // Release 20 (RP-203): publisher and ISBN suggestions for a book (saved as unconfirmed facts).
      case "book": return json(await suggestBook(store.id, q.get("resourceId") || q.get("id") || ""));
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
      case "supplier-originals": return json(await supplierOriginals(store.id, body));
      case "clean-formatting": return json(await cleanFormatting(store.id, body));
      // Release 19: parity with the merchant UI.
      case "undo": return json(await undoChanges(store.id, body));
      case "keep-shopify": return json(await keepShopifyVersion(store.id, body));
      // Release 20 (RP-103): propose RankPilot's applied version again.
      case "restore": {
        const { restoreRankpilotVersion } = await import("../core/history-hygiene.server");
        const ids = z.object({ changeIds: z.array(z.string()).min(1).max(25) }).parse(body).changeIds;
        const results = [];
        for (const id of ids) {
          try { const c = await restoreRankpilotVersion(store.id, id); results.push({ id, ok: true, status: "pending", changeId: c.change.id, message: c.message }); }
          catch (e) { results.push({ id, ok: false, status: "error", message: (e as Error).message }); }
        }
        return json({ results });
      }
      case "no-barcode": return json(await noBarcode(store.id, body));
      case "snooze": return json(await snoozeFindings(store.id, body));
      case "confirm-facts": return json(await confirmFacts(store.id, body));
      case "faq": return json(await bulkFaq(store.id, body));
      case "product": return json(await bulkProduct(store.id, body));
      // Release 20 (RP-201): pending vendor changes from brand-is-store findings.
      case "brands": {
        const b = z.object({ ids: z.array(z.string()).max(500).optional(), minConfidence: z.enum(["high", "medium"]).optional() }).parse(body);
        return json(await proposeBrands(store.id, { ...b, actor: AGENT_ACTOR }));
      }
      // Release 22 (R22-403): confirm a brand once; pending vendor changes for every product that names it.
      case "confirm-brand": {
        const b = z.object({ brand: z.string().min(2).max(60) }).parse(body);
        return json(await confirmBrand(store.id, { ...b, actor: AGENT_ACTOR }));
      }
      case "book": {
        const b = z.object({ resourceId: z.string().min(1), isbn: z.string(), publisher: z.string(), editionConfirmed: z.boolean() }).parse(body);
        return json(await applyBook(store.id, b.resourceId, { ...b, actor: AGENT_ACTOR }));
      }
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

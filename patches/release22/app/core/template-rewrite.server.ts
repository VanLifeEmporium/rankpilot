import prisma from "../db.server";
import { contentUnits } from "./catalogue-checks";
import { specFacts } from "./spec-extract";
import { normalisePath, resourcePath } from "./page-liveness";
import { rewriteTemplate, templateKey } from "./template-rewrite";
import { log } from "./service.server";
import { friendlyError } from "./db-errors";
import type { Facts, Payload } from "./types";
/**
 * Release 22 (R22-603): rewrite a repeated template across many products as reviewed batches of 25.
 * Pages Google shows most come first. Every proposal quotes the fact it used and waits for approval;
 * pages with a description change already waiting are skipped, so each batch moves on to new pages.
 */
export type TemplateBatchItem = { resourceId: string; title: string; impressions: number; status: "pending" | "removed-only" | "skipped" | "error"; changeId?: string; question?: string; answer?: string; fact?: string; message?: string };
export async function rewriteTemplateBatch(storeId: string, input: { sample: string; size?: number; actor?: string }) {
  const key = templateKey(input.sample);
  const size = Math.max(1, Math.min(25, input.size || 25));
  const { stageChange } = await import("./agent.server");
  const gsc = await prisma.metric.findFirst({ where: { storeId, provider: "gsc" }, orderBy: { period: "desc" } });
  const byPath = new Map<string, number>();
  try { for (const r of (JSON.parse(gsc?.payload || "{}").rows || []) as { keys?: string[]; impressions?: number }[]) { const url = r.keys?.[0]; if (url) byPath.set(normalisePath(url), (byPath.get(normalisePath(url)) || 0) + (r.impressions || 0)); } } catch { /* no search data */ }
  const waiting = new Set((await prisma.change.findMany({ where: { storeId, feature: "description", status: { in: ["pending", "approved", "applying", "verifying"] } }, select: { resourceId: true } })).map((c) => c.resourceId));
  const matches: { id: string; title: string; impressions: number }[] = [];
  let inReview = 0;
  for (let cursor: string | undefined; ;) {
    const page = await prisma.resource.findMany({ where: { storeId, kind: "product" }, orderBy: { id: "asc" }, take: 200, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), select: { id: true, kind: true, handle: true, title: true, payload: true } });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const r of page) {
      let p: Payload; try { p = JSON.parse(r.payload); } catch { continue; }
      if (!contentUnits(p).has(key)) continue;
      if (waiting.has(r.id)) { inReview++; continue; }
      matches.push({ id: r.id, title: r.title, impressions: byPath.get(resourcePath({ ...r, payload: JSON.stringify({ url: p.url }) })) || 0 });
    }
  }
  matches.sort((a, b) => b.impressions - a.impressions || a.title.localeCompare(b.title));
  const total = matches.length + inReview;
  const items: TemplateBatchItem[] = [];
  for (const m of matches.slice(0, size)) {
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id: m.id, storeId } });
      const p: Payload = JSON.parse(r.payload);
      const confirmed = Object.fromEntries(Object.entries(JSON.parse(r.facts || "{}") as Facts).filter(([k, f]) => k !== "barcode" && f?.confirmed && f.value?.trim()));
      const facts: Facts = { ...specFacts(p.descriptionHtml || ""), ...confirmed };
      const rw = rewriteTemplate(p, key, facts);
      if (!rw) { items.push({ ...m, resourceId: m.id, status: "skipped", message: "The repeated text spans formatting here; edit this page by hand." }); continue; }
      const used = rw.fact ? `Fact used: ${rw.fact.key} “${rw.fact.value.slice(0, 160)}” (source: ${rw.fact.source.slice(0, 100)}).` : "";
      const row = await stageChange(storeId, r.id, "description", p.descriptionHtml || "", rw.html, [
        `source-extract-v1: Rewrites the repeated text “${input.sample.slice(0, 160)}” (on ${total} products) for this product.`,
        rw.question ? `Replaces “${rw.removed.slice(0, 160)}” with “${rw.question}” ${rw.answer}` : rw.answer ? `Replaces “${rw.removed.slice(0, 160)}” with “${rw.answer}”` : `Removes “${rw.removed.slice(0, 160)}”: no product fact on this page answers a shopper question, so nothing was made up.`,
        ...(used ? [used] : []),
        `Google impressions (last 28 days): ${m.impressions}. Waits for your approval; undo it in Results & history.`,
      ]);
      items.push({ resourceId: m.id, title: m.title, impressions: m.impressions, status: rw.fact ? "pending" : "removed-only", changeId: row.id, question: rw.question, answer: rw.answer, fact: used || undefined });
    } catch (e) { items.push({ resourceId: m.id, title: m.title, impressions: m.impressions, status: "error", message: friendlyError(e) }); }
  }
  const prepared = items.filter((i) => i.changeId).length;
  await log(storeId, "Template rewrite batch prepared", { sample: input.sample.slice(0, 120), prepared, total, actor: input.actor });
  return { sample: input.sample, total, inReview: inReview + prepared, remaining: Math.max(0, matches.length - size), items };
}

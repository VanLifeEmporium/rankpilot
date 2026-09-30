/**
 * Release 17: keep change history and findings honest about the live store.
 *
 * - settleStaleChanges: failed or conflicted changes that a later applied change has
 *   replaced are marked superseded, so they stop showing as needing attention.
 * - dismissChanges: merchant/agent clean-up of failed, conflicted or pending rows.
 * - driftIssues: pages where Shopify now holds a different value from the last change
 *   RankPilot applied (edited in Shopify admin, another app or an import).
 */
import prisma from "../db.server";
import type { Issue, Payload } from "./types";
import { settings } from "./types";
import { sameContent, contentDiff } from "./content-diff";
import { fieldValue, matchesField, log } from "./service.server";
import { load } from "cheerio";

export const STUCK_STATUSES = ["apply_failed", "conflict", "verification_failed"] as const;
const DRIFT_FEATURES = ["seo", "title", "description", "links", "faq"] as const;
const BODY_FEATURES = ["description", "links"];

/** Mark failed/conflicted rows superseded when a newer change on the same field was applied. */
export async function settleStaleChanges(storeId: string) {
  const stuck = await prisma.change.findMany({ where: { storeId, status: { in: [...STUCK_STATUSES] } } });
  if (!stuck.length) return { settled: 0 };
  const applied = await prisma.change.findMany({
    where: { storeId, status: "applied", resourceId: { in: [...new Set(stuck.map((c) => c.resourceId))] } },
    select: { id: true, resourceId: true, feature: true, createdAt: true },
  });
  let settled = 0;
  for (const row of stuck) {
    const sameField = (f: string) => f === row.feature || (BODY_FEATURES.includes(f) && BODY_FEATURES.includes(row.feature));
    const newer = applied.filter((a) => a.resourceId === row.resourceId && sameField(a.feature) && a.createdAt > row.createdAt).sort((a, b) => +b.createdAt - +a.createdAt)[0];
    if (!newer) continue;
    const done = await prisma.change.updateMany({
      where: { id: row.id, storeId, status: row.status },
      data: { status: "superseded", error: `Replaced by a later applied update (${newer.id}). No action needed.` },
    });
    settled += done.count;
  }
  if (settled) await log(storeId, "Stale change history settled", { settled });
  return { settled };
}

/** Dismiss failed, conflicted or pending rows. Applied changes are never touched. */
export async function dismissChanges(storeId: string, ids: string[], reason: string, actor: string) {
  const rows = await prisma.change.findMany({ where: { storeId, id: { in: ids } } });
  // verification_failed means Shopify acknowledged the write; it is probably live, so it is
  // re-read ("verify") rather than dismissed, which would lose its exact undo.
  const dismissible = ["apply_failed", "conflict", "pending"];
  const allowed = rows.filter((r) => dismissible.includes(r.status));
  const done = allowed.length
    ? await prisma.change.updateMany({
        where: { storeId, id: { in: allowed.map((r) => r.id) }, status: { in: dismissible } },
        data: { status: "superseded", error: `Dismissed by ${actor}: ${reason}` },
      })
    : { count: 0 };
  await log(storeId, "Changes dismissed", { count: done.count, actor, reason });
  return {
    dismissed: done.count,
    skipped: rows.filter((r) => !allowed.includes(r)).map((r) => ({ id: r.id, status: r.status, message: r.status === "verification_failed" ? "This update was sent to Shopify and may be live. Re-read live Shopify values instead of dismissing it." : "Only changes that did not save, conflicts and pending previews can be dismissed." })),
    notFound: ids.filter((id) => !rows.some((r) => r.id === id)),
  };
}

const preview = (feature: string, value: unknown) => {
  if (feature === "seo") {
    const v = value as { title?: string; description?: string };
    return `title “${v?.title || ""}”`;
  }
  if (typeof value === "string") {
    const text = load(value).root().text().replace(/\s+/g, " ").trim();
    return `“${text.slice(0, 90)}${text.length > 90 ? "…" : ""}”`;
  }
  return `${Array.isArray(value) ? value.length : 0} items`;
};

/** Findings for fields that no longer hold the value RankPilot last applied. */
export async function driftIssues(storeId: string, given?: { id: string; title: string; kind?: string; payload: string }[]): Promise<Issue[]> {
  // Newer rows that may have written (verification_failed, apply_failed) or are about to write
  // make an older applied row stale, so they are read too and win the "newest" slot.
  const changes = await prisma.change.findMany({
    where: { storeId, feature: { in: [...DRIFT_FEATURES, "alt"] }, status: { in: ["applied", "rollback_failed", "pending", "approved", "applying", "verifying", "verification_failed", "apply_failed", "rolling_back"] } },
    orderBy: { createdAt: "desc" },
  });
  // Release 19: without a list, read only the pages that have changes, not the whole store.
  const resources = given || (await prisma.resource.findMany({ where: { storeId, id: { in: [...new Set(changes.map((c) => c.resourceId))] } }, select: { id: true, title: true, kind: true, payload: true } }));
  const byId = new Map(resources.map((r) => [r.id, r]));
  const seen = new Set<string>();
  // Release 18: "Keep Shopify's version" records acceptance of the current Shopify value for that change.
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } });
  const kept = settings(store?.settings || "{}").keptShopify || {};
  const issues: Issue[] = [];
  for (const c of changes) {
    const kind = byId.get(c.resourceId)?.kind;
    // Alt text on pages and articles is written into the body, so it counts as a body edit there.
    const inBody = BODY_FEATURES.includes(c.feature) || (c.feature === "alt" && (kind === "page" || kind === "article"));
    const group = inBody ? "body" : c.feature;
    const key = c.resourceId + ":" + group;
    if (seen.has(key)) continue;
    seen.add(key);
    // Only the newest change per field counts, and only once it has been applied.
    // Release 19: a failed undo leaves RankPilot's value as the last applied one.
    if (!["applied", "rollback_failed"].includes(c.status) || c.feature === "alt") continue;
    const r = byId.get(c.resourceId);
    if (!r) continue;
    const p: Payload = JSON.parse(r.payload);
    const expected = JSON.parse(c.after);
    const actual = fieldValue(p, c.feature);
    if (matchesField(actual, expected, c.feature)) continue;
    // Release 20 (RP-103): formatting-only differences (Shopify's editor rewriting the HTML) are not edits.
    const body = ["description", "links"].includes(c.feature) && typeof actual === "string" && typeof expected === "string";
    if (body && sameContent(actual as string, expected as string)) continue;
    if (kept[c.id]) continue;
    const field = c.feature === "seo" ? "Google title and summary" : c.feature === "title" ? "page title" : c.feature === "faq" ? "FAQ answers" : "page description";
    issues.push({
      resourceId: r.id,
      title: r.title,
      code: "changed-outside",
      changeId: c.id,
      severity: "warning",
      feature: c.feature === "links" ? "description" : (c.feature as Issue["feature"]),
      detail: `RankPilot applied this ${field} on ${(c.appliedAt || c.createdAt).toISOString().slice(0, 10)}, but Shopify now holds a different value: ${preview(c.feature, actual)} instead of ${preview(c.feature, expected)}. It was edited in Shopify admin, by another app or by an import. Keep Shopify's version, or restore RankPilot's; RankPilot will not overwrite it on its own.`,
      diff: body ? contentDiff(expected as string, actual as string) : { rankpilot: preview(c.feature, expected), shopify: preview(c.feature, actual), linksRemoved: [], linksAdded: [] },
    });
  }
  return issues;
}

/**
 * Release 20 (RP-103): offer RankPilot's applied value again as a normal proposal. Nothing is written
 * until the merchant approves it; the approval re-checks the live value first.
 */
export async function restoreRankpilotVersion(storeId: string, changeId: string) {
  const c = await prisma.change.findFirstOrThrow({ where: { id: changeId, storeId, status: { in: ["applied", "rollback_failed"] } } });
  const r = await prisma.resource.findFirstOrThrow({ where: { id: c.resourceId, storeId } });
  const current = fieldValue(JSON.parse(r.payload) as Payload, c.feature);
  const open = await prisma.change.findFirst({ where: { storeId, resourceId: r.id, feature: c.feature, status: { in: ["pending", "approved", "applying", "verifying"] } } });
  if (open) return { change: open, message: "A proposal for this field is already waiting for review." };
  const change = await prisma.change.create({ data: { storeId, resourceId: r.id, feature: c.feature, before: JSON.stringify(current), after: c.after, reasons: JSON.stringify([`merchant-reviewed-v1: Restores the version RankPilot applied on ${(c.appliedAt || c.createdAt).toISOString().slice(0, 10)}, after it was changed in Shopify. Check the before and after, then approve.`]) } });
  await log(storeId, "Restore of RankPilot version proposed", { changeId, proposal: change.id });
  return { change, message: "Restore prepared for review. Nothing changes in Shopify until you approve it." };
}

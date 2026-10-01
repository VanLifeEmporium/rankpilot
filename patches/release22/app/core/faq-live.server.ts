import prisma from "../db.server";
import { faqOnPage, SAVED_NOT_LIVE, type FaqPageCheck } from "./faq-live";
import { correctedFaqs, type FaqItem } from "./faq-facts";
import { specFacts } from "./spec-extract";
import { settings, type Facts, type Issue, type Payload } from "./types";
import { log, enqueue } from "./service.server";
import { withDbRetry } from "./db-retry";
/**
 * Release 22 (R22-103, R22-104, R22-106): FAQ changes are verified on the live product page, the
 * store-wide "FAQs aren't on your store" status is kept for the dashboard, and saved answers are
 * re-checked with the fact rules before the block goes live.
 */
export type Fetcher = (url: string) => Promise<string | null>;
export const storefrontFetcher = (domain: string): Fetcher => async (url) => {
  const { publicFetch, limitedText } = await import("./crawl.server");
  const res = await publicFetch(new URL(new URL(url, domain).pathname, domain).href, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) { await res.body?.cancel(); return null; }
  return limitedText(res, 3_000_000);
};
const productUrl = (domain: string, r: { handle: string }, p: Payload) => p.url || `${domain.replace(/\/$/, "")}/products/${r.handle}`;
async function fetcherFor(storeId: string, override?: Fetcher | null) {
  if (override !== undefined) return override;
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { demo: true, domain: true } });
  return store.demo ? null : storefrontFetcher(store.domain);
}

/** Check one applied FAQ change on the live page and label it "Verified" or "Saved, not live". */
export async function checkFaqChange(storeId: string, changeId: string, fetcher?: Fetcher | null): Promise<(FaqPageCheck & { status: string }) | null> {
  const change = await prisma.change.findFirst({ where: { id: changeId, storeId, feature: "faq", status: "applied" } });
  if (!change) return null;
  const fetch = await fetcherFor(storeId, fetcher);
  if (!fetch) return null;
  const [r, store] = await Promise.all([prisma.resource.findFirstOrThrow({ where: { id: change.resourceId, storeId } }), prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { domain: true } })]);
  const faqs = (JSON.parse(change.after) as FaqItem[]).filter((f) => f?.question && f?.answer);
  const html = await fetch(productUrl(store.domain, r, JSON.parse(r.payload)));
  const check: FaqPageCheck = html ? faqOnPage(html, faqs) : { block: false, missing: faqs.map((f) => f.question), live: false, faqPages: 0, sources: [] };
  const error = check.live
    ? null
    : `${SAVED_NOT_LIVE}: ${!html ? "the product page could not be loaded" : !check.block ? "the RankPilot FAQ block is not on the live product template" : `${check.missing.length} of ${faqs.length} questions are not in the page HTML yet`} (checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC).`;
  await withDbRetry(() => prisma.change.updateMany({ where: { id: change.id, status: "applied" }, data: { error } }));
  return { ...check, status: check.live ? "Verified" : SAVED_NOT_LIVE };
}

/** Queue a live check shortly after an FAQ apply (the storefront can lag the admin by a few seconds). */
export async function queueFaqLiveCheck(storeId: string, changeId: string, attempt = 0, delayMs = 20000) {
  const job = await enqueue(storeId, "faq-live", { changeId, attempt }, `${changeId}:${attempt}`);
  await prisma.job.updateMany({ where: { id: job.id, status: "queued" }, data: { runAt: new Date(Date.now() + delayMs) } });
}
/** The faq-live job: check, and look again twice more if the block is there but the page has not caught up. */
export async function runFaqLiveJob(storeId: string, payload: { changeId: string; attempt?: number }) {
  const result = await checkFaqChange(storeId, payload.changeId);
  if (result && !result.live && result.block && (payload.attempt || 0) < 2) await queueFaqLiveCheck(storeId, payload.changeId, (payload.attempt || 0) + 1, 120000);
  await refreshFaqStatus(storeId).catch(() => undefined);
  return result ? [{ message: result.status }] : [];
}

/** Re-check every applied FAQ (the newest per product), e.g. the ones marked verified before this release. */
export async function recheckFaqChanges(storeId: string, fetcher?: Fetcher | null) {
  const rows = await prisma.change.findMany({ where: { storeId, feature: "faq", status: "applied" }, orderBy: { appliedAt: "desc" }, select: { id: true, resourceId: true } });
  const seen = new Set<string>();
  const out = { live: 0, notLive: 0 };
  for (const c of rows) {
    if (seen.has(c.resourceId)) continue;
    seen.add(c.resourceId);
    const r = await checkFaqChange(storeId, c.id, fetcher);
    if (r) r.live ? out.live++ : out.notLive++;
  }
  return out;
}

export type FaqStatus = { products: number; live: number; notLive: number; needReview: number; block: boolean | null; checkedAt?: string };
/** Store-wide FAQ status for the dashboard banner (R22-103), from saved FAQs and the latest live checks. */
export async function refreshFaqStatus(storeId: string): Promise<FaqStatus> {
  const [products, changes, store] = await Promise.all([
    prisma.resource.findMany({ where: { storeId, kind: "product" }, select: { id: true, payload: true, facts: true } }),
    prisma.change.findMany({ where: { storeId, feature: "faq", status: "applied" }, orderBy: { appliedAt: "desc" }, select: { resourceId: true, error: true, updatedAt: true } }),
    prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { discoveries: true } }),
  ]);
  const latest = new Map<string, { error: string | null; updatedAt: Date }>();
  for (const c of changes) if (!latest.has(c.resourceId)) latest.set(c.resourceId, c);
  let count = 0, live = 0, needReview = 0, block: boolean | null = null, checkedAt: string | undefined;
  for (const r of products) {
    let p: Payload; try { p = JSON.parse(r.payload); } catch { continue; }
    if (p.published === false || !(p.faqs || []).length) continue;
    count++;
    if (correctedFaqs(p.faqs || [], {}).fixed.length) needReview++;
    const c = latest.get(r.id);
    if (!c) continue;
    if (c.error?.startsWith(SAVED_NOT_LIVE)) { if (/block is not on the live/.test(c.error)) block = block ?? false; } else { live++; block = true; }
    if (!checkedAt || c.updatedAt.toISOString() > checkedAt) checkedAt = c.updatedAt.toISOString();
  }
  const status: FaqStatus = { products: count, live, notLive: count - live, needReview, block, ...(checkedAt ? { checkedAt } : {}) };
  const d = (() => { try { return JSON.parse(store.discoveries || "{}"); } catch { return {}; } })();
  await withDbRetry(() => prisma.store.update({ where: { id: storeId }, data: { discoveries: JSON.stringify({ ...d, faqStatus: status }) } }));
  return status;
}

/** Audit finding: products whose saved FAQs are not on the live page (the theme lost the block, R22-103). */
export function faqNotLiveIssue(s: FaqStatus): Issue | null {
  if (!s.products || s.notLive <= 0) return null;
  return {
    resourceId: "store:faq-not-live", title: "FAQs not on your store", code: "faq-not-live", severity: "warning", count: s.notLive,
    detail: `${s.notLive} ${s.notLive === 1 ? "product has" : "products have"} FAQs that aren't on your store${s.block === false ? ": the RankPilot FAQ block is not on the live product template" : ""}. Add the RankPilot FAQ block to the product template in the theme editor (Add block > Apps > RankPilot FAQ).${s.needReview ? ` Review ${s.needReview} ${s.needReview === 1 ? "product" : "products"} with answers that need correcting first.` : ""}`,
  };
}

/**
 * R22-106: re-check every saved FAQ answer with the fact rules and propose a corrected list for each
 * product that fails (pending, so nothing is published without approval).
 */
export async function reviewSavedFaqs(storeId: string, opts: { propose?: boolean; actor?: string } = {}) {
  const { stageChange } = await import("./agent.server");
  const products = await prisma.resource.findMany({ where: { storeId, kind: "product" }, select: { id: true, title: true, payload: true, facts: true } });
  const results: { resourceId: string; title: string; problems: string[]; changeId?: string; message?: string }[] = [];
  for (const r of products) {
    let p: Payload; try { p = JSON.parse(r.payload); } catch { continue; }
    if (!(p.faqs || []).length) continue;
    const confirmed: Facts = Object.fromEntries(Object.entries(JSON.parse(r.facts || "{}") as Facts).filter(([k, f]) => k !== "barcode" && f?.confirmed));
    const facts = { ...specFacts(p.descriptionHtml || ""), ...confirmed };
    const text = (p.descriptionHtml || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const { faqs, fixed } = correctedFaqs(p.faqs || [], facts, text);
    if (!fixed.length) continue;
    const problems = fixed.map((f) => `“${f.question}” ${f.answer} — ${f.problems.join("; ")}${f.replacement ? `; replaced by “${f.replacement.question}” ${f.replacement.answer}` : "; removed"}`);
    const row: (typeof results)[number] = { resourceId: r.id, title: r.title, problems };
    if (opts.propose) {
      try {
        const change = await stageChange(storeId, r.id, "faq", p.faqs || [], faqs, ["merchant-reviewed-v1: Release 22 FAQ answer review. These saved answers did not fit their questions:", ...problems, "Approve to publish the corrected list, or reject to keep the current FAQs."]);
        row.changeId = change.id;
      } catch (e) { row.message = (e as Error).message; }
    }
    results.push(row);
  }
  if (opts.propose) await log(storeId, "Saved FAQ answers reviewed", { needCorrection: results.length, proposed: results.filter((r) => r.changeId).length, actor: opts.actor });
  return results;
}

/** One-time Release 22 FAQ pass per store: re-label FAQ changes from the live page and review saved answers. */
export async function releaseFaqPass(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { settings: true } });
  const cfg = settings(store.settings) as ReturnType<typeof settings> & { faqReview22?: string };
  if (cfg.faqReview22) return null;
  const relabelled = await recheckFaqChanges(storeId);
  const reviewed = await reviewSavedFaqs(storeId, { propose: true, actor: "release-22" });
  const status = await refreshFaqStatus(storeId);
  const fresh = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { settings: true } });
  await withDbRetry(() => prisma.store.update({ where: { id: storeId }, data: { settings: JSON.stringify({ ...JSON.parse(fresh.settings || "{}"), faqReview22: new Date().toISOString() }) } }));
  await log(storeId, "Release 22 FAQ check", { relabelled, needCorrection: reviewed.length, status });
  return { relabelled, reviewed: reviewed.length, status };
}

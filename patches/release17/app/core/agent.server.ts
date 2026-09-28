/**
 * Agent workspace (release 15, extended in releases 16 and 17).
 *
 * A short-lived, single-use access link minted from inside the authenticated
 * Shopify admin lets an assistant (or the merchant) open RankPilot at its own
 * top-level address, read findings as plain JSON/text and run bounded bulk
 * actions. Every write goes through the same change pipeline as the embedded
 * app: a Change row with before/after, approval, Shopify write, read-back
 * verification and individual undo.
 */
import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { load } from "cheerio";
import { z } from "zod";
import prisma from "../db.server";
import type { Issue, Payload } from "./types";
import { settings } from "./types";
import { actionGroups } from "./dashboard";
import { findingName } from "./merchant-copy";
import { approve, enqueue, log, tick, clientFor, verifyChange, assertSafeCopy, enqueueGeneration, proposeRedirect, sync } from "./service.server";
import { fetchResource } from "./shopify-api.server";
import { publicFetch, limitedText } from "./crawl.server";
import { dismissChanges, settleStaleChanges } from "./history-hygiene.server";

export const RELEASE = "17";
export const AGENT_ACTOR = "claude-agent";
export const AGENT_REASON =
  "agent-reviewed-v1: Written by the RankPilot agent from this page's own content at the merchant's request, checked against the page text and applied through the bulk tool. Undo is available in Results & history.";
const COOKIE = "rankpilot_agent";
const LINK_TTL = "15m";
const SESSION_SECONDS = 2 * 60 * 60;
const BUSY = ["approved", "applying", "verifying", "rolling_back"];
const BODY_FEATURES = ["description", "links"];

export function agentEnabled() {
  return !["off", "false", "0"].includes(String(process.env.AGENT_ACCESS || "").toLowerCase());
}
function secret() {
  const raw = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!raw || raw.length < 16) throw new Error("Agent access needs SESSION_SECRET to be configured.");
  return new TextEncoder().encode("rankpilot-agent:" + raw);
}
async function storeAccess(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const cfg = settings(store.settings);
  return { store, allowed: cfg.agentAccess !== false, epoch: cfg.agentEpoch || 0 };
}
export async function mintLink(storeId: string, actor: string) {
  if (!agentEnabled()) throw new Error("Agent access is switched off (AGENT_ACCESS=off).");
  const { allowed, epoch } = await storeAccess(storeId);
  if (!allowed) throw new Error("Agent access is switched off for this store. Switch it on in Settings › Agent workspace.");
  const jti = randomUUID();
  const token = await new SignJWT({ storeId, actor, use: "link", epoch })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("rankpilot-agent")
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(LINK_TTL)
    .sign(secret());
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  await log(storeId, "Agent access link created", { actor, jti });
  return `${base}/agent?t=${encodeURIComponent(token)}`;
}
async function verify(token: string, use: "link" | "session") {
  const { payload } = await jwtVerify(token, secret(), { audience: "rankpilot-agent" });
  if (payload.use !== use || typeof payload.storeId !== "string") throw new Error("Invalid agent token");
  return { storeId: payload.storeId, actor: String(payload.actor || ""), epoch: Number(payload.epoch || 0), jti: payload.jti };
}
const readCookie = (request: Request) =>
  (request.headers.get("Cookie") || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);

/** Exchange a link token for an HttpOnly session cookie. Each link works once. */
export async function exchange(linkToken: string) {
  const claims = await verify(linkToken, "link");
  const { allowed, epoch } = await storeAccess(claims.storeId);
  if (!allowed || claims.epoch !== epoch) throw new Error("Agent access was revoked");
  if (claims.jti) {
    const used = await prisma.event.findFirst({ where: { storeId: claims.storeId, message: "Agent link used", detail: { contains: claims.jti } } });
    if (used) throw new Error("This link has already been used");
    await log(claims.storeId, "Agent link used", { jti: claims.jti, actor: claims.actor });
  }
  const session = await new SignJWT({ storeId: claims.storeId, actor: claims.actor, use: "session", epoch })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("rankpilot-agent")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
  await log(claims.storeId, "Agent session opened", { actor: claims.actor });
  const secure = String(process.env.SHOPIFY_APP_URL || "").startsWith("https:") ? "; Secure" : "";
  return `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}
export async function agentContext(request: Request) {
  if (!agentEnabled()) throw new Response("Agent access is switched off.", { status: 403 });
  const token = readCookie(request);
  if (!token) throw new Response("No agent session. Open a fresh link from RankPilot › Settings › Agent workspace.", { status: 401 });
  let claims;
  try {
    claims = await verify(token, "session");
  } catch {
    throw new Response("Agent session expired. Open a fresh link from RankPilot › Settings › Agent workspace.", { status: 401 });
  }
  const access = await storeAccess(claims.storeId).catch(() => null);
  if (!access) throw new Response("Agent session expired. Open a fresh link from RankPilot › Settings › Agent workspace.", { status: 401 });
  if (!access.allowed || claims.epoch !== access.epoch) throw new Response("Agent access was revoked or switched off in RankPilot › Settings › Agent workspace.", { status: 401 });
  return { store: access.store };
}
/** Writes must be same-origin and carry an explicit header (CSRF guard). */
export function requireAgentWrite(request: Request) {
  if (request.headers.get("x-rankpilot-agent") !== "1") throw new Response("Missing agent header", { status: 400 });
  // Behind Render's proxy request.url is the internal http address, so compare with the public app URL.
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.SHOPIFY_APP_URL || request.url).origin;
  if (origin && origin !== expected) throw new Response("Cross-origin request refused", { status: 403 });
}

const text = (html: string) => {
  const $ = load(html || "");
  $("script,style").remove();
  return $.root().text().replace(/\s+/g, " ").trim();
};
const urlOf = (domain: string, r: { kind: string; handle: string }, p: Payload) =>
  p.url || `${domain}/${r.kind === "article" ? `blogs/${p.blogHandle}` : r.kind + "s"}/${r.handle}`;
const shopNameOf = (store: { discoveries: string; settings: string }) =>
  (JSON.parse(store.discoveries || "{}").shop?.name as string | undefined) || settings(store.settings).titleBrand || "";
/** Dawn-based themes add " – {shop name}" after the SEO title unless it already contains the shop name. */
export function servedTitle(title: string, shopName: string) {
  // Liquid's `contains` is case-sensitive, so this is too.
  if (!title || !shopName || title.includes(shopName)) return title;
  return `${title} – ${shopName}`;
}

async function latestIssues(storeId: string): Promise<Issue[]> {
  const audit = await prisma.audit.findFirst({ where: { storeId }, orderBy: { createdAt: "desc" } });
  return audit ? JSON.parse(audit.issues) : [];
}

export async function overview(storeId: string) {
  const [store, audit, counts, score] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
    prisma.audit.findFirst({ where: { storeId }, orderBy: { createdAt: "desc" } }),
    prisma.change.groupBy({ by: ["status"], where: { storeId }, _count: true }),
    prisma.metric.findFirst({ where: { storeId, provider: "store-score" }, orderBy: { period: "desc" } }),
  ]);
  const issues: Issue[] = audit ? JSON.parse(audit.issues) : [];
  return {
    release: RELEASE,
    store: store.id,
    domain: store.domain,
    audit: audit ? { at: audit.createdAt, score: audit.score, aeoScore: audit.aeoScore, pages: audit.resourceCount } : null,
    storeScore: score ? JSON.parse(score.payload) : null,
    groups: actionGroups(issues).map((g) => ({ key: g.key, name: findingName(g.code), pages: g.count, occurrences: g.occurrences })),
    changes: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}

export async function findings(storeId: string, group?: string) {
  const issues = await latestIssues(storeId);
  const resources = await prisma.resource.findMany({ where: { storeId }, select: { id: true, kind: true, handle: true, title: true } });
  const byId = new Map(resources.map((r) => [r.id, r]));
  return actionGroups(issues)
    .filter((g) => !group || g.key === group || g.code === group)
    .map((g) => ({
      key: g.key,
      name: findingName(g.code),
      pages: g.count,
      items: g.items.map((i) => ({
        resourceId: i.resourceId,
        kind: byId.get(i.resourceId)?.kind,
        handle: byId.get(i.resourceId)?.handle,
        title: i.title,
        code: i.code,
        severity: i.severity,
        detail: i.detail,
        link: i.link,
      })),
    }));
}

export async function pages(storeId: string, opts: { ids?: string[]; kind?: string; limit?: number; offset?: number; full?: boolean }) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const shopName = shopNameOf(store);
  const rows = await prisma.resource.findMany({
    where: { storeId, ...(opts.ids?.length ? { id: { in: opts.ids } } : {}), ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
    skip: opts.offset || 0,
    take: Math.min(opts.limit || 50, 200),
  });
  return rows.map((r) => {
    const p: Payload = JSON.parse(r.payload);
    const body = text(p.descriptionHtml);
    const shown = servedTitle(p.seo?.title || "", shopName);
    return {
      id: r.id,
      kind: r.kind,
      title: p.title,
      handle: r.handle,
      url: urlOf(store.domain, r, p),
      published: p.published,
      seo: p.seo,
      seoLengths: { title: (p.seo?.title || "").length, servedTitle: shown.length, description: (p.seo?.description || "").length },
      productType: p.productType,
      vendor: p.vendor,
      tags: p.tags,
      price: p.variants?.[0]?.price,
      images: opts.full ? p.images?.map((i) => ({ id: i.id, alt: i.alt, url: i.url })) : p.images?.length,
      ...(opts.full ? { html: p.descriptionHtml } : {}),
      text: opts.full ? body.slice(0, 6000) : body.slice(0, 700),
      textLength: body.length,
    };
  });
}

export async function changes(storeId: string, opts: { status?: string; ids?: string[]; limit?: number; actor?: string }) {
  const rows = await prisma.change.findMany({
    where: {
      storeId,
      ...(opts.status ? { status: { in: opts.status.split(",") } } : {}),
      ...(opts.ids?.length ? { id: { in: opts.ids } } : {}),
      ...(opts.actor ? { approvedBy: opts.actor } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.limit || 100, 500),
  });
  const titles = new Map((await prisma.resource.findMany({ where: { storeId, id: { in: rows.map((r) => r.resourceId) } }, select: { id: true, title: true } })).map((r) => [r.id, r.title]));
  return rows.map((c) => ({
    id: c.id,
    resourceId: c.resourceId,
    page: titles.get(c.resourceId),
    feature: c.feature,
    status: c.status,
    error: c.error,
    approvedBy: c.approvedBy,
    before: JSON.parse(c.before),
    after: JSON.parse(c.after),
    createdAt: c.createdAt,
    appliedAt: c.appliedAt,
  }));
}

export const seoItem = z.object({
  resourceId: z.string().min(1),
  title: z.string().trim().min(20, "Title under 20 characters").max(70, "Title over 70 characters"),
  description: z.string().trim().min(70, "Summary under 70 characters").max(170, "Summary over 170 characters"),
});
export function seoWarnings(title: string, description: string, shopName = "") {
  const w: string[] = [];
  if (title.length < 30 || title.length > 60) w.push(`title ${title.length} chars (target 30–60)`);
  const shown = servedTitle(title, shopName);
  if (shown !== title && shown.length > 65) w.push(`Google will see ${shown.length} chars including “ – ${shopName}” added by the theme; shorten to ${Math.max(20, 65 - (shown.length - title.length))} or include the store name`);
  if (description.length < 120 || description.length > 160) w.push(`summary ${description.length} chars (target 120–160)`);
  if (/!/.test(title + description)) w.push("contains an exclamation mark");
  return w;
}

async function waitForApplies(storeId: string, ids: string[], budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  for (const id of ids) {
    const job = await prisma.job.findUnique({ where: { dedup: `${storeId}:apply:${id}` } });
    if (!job || Date.now() > deadline) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      tick({ jobId: job.id }).catch(() => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, Math.max(500, Math.min(8000, deadline - Date.now()))); }),
    ]).finally(() => timer && clearTimeout(timer));
  }
}

class BusyError extends Error {}
/**
 * Create one reviewed change. Refuses while another update is applying to the page and
 * supersedes pending previews for the same field, so an older preview accepted later
 * cannot silently undo this one. Body edits (description and links) count as one field.
 */
async function stageChange(storeId: string, resourceId: string, feature: string, before: unknown, after: unknown, reasons: string[]) {
  const family = BODY_FEATURES.includes(feature) ? BODY_FEATURES : [feature];
  return prisma.$transaction(async (tx) => {
    const busy = await tx.change.findFirst({ where: { storeId, resourceId, status: { in: BUSY } } });
    if (busy) throw new BusyError("Another update is applying to this page");
    const next = await tx.change.create({
      data: { storeId, resourceId, feature, before: JSON.stringify(before), after: JSON.stringify(after), blockers: "[]", reasons: JSON.stringify(reasons) },
    });
    await tx.change.updateMany({ where: { storeId, resourceId, feature: { in: family }, status: "pending", id: { not: next.id } }, data: { status: "superseded", error: `Replaced by agent change ${next.id}` } });
    return next;
  });
}
async function isBusy(storeId: string, resourceId: string) {
  return !!(await prisma.change.findFirst({ where: { storeId, resourceId, status: { in: BUSY } } }));
}
type Result = { resourceId: string; ok: boolean; status: string; title?: string; changeId?: string; message?: string; warnings?: string[]; changes?: string[] };
async function settleResults(storeId: string, results: Result[], created: string[], budget: number) {
  if (created.length) await waitForApplies(storeId, created, budget);
  const final = new Map((await prisma.change.findMany({ where: { id: { in: created } } })).map((c) => [c.id, c]));
  for (const r of results) {
    const c = r.changeId && final.get(r.changeId);
    if (c) { r.status = c.status; r.ok = !["apply_failed", "conflict", "verification_failed"].includes(c.status); if (c.error) r.message = c.error; }
  }
  return results;
}

/** Create reviewed SEO changes for up to 25 pages; optionally approve and apply them. */
export async function bulkSeo(storeId: string, input: unknown) {
  const body = z
    .object({ items: z.array(z.unknown()).min(1).max(25), dryRun: z.boolean().default(true), apply: z.boolean().default(true) })
    .parse(input);
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const shopName = shopNameOf(store);
  const client = await clientFor(storeId);
  const results: Result[] = [];
  const created: string[] = [];
  const seen = new Set<string>();
  for (const raw of body.items) {
    const parsed = seoItem.safeParse(raw);
    const resourceId = String((raw as { resourceId?: string })?.resourceId || "");
    if (!parsed.success) { results.push({ resourceId, ok: false, status: "invalid", message: parsed.error.issues.map((i) => i.message).join("; ") }); continue; }
    const item = parsed.data;
    if (seen.has(item.resourceId)) { results.push({ resourceId, ok: false, status: "duplicate", message: "Page listed twice in this batch" }); continue; }
    seen.add(item.resourceId);
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id: item.resourceId, storeId } });
      const live: Payload = client ? await fetchResource(client, r.remoteId, r.kind) : JSON.parse(r.payload);
      const before = { title: live.seo?.title || "", description: live.seo?.description || "" };
      const after = { title: item.title, description: item.description };
      const warnings = seoWarnings(after.title, after.description, shopName);
      if (before.title.trim() === after.title && before.description.trim() === after.description) { results.push({ resourceId, ok: true, status: "unchanged", message: "Already saved" }); continue; }
      if (await isBusy(storeId, r.id)) { results.push({ resourceId, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      if (body.dryRun) { results.push({ resourceId, ok: true, status: "valid", warnings, message: `${before.title || "(no Google title)"} → ${after.title}` }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await stageChange(storeId, r.id, "seo", before, after, [AGENT_REASON, ...warnings.map((w) => "Note: " + w)]);
      if (body.apply) await approve(storeId, row.id, AGENT_ACTOR);
      created.push(row.id);
      results.push({ resourceId, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id, warnings });
    } catch (e) {
      results.push({ resourceId, ok: false, status: e instanceof BusyError ? "busy" : "error", message: (e as Error).message });
    }
  }
  await settleResults(storeId, results, body.apply ? created : [], 45000);
  await log(storeId, "Agent bulk SEO update", { dryRun: body.dryRun, count: results.length, applied: results.filter((r) => r.status === "applied").length });
  return { dryRun: body.dryRun, results };
}

/** Approve existing pending proposals (e.g. image-reviewed alt text) in bulk. */
export async function bulkApprove(storeId: string, input: unknown) {
  const { ids } = z.object({ ids: z.array(z.string()).min(1).max(25) }).parse(input);
  const results: { id: string; ok: boolean; message?: string }[] = [];
  const ok: string[] = [];
  for (const id of [...new Set(ids)]) {
    try { await approve(storeId, id, AGENT_ACTOR); ok.push(id); results.push({ id, ok: true }); } catch (e) { results.push({ id, ok: false, message: (e as Error).message }); }
  }
  if (ok.length) await waitForApplies(storeId, ok, 45000);
  const final = new Map((await prisma.change.findMany({ where: { id: { in: ok } } })).map((c) => [c.id, c.status]));
  return { results: results.map((r) => ({ ...r, status: final.get(r.id) })) };
}

/** Reject pending proposals: explicit ids, or every stale/retired preview. */
export async function bulkReject(storeId: string, input: unknown) {
  const body = z.object({ ids: z.array(z.string()).max(500).optional(), stale: z.boolean().optional(), olderThan: z.string().datetime().optional(), reason: z.string().max(300).default("Bulk clean-up of stale previews") }).parse(input);
  if (!body.ids?.length && !body.stale) throw new Error("Pass ids, or stale:true");
  const where = { storeId, status: "pending", ...(body.ids?.length ? { id: { in: body.ids } } : {}), ...(body.olderThan ? { createdAt: { lt: new Date(body.olderThan) } } : {}) };
  const rows = await prisma.change.findMany({ where });
  const target = body.stale
    ? rows.filter((c) => { try { assertSafeCopy(c.feature, JSON.parse(c.before), JSON.parse(c.after), JSON.parse(c.reasons)); return JSON.parse(c.blockers).length > 0; } catch { return true; } })
    : rows;
  const updated = await prisma.change.updateMany({ where: { id: { in: target.map((c) => c.id) }, status: "pending" }, data: { status: "rejected", error: body.reason } });
  await log(storeId, "Agent bulk reject", { count: updated.count, reason: body.reason, stale: !!body.stale });
  return { rejected: updated.count, considered: rows.length };
}

/** Release 17: clear failed, conflicted or pending history rows. Never touches applied changes. */
export async function dismiss(storeId: string, input: unknown) {
  const body = z.object({ ids: z.array(z.string()).max(500).optional(), stale: z.boolean().optional(), reason: z.string().max(300).default("No longer needed") }).parse(input || {});
  if (!body.ids?.length && !body.stale) throw new Error("Pass ids, or stale:true to clear failed items already replaced by a later applied update");
  const settled = body.stale ? await settleStaleChanges(storeId) : { settled: 0 };
  const dismissed = body.ids?.length ? await dismissChanges(storeId, body.ids, body.reason, AGENT_ACTOR) : { dismissed: 0, skipped: [], notFound: [] };
  return { ...settled, ...dismissed };
}

/** Recheck pages that returned an HTTP error, one at a time with polite spacing. Runs as a background job. */
export async function recheckPages(storeId: string, input: unknown) {
  const body = z.object({ limit: z.number().int().min(1).max(40).default(20), resourceIds: z.array(z.string()).max(40).optional() }).parse(input || {});
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const issues = await latestIssues(storeId);
  const failing = issues.filter((i) => i.code === "http-error" && (!body.resourceIds || body.resourceIds.includes(i.resourceId)));
  const resources = new Map((await prisma.resource.findMany({ where: { storeId, id: { in: failing.map((i) => i.resourceId) } } })).map((r) => [r.id, r]));
  const batch = failing.slice(0, body.limit);
  const outcome: { resourceId: string; url: string; status: number | null; cleared: boolean }[] = [];
  for (const issue of batch) {
    const r = resources.get(issue.resourceId);
    const url = issue.link?.url || (r ? urlOf(store.domain, r, JSON.parse(r.payload)) : "");
    let status: number | null = null;
    for (let attempt = 0; attempt < 3 && url; attempt++) {
      try {
        const res = await publicFetch(url);
        status = res.status;
        await limitedText(res).catch(() => "");
        if (status !== 429 && status !== 503) break;
        await new Promise((ok) => setTimeout(ok, 2500 * (attempt + 1)));
      } catch { status = null; }
    }
    outcome.push({ resourceId: issue.resourceId, url, status, cleared: !!status && status >= 200 && status < 300 });
    await new Promise((ok) => setTimeout(ok, 1200));
  }
  await prisma.$transaction(async (tx) => {
    const audit = await tx.audit.findFirst({ where: { storeId }, orderBy: { createdAt: "desc" } });
    if (!audit) return;
    const current: Issue[] = JSON.parse(audit.issues);
    const cleared = new Set(outcome.filter((o) => o.cleared).map((o) => o.resourceId));
    const next = current
      .filter((i) => !(i.code === "http-error" && cleared.has(i.resourceId)))
      .map((i) => {
        const o = outcome.find((x) => x.resourceId === i.resourceId && !x.cleared);
        return i.code === "http-error" && o ? { ...i, detail: `Storefront returned ${o.status ?? "no response"} on recheck; may be protected or temporarily unavailable.`, link: { url: o.url, status: o.status || 0, checkedAt: new Date().toISOString() } } : i;
      });
    await tx.audit.update({ where: { id: audit.id }, data: { issues: JSON.stringify(next) } });
  });
  await log(storeId, "Agent page recheck", { checked: outcome.length, cleared: outcome.filter((o) => o.cleared).length });
  return { checked: outcome.length, remaining: failing.length - outcome.filter((o) => o.cleared).length, outcome };
}

export async function queueJob(storeId: string, input: unknown) {
  const { kind, ids, limit } = z.object({ kind: z.enum(["audit", "indexation", "refresh-audit", "generate-alt", "recheck-pages"]), ids: z.array(z.string()).max(50).optional(), limit: z.number().int().min(1).max(40).optional() }).parse(input);
  if (kind === "generate-alt") {
    if (!ids?.length) throw new Error("Pass product ids for alt text generation");
    return { job: await enqueueGeneration(storeId, ids, "alt") };
  }
  const active = await prisma.job.findFirst({ where: { storeId, kind, status: { in: ["queued", "running"] } } });
  if (active) return { job: active };
  return { job: await enqueue(storeId, kind, kind === "recheck-pages" ? { limit: limit || 20, ...(ids?.length ? { resourceIds: ids } : {}) } : {}) };
}

export async function jobs(storeId: string) {
  const rows = await prisma.job.findMany({ where: { storeId }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, kind: true, status: true, error: true, attempts: true, updatedAt: true, payload: true } });
  return rows.map(({ payload, ...j }) => {
    let result: unknown;
    if (j.kind === "recheck-pages") try { result = JSON.parse(payload).result; } catch { /* ignore */ }
    return result === undefined ? j : { ...j, result };
  });
}

export async function recheckChange(storeId: string, id: string) {
  return verifyChange(storeId, id);
}

export async function brandSettings(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const s = settings(store.settings);
  return { brandVoice: s.brandVoice, titleBrand: s.titleBrand, titleBrandMode: s.titleBrandMode, shopName: shopNameOf(store) };
}

/**
 * Release 16/17: repair heading order inside page, article, collection or product body HTML.
 * The theme renders the page title as H1, so body headings must start at H2 and never skip
 * a level. Only heading tags are rewritten, in place in the original string, so no other
 * markup is re-serialised. The original level is kept as a class (e.g. class="h3") so
 * Dawn-based themes keep the same visual size. Empty headings become paragraphs.
 */
export function fixHeadingOrder(html: string) {
  const src = html || "";
  const tags = [...src.matchAll(/<(\/?)h([1-6])\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)].map((m) => ({ index: m.index!, length: m[0].length, close: m[1] === "/", level: Number(m[2]), attrs: m[3] }));
  type Tag = (typeof tags)[number];
  const pairs: { open: Tag; close: Tag }[] = [];
  const stack: Tag[] = [];
  for (const t of tags) {
    if (!t.close) { stack.push(t); continue; }
    const open = stack.pop();
    if (!open || open.level !== t.level) return { html, changes: [] as string[], skipped: "Heading tags are not properly nested; left unchanged." };
    pairs.push({ open, close: t });
  }
  if (stack.length || !pairs.length) return { html, changes: [] as string[], ...(stack.length ? { skipped: "A heading is not closed; left unchanged." } : {}) };
  pairs.sort((a, b) => a.open.index - b.open.index);
  const inner = (p: { open: Tag; close: Tag }) => src.slice(p.open.index + p.open.length, p.close.index);
  const isEmpty = (p: { open: Tag; close: Tag }) => !/<(img|svg|picture|video|iframe)\b/i.test(inner(p)) && !load(`<div>${inner(p)}</div>`)("div").text().replace(/[\s ]+/g, "");
  const real = pairs.filter((p) => !isEmpty(p));
  const edits: { index: number; length: number; value: string }[] = [];
  const changes: string[] = [];
  for (const p of pairs.filter(isEmpty)) {
    edits.push({ index: p.open.index, length: p.open.length, value: `<p${p.open.attrs}>` }, { index: p.close.index, length: p.close.length, value: "</p>" });
    changes.push(`empty h${p.open.level}→p`);
  }
  if (real.length) {
    const shift = Math.max(0, Math.min(...real.map((p) => p.open.level)) - 2);
    let prev = 1;
    for (const p of real) {
      const orig = p.open.level;
      const next = Math.max(2, Math.min(orig - shift, prev + 1));
      if (next !== orig) {
        let attrs = p.open.attrs;
        const cls = attrs.match(/\sclass(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+)))?(?=\s|$|\/)/i);
        const list = cls ? (cls[2] ?? cls[3] ?? cls[4] ?? "").split(/\s+/).filter(Boolean) : [];
        if (!list.some((c) => /^h[0-6]$/.test(c))) {
          list.push("h" + orig);
          const value = ` class="${list.join(" ").replace(/"/g, "&quot;")}"`;
          attrs = cls ? attrs.slice(0, cls.index!) + value + attrs.slice(cls.index! + cls[0].length) : `${attrs.replace(/\s*\/?$/, "")}${value}`;
        }
        edits.push({ index: p.open.index, length: p.open.length, value: `<h${next}${attrs}>` }, { index: p.close.index, length: p.close.length, value: `</h${next}>` });
        changes.push(`h${orig}→h${next} "${load(`<div>${inner(p)}</div>`)("div").text().trim().slice(0, 50)}"`);
      }
      prev = next;
    }
  }
  if (!edits.length) return { html, changes };
  let out = src;
  for (const e of edits.sort((a, b) => b.index - a.index)) out = out.slice(0, e.index) + e.value + out.slice(e.index + e.length);
  return { html: out, changes };
}

export async function bulkHeadings(storeId: string, input: unknown) {
  const body = z.object({ ids: z.array(z.string()).min(1).max(25), dryRun: z.boolean().default(true) }).parse(input);
  const client = await clientFor(storeId);
  const results: Result[] = [];
  const created: string[] = [];
  for (const id of [...new Set(body.ids)]) {
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id, storeId } });
      const live: Payload = client ? await fetchResource(client, r.remoteId, r.kind) : JSON.parse(r.payload);
      const fixed = fixHeadingOrder(live.descriptionHtml);
      if ("skipped" in fixed && fixed.skipped) { results.push({ resourceId: id, title: r.title, ok: false, status: "skipped", message: fixed.skipped }); continue; }
      if (!fixed.changes.length) { results.push({ resourceId: id, title: r.title, ok: true, status: "unchanged" }); continue; }
      if (text(fixed.html) !== text(live.descriptionHtml)) throw new Error("Heading repair would change visible text; skipped.");
      if (await isBusy(storeId, r.id)) { results.push({ resourceId: id, title: r.title, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      if (body.dryRun) { results.push({ resourceId: id, title: r.title, ok: true, status: "valid", changes: fixed.changes }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await stageChange(storeId, r.id, "description", live.descriptionHtml, fixed.html, [AGENT_REASON, "Heading order repair: " + fixed.changes.join("; "), "Visible text is unchanged; only heading levels change, with the original size kept as a class."]);
      await approve(storeId, row.id, AGENT_ACTOR);
      created.push(row.id);
      results.push({ resourceId: id, title: r.title, ok: true, status: "approved", changeId: row.id, changes: fixed.changes });
    } catch (e) {
      results.push({ resourceId: id, ok: false, status: e instanceof BusyError ? "busy" : "error", message: (e as Error).message });
    }
  }
  await settleResults(storeId, results, created, 40000);
  await log(storeId, "Agent heading repair", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

const BLOCKED_HTML = /<\s*(script|style|iframe|object|embed|form|input|button|link|meta)\b|\son[a-z]+\s*=|javascript:/i;
const ALLOWED_TAGS = new Set(["h2", "h3", "h4", "h5", "h6", "p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "span", "div", "blockquote", "dl", "dt", "dd", "details", "summary", "h1"]);
const ALLOWED_ATTRS: Record<string, string[]> = { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height", "loading"] };
function htmlOutsideAllowed(html: string) {
  const $ = load(html, null, false);
  const bad = new Set<string>();
  $("*").each((_, el) => {
    const name = (el as unknown as { name: string }).name;
    if (!ALLOWED_TAGS.has(name)) bad.add(`<${name}>`);
    for (const attr of Object.keys((el as unknown as { attribs: Record<string, string> }).attribs || {}))
      if (attr !== "class" && !(ALLOWED_ATTRS[name] || []).includes(attr)) bad.add(`${name}[${attr}]`);
    const url = $(el).attr("href") || $(el).attr("src");
    if (url && !/^(https:|mailto:|tel:|\/(?!\/)|#)/i.test(url)) bad.add(`${name} link “${url.slice(0, 40)}”`);
  });
  return [...bad];
}
export const descriptionItem = z.object({ resourceId: z.string().min(1), html: z.string().trim().min(1).max(60000) });
export function descriptionProblems(html: string) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (BLOCKED_HTML.test(html)) errors.push("Scripts, styles, frames, forms and event handlers are not allowed.");
  const outside = htmlOutsideAllowed(html);
  if (outside.length) errors.push(`Not allowed in a description: ${outside.slice(0, 6).join(", ")}. Use headings H2–H6, paragraphs, lists, links, tables, images and emphasis.`);
  if (/<h1\b/i.test(html)) errors.push("Do not use H1 in a body; the theme already renders the page title as H1.");
  const words = text(html).split(/\s+/).filter(Boolean).length;
  if (words < 40) errors.push(`Only ${words} words; write a useful description.`);
  else if (words < 80) warnings.push(`${words} words (thin-content threshold is 80)`);
  if (/!/.test(text(html))) warnings.push("contains an exclamation mark");
  if (fixHeadingOrder(html).changes.length) warnings.push("heading levels skip or do not start at H2");
  return { errors, warnings, words };
}
/**
 * Release 17: reviewed description or body rewrites for products, collections, pages and articles.
 * Dry run by default. The agent writes from the page's own facts at the merchant's request;
 * the change pipeline verifies the save and keeps an exact undo.
 */
export async function bulkDescription(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(z.unknown()).min(1).max(10), dryRun: z.boolean().default(true), apply: z.boolean().default(true) }).parse(input);
  const client = await clientFor(storeId);
  const results: Result[] = [];
  const created: string[] = [];
  const seen = new Set<string>();
  for (const raw of body.items) {
    const parsed = descriptionItem.safeParse(raw);
    const resourceId = String((raw as { resourceId?: string })?.resourceId || "");
    if (!parsed.success) { results.push({ resourceId, ok: false, status: "invalid", message: parsed.error.issues.map((i) => i.message).join("; ") }); continue; }
    if (seen.has(resourceId)) { results.push({ resourceId, ok: false, status: "duplicate", message: "Page listed twice in this batch" }); continue; }
    seen.add(resourceId);
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id: resourceId, storeId } });
      const { errors, warnings, words } = descriptionProblems(parsed.data.html);
      if (errors.length) { results.push({ resourceId, title: r.title, ok: false, status: "invalid", message: errors.join(" "), warnings }); continue; }
      const live: Payload = client ? await fetchResource(client, r.remoteId, r.kind) : JSON.parse(r.payload);
      if (text(live.descriptionHtml) === text(parsed.data.html) && live.descriptionHtml.trim() === parsed.data.html) { results.push({ resourceId, title: r.title, ok: true, status: "unchanged", message: "Already saved" }); continue; }
      if (await isBusy(storeId, r.id)) { results.push({ resourceId, title: r.title, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      const summary = `${text(live.descriptionHtml).split(/\s+/).filter(Boolean).length} → ${words} words`;
      if (body.dryRun) { results.push({ resourceId, title: r.title, ok: true, status: "valid", warnings, message: summary }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await stageChange(storeId, r.id, "description", live.descriptionHtml, parsed.data.html, [AGENT_REASON, `Description rewrite (${summary}).`, ...warnings.map((w) => "Note: " + w)]);
      if (body.apply) await approve(storeId, row.id, AGENT_ACTOR);
      created.push(row.id);
      results.push({ resourceId, title: r.title, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id, warnings, message: summary });
    } catch (e) {
      results.push({ resourceId, ok: false, status: e instanceof BusyError ? "busy" : "error", message: (e as Error).message });
    }
  }
  await settleResults(storeId, results, body.apply ? created : [], 45000);
  await log(storeId, "Agent description update", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

/** Release 17: forward retired or missing addresses (including ones that redirect to the home page). */
export async function bulkRedirects(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(z.object({ path: z.string().min(1).max(500), target: z.string().min(1).max(500) })).min(1).max(20), dryRun: z.boolean().default(true) }).parse(input);
  const results: { path: string; target: string; ok: boolean; status: string; changeId?: string; message?: string }[] = [];
  const created: string[] = [];
  for (const item of body.items) {
    try {
      if (body.dryRun) {
        const res = await prisma.resource.findUnique({ where: { storeId_remoteId: { storeId, remoteId: "redirect:" + item.path } } });
        const open = res && (await prisma.change.findFirst({ where: { storeId, resourceId: res.id, feature: "redirect", status: "pending" } }));
        if (open) { results.push({ ...item, ok: true, status: "exists", changeId: open.id, message: "A redirect for this path is already waiting for review; nothing checked or changed." }); continue; }
      }
      const earlier = new Set((await prisma.change.findMany({ where: { storeId, feature: "redirect", status: "pending" }, select: { id: true } })).map((c) => c.id));
      const change = await proposeRedirect(storeId, item.path, item.target);
      if (body.dryRun) {
        if (change.status === "pending" && !earlier.has(change.id)) await prisma.change.updateMany({ where: { id: change.id, status: "pending" }, data: { status: "superseded", error: "Agent dry run: checked only" } });
        results.push({ ...item, ok: true, status: "valid", message: "Path and destination checked; nothing saved." });
        continue;
      }
      if (change.status === "pending") await approve(storeId, change.id, AGENT_ACTOR);
      created.push(change.id);
      results.push({ ...item, ok: true, status: "approved", changeId: change.id });
    } catch (e) {
      results.push({ ...item, ok: false, status: "error", message: (e as Error).message });
    }
  }
  if (created.length) await waitForApplies(storeId, created, 40000);
  const final = new Map((await prisma.change.findMany({ where: { id: { in: created } } })).map((c) => [c.id, c]));
  for (const r of results) { const c = r.changeId && final.get(r.changeId); if (c) { r.status = c.status; if (c.error) r.message = c.error; } }
  await log(storeId, "Agent redirect update", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

const OPTIONAL_CODES = new Set(["thin-content", "supplier-language", "missing-product-faq", "missing-gtin", "nofollow-review", "slow-response", "image-loading-review", "large-image", "live-title-long", "keyword-cannibalisation"]);
/**
 * Release 17: go-live check for Store Operations. A product is ready when every image has
 * alt text, it has a Google title and summary of sensible length, and no blocking finding is open.
 * Pass RankPilot ids (ids=) or Shopify product GIDs (gids=). refresh=1 re-reads the products from Shopify first.
 */
export async function readiness(storeId: string, opts: { ids?: string[]; gids?: string[]; refresh?: boolean }) {
  if (!opts.ids?.length && !opts.gids?.length) throw new Error("Pass ids or gids");
  if ((opts.ids?.length || 0) + (opts.gids?.length || 0) > 50) throw new Error("Check up to 50 products at a time");
  const bad = (opts.gids || []).filter((g) => !/^gid:\/\/shopify\/Product\/\d+$/.test(g));
  if (bad.length) throw new Error(`gids must be Shopify product ids (gid://shopify/Product/123): ${bad.slice(0, 3).join(", ")}`);
  if (opts.refresh && opts.gids?.length) for (const gid of opts.gids) await sync(storeId, gid).catch(() => undefined);
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const shopName = shopNameOf(store);
  const rows = await prisma.resource.findMany({ where: { storeId, OR: [{ id: { in: opts.ids || [] } }, { remoteId: { in: opts.gids || [] } }] } });
  const issues = await latestIssues(storeId);
  const found = rows.map((r) => {
    const p: Payload = JSON.parse(r.payload);
    const reasons: string[] = [];
    const noAlt = p.images.filter((i) => !i.alt?.trim()).length;
    if (!p.images.length) reasons.push("No images");
    if (noAlt) reasons.push(`${noAlt} of ${p.images.length} images have no alt text`);
    const title = p.seo?.title?.trim() || "";
    const shown = servedTitle(title, shopName);
    if (!title) reasons.push("No Google title");
    else if (shown.length > 70) reasons.push(`Google title will show as ${shown.length} characters`);
    const description = p.seo?.description?.trim() || "";
    if (!description) reasons.push("No Google summary");
    else if (description.length < 70 || description.length > 170) reasons.push(`Google summary is ${description.length} characters (aim for 120–160)`);
    const blocking = issues.filter((i) => i.resourceId === r.id && i.severity !== "notice" && !OPTIONAL_CODES.has(i.code));
    for (const code of new Set(blocking.map((i) => i.code))) reasons.push(`Open finding: ${findingName(code)}`);
    return { id: r.id, gid: r.remoteId, kind: r.kind, title: r.title, published: p.published, ready: !reasons.length, reasons, checkedAt: new Date().toISOString() };
  });
  const missing = [...(opts.ids || []).filter((id) => !rows.some((r) => r.id === id)), ...(opts.gids || []).filter((g) => !rows.some((r) => r.remoteId === g))].map((id) => ({ id, ready: false, reasons: ["Not in RankPilot yet; pass refresh=1 with the Shopify GID, or run an audit"] }));
  return [...found, ...missing];
}

/** Normalise a storefront address to the canonical path RankPilot stores. */
export function normalisePath(input: string) {
  let path = input.trim();
  try { path = new URL(path, "https://x.invalid").pathname; } catch { /* keep */ }
  try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }
  path = path.toLowerCase().replace(/\/+$/, "") || "/";
  path = path.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/(products|collections|pages|blogs)\/)/, "");
  return path.replace(/^\/collections\/[^/]+\/products\//, "/products/");
}
/** Find resources by storefront path or URL, e.g. /pages/faq, https://shop/blogs/news/post/. */
export async function lookup(storeId: string, paths: string[]) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const rows = await prisma.resource.findMany({ where: { storeId, kind: { in: ["product", "collection", "page", "article"] } }, select: { id: true, kind: true, handle: true, title: true, payload: true } });
  const index = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    try { index.set(normalisePath(urlOf(store.domain, r, JSON.parse(r.payload))), r); } catch { /* skip */ }
    if (r.kind !== "article") index.set(normalisePath(`/${r.kind}s/${r.handle}`), index.get(normalisePath(`/${r.kind}s/${r.handle}`)) || r);
  }
  return paths.slice(0, 200).map((path) => {
    const hit = index.get(normalisePath(path));
    return { path, id: hit?.id, kind: hit?.kind, title: hit?.title };
  });
}

/**
 * Release 17: striking-distance pages. Google Search Console rows at average positions 8–20,
 * grouped by page and ranked by impressions, so title and summary work goes where extra
 * clicks are closest. Uses the latest stored Search Console snapshot; nothing is fetched.
 */
export async function opportunities(storeId: string, limit = 25) {
  const metric = await prisma.metric.findFirst({ where: { storeId, provider: "gsc" }, orderBy: { period: "desc" } });
  if (!metric) return { period: null, pages: [], note: "Connect Google Search Console and refresh analytics first." };
  const data = JSON.parse(metric.payload) as { rows?: { keys: string[]; position?: number; impressions: number; clicks: number }[]; start?: string; end?: string };
  const rows = (data.rows || []).filter((r) => r.position !== undefined && r.position >= 8 && r.position <= 20);
  const byPage = new Map<string, { page: string; impressions: number; clicks: number; queries: { query: string; position: number; impressions: number; clicks: number }[] }>();
  for (const r of rows) {
    const [page, query] = r.keys;
    const entry = byPage.get(page) || { page, impressions: 0, clicks: 0, queries: [] };
    entry.impressions += r.impressions;
    entry.clicks += r.clicks;
    entry.queries.push({ query, position: Math.round((r.position || 0) * 10) / 10, impressions: r.impressions, clicks: r.clicks });
    byPage.set(page, entry);
  }
  const ranked = [...byPage.values()].sort((a, b) => b.impressions - a.impressions).slice(0, Math.min(limit, 100));
  const found = await lookup(storeId, ranked.map((p) => p.page));
  return {
    period: { start: data.start, end: data.end },
    pages: ranked.map((p, i) => ({ ...p, resourceId: found[i]?.id, title: found[i]?.title, queries: p.queries.sort((a, b) => b.impressions - a.impressions).slice(0, 10) })),
  };
}

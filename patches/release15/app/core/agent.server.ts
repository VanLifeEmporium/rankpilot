/**
 * Release 15: agent workspace.
 *
 * A short-lived, signed access link minted from inside the authenticated
 * Shopify admin lets an assistant (or the merchant) open RankPilot at its own
 * top-level address, read findings as plain JSON/text and run bounded bulk
 * actions. Every write goes through the same change pipeline as the embedded
 * app: a Change row with before/after, approval, Shopify write, read-back
 * verification and individual undo.
 */
import { SignJWT, jwtVerify } from "jose";
import { load } from "cheerio";
import { z } from "zod";
import prisma from "../db.server";
import type { Issue, Payload } from "./types";
import { settings } from "./types";
import { actionGroups } from "./dashboard";
import { findingName } from "./merchant-copy";
import { approve, enqueue, log, tick, clientFor, verifyChange } from "./service.server";
import { fetchResource } from "./shopify-api.server";
import { publicFetch, limitedText } from "./crawl.server";

export const AGENT_ACTOR = "claude-agent";
export const AGENT_REASON =
  "agent-reviewed-v1: Written by the RankPilot agent from this page's own content at the merchant's request, checked against the page text and applied through the bulk tool. Undo is available in Results & history.";
const COOKIE = "rankpilot_agent";
const LINK_TTL = "15m";
const SESSION_SECONDS = 2 * 60 * 60;

export function agentEnabled() {
  return !["off", "false", "0"].includes(String(process.env.AGENT_ACCESS || "").toLowerCase());
}
function secret() {
  const raw = process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!raw || raw.length < 16) throw new Error("Agent access needs SESSION_SECRET to be configured.");
  return new TextEncoder().encode("rankpilot-agent:" + raw);
}
export async function mintLink(storeId: string, actor: string) {
  if (!agentEnabled()) throw new Error("Agent access is switched off (AGENT_ACCESS=off).");
  const token = await new SignJWT({ storeId, actor, use: "link" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("rankpilot-agent")
    .setIssuedAt()
    .setExpirationTime(LINK_TTL)
    .sign(secret());
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  await log(storeId, "Agent access link created", { actor });
  return `${base}/agent?t=${encodeURIComponent(token)}`;
}
async function verify(token: string, use: "link" | "session") {
  const { payload } = await jwtVerify(token, secret(), { audience: "rankpilot-agent" });
  if (payload.use !== use || typeof payload.storeId !== "string") throw new Error("Invalid agent token");
  return { storeId: payload.storeId, actor: String(payload.actor || "") };
}
const readCookie = (request: Request) =>
  (request.headers.get("Cookie") || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);

/** Exchange a link token for an HttpOnly session cookie. */
export async function exchange(linkToken: string) {
  const claims = await verify(linkToken, "link");
  const session = await new SignJWT({ storeId: claims.storeId, actor: claims.actor, use: "session" })
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
  try {
    const { storeId } = await verify(token, "session");
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    return { store };
  } catch {
    throw new Response("Agent session expired. Open a fresh link from RankPilot › Settings › Agent workspace.", { status: 401 });
  }
}
/** Writes must be same-origin and carry an explicit header (CSRF guard). */
export function requireAgentWrite(request: Request) {
  if (request.headers.get("x-rankpilot-agent") !== "1") throw new Response("Missing agent header", { status: 400 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new Response("Cross-origin request refused", { status: 403 });
}

const text = (html: string) => {
  const $ = load(html || "");
  $("script,style").remove();
  return $.root().text().replace(/\s+/g, " ").trim();
};
const urlOf = (domain: string, r: { kind: string; handle: string }, p: Payload) =>
  p.url || `${domain}/${r.kind === "article" ? `blogs/${p.blogHandle}` : r.kind + "s"}/${r.handle}`;

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
    release: "15",
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
  const rows = await prisma.resource.findMany({
    where: { storeId, ...(opts.ids?.length ? { id: { in: opts.ids } } : {}), ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: [{ kind: "asc" }, { title: "asc" }],
    skip: opts.offset || 0,
    take: Math.min(opts.limit || 50, 200),
  });
  return rows.map((r) => {
    const p: Payload = JSON.parse(r.payload);
    const body = text(p.descriptionHtml);
    return {
      id: r.id,
      kind: r.kind,
      title: p.title,
      handle: r.handle,
      url: urlOf(store.domain, r, p),
      published: p.published,
      seo: p.seo,
      seoLengths: { title: (p.seo?.title || "").length, description: (p.seo?.description || "").length },
      productType: p.productType,
      vendor: p.vendor,
      tags: p.tags,
      price: p.variants?.[0]?.price,
      images: opts.full ? p.images?.map((i) => ({ id: i.id, alt: i.alt, url: i.url })) : p.images?.length,
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
export function seoWarnings(title: string, description: string) {
  const w: string[] = [];
  if (title.length < 30 || title.length > 60) w.push(`title ${title.length} chars (target 30–60)`);
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

/** Create reviewed SEO changes for up to 25 pages; optionally approve and apply them. */
export async function bulkSeo(storeId: string, input: unknown) {
  const body = z
    .object({ items: z.array(z.unknown()).min(1).max(25), dryRun: z.boolean().default(false), apply: z.boolean().default(true) })
    .parse(input);
  const client = await clientFor(storeId);
  const results: { resourceId: string; ok: boolean; status: string; changeId?: string; message?: string; warnings?: string[] }[] = [];
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
      const warnings = seoWarnings(after.title, after.description);
      if (JSON.stringify(before) === JSON.stringify(after)) { results.push({ resourceId, ok: true, status: "unchanged", message: "Already saved" }); continue; }
      const busy = await prisma.change.findFirst({ where: { storeId, resourceId: r.id, status: { in: ["approved", "applying", "verifying", "rolling_back"] } } });
      if (busy) { results.push({ resourceId, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      if (body.dryRun) { results.push({ resourceId, ok: true, status: "valid", warnings, message: `${before.title || "(no Google title)"} → ${after.title}` }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await prisma.$transaction(async (tx) => {
        const next = await tx.change.create({
          data: { storeId, resourceId: r.id, feature: "seo", before: JSON.stringify(before), after: JSON.stringify(after), blockers: "[]", reasons: JSON.stringify([AGENT_REASON, ...warnings.map((w) => "Note: " + w)]) },
        });
        await tx.change.updateMany({ where: { storeId, resourceId: r.id, feature: "seo", status: "pending", id: { not: next.id } }, data: { status: "superseded", error: `Replaced by agent change ${next.id}` } });
        return next;
      });
      if (body.apply) await approve(storeId, row.id, AGENT_ACTOR);
      created.push(row.id);
      results.push({ resourceId, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id, warnings });
    } catch (e) {
      results.push({ resourceId, ok: false, status: "error", message: (e as Error).message });
    }
  }
  if (body.apply && created.length) await waitForApplies(storeId, created, 45000);
  const final = new Map((await prisma.change.findMany({ where: { id: { in: created } } })).map((c) => [c.id, c]));
  for (const r of results) if (r.changeId && final.get(r.changeId)) { const c = final.get(r.changeId)!; r.status = c.status; if (c.error) r.message = c.error; }
  await log(storeId, "Agent bulk SEO update", { dryRun: body.dryRun, count: results.length, applied: results.filter((r) => r.status === "applied").length });
  return { dryRun: body.dryRun, results };
}

/** Approve existing pending proposals (e.g. image-reviewed alt text) in bulk. */
export async function bulkApprove(storeId: string, input: unknown) {
  const { ids } = z.object({ ids: z.array(z.string()).min(1).max(25) }).parse(input);
  const results: { id: string; ok: boolean; message?: string }[] = [];
  const ok: string[] = [];
  for (const id of ids) {
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
  const { assertSafeCopy } = await import("./service.server");
  const target = body.stale
    ? rows.filter((c) => { try { assertSafeCopy(c.feature, JSON.parse(c.before), JSON.parse(c.after), JSON.parse(c.reasons)); return JSON.parse(c.blockers).length > 0; } catch { return true; } })
    : rows;
  const updated = await prisma.change.updateMany({ where: { id: { in: target.map((c) => c.id) }, status: "pending" }, data: { status: "rejected", error: body.reason } });
  await log(storeId, "Agent bulk reject", { count: updated.count, reason: body.reason, stale: !!body.stale });
  return { rejected: updated.count, considered: rows.length };
}

/** Recheck pages that returned an HTTP error, one at a time with polite spacing. */
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
  const { kind, ids, feature } = z.object({ kind: z.enum(["audit", "indexation", "refresh-audit", "generate-alt"]), ids: z.array(z.string()).max(50).optional(), feature: z.string().optional() }).parse(input);
  if (kind === "generate-alt") {
    const { enqueueGeneration } = await import("./service.server");
    if (!ids?.length) throw new Error("Pass product ids for alt text generation");
    return { job: await enqueueGeneration(storeId, ids, "alt") , feature };
  }
  const active = await prisma.job.findFirst({ where: { storeId, kind, status: { in: ["queued", "running"] } } });
  return { job: active || (await enqueue(storeId, kind)) };
}

export async function jobs(storeId: string) {
  return prisma.job.findMany({ where: { storeId }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, kind: true, status: true, error: true, attempts: true, updatedAt: true } });
}

export async function recheckChange(storeId: string, id: string) {
  return verifyChange(storeId, id);
}

export async function brandSettings(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const s = settings(store.settings);
  return { brandVoice: s.brandVoice, titleBrand: s.titleBrand, titleBrandMode: s.titleBrandMode };
}

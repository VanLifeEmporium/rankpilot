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
import type { Issue, Payload, Facts } from "./types";
import { settings } from "./types";
import { actionGroups } from "./dashboard";
import { findingName } from "./merchant-copy";
import { approve, enqueue, log, tick, clientFor, verifyChange, assertSafeCopy, enqueueGeneration, proposeRedirect, sync, scheduleCatalogueRefresh } from "./service.server";
import { fetchResource } from "./shopify-api.server";
import { publicFetch, limitedText } from "./crawl.server";
import { dismissChanges, settleStaleChanges } from "./history-hygiene.server";
import { applyFindingState } from "./finding-state";
import { friendlyError } from "./db-errors";
import { withDbRetry } from "./db-retry";
import { productBrands, storeNames } from "./brand-detect";
import { ProtectedPageError } from "./protected-pages.server";
import { allowedCaps, brandGate, brandRuleHits, newRuleErrors, ruleErrors, ruleSummary, unverifiedClaims, wordCut } from "./brand-rules";

export const RELEASE = "22";
export const AGENT_ACTOR = "claude-agent";
/** Release 20 (RP-605): every write that does nothing says why, so a no-op is not read as a failure. */
export const NO_CHANGE = "No change: value already set";
export const AGENT_REASON =
  "agent-reviewed-v1: Written by the RankPilot agent from this page's own content at the merchant's request, checked against the page text and applied through the bulk tool. Undo is available in Results & history.";
const COOKIE = "rankpilot_agent";
const LINK_TTL = "15m";
const SESSION_SECONDS = 2 * 60 * 60;
const BUSY = ["approved", "applying", "verifying", "rolling_back"];
/** Release 19: batches return within about 10 s; changes still saving show as applying — poll GET changes?ids=. */
const AGENT_WAIT_MS = Number(process.env.AGENT_WAIT_MS) || 7000;
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
  if (!claims.jti) throw new Error("Invalid agent link");
  // Release 19: single use is atomic. The first request inserts the link id (primary key);
  // any concurrent or later request fails on the unique constraint.
  try {
    await prisma.webhookReceipt.create({ data: { id: `agent-link:${claims.jti}`, storeId: claims.storeId } });
  } catch {
    throw new Error("This link has already been used");
  }
  await log(claims.storeId, "Agent link used", { jti: claims.jti, actor: claims.actor });
  const session = await new SignJWT({ storeId: claims.storeId, actor: claims.actor, use: "session", epoch })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("rankpilot-agent")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(secret());
  await log(claims.storeId, "Agent session opened", { actor: claims.actor });
  const secure = String(process.env.SHOPIFY_APP_URL || "").startsWith("https:") ? "; Secure" : "";
  // Release 19: Lax, so the cookie is kept when the link is opened from Shopify admin (a cross-site navigation).
  // Writes stay protected by the x-rankpilot-agent header and the same-origin check.
  return `${COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
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
  const [audit, store] = await Promise.all([prisma.audit.findFirst({ where: { storeId }, orderBy: { createdAt: "desc" } }), prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } })]);
  // Release 18: snoozed and accepted findings are left out, as in the app.
  // Release 20 (RP-301): findings on unpublished pages are left out (they carry unpublished: true when listed).
  return audit ? applyFindingState(JSON.parse(audit.issues) as Issue[], settings(store?.settings || "{}")).active.filter((i) => !i.unpublished) : [];
}

export async function overview(storeId: string) {
  const [store, audit, counts, score] = await Promise.all([
    prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
    prisma.audit.findFirst({ where: { storeId }, orderBy: { createdAt: "desc" } }),
    prisma.change.groupBy({ by: ["status"], where: { storeId }, _count: true }),
    prisma.metric.findFirst({ where: { storeId, provider: "store-score" }, orderBy: { period: "desc" } }),
  ]);
  const issues: Issue[] = audit ? applyFindingState(JSON.parse(audit.issues) as Issue[], settings(store.settings)).active.filter((i) => !i.unpublished) : [];
  return {
    release: RELEASE,
    store: store.id,
    domain: store.domain,
    // Release 19: one Answer readiness figure; the separate aeoScore is retired.
    audit: audit ? { at: audit.createdAt, catalogueChecks: audit.score, answerReadiness: JSON.parse(audit.coverage || "{}").answerReadiness ?? null, pages: audit.resourceCount } : null,
    storeScore: score ? JSON.parse(score.payload) : null,
    groups: actionGroups(issues).map((g) => ({ key: g.key, name: findingName(g.code), pages: g.count, occurrences: g.occurrences })),
    changes: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  };
}

export async function findings(storeId: string, group?: string) {
  const issues = await latestIssues(storeId);
  const resources = await prisma.resource.findMany({ where: { storeId }, select: { id: true, kind: true, handle: true, title: true } });
  const byId = new Map(resources.map((r) => [r.id, r]));
  // Release 22 (R22-402, R22-701): the proposal already waiting for a finding, so agents don't duplicate it.
  const { splitInProgress, findingKey } = await import("./finding-state");
  const split = splitInProgress(issues, await prisma.change.findMany({ where: { storeId, status: { in: ["pending", "approved", "applying", "verifying"] } }, orderBy: { createdAt: "asc" }, select: { id: true, resourceId: true, feature: true, status: true } }), resources.filter((r) => r.kind === "redirect"));
  const pending = new Map(split.inProgress.map((i) => [findingKey(i), i.pending]));
  return actionGroups(issues)
    .filter((g) => !group || g.key === group || g.code === group)
    .map((g) => ({
      key: g.key,
      name: findingName(g.code),
      pages: g.count,
      // Release 22 (R22-701): pages with nothing waiting; in-progress items carry status and pendingChangeId.
      openPages: new Set(g.items.filter((i) => !pending.has(findingKey(i))).map((i) => i.resourceId)).size,
      items: g.items.map((i) => ({
        resourceId: i.resourceId,
        kind: byId.get(i.resourceId)?.kind,
        handle: byId.get(i.resourceId)?.handle,
        title: i.title,
        code: i.code,
        severity: i.severity,
        detail: i.detail,
        link: i.link,
        // Release 20 (RP-604): the change behind a changed-outside finding, for POST keep-shopify.
        ...(i.changeId ? { changeId: i.changeId } : {}),
        ...(i.template ? { template: i.template } : {}),
        ...(pending.get(findingKey(i)) ? { pendingChangeId: pending.get(findingKey(i))!.changeId, status: pending.get(findingKey(i))!.label } : {}),
      })),
    }));
}

export async function pages(storeId: string, opts: { ids?: string[]; kind?: string; limit?: number; offset?: number; full?: boolean }) {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const shopName = shopNameOf(store);
  // Release 19: paged with total and offset (the old response stopped silently at 200).
  const where = { storeId, ...(opts.ids?.length ? { id: { in: opts.ids } } : {}), ...(opts.kind ? { kind: opts.kind } : {}) };
  const offset = Math.max(0, opts.offset || 0), limit = Math.max(1, Math.min(opts.limit || 50, 200));
  const [total, rows] = await Promise.all([prisma.resource.count({ where }), prisma.resource.findMany({ where, orderBy: [{ kind: "asc" }, { title: "asc" }, { id: "asc" }], skip: offset, take: limit })]);
  const items = rows.map((r) => {
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
      // Release 19: grounding data, so an agent can write without scraping the storefront.
      ...(opts.full ? {
        variants: (p.variants || []).map((v) => ({ sku: v.sku, barcode: v.barcode, price: v.price, options: v.selectedOptions })),
        productFields: p.metafields || {},
        confirmedFacts: Object.fromEntries(Object.entries(JSON.parse(r.facts || "{}") as Facts).filter(([, f]) => f?.confirmed).map(([k, f]) => [k, { value: f.value, source: f.source }])),
        faqs: p.faqs || [],
      } : {}),
      text: opts.full ? body.slice(0, 6000) : body.slice(0, 700),
      textLength: body.length,
    };
  });
  return { total, offset, limit, hasMore: offset + items.length < total, items };
}

/**
 * Release 20 (RP-604): filter by resourceId and page with offset. When resourceId or offset is given the
 * response is {total, offset, limit, hasMore, items}; otherwise it stays a plain list (the latest 100, up to 500).
 */
export async function changes(storeId: string, opts: { status?: string; ids?: string[]; resourceIds?: string[]; limit?: number; offset?: number; actor?: string }) {
  const where = {
    storeId,
    // Release 19: "verified" is an alias for applied (saved and read back from Shopify).
    ...(opts.status ? { status: { in: opts.status.split(",").map((x) => (x === "verified" ? "applied" : x)) } } : {}),
    ...(opts.ids?.length ? { id: { in: opts.ids } } : {}),
    ...(opts.resourceIds?.length ? { resourceId: { in: opts.resourceIds } } : {}),
    ...(opts.actor ? { approvedBy: opts.actor } : {}),
  };
  const paged = !!opts.resourceIds?.length || opts.offset !== undefined;
  const offset = Math.max(0, opts.offset || 0), limit = Math.max(1, Math.min(opts.limit || 100, 500));
  const [total, rows] = await Promise.all([
    paged ? prisma.change.count({ where }) : Promise.resolve(0),
    prisma.change.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
  ]);
  const titles = new Map((await prisma.resource.findMany({ where: { storeId, id: { in: rows.map((r) => r.resourceId) } }, select: { id: true, title: true } })).map((r) => [r.id, r.title]));
  const items = rows.map((c) => ({
    id: c.id,
    resourceId: c.resourceId,
    page: titles.get(c.resourceId),
    feature: c.feature,
    status: c.status,
    // Release 22 (R22-104): an applied FAQ is verified only when it is in the live page HTML.
    verified: c.status === "applied" && !c.error?.startsWith("Saved, not live"),
    ...(c.feature === "faq" && c.status === "applied" ? { live: !c.error?.startsWith("Saved, not live") } : {}),
    error: c.error,
    approvedBy: c.approvedBy,
    before: JSON.parse(c.before),
    after: JSON.parse(c.after),
    createdAt: c.createdAt,
    appliedAt: c.appliedAt,
  }));
  return paged ? { total, offset, limit, hasMore: offset + items.length < total, items } : items;
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
    // Release 22 (R22-203): a resent failed item has its own retry job; wait on the newest one still queued.
    const job = (await prisma.job.findFirst({ where: { storeId, kind: "apply", status: { in: ["queued", "running"] }, payload: { contains: `"changeId":"${id}"` } }, orderBy: { createdAt: "desc" } })) || (await prisma.job.findUnique({ where: { dedup: `${storeId}:apply:${id}` } }));
    if (!job || Date.now() > deadline) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      tick({ jobId: job.id }).catch(() => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, Math.max(500, Math.min(8000, deadline - Date.now()))); }),
    ]).finally(() => timer && clearTimeout(timer));
  }
}

export class BusyError extends Error {}
/**
 * Create one reviewed change. Refuses while another update is applying to the page and
 * supersedes pending previews for the same field, so an older preview accepted later
 * cannot silently undo this one. Body edits (description and links) count as one field.
 */
export async function stageChange(storeId: string, resourceId: string, feature: string, before: unknown, after: unknown, reasons: string[]) {
  // Release 20 (RP-603): never write over an edit made in Shopify that the merchant has not resolved.
  const { assertNotProtected } = await import("./protected-pages.server");
  await assertNotProtected(storeId, resourceId);
  const family = BODY_FEATURES.includes(feature) ? BODY_FEATURES : [feature];
  // Release 22 (R22-203): resending the same proposal returns the one already waiting, never a duplicate.
  const same = await prisma.change.findFirst({ where: { storeId, resourceId, feature, status: "pending", after: JSON.stringify(after) }, orderBy: { createdAt: "desc" } });
  if (same) return same;
  // Release 22 (R22-201): retried when the database is still busy; nothing has been sent to Shopify yet.
  return withDbRetry(() => prisma.$transaction(async (tx) => {
    const busy = await tx.change.findFirst({ where: { storeId, resourceId, status: { in: BUSY } } });
    if (busy) throw new BusyError("Another update is applying to this page");
    const next = await tx.change.create({
      data: { storeId, resourceId, feature, before: JSON.stringify(before), after: JSON.stringify(after), blockers: "[]", reasons: JSON.stringify(reasons) },
    });
    await tx.change.updateMany({ where: { storeId, resourceId, feature: { in: family }, status: "pending", id: { not: next.id } }, data: { status: "superseded", error: `Replaced by agent change ${next.id}` } });
    return next;
  }));
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
    .object({ items: z.array(z.unknown()).min(1).max(25), dryRun: z.boolean().default(true), apply: z.boolean().default(false) })
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
      // Release 19: brand rules and unverified claims make an SEO item invalid, including in a dry run.
      const blocked = brandGate("seo", before, after, JSON.parse(r.facts || "{}"), { allow: allowedCaps(live.vendor, live.title, settings(store.settings).capsAllowlist), brands: productBrands(live, storeNames(store)), productTitle: live.title, storeNames: storeNames(store) });
      if (blocked.length) { results.push({ resourceId, ok: false, status: "invalid", message: blocked.join("; "), warnings }); continue; }
      if (before.title.trim() === after.title && before.description.trim() === after.description) { results.push({ resourceId, ok: true, status: "unchanged", message: NO_CHANGE }); continue; }
      if (await isBusy(storeId, r.id)) { results.push({ resourceId, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      if (body.dryRun) { results.push({ resourceId, ok: true, status: "valid", warnings, message: `${before.title || "(no Google title)"} → ${after.title}` }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await stageChange(storeId, r.id, "seo", before, after, [AGENT_REASON, ...warnings.map((w) => "Note: " + w)]);
      if (body.apply) await approve(storeId, row.id, AGENT_ACTOR);
      created.push(row.id);
      results.push({ resourceId, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id, warnings });
    } catch (e) {
      results.push({ resourceId, ok: false, status: e instanceof BusyError ? "busy" : e instanceof ProtectedPageError ? "protected" : "error", message: friendlyError(e) });
    }
  }
  await settleResults(storeId, results, body.apply ? created : [], AGENT_WAIT_MS);
  await log(storeId, "Agent bulk SEO update", { dryRun: body.dryRun, count: results.length, applied: results.filter((r) => r.status === "applied").length });
  return { dryRun: body.dryRun, results };
}

/** Approve existing pending proposals (e.g. image-reviewed alt text) in bulk. */
/**
 * Release 22 (R22-203): safe to resend. Each id says what happened: applied changes are left alone,
 * ones still saving are reported, and ones whose apply failed are queued again (only those).
 */
export async function bulkApprove(storeId: string, input: unknown) {
  const { ids } = z.object({ ids: z.array(z.string()).min(1).max(25) }).parse(input);
  const results: { id: string; ok: boolean; status?: string; message?: string }[] = [];
  const queued: string[] = [];
  const rows = new Map((await prisma.change.findMany({ where: { storeId, id: { in: ids } } })).map((c) => [c.id, c]));
  for (const id of [...new Set(ids)]) {
    const c = rows.get(id);
    if (!c) { results.push({ id, ok: false, status: "not_found", message: "No change with this id for this store" }); continue; }
    if (c.status === "applied") { results.push({ id, ok: true, status: "applied", message: "No change: already applied" }); continue; }
    if (["approved", "applying", "verifying"].includes(c.status)) { results.push({ id, ok: true, status: c.status, message: "Already approved; still saving" }); queued.push(id); continue; }
    try {
      if (["apply_failed", "verification_failed"].includes(c.status)) {
        // Only the failed item is sent again; the apply step re-reads Shopify before writing.
        await withDbRetry(() => prisma.$transaction([
          prisma.change.updateMany({ where: { id, storeId, status: c.status }, data: { status: "approved", error: null, approvedBy: AGENT_ACTOR } }),
          prisma.job.create({ data: { storeId, kind: "apply", payload: JSON.stringify({ changeId: id, verificationPass: 13 }), dedup: `${storeId}:apply:${id}:retry:${Date.now()}` } }),
        ]));
      } else await approve(storeId, id, AGENT_ACTOR);
      queued.push(id); results.push({ id, ok: true });
    } catch (e) { results.push({ id, ok: false, status: c.status, message: friendlyError(e) }); }
  }
  if (queued.length) await waitForApplies(storeId, queued, 45000);
  const final = new Map((await prisma.change.findMany({ where: { id: { in: queued } } })).map((c) => [c.id, c]));
  return {
    results: results.map((r) => {
      const c = final.get(r.id);
      if (!c) return r;
      const failed = ["apply_failed", "verification_failed", "conflict"].includes(c.status);
      return { ...r, ok: !failed, status: c.status, ...(failed ? { message: c.error || "The update failed; send this id again to retry" } : {}) };
    }),
  };
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
  const { kind, ids, limit } = z.object({ kind: z.enum(["audit", "indexation", "refresh-audit", "generate-alt", "recheck-pages", "crux"]), ids: z.array(z.string()).max(50).optional(), limit: z.number().int().min(1).max(40).optional() }).parse(input);
  if (kind === "generate-alt") {
    if (!ids?.length) throw new Error("Pass product ids for alt text generation");
    // Release 20 (RP-601): an explicit request always runs again, instead of returning an earlier completed job.
    return { job: await enqueueGeneration(storeId, ids, "alt", true) };
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
  const isEmpty = (p: { open: Tag; close: Tag }) => !/<(img|svg|picture|video|iframe)\b/i.test(inner(p)) && !load(`<div>${inner(p)}</div>`)("div").text().replace(/[\s\u00a0]+/g, "");
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
  const body = z.object({ ids: z.array(z.string()).min(1).max(25), dryRun: z.boolean().default(true), apply: z.boolean().default(false) }).parse(input);
  const client = await clientFor(storeId);
  const results: Result[] = [];
  const created: string[] = [];
  for (const id of [...new Set(body.ids)]) {
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id, storeId } });
      const live: Payload = client ? await fetchResource(client, r.remoteId, r.kind) : JSON.parse(r.payload);
      const fixed = fixHeadingOrder(live.descriptionHtml);
      if ("skipped" in fixed && fixed.skipped) { results.push({ resourceId: id, title: r.title, ok: false, status: "skipped", message: fixed.skipped }); continue; }
      if (!fixed.changes.length) { results.push({ resourceId: id, title: r.title, ok: true, status: "unchanged", message: "No change: heading levels are already in order" }); continue; }
      if (text(fixed.html) !== text(live.descriptionHtml)) throw new Error("Heading repair would change visible text; skipped.");
      if (await isBusy(storeId, r.id)) { results.push({ resourceId: id, title: r.title, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      if (body.dryRun) { results.push({ resourceId: id, title: r.title, ok: true, status: "valid", changes: fixed.changes }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await stageChange(storeId, r.id, "description", live.descriptionHtml, fixed.html, [AGENT_REASON, "Heading order repair: " + fixed.changes.join("; "), "Visible text is unchanged; only heading levels change, with the original size kept as a class."]);
      // Release 19: agent writes arrive as pending proposals unless apply: true is sent.
      if (body.apply) { await approve(storeId, row.id, AGENT_ACTOR); created.push(row.id); }
      results.push({ resourceId: id, title: r.title, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id, changes: fixed.changes });
    } catch (e) {
      results.push({ resourceId: id, ok: false, status: e instanceof BusyError ? "busy" : e instanceof ProtectedPageError ? "protected" : "error", message: friendlyError(e) });
    }
  }
  await settleResults(storeId, results, created, AGENT_WAIT_MS);
  await log(storeId, "Agent heading repair", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

const BLOCKED_HTML = /<\s*(script|style|iframe|object|embed|form|input|button|link|meta)\b|\son[a-z]+\s*=|javascript:/i;
const ALLOWED_TAGS = new Set(["h2", "h3", "h4", "h5", "h6", "p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "a", "table", "thead", "tbody", "tr", "th", "td", "img", "span", "div", "blockquote", "dl", "dt", "dd", "details", "summary", "h1"]);
const ALLOWED_ATTRS: Record<string, string[]> = { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height", "loading"] };
/** Release 19: tags and tag[attribute] pairs already used in a stored body (articles and pages keep their layout). */
export function markupOf(html: string) {
  const $ = load(html || "", null, false);
  const tags = new Set<string>(), attrs = new Set<string>();
  $("*").each((_, el) => {
    const name = (el as unknown as { name: string }).name;
    tags.add(name);
    for (const attr of Object.keys((el as unknown as { attribs: Record<string, string> }).attribs || {})) if (!/^on/i.test(attr)) attrs.add(`${name}[${attr}]`);
  });
  for (const t of ["script", "style", "iframe", "object", "embed", "form", "input", "button", "link", "meta"]) tags.delete(t);
  return { tags, attrs };
}
function htmlOutsideAllowed(html: string, existing: { tags: Set<string>; attrs: Set<string> } = { tags: new Set(), attrs: new Set() }) {
  const $ = load(html, null, false);
  const bad = new Set<string>();
  $("*").each((_, el) => {
    const name = (el as unknown as { name: string }).name;
    if (!ALLOWED_TAGS.has(name) && !existing.tags.has(name)) bad.add(`<${name}>`);
    for (const attr of Object.keys((el as unknown as { attribs: Record<string, string> }).attribs || {}))
      if (attr !== "class" && !(ALLOWED_ATTRS[name] || []).includes(attr) && !existing.attrs.has(`${name}[${attr}]`)) bad.add(`${name}[${attr}]`);
    const url = $(el).attr("href") || $(el).attr("src");
    if (url && !/^(https:|mailto:|tel:|\/(?!\/)|#)/i.test(url)) bad.add(`${name} link “${url.slice(0, 40)}”`);
  });
  return [...bad];
}
export const descriptionItem = z.object({ resourceId: z.string().min(1), html: z.string().trim().min(1).max(60000) });
export function descriptionProblems(html: string, context: { before?: string; facts?: Facts; kind?: string; allow?: Iterable<string> } = {}) {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Release 19: the shared brand rules and unverified-claim checks are errors, not warnings.
  const before = context.before || "";
  const ruleHits = newRuleErrors(before, html, { allow: context.allow });
  if (ruleHits.length) errors.push(`Breaks the brand rules: ${ruleSummary(ruleHits)}.`);
  errors.push(...unverifiedClaims(html, context.facts || {}, before));
  const cut = wordCut(before, html);
  if (cut) errors.push(cut);
  const spelling = brandRuleHits(html).filter((h) => h.severity === "warning");
  if (spelling.length) warnings.push(ruleSummary(spelling));
  if (BLOCKED_HTML.test(html)) errors.push("Scripts, styles, frames, forms and event handlers are not allowed.");
  // Release 19: guides and pages may keep markup their stored body already uses (aside, figure, hr, ids, styles).
  const outside = htmlOutsideAllowed(html, ["article", "page"].includes(context.kind || "") ? markupOf(context.before || "") : undefined);
  if (outside.length) errors.push(`Not allowed in a description: ${outside.slice(0, 6).join(", ")}. Use headings H2–H6, paragraphs, lists, links, tables, images and emphasis.`);
  if (/<h1\b/i.test(html)) errors.push("Do not use H1 in a body; the theme already renders the page title as H1.");
  const words = text(html).split(/\s+/).filter(Boolean).length;
  if (words < 40) errors.push(`Only ${words} words; write a useful description.`);
  else if (words < 80) warnings.push(`${words} words (thin-content threshold is 80)`);
  if (fixHeadingOrder(html).changes.length) warnings.push("heading levels skip or do not start at H2");
  return { errors, warnings, words };
}
/**
 * Release 17: reviewed description or body rewrites for products, collections, pages and articles.
 * Dry run by default. The agent writes from the page's own facts at the merchant's request;
 * the change pipeline verifies the save and keeps an exact undo.
 */
export async function bulkDescription(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(z.unknown()).min(1).max(10), dryRun: z.boolean().default(true), apply: z.boolean().default(false) }).parse(input);
  const client = await clientFor(storeId);
  const capsAllowlist = settings((await prisma.store.findUnique({ where: { id: storeId }, select: { settings: true } }))?.settings || "{}").capsAllowlist;
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
      const live: Payload = client ? await fetchResource(client, r.remoteId, r.kind) : JSON.parse(r.payload);
      const { errors, warnings, words } = descriptionProblems(parsed.data.html, { before: live.descriptionHtml, facts: JSON.parse(r.facts || "{}"), kind: r.kind, allow: allowedCaps(live.vendor, live.title, capsAllowlist) });
      if (errors.length) { results.push({ resourceId, title: r.title, ok: false, status: "invalid", message: errors.join(" "), warnings }); continue; }
      if (text(live.descriptionHtml) === text(parsed.data.html) && live.descriptionHtml.trim() === parsed.data.html) { results.push({ resourceId, title: r.title, ok: true, status: "unchanged", message: NO_CHANGE }); continue; }
      if (await isBusy(storeId, r.id)) { results.push({ resourceId, title: r.title, ok: false, status: "busy", message: "Another update is applying to this page" }); continue; }
      const summary = `word count ${text(live.descriptionHtml).split(/\s+/).filter(Boolean).length} to ${words}`;
      if (body.dryRun) { results.push({ resourceId, title: r.title, ok: true, status: "valid", warnings, message: summary }); continue; }
      await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify(live) } });
      const row = await stageChange(storeId, r.id, "description", live.descriptionHtml, parsed.data.html, [AGENT_REASON, `Description rewrite (${summary}).`, ...warnings.map((w) => "Note: " + w)]);
      if (body.apply) await approve(storeId, row.id, AGENT_ACTOR);
      created.push(row.id);
      results.push({ resourceId, title: r.title, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id, warnings, message: summary });
    } catch (e) {
      results.push({ resourceId, ok: false, status: e instanceof BusyError ? "busy" : e instanceof ProtectedPageError ? "protected" : "error", message: friendlyError(e) });
    }
  }
  await settleResults(storeId, results, body.apply ? created : [], AGENT_WAIT_MS);
  await log(storeId, "Agent description update", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

/** Release 17: forward retired or missing addresses (including ones that redirect to the home page). */
export async function bulkRedirects(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(z.object({ path: z.string().min(1).max(500), target: z.string().min(1).max(500) })).min(1).max(20), dryRun: z.boolean().default(true), apply: z.boolean().default(false) }).parse(input);
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
      if (!body.apply) { results.push({ ...item, ok: true, status: "pending", changeId: change.id, message: "Waiting for the merchant to approve." }); continue; }
      if (change.status === "pending") await approve(storeId, change.id, AGENT_ACTOR);
      created.push(change.id);
      results.push({ ...item, ok: true, status: "approved", changeId: change.id });
    } catch (e) {
      results.push({ ...item, ok: false, status: "error", message: friendlyError(e) });
    }
  }
  if (created.length) await waitForApplies(storeId, created, AGENT_WAIT_MS);
  const final = new Map((await prisma.change.findMany({ where: { id: { in: created } } })).map((c) => [c.id, c]));
  for (const r of results) { const c = r.changeId && final.get(r.changeId); if (c) { r.status = c.status; if (c.error) r.message = c.error; } }
  await log(storeId, "Agent redirect update", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

const idsOf = (body: { ids?: string[]; resourceIds?: string[] }) => body.ids || body.resourceIds || [];
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
    // Release 19: the shared brand rules (supplier formatting, sales language, capitals, imperial units, "!").
    const ruleHits = ruleErrors([p.title, p.seo?.title || "", p.seo?.description || "", p.descriptionHtml || ""].join("\n"), { allow: allowedCaps(p.vendor, p.title, settings(store.settings).capsAllowlist) });
    for (const rule of new Set(ruleHits.map((h) => h.rule))) reasons.push(rule);
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
  // Release 20 (RP-303): only live, published, indexable pages. 404s are reported as findings instead (RP-302).
  const { storeLiveness } = await import("./page-liveness.server");
  const live = await storeLiveness(storeId);
  const all = [...byPage.values()].sort((a, b) => b.impressions - a.impressions);
  const excluded = all.map((p) => ({ page: p.page, impressions: p.impressions, ...live(p.page) })).filter((x) => !x.live);
  const ranked = all.filter((p) => live(p.page).live).slice(0, Math.min(limit, 100));
  const found = await lookup(storeId, ranked.map((p) => p.page));
  return {
    period: { start: data.start, end: data.end },
    pages: ranked.map((p, i) => ({ ...p, resourceId: found[i]?.id, title: found[i]?.title, queries: p.queries.sort((a, b) => b.impressions - a.impressions).slice(0, 10) })),
    excluded: excluded.slice(0, 50).map((x) => ({ page: x.page, impressions: x.impressions, reason: x.reason })),
  };
}

/** Release 18: supplier originals (e.g. from Store Operations) and the products still on supplier copy. */
export async function supplierOriginals(storeId: string, input: unknown) {
  const { saveSupplierOriginals } = await import("./supplier-copy.server");
  const result = await saveSupplierOriginals(storeId, input);
  await log(storeId, "Agent supplier originals", { count: result.saved });
  return result;
}
export async function supplierCopy(storeId: string) {
  const { supplierCopyReport } = await import("./supplier-copy.server");
  return supplierCopyReport(storeId);
}
/** Release 18: formatting-only clean-up proposals. Dry run by default; apply approves them through the change pipeline. */
export async function cleanFormatting(storeId: string, input: unknown) {
  // Release 19: ids, like every other endpoint (resourceIds still accepted).
  const raw = z.object({ ids: z.array(z.string().min(1)).max(20).optional(), resourceIds: z.array(z.string().min(1)).max(20).optional(), dryRun: z.boolean().default(true), apply: z.boolean().default(false) }).parse(input);
  const body = { ...raw, resourceIds: z.array(z.string()).min(1, "Send ids").parse(idsOf(raw)) };
  const { cleanSupplierHtml } = await import("./html-cleanup");
  const { proposeCleanFormatting } = await import("./supplier-copy.server");
  const results: { resourceId: string; ok: boolean; status: string; removed?: string[]; changeId?: string; message?: string }[] = [];
  const created: string[] = [];
  for (const resourceId of body.resourceIds) {
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id: resourceId, storeId } });
      const preview = cleanSupplierHtml(JSON.parse(r.payload).descriptionHtml || "");
      if (body.dryRun) { results.push({ resourceId, ok: preview.sameText, status: preview.removed.length ? (preview.sameText ? "valid" : "invalid") : "unchanged", removed: preview.removed, message: !preview.removed.length ? "No change: no supplier formatting to remove" : preview.sameText ? undefined : "Clean-up would change visible text" }); continue; }
      const { change, message } = await proposeCleanFormatting(storeId, resourceId);
      if (!change) { results.push({ resourceId, ok: true, status: "unchanged", message: /^No change/.test(message || "") ? message : `No change: ${message || "nothing to clean"}` }); continue; }
      if (!body.apply) { results.push({ resourceId, ok: true, status: "pending", changeId: change.id, removed: preview.removed }); continue; }
      await approve(storeId, change.id, AGENT_ACTOR);
      created.push(change.id);
      results.push({ resourceId, ok: true, status: "approved", changeId: change.id, removed: preview.removed });
    } catch (e) {
      results.push({ resourceId, ok: false, status: e instanceof ProtectedPageError ? "protected" : "error", message: friendlyError(e) });
    }
  }
  if (created.length) await waitForApplies(storeId, created, AGENT_WAIT_MS);
  await log(storeId, "Agent formatting clean-up", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}
/** Release 18: pre/post-deploy check — products whose description yields no rule-based specification. */
export async function specCoverageReport(storeId: string) {
  const { specCoverage } = await import("./spec-review.server");
  const products = await prisma.resource.findMany({ where: { storeId, kind: "product" }, select: { payload: true } });
  return { ...specCoverage(products), baseline: { date: "2026-09-29", none: 241, total: 315 }, target: "under 30% with no suggestions" };
}

// ---------------------------------------------------------------------------
// Release 19 (R19-11): the merchant UI's actions, for agents. Writes follow the same rules:
// dry run by default, pending proposals unless apply: true, brand rules and claim checks.
// ---------------------------------------------------------------------------
/** Undo applied changes (queued on the apply lane; poll GET changes?ids=). */
export async function undoChanges(storeId: string, input: unknown) {
  const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(20) }).parse(input);
  const results: { id: string; ok: boolean; status: string; message?: string }[] = [];
  for (const id of body.ids) {
    const c = await prisma.change.findFirst({ where: { id, storeId } });
    if (!c) { results.push({ id, ok: false, status: "not_found", message: "No change: this change id was not found for this store" }); continue; }
    if (c.status !== "applied") { results.push({ id, ok: false, status: c.status, message: "Only an applied change can be undone" }); continue; }
    await enqueue(storeId, "rollback", { changeId: c.id }, c.id);
    results.push({ id, ok: true, status: "queued", message: "Undo queued; check GET changes?ids= for rolled_back or rollback_failed" });
  }
  await log(storeId, "Agent undo", { count: results.length, actor: AGENT_ACTOR });
  return { results };
}
/** Keep the value now in Shopify for a changed-outside finding (no Shopify write). */
export async function keepShopifyVersion(storeId: string, input: unknown) {
  const body = z.object({ changeIds: z.array(z.string().min(1)).min(1).max(50) }).parse(input);
  const { keepShopify } = await import("./finding-state");
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  let cfg = settings(store.settings);
  const rows = await prisma.change.findMany({ where: { storeId, id: { in: body.changeIds }, status: { in: ["applied", "rollback_failed"] } } });
  for (const r of rows) cfg = keepShopify(cfg, r.id);
  await prisma.store.update({ where: { id: storeId }, data: { settings: JSON.stringify(cfg) } });
  await scheduleCatalogueRefresh(storeId);
  await log(storeId, "Agent kept Shopify's version", { count: rows.length, actor: AGENT_ACTOR });
  return { kept: rows.map((r) => r.id), notFound: body.changeIds.filter((id) => !rows.some((r) => r.id === id)) };
}
/** Confirm (or undo) "No manufacturer barcode" on own-label products. */
export async function noBarcode(storeId: string, input: unknown) {
  const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(500), undo: z.boolean().default(false) }).parse(input);
  const { noBarcodeFact } = await import("./finding-state");
  const rows = await prisma.resource.findMany({ where: { storeId, kind: "product", id: { in: body.ids } }, select: { id: true, facts: true } });
  for (const r of rows) { const facts = JSON.parse(r.facts || "{}"); if (body.undo) delete facts.barcode; else facts.barcode = noBarcodeFact(); await prisma.resource.update({ where: { id: r.id }, data: { facts: JSON.stringify(facts) } }); }
  await scheduleCatalogueRefresh(storeId);
  await log(storeId, body.undo ? "Agent removed no-barcode confirmation" : "Agent confirmed no manufacturer barcode", { count: rows.length, actor: AGENT_ACTOR });
  return { updated: rows.map((r) => r.id), notFound: body.ids.filter((id) => !rows.some((r) => r.id === id)), undo: body.undo };
}
/** Snooze findings until a date with a reason, or bring them back. */
export async function snoozeFindings(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(z.object({ resourceId: z.string().min(1), code: z.string().min(1), until: z.string().optional(), reason: z.string().optional() })).min(1).max(50), unsnooze: z.boolean().default(false) }).parse(input);
  const { snooze, unsnooze } = await import("./finding-state");
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  let cfg = settings(store.settings);
  const results: { resourceId: string; code: string; ok: boolean; message?: string }[] = [];
  for (const i of body.items) {
    try { cfg = body.unsnooze ? unsnooze(cfg, i) : snooze(cfg, { resourceId: i.resourceId, code: i.code, until: i.until || "", reason: i.reason || "" }); results.push({ ...i, ok: true }); }
    catch (e) { results.push({ resourceId: i.resourceId, code: i.code, ok: false, message: friendlyError(e) }); }
  }
  await prisma.store.update({ where: { id: storeId }, data: { settings: JSON.stringify(cfg) } });
  await log(storeId, body.unsnooze ? "Agent removed snoozes" : "Agent snoozed findings", { count: results.filter((r) => r.ok).length, actor: AGENT_ACTOR });
  return { results };
}
/** Confirm suggested facts after checking them (all, or the listed keys). */
export async function confirmFacts(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(z.object({ resourceId: z.string().min(1), keys: z.array(z.string()).optional() })).min(1).max(50) }).parse(input);
  const { confirmAllSpecs } = await import("./spec-review.server");
  const results: { resourceId: string; ok: boolean; confirmed?: number; message?: string }[] = [];
  for (const i of body.items) {
    try { const confirmed = await confirmAllSpecs(storeId, i.resourceId, i.keys); results.push({ resourceId: i.resourceId, ok: true, confirmed, ...(confirmed ? {} : { status: "unchanged", message: "No change: no unconfirmed facts to confirm" }) }); }
    catch (e) { results.push({ resourceId: i.resourceId, ok: false, message: friendlyError(e) }); }
  }
  await scheduleCatalogueRefresh(storeId);
  await log(storeId, "Agent confirmed facts", { count: results.length, actor: AGENT_ACTOR });
  return { results };
}
const faqItem = z.object({ resourceId: z.string().min(1), faqs: z.array(z.object({ question: z.string().trim().min(5).max(300), answer: z.string().trim().min(2).max(2000) })).min(1).max(12) });
/** Write product FAQs (the FAQ metafield). */
export async function bulkFaq(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(faqItem).min(1).max(5), dryRun: z.boolean().default(true), apply: z.boolean().default(false) }).parse(input);
  const results: Result[] = [];
  const created: string[] = [];
  for (const item of body.items) {
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id: item.resourceId, storeId, kind: "product" } });
      const p: Payload = JSON.parse(r.payload);
      const problems = brandGate("faq", p.faqs || [], item.faqs, JSON.parse(r.facts || "{}"), { allow: allowedCaps(p.vendor, p.title) });
      if (problems.length) { results.push({ resourceId: r.id, title: r.title, ok: false, status: "invalid", message: problems.join("; ") }); continue; }
      if (JSON.stringify(p.faqs || []) === JSON.stringify(item.faqs)) { results.push({ resourceId: r.id, title: r.title, ok: true, status: "unchanged", message: NO_CHANGE }); continue; }
      if (body.dryRun) { results.push({ resourceId: r.id, title: r.title, ok: true, status: "valid", message: `${(p.faqs || []).length} → ${item.faqs.length} questions` }); continue; }
      const row = await stageChange(storeId, r.id, "faq", p.faqs || [], item.faqs, [AGENT_REASON]);
      if (body.apply) { await approve(storeId, row.id, AGENT_ACTOR); created.push(row.id); }
      results.push({ resourceId: r.id, title: r.title, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id });
    } catch (e) {
      results.push({ resourceId: item.resourceId, ok: false, status: e instanceof BusyError ? "busy" : e instanceof ProtectedPageError ? "protected" : "error", message: friendlyError(e) });
    }
  }
  if (created.length) await settleResults(storeId, results, created, AGENT_WAIT_MS);
  await log(storeId, "Agent FAQ update", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}
const productItem = z.object({ resourceId: z.string().min(1), title: z.string().trim().min(3).max(255).optional(), vendor: z.string().trim().min(2).max(100).optional() }).refine((v) => v.title || v.vendor, "Send title and/or vendor");
/** Change a product's title and/or vendor (brand). */
export async function bulkProduct(storeId: string, input: unknown) {
  const body = z.object({ items: z.array(productItem).min(1).max(10), dryRun: z.boolean().default(true), apply: z.boolean().default(false) }).parse(input);
  const results: (Result & { field?: string })[] = [];
  const created: string[] = [];
  for (const item of body.items) {
    try {
      const r = await prisma.resource.findFirstOrThrow({ where: { id: item.resourceId, storeId, kind: "product" } });
      const p: Payload = JSON.parse(r.payload);
      for (const [field, value, before] of [["title", item.title, p.title], ["vendor", item.vendor, p.vendor || ""]] as const) {
        if (!value) continue;
        if (value === before) { results.push({ resourceId: r.id, title: r.title, field, ok: true, status: "unchanged", message: NO_CHANGE }); continue; }
        const problems = field === "title" ? brandGate("title", before, value, {}, { allow: allowedCaps(p.vendor, p.title, value), brands: productBrands(p, storeNames(await prisma.store.findUnique({ where: { id: storeId }, select: { settings: true, discoveries: true } }))) }) : /^(n\/?a|none|unbranded|un-branded)$/i.test(value) ? ["Use the real brand, not a placeholder"] : [];
        if (problems.length) { results.push({ resourceId: r.id, title: r.title, field, ok: false, status: "invalid", message: problems.join("; ") }); continue; }
        if (body.dryRun) { results.push({ resourceId: r.id, title: r.title, field, ok: true, status: "valid", message: `${before || "(blank)"} → ${value}` }); continue; }
        const row = await stageChange(storeId, r.id, field, before, value, [AGENT_REASON]);
        if (body.apply) { await approve(storeId, row.id, AGENT_ACTOR); created.push(row.id); }
        results.push({ resourceId: r.id, title: r.title, field, ok: true, status: body.apply ? "approved" : "pending", changeId: row.id });
      }
    } catch (e) {
      results.push({ resourceId: item.resourceId, ok: false, status: e instanceof BusyError ? "busy" : e instanceof ProtectedPageError ? "protected" : "error", message: friendlyError(e) });
    }
  }
  if (created.length) await settleResults(storeId, results, created, AGENT_WAIT_MS);
  await log(storeId, "Agent product update", { dryRun: body.dryRun, count: results.length });
  return { dryRun: body.dryRun, results };
}

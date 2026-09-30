import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import prisma from "../app/db.server";
import { cached, clearLoadCache, resourceFingerprint } from "../app/core/load-cache";
import { auditCatalogue, TEMPLATE_ID_LIMIT, type AuditResource } from "../app/core/catalogue";
import { protectedPages } from "../app/core/protected-pages.server";
import type { Payload } from "../app/core/types";

// Release 20.1: page loads blocked the web process (502s). These guard the fixes.
describe("load cache", () => {
  beforeEach(() => clearLoadCache());
  it("computes once while the key is unchanged", () => {
    let runs = 0; const work = () => ++runs;
    expect(cached("health:s1", "a", work)).toBe(1);
    expect(cached("health:s1", "a", work)).toBe(1);
    expect(runs).toBe(1);
  });
  it("recomputes when the key changes", () => {
    let runs = 0; const work = () => ++runs;
    cached("health:s1", "a", work);
    expect(cached("health:s1", "b", work)).toBe(2);
  });
  it("keeps stores apart", () => {
    cached("health:s1", "a", () => "one");
    expect(cached("health:s2", "a", () => "two")).toBe("two");
    expect(cached("health:s1", "a", () => "changed")).toBe("one");
  });
  it("fingerprint changes when a resource is added or updated", () => {
    const base = [{ id: "a", updatedAt: new Date("2026-09-30T10:00:00Z") }, { id: "b", updatedAt: new Date("2026-09-30T11:00:00Z") }];
    const fp = resourceFingerprint(base);
    expect(resourceFingerprint([...base])).toBe(fp);
    expect(resourceFingerprint([...base, { id: "c", updatedAt: new Date("2026-09-30T09:00:00Z") }])).not.toBe(fp);
    expect(resourceFingerprint([base[0], { id: "b", updatedAt: new Date("2026-09-30T12:00:00Z") }])).not.toBe(fp);
  });
});

describe("page loader", () => {
  const source = readFileSync(new URL("../app/core/ui.server.ts", import.meta.url), "utf8");
  const loader = source.slice(source.indexOf("export async function loadUI"), source.indexOf("const credentialKeys"));
  it("runs the catalogue audit only as a cached fallback", () => {
    expect((loader.match(/auditCatalogue\(/g) || []).length).toBe(1);
    expect(loader).toMatch(/cached\(`health:/);
    expect(loader).toMatch(/latestCoverage\.healthScores/);
  });
  it("does not reload every resource for the liveness check", () => {
    expect(loader).not.toMatch(/storeLiveness/);
  });
  it("reads findings only for the latest audit", () => {
    expect(loader).toMatch(/select: \{ id: true, storeId: true, score: true/);
  });
  it("works out finding state once", () => {
    expect((loader.match(/applyFindingState\(/g) || []).length).toBe(1);
  });
});

let n = 0;
const res = (kind: string, over: Partial<Payload> = {}): AuditResource => {
  n++;
  const p: Payload = { title: `Item ${n}`, handle: `item-${n}`, seo: { title: n % 2 ? "" : `Item ${n} | Store`, description: "" }, descriptionHtml: `<p>Item ${n}. ${"Useful words about it. ".repeat(n % 3 ? 2 : 40)}</p>`, images: [], collections: [], vendor: "Acme", productType: "Storage", ...over };
  return { id: `r${n}`, title: p.title, kind, payload: JSON.stringify(p), keyword: "", facts: "{}" };
};

describe("per page-type scores are stored with the audit", () => {
  it("match what the loader used to compute per type", () => {
    const rows = [...Array.from({ length: 8 }, () => res("product")), ...Array.from({ length: 4 }, () => res("collection")), ...Array.from({ length: 3 }, () => res("article"))];
    const all = auditCatalogue(rows);
    for (const kind of ["collection", "article"]) {
      const alone = auditCatalogue(rows.filter((r) => r.kind === kind));
      expect(all.healthScores[kind]).toEqual({ score: alone.score, checks: alone.checks, failed: alone.failed });
    }
    const products = auditCatalogue(rows.filter((r) => r.kind === "product"));
    expect(all.healthScores.product).toEqual({ score: products.score, checks: products.checks, failed: products.failed });
  });
  it("stores a bounded list of product ids per repeated-text finding, with an exact count", () => {
    expect(TEMPLATE_ID_LIMIT).toBeLessThanOrEqual(200);
    const rows = Array.from({ length: 260 }, (_, i) => res("product", { title: `Stool ${i}`, descriptionHtml: `<p>A folding stool with a steel frame, number ${i}.</p><p>This sturdy seat packs flat for any campervan trip.</p>` }));
    const t = auditCatalogue(rows).issues.find((i) => i.code === "repeated-template")!;
    expect(t.count).toBe(260);
    expect(t.resourceIds).toHaveLength(TEMPLATE_ID_LIMIT);
  });
});

const STORE = "demo-r201";
const wipe = async () => {
  for (const m of ["change", "resource", "audit"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true } }); });
afterAll(wipe);

describe("protected pages after the upgrade", () => {
  it("does not lock a page on a pre-release-20 formatting-only finding, but still locks a real edit", async () => {
    const p = (html: string) => JSON.stringify({ title: "Rug", handle: "rug", descriptionHtml: html, seo: { title: "", description: "" }, images: [], collections: [] });
    const a = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/a", kind: "product", title: "Rug", handle: "rug-a", payload: p("<p>Warm<br>rug</p>") } });
    const b = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/b", kind: "product", title: "Rug", handle: "rug-b", payload: p("<p>Cold rug, edited in Shopify</p>") } });
    const ca = await prisma.change.create({ data: { storeId: STORE, resourceId: a.id, feature: "description", before: '""', after: JSON.stringify("<p>Warm<br />rug</p>"), status: "applied" } });
    const cb = await prisma.change.create({ data: { storeId: STORE, resourceId: b.id, feature: "description", before: '""', after: JSON.stringify("<p>Warm rug</p>"), status: "applied" } });
    const old = (id: string, changeId: string) => ({ resourceId: id, title: "Rug", code: "changed-outside", severity: "warning", detail: "Changed.", changeId });
    await prisma.audit.create({ data: { storeId: STORE, score: 90, aeoScore: 0, coverage: "{}", resourceCount: 2, issues: JSON.stringify([old(a.id, ca.id), old(b.id, cb.id)]) } });
    const locked = await protectedPages(STORE);
    expect(locked.has(a.id)).toBe(false);
    expect(locked.has(b.id)).toBe(true);
  });
});

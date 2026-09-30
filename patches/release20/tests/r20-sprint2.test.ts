import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { auditCatalogue, type AuditResource } from "../app/core/catalogue";
import { answeredQuestions, relevantQuestions } from "../app/core/catalogue-checks";
import { redirectSuggestion, deadPageIssue, type DeadPage } from "../app/core/index-hygiene";
import { deadPagesWithImpressions } from "../app/core/index-hygiene.server";
import { brandRuleHits, ruleErrors, allowedCaps, unverifiedClaims, brandGate } from "../app/core/brand-rules";
import { changes, findings } from "../app/core/agent.server";
import type { Payload } from "../app/core/types";

const STORE = "demo-r20-s2";
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true } }); });
afterAll(wipe);

let n = 0;
const product = (over: Partial<Payload> = {}): AuditResource => {
  n++;
  const title = over.title || `Product ${n}`;
  const p: Payload = { title, handle: `p-${n}`, seo: { title: `${title} | Van Life Emporium`, description: "" }, descriptionHtml: "<p>A product.</p>", images: [], collections: [], vendor: "Van Life Emporium", productType: "Storage", variants: [{ sku: `S${n}`, barcode: "", price: "20.00" }], ...over };
  return { id: `p${n}`, title, kind: "product", payload: JSON.stringify(p), keyword: "", facts: "{}" };
};

describe("RP-104 answer readiness counts what applies", () => {
  it("reads size from variant options", () => {
    const p = JSON.parse(product({ title: "Jute Rug", productType: "Rugs", variants: [{ sku: "r", barcode: "", price: "40", selectedOptions: [{ name: "Size", value: "Rectangle 80 X 150Cm" }] }] }).payload);
    expect(answeredQuestions(p, {}).size).toBe(true);
  });
  it("does not ask a rug about fit or a book about care", () => {
    const rug = JSON.parse(product({ productType: "Rugs" }).payload), book = JSON.parse(product({ productType: "Books & Guides" }).payload);
    expect(relevantQuestions(rug).map((q) => q.key)).not.toContain("fit");
    expect(relevantQuestions(book).map((q) => q.key)).not.toContain("care");
    expect(relevantQuestions(rug).map((q) => q.key)).not.toContain("delivery");
    const r = auditCatalogue(Array.from({ length: 5 }, () => product({ productType: "Rugs" })));
    expect(r.issues.find((i) => i.code === "answer-missing-fit")).toBeUndefined();
  });
  it("counts a boilerplate delivery line once at store level", () => {
    const withLine = Array.from({ length: 10 }, () => product({ descriptionHtml: "<p>A basket.</p><p>Free UK delivery in 2 to 4 days.</p>" }));
    const r = auditCatalogue(withLine);
    expect(r.issues.filter((i) => i.code === "answer-missing-delivery")).toHaveLength(0);
    const none = auditCatalogue(Array.from({ length: 10 }, () => product()));
    const d = none.issues.filter((i) => i.code === "answer-missing-delivery");
    expect(d).toHaveLength(1);
    expect(d[0].count).toBe(1);
    expect(auditCatalogue(Array.from({ length: 10 }, () => product()), { deliveryPolicy: true }).issues.filter((i) => i.code === "answer-missing-delivery")).toHaveLength(0);
  });
});

describe("RP-302 dead pages with impressions", () => {
  const res = (kind: string, handle: string, title: string, productType = "") => ({ id: handle, kind, handle, title, productType, payload: "{}" });
  const candidates = [res("product", "outwell-folding-camping-table", "Outwell Folding Camping Table", "Tables"), res("collection", "camping-chairs", "Camping Chairs"), res("page", "about", "About us")];
  it("suggests the closest live product or collection", () => {
    const dead: DeadPage = { url: "https://vanlifeemporium.com/products/outwell-folding-table-old", impressions: 120, queries: ["outwell folding table"], reason: "not-found" };
    const s = redirectSuggestion(dead, candidates);
    expect(s).toMatchObject({ path: "/products/outwell-folding-camping-table" });
    const issue = deadPageIssue(dead, s);
    expect(issue).toMatchObject({ code: "404-with-impressions", severity: "warning", suggestion: { path: "/products/outwell-folding-camping-table" } });
    expect(issue.detail).toContain("120 times");
  });
  it("recommends leaving the 404 when nothing matches, never the home page", () => {
    const dead: DeadPage = { url: "/products/riemann-p20-original-spf-50-spray-200ml", impressions: 9, queries: ["riemann p20"], reason: "not-found" };
    const s = redirectSuggestion(dead, candidates);
    expect(s).toBeNull();
    const issue = deadPageIssue(dead, s);
    expect(issue.suggestion).toBeUndefined();
    expect(issue.detail).toContain("leave it as a 404");
    expect(issue.detail).not.toMatch(/Redirect it to/);
  });
  it("offers republish or redirect for an unpublished page Google still shows", async () => {
    await prisma.resource.createMany({ data: [
      { storeId: STORE, remoteId: "gid://shopify/Product/old", kind: "product", title: "Camping Chair Old", handle: "camping-chair-old", payload: JSON.stringify({ title: "Camping Chair Old", published: false }) },
      { storeId: STORE, remoteId: "gid://shopify/Collection/cc", kind: "collection", title: "Camping Chairs", handle: "camping-chairs", payload: JSON.stringify({ title: "Camping Chairs", published: true }) },
    ] });
    await prisma.metric.create({ data: { storeId: STORE, provider: "gsc", period: "2026-09-30", payload: JSON.stringify({ rows: [
      { keys: ["https://vanlifeemporium.com/products/camping-chair-old", "camping chair"], impressions: 40, clicks: 0, position: 8 },
      { keys: ["https://vanlifeemporium.com/collections/camping-chairs", "camping chairs"], impressions: 400, clicks: 12, position: 5 },
    ] }) } });
    const issues = await deadPagesWithImpressions(STORE);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "unpublished-with-impressions", suggestion: { path: "/collections/camping-chairs" } });
    expect(issues[0].detail).toMatch(/Republish it in Shopify/);
    expect(issues[0].detail).toMatch(/redirect it to Camping Chairs/);
  });
});

describe("RP-501 capitals allowlist", () => {
  it("accepts technical terms and the product's own vendor", () => {
    expect(ruleErrors("MIMO antenna with an MPPT controller").filter((h) => h.rule === "Capitals")).toEqual([]);
    expect(ruleErrors("NETGEAR 4G router").map((h) => h.match)).toContain("NETGEAR");
    expect(ruleErrors("NETGEAR 4G router", { allow: allowedCaps("NETGEAR") }).filter((h) => h.rule === "Capitals")).toEqual([]);
  });
  it("accepts words the merchant adds in Settings", () => {
    const rows = [product({ descriptionHtml: "<p>The KOMFORT range.</p>" })];
    expect(auditCatalogue(rows).issues.some((i) => i.code === "supplier-formatting")).toBe(true);
    expect(auditCatalogue(rows, { capsAllowlist: ["KOMFORT"] }).issues.some((i) => i.code === "supplier-formatting")).toBe(false);
    expect(brandGate("description", "", "<p>The KOMFORT range fits a locker.</p>", {}, { allow: allowedCaps(["KOMFORT"]) })).toEqual([]);
  });
});

describe("RP-502 imperial units with a metric equivalent", () => {
  it("raises nothing when metric is already given", () => {
    expect(brandRuleHits("Size 63 x 51in (approx. 160 x 130cm)").filter((h) => h.rule === "Imperial units")).toEqual([]);
  });
  it("proposes the metric conversion", () => {
    const hit = brandRuleHits("Fits wheels 17 to 22 inches").find((h) => h.rule === "Imperial units")!;
    expect(hit.match).toContain("43 to 56 cm");
  });
});

describe("RP-503 negated claims", () => {
  it("does not reject a sentence that denies the claim", () => {
    expect(unverifiedClaims("Note: it is not a waterproof layer, so keep it dry.")).toEqual([]);
    expect(unverifiedClaims("A waterproof 3000mm HH shell.")).toContain("Unverified waterproof or IP rating");
  });
});

describe("RP-604 changes for one page", () => {
  it("pages through a page's changes beyond the latest 500 and links findings to their change", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/busy", kind: "product", title: "Busy", handle: "busy", payload: JSON.stringify({ title: "Busy" }) } });
    const other = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/other", kind: "product", title: "Other", handle: "other", payload: "{}" } });
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    await prisma.change.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ storeId: STORE, resourceId: r.id, feature: "seo", before: "{}", after: JSON.stringify({ i }), status: "applied", createdAt: new Date(t0 + i * 1000) })) });
    await prisma.change.createMany({ data: Array.from({ length: 510 }, (_, i) => ({ storeId: STORE, resourceId: other.id, feature: "seo", before: "{}", after: "{}", status: "rejected", createdAt: new Date(t0 + 100000 + i * 1000) })) });
    const latest = (await changes(STORE, { limit: 500 })) as { resourceId: string }[];
    expect(latest.some((c) => c.resourceId === r.id)).toBe(false);
    const page = (await changes(STORE, { resourceIds: [r.id], limit: 5, offset: 10 })) as { total: number; hasMore: boolean; items: { after: { i: number } }[] };
    expect(page.total).toBe(12);
    expect(page.hasMore).toBe(false);
    expect(page.items.map((c) => c.after.i)).toEqual([1, 0]);
    const oldest = await prisma.change.findFirstOrThrow({ where: { resourceId: r.id }, orderBy: { createdAt: "asc" } });
    await prisma.audit.create({ data: { storeId: STORE, score: 90, aeoScore: 0, coverage: "{}", resourceCount: 2, issues: JSON.stringify([{ resourceId: r.id, title: "Busy", code: "changed-outside", severity: "warning", detail: "Changed in Shopify.", changeId: oldest.id }]) } });
    const group = (await findings(STORE)).find((g) => g.items.some((i) => i.code === "changed-outside"))!;
    expect(group.items[0]).toMatchObject({ resourceId: r.id, changeId: oldest.id });
  });
});

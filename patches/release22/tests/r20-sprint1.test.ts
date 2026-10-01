import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import prisma from "../app/db.server";
import { schemaNodes, validateSchema } from "../app/core/crawl.server";
import { renderedChecks } from "../app/core/rendered-page";
import { sameContent, contentDiff } from "../app/core/content-diff";
import { driftIssues, restoreRankpilotVersion } from "../app/core/history-hygiene.server";
import { auditCatalogue } from "../app/core/catalogue";
import { livenessIndex } from "../app/core/page-liveness";
import { opportunityQueries } from "../app/core/dashboard";
import { opportunities, bulkDescription, cleanFormatting, bulkFaq, bulkHeadings, queueJob } from "../app/core/agent.server";
import { approve, executeJob } from "../app/core/service.server";
import { generateAlts } from "../app/core/generation.server";
import { friendlyError } from "../app/core/db-errors";
import type { Payload } from "../app/core/types";

const STORE = "demo-r20-s1";
const ld = (...j: object[]) => j.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join("");
const page = (head: string) => `<html><head>${head}<meta property="og:image" content="https://cdn.shopify.com/a.jpg"></head><body class="template-product"><h1>Rug</h1></body></html>`;
const target = { id: "p", title: "Rug", url: "https://vanlifeemporium.com/products/rug", kind: "product" };
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true } }); });
afterAll(wipe);

describe("RP-101 variants in one ProductGroup", () => {
  it("raises no product-schema-multiple for 32 hasVariant Products", () => {
    const group = { "@context": "https://schema.org", "@type": "ProductGroup", "@id": "https://vanlifeemporium.com/products/rug#group", name: "Rug", brand: { "@type": "Brand", name: "VLE" }, image: "https://cdn.shopify.com/a.jpg",
      hasVariant: Array.from({ length: 32 }, (_, i) => ({ "@type": "Product", name: `Rug ${i}`, url: "https://vanlifeemporium.com/products/rug", offers: { "@type": "Offer", price: "40", priceCurrency: "GBP", availability: "InStock" } })) };
    const html = page(ld(group));
    const s = schemaNodes(html);
    expect([...s.variantNodes].filter((n) => n["@type"] === "Product")).toHaveLength(32);
    expect(validateSchema(s.nodes, s.variantNodes).filter((e) => e.startsWith("Duplicate"))).toEqual([]);
    expect(renderedChecks(html, s.nodes, target, { variants: s.variantNodes, top: s.topNodes, sources: s.sources }).map((i) => i.code)).not.toContain("product-schema-multiple");
  });
  it("raises it for two separate top-level Products, naming both sources", () => {
    const p = { "@type": "Product", name: "Rug", url: "https://vanlifeemporium.com/products/rug", image: "x", brand: "VLE", offers: { price: "40" } };
    const html = page(`<script type="application/ld+json" id="theme-product">${JSON.stringify(p)}</script><script type="application/ld+json" id="app-reviews-product">${JSON.stringify(p)}</script>`);
    const s = schemaNodes(html);
    const found = renderedChecks(html, s.nodes, target, { variants: s.variantNodes, top: s.topNodes, sources: s.sources }).find((i) => i.code === "product-schema-multiple")!;
    expect(found.detail).toContain("theme-product");
    expect(found.detail).toContain("app-reviews-product");
  });
});

describe("RP-102 pages with no Product data", () => {
  it("raises a product-schema-missing error naming the template", () => {
    const html = `<html><head>${ld({ "@type": "Organization", name: "VLE" })}</head><body class="template-product template-suffix-alternate"><h1>Rug</h1></body></html>`;
    const s = schemaNodes(html);
    const f = renderedChecks(html, s.nodes, target, { variants: s.variantNodes, top: s.topNodes }).find((i) => i.code === "product-schema-missing")!;
    expect(f.severity).toBe("critical");
    expect(f.detail).toContain("only Organization");
    expect(f.detail).toContain("“product.alternate”");
  });
});

describe("RP-103 changed outside ignores formatting", () => {
  it("treats Shopify's <br> normalisation and editor noise as the same content", () => {
    expect(sameContent("<p>Warm<br />blanket</p>", "<p>Warm<br>blanket</p>")).toBe(true);
    expect(sameContent('<p>Warm <b>blanket</b></p>', '<p style=""><span>Warm</span> <strong>blanket</strong></p>')).toBe(true);
    expect(sameContent("<p>Warm blanket</p>", "<p>Warm blankets</p>")).toBe(false);
  });
  it("raises no finding for normalised HTML, and a side-by-side diff for a real link edit", async () => {
    const mk = async (applied: string, live: string, handle: string) => {
      const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/" + handle, kind: "product", title: handle, handle, payload: JSON.stringify({ title: handle, handle, descriptionHtml: live, seo: { title: "", description: "" }, images: [], collections: [] }) } });
      const c = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "description", before: JSON.stringify("<p>old</p>"), after: JSON.stringify(applied), status: "applied", appliedAt: new Date() } });
      return { r, c };
    };
    const a = await mk("<p>Warm<br />blanket</p>", "<p>Warm<br>blanket</p>", "br");
    const b = await mk('<p>See <a href="/collections/rugs">our rugs</a>.</p>', '<p>See <a href="/collections/outdoor-rugs">our rugs</a>.</p>', "link");
    const issues = await driftIssues(STORE, [a.r, b.r]);
    expect(issues.map((i) => i.resourceId)).toEqual([b.r.id]);
    expect(issues[0].diff).toEqual(contentDiff('<p>See <a href="/collections/rugs">our rugs</a>.</p>', '<p>See <a href="/collections/outdoor-rugs">our rugs</a>.</p>'));
    expect(issues[0].diff!.linksRemoved).toEqual(["our rugs → /collections/rugs"]);
    expect(issues[0].diff!.linksAdded).toEqual(["our rugs → /collections/outdoor-rugs"]);
    // "Restore RankPilot version" makes a proposal; nothing is written until approval.
    const restored = await restoreRankpilotVersion(STORE, b.c.id);
    expect(restored.change.status).toBe("pending");
    expect(JSON.parse(restored.change.after)).toContain("/collections/rugs");
  });
});

describe("RP-301 unpublished pages", () => {
  it("labels findings and leaves them out of catalogue checks and answer readiness", () => {
    const p = (published: boolean, title: string) => ({ id: title, title, kind: "article", keyword: "", facts: "{}", payload: JSON.stringify({ title, handle: title, blogHandle: "news", published, descriptionHtml: "<p>short</p>", seo: { title: "", description: "" }, images: [], collections: [] }) });
    const live = auditCatalogue([p(true, "Live guide")]);
    const both = auditCatalogue([p(true, "Live guide"), p(false, "Best Free and Cheap Campervan Parking in Wales (2026)")]);
    expect(both.score).toBe(live.score);
    expect(both.checks).toBe(live.checks);
    const wales = both.issues.filter((i) => i.resourceId.startsWith("Best Free"));
    expect(wales.length).toBeGreaterThan(0);
    expect(wales.every((i) => i.unpublished)).toBe(true);
  });
});

describe("RP-303 Opportunities list only live pages", () => {
  it("drops 404s, unpublished and unknown pages", async () => {
    const res = (handle: string, published = true) => ({ id: handle, kind: "product", handle, title: handle, payload: JSON.stringify({ published }) });
    const live = livenessIndex([res("chair"), res("draft", false), res("gone")], [{ url: "https://vanlifeemporium.com/products/gone", status: 404 }]);
    expect(live("https://vanlifeemporium.com/products/chair").live).toBe(true);
    expect(live("https://vanlifeemporium.com/products/draft")).toMatchObject({ live: false, reason: "unpublished" });
    expect(live("https://vanlifeemporium.com/products/gone")).toMatchObject({ live: false, reason: "not-found" });
    expect(live("https://vanlifeemporium.com/products/riemann-p20-original-spf-50-spray-200ml")).toMatchObject({ live: false, reason: "not-in-store" });
    const rows = [{ keys: ["https://vanlifeemporium.com/products/chair"], position: 9, impressions: 50, clicks: 1 }, { keys: ["https://vanlifeemporium.com/products/gone"], position: 9, impressions: 90, clicks: 0 }];
    expect(opportunityQueries(rows, ["/products/gone"]).map((r) => r.keys[0])).toEqual(["https://vanlifeemporium.com/products/chair"]);
    // The agent endpoint applies the same rule and reports what it left out.
    await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/chair", kind: "product", title: "Chair", handle: "chair", payload: JSON.stringify({ title: "Chair", handle: "chair", descriptionHtml: "", seo: { title: "", description: "" }, images: [], collections: [] }) } });
    await prisma.metric.create({ data: { storeId: STORE, provider: "gsc", period: "2026-09-30", payload: JSON.stringify({ start: "2026-09-01", end: "2026-09-28", rows: [{ keys: ["https://vanlifeemporium.com/products/chair", "folding chair"], position: 9.1, impressions: 50, clicks: 1 }, { keys: ["https://vanlifeemporium.com/products/riemann-p20-original-spf-50-spray-200ml", "riemann p20"], position: 11, impressions: 9, clicks: 0 }] }) } });
    const o = await opportunities(STORE, 25);
    expect(o.pages.map((p) => p.page)).toEqual(["https://vanlifeemporium.com/products/chair"]);
    expect(o.excluded).toEqual([{ page: "https://vanlifeemporium.com/products/riemann-p20-original-spf-50-spray-200ml", impressions: 9, reason: "not-in-store" }]);
  });
});

describe("RP-601 generate-alt explains itself", () => {
  it("targets duplicate alt text and says why nothing was created", async () => {
    const p = { title: "Mug", handle: "mug", descriptionHtml: "", seo: { title: "", description: "" }, collections: [], images: [{ id: "1", url: "https://cdn.shopify.com/1.jpg", alt: "Mug", filename: "1" }, { id: "2", url: "https://cdn.shopify.com/2.jpg", alt: "Blue mug", filename: "2" }] } as Payload;
    const none = await generateAlts(STORE, p);
    expect(none.reasons[0]).toMatch(/already have their own alt text/);
    const cache = { get: async (id: string) => (id === "2" ? "The mug from the side" : null), set: async () => {} };
    const dup = await generateAlts(STORE, { ...p, images: [p.images[0], { ...p.images[1], alt: "mug" }] }, cache);
    expect(dup.after).toEqual([{ id: "1", alt: "Mug" }, { id: "2", alt: "The mug from the side" }]);
  });
  it("re-runs an explicit alt job and records a result for every product", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/alt", kind: "product", title: "Mug", handle: "mug", payload: JSON.stringify({ title: "Mug", handle: "mug", descriptionHtml: "", seo: { title: "", description: "" }, collections: [], images: [{ id: "1", url: "https://cdn.shopify.com/1.jpg", alt: "Mug", filename: "1" }] }) } });
    const { job } = await queueJob(STORE, { kind: "generate-alt", ids: [r.id] });
    const result = await executeJob({ ...job, payload: job.payload }) as { resourceId: string; message?: string; error?: string }[];
    expect(result).toHaveLength(1);
    expect(result[0].message || result[0].error).toMatch(/already have their own alt text|image description/);
    const again = await queueJob(STORE, { kind: "generate-alt", ids: [r.id] });
    expect(again.job.status).toBe("queued");
  });
});

describe("RP-602 database errors are never raw", () => {
  it("maps transaction timeouts to a plain message", () => {
    expect(friendlyError(new Error("Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5314 ms passed"))).toBe("The store database was still busy after several automatic retries, so this item was not saved. Nothing changed; it is safe to send it again.");
    expect(friendlyError(new Error("Page listed twice"))).toBe("Page listed twice");
  });
  it("saves a batch of 10 as pending proposals or validation messages", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await prisma.resource.create({ data: { storeId: STORE, remoteId: `gid://shopify/Product/b${i}`, kind: "product", title: `Item ${i}`, handle: `item-${i}`, payload: JSON.stringify({ title: `Item ${i}`, handle: `item-${i}`, descriptionHtml: "<p>" + "A sturdy item for van life. ".repeat(12) + "</p>", seo: { title: "", description: "" }, images: [], collections: [] }) } })).id);
    const out = await bulkDescription(STORE, { items: ids.map((resourceId) => ({ resourceId, html: "<p>" + "A sturdy, useful item for van life. ".repeat(12) + "</p>" })), dryRun: false });
    expect(out.results.every((r) => r.status === "pending" || r.status === "invalid")).toBe(true);
    expect(out.results.some((r) => /prisma|Transaction/i.test(String(r.message)))).toBe(false);
  });
});

describe("RP-603 protected pages", () => {
  it("refuses description, clean-formatting, FAQ and heading writes while changed-outside is open", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/protected", kind: "product", title: "Blanket", handle: "blanket", payload: JSON.stringify({ title: "Blanket", handle: "blanket", descriptionHtml: "<h1>Blanket</h1><h3>Care</h3><p>" + "Warm fleece. ".repeat(40) + "</p><button>BUY NOW</button>", seo: { title: "", description: "" }, images: [], collections: [] }) } });
    await prisma.audit.create({ data: { storeId: STORE, score: 80, aeoScore: 0, resourceCount: 1, coverage: "{}", issues: JSON.stringify([{ resourceId: r.id, title: "Blanket", code: "changed-outside", severity: "warning", detail: "d", changeId: "c" }]) } });
    const desc = await bulkDescription(STORE, { items: [{ resourceId: r.id, html: "<p>" + "Warm soft fleece. ".repeat(40) + "</p>" }], dryRun: false });
    expect(desc.results[0]).toMatchObject({ ok: false, status: "protected" });
    const clean = await cleanFormatting(STORE, { ids: [r.id], dryRun: false });
    expect(clean.results[0]).toMatchObject({ ok: false, status: "protected" });
    const faq = await bulkFaq(STORE, { items: [{ resourceId: r.id, faqs: [{ question: "Is it washable?", answer: "Yes, at 30 degrees." }] }], dryRun: false });
    expect(faq.results[0].status).toBe("protected");
    const heads = await bulkHeadings(STORE, { ids: [r.id], dryRun: false });
    expect(heads.results[0].status).toBe("protected");
    // Approval of any other pending change for the page is refused too.
    const c = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "seo", before: JSON.stringify({ title: "", description: "" }), after: JSON.stringify({ title: "Insulated Camping Blanket | VLE", description: "A warm blanket." }), reasons: JSON.stringify(["merchant-reviewed-v1: x"]) } });
    await expect(approve(STORE, c.id, "merchant")).rejects.toThrow(/changed in Shopify after RankPilot/);
    vi.restoreAllMocks();
  });
});

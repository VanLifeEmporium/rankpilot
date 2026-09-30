import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import prisma from "../app/db.server";
import {
  pages, changes, queueJob, undoChanges, keepShopifyVersion, noBarcode, snoozeFindings, confirmFacts, bulkFaq, bulkProduct,
  cleanFormatting, descriptionProblems, markupOf, bulkDescription,
} from "../app/core/agent.server";
import { ENDPOINTS } from "../app/routes/api.agent.$action";
import { auditCatalogue } from "../app/core/catalogue";
import { articleFacts, nextSeason, duplicateAlts } from "../app/core/catalogue-checks";
import { merchantListingGaps } from "../app/core/rendered-page";
import { jobLabel } from "../app/core/job-feedback";
import { tick } from "../app/core/service.server";
import { fieldScore } from "../app/core/field-speed";
import { storeScore } from "../app/core/store-score";
import type { Payload } from "../app/core/types";

const STORE = "demo-r19-p2";
const body = "<p>" + "A warm, packable camping blanket for cold evenings in the van. ".repeat(10) + "</p>";
const payload = (over: Partial<Payload> = {}) => JSON.stringify({ title: "Insulated Camping Blanket", handle: "blanket", descriptionHtml: body, seo: { title: "Insulated Camping Blanket | VLE", description: "A warm blanket." }, images: [], collections: [], vendor: "N/A", variants: [{ sku: "B1", barcode: "", price: "30.00" }], faqs: [], ...over });
const wipe = async () => {
  for (const m of ["change", "resource", "event", "job", "audit", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
let id = "";
beforeAll(async () => {
  await wipe();
  await prisma.store.create({ data: { id: STORE, demo: true } });
  id = (await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/1", kind: "product", title: "Insulated Camping Blanket", handle: "blanket", payload: payload(), facts: JSON.stringify({ weight: { value: "1.2kg", source: "Supplier sheet", confirmed: false } }) } })).id;
  await prisma.resource.createMany({ data: Array.from({ length: 230 }, (_, i) => ({ storeId: STORE, remoteId: `gid://shopify/Product/x${i}`, kind: "product", title: `Item ${String(i).padStart(3, "0")}`, handle: `item-${i}`, payload: payload({ title: `Item ${i}` }) })) });
});
afterAll(wipe);

describe("R19-11 agents have parity with the merchant UI", () => {
  it("pages report total and offset instead of stopping silently at 200, and full=1 carries grounding data", async () => {
    const first = await pages(STORE, { kind: "product", limit: 200 });
    expect(first).toMatchObject({ total: 231, offset: 0, limit: 200, hasMore: true });
    expect(first.items).toHaveLength(200);
    const rest = await pages(STORE, { kind: "product", limit: 200, offset: 200 });
    expect(rest.items).toHaveLength(31);
    expect(rest.hasMore).toBe(false);
    const [full] = (await pages(STORE, { ids: [id], full: true })).items as Record<string, unknown>[];
    expect(full.variants).toEqual([{ sku: "B1", barcode: "", price: "30.00", options: undefined }]);
    expect(full).toHaveProperty("confirmedFacts");
    expect(full).toHaveProperty("faqs");
  });
  it("an agent can find, fix, verify and undo a barcode finding without the UI", async () => {
    expect(auditCatalogue([{ ...(await prisma.resource.findUniqueOrThrow({ where: { id } })) }]).issues.some((i) => i.code === "missing-gtin")).toBe(true);
    await noBarcode(STORE, { ids: [id] });
    expect(auditCatalogue([{ ...(await prisma.resource.findUniqueOrThrow({ where: { id } })) }]).issues.some((i) => i.code === "missing-gtin")).toBe(false);
    await noBarcode(STORE, { ids: [id], undo: true });
    expect(auditCatalogue([{ ...(await prisma.resource.findUniqueOrThrow({ where: { id } })) }]).issues.some((i) => i.code === "missing-gtin")).toBe(true);
  });
  it("snooze, confirm facts, keep Shopify's version and undo are available", async () => {
    expect((await snoozeFindings(STORE, { items: [{ resourceId: id, code: "missing-gtin", until: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), reason: "Own label" }] })).results[0].ok).toBe(true);
    expect((await snoozeFindings(STORE, { items: [{ resourceId: id, code: "missing-gtin" }], unsnooze: true })).results[0].ok).toBe(true);
    expect((await confirmFacts(STORE, { items: [{ resourceId: id, keys: ["weight"] }] })).results[0]).toMatchObject({ ok: true, confirmed: 1 });
    const applied = await prisma.change.create({ data: { storeId: STORE, resourceId: id, feature: "seo", before: "{}", after: "{}", status: "applied", appliedAt: new Date() } });
    expect((await keepShopifyVersion(STORE, { changeIds: [applied.id] })).kept).toEqual([applied.id]);
    const undo = await undoChanges(STORE, { ids: [applied.id] });
    expect(undo.results[0]).toMatchObject({ ok: true, status: "queued" });
    expect(await prisma.job.count({ where: { storeId: STORE, kind: "rollback" } })).toBe(1);
    const verified = (await changes(STORE, { status: "verified", ids: [applied.id] })) as { verified: boolean }[];
    expect(verified[0]).toMatchObject({ verified: true });
  });
  it("writes FAQs, titles and vendors as pending proposals, with the same rules", async () => {
    expect((await bulkFaq(STORE, { items: [{ resourceId: id, faqs: [{ question: "Is it machine washable?", answer: "Rated 5 stars by 2,000 customers." }] }] })).results[0].status).toBe("invalid");
    const faq = await bulkFaq(STORE, { items: [{ resourceId: id, faqs: [{ question: "Does it fold into a bag?", answer: "Yes, it folds into its own bag." }] }], dryRun: false });
    expect(faq.results[0]).toMatchObject({ ok: true, status: "pending" });
    const product = await bulkProduct(STORE, { items: [{ resourceId: id, vendor: "Van Life Emporium", title: "HOT SALE Blanket" }], dryRun: false });
    expect(product.results.find((r) => r.field === "vendor")).toMatchObject({ status: "pending" });
    expect(product.results.find((r) => r.field === "title")).toMatchObject({ status: "invalid" });
    expect((await bulkProduct(STORE, { items: [{ resourceId: id, vendor: "Unbranded" }] })).results[0].status).toBe("invalid");
  });
  it("uses ids everywhere and documents every endpoint", async () => {
    expect((await cleanFormatting(STORE, { ids: [id] })).results[0].resourceId).toBe(id);
    const docs = readFileSync("app/routes/agent.ts", "utf8");
    for (const e of ENDPOINTS) expect(docs, e).toContain(`/api/agent/${e.split(" ")[1]}`);
  });
});

describe("R19-12, R19-13 speed", () => {
  it("agents can start the speed job", async () => {
    const { job } = await queueJob(STORE, { kind: "crux" });
    expect(job.kind).toBe("crux");
  });
  it("treats 'no data' as normal and records API errors instead of failing the job", async () => {
    const { fieldSpeed } = await import("../app/core/integrations.server");
    const out = await fieldSpeed(STORE) as { error?: string };
    expect(out.error).toMatch(/PageSpeed Insights key/);
    const row = await prisma.metric.findFirstOrThrow({ where: { storeId: STORE, provider: "crux" } });
    expect(JSON.parse(row.payload).error).toBeTruthy();
    expect(fieldScore({ checkedAt: "", pages: [], note: "Not enough Chrome visitors yet; using lab tests." })).toBeNull();
  });
});

describe("R19-14 AI samples", () => {
  it("does not include a 0 from simulated samples in the Store Score", () => {
    const now = Date.now();
    const s = storeScore({ metrics: [], technical: 70, answerReadiness: 50, healthScores: {}, observations: Array.from({ length: 25 }, () => ({ createdAt: new Date(now - 3600000), cited: false })), now });
    expect(s.ai).toBe(0);
    expect(s.parts.find((p) => p.key === "ai")!.weight).toBe(0);
    expect(s.score).toBe(Math.min(55, Math.round((30 * 70 + 20 * 50) / 50)));
  });
});

describe("R19-15 dated facts in guides", () => {
  it("finds opening dates, open all year, postcodes and prices, with a re-check date", () => {
    const guide = "The site at Poolsbrook opens from March to October. Castle Ward is open all year. Postcode S43 3LH. Pitches cost £28 per night. The café is closed in winter. Dundonald: BT16 1UE, £30 a night, open from Easter.";
    const facts = articleFacts(guide);
    expect(facts.map((f) => f.label)).toEqual(expect.arrayContaining(["opening dates", "open all year", "postcode", "price"]));
    expect(facts.length).toBeGreaterThanOrEqual(8);
    expect(nextSeason(new Date("2026-10-01"))).toEqual({ season: "winter", date: "2026-12-01" });
    const r = auditCatalogue([{ id: "a", title: "Poolsbrook guide", kind: "article", keyword: "", facts: "{}", payload: JSON.stringify({ title: "Poolsbrook", handle: "poolsbrook", blogHandle: "guides", descriptionHtml: `<p>${guide}</p>`, seo: { title: "t", description: "d" }, images: [], collections: [] }) }]);
    const f = r.issues.find((i) => i.code === "article-dated-facts")!;
    expect(f.detail).toMatch(/^Check before (spring|summer|autumn|winter) \(\d{4}-\d{2}-\d{2}\)/);
    expect(f.count).toBe(facts.length);
  });
});

describe("R19-16 guides keep their layout", () => {
  it("a one-word change to a regional guide dry-runs as valid, and scripts stay blocked", () => {
    const guide = `<aside style="padding:8px"><p>Quick facts</p></aside><figure><img src="https://cdn.shopify.com/a.jpg" alt="Lake"><figcaption>The lake</figcaption></figure><h3 id="getting-there">Getting there</h3><hr><div style="margin:0"><p style="color:#333">${"Follow the lane past the farm to the car park by the lake. ".repeat(8)}</p></div>`;
    const edited = guide.replace("Follow the lane", "Follow the narrow lane");
    expect(descriptionProblems(edited, { before: guide, kind: "article" }).errors).toEqual([]);
    expect(descriptionProblems(edited, { before: guide, kind: "product" }).errors.join(" ")).toContain("Not allowed");
    expect(descriptionProblems(edited + '<script>alert(1)</script>', { before: guide, kind: "article" }).errors.join(" ")).toContain("Scripts");
    expect(markupOf('<form><input></form><p onclick="x">a</p>').tags.has("form")).toBe(false);
  });
});

describe("R19-17, R19-18 findings", () => {
  it("flags missing merchant-listing fields in Product data", () => {
    expect(merchantListingGaps([{ "@type": "Product", offers: { price: "1" } } as never])).toEqual(["shippingDetails", "hasMerchantReturnPolicy"]);
    expect(merchantListingGaps([{ "@type": "Product", offers: { shippingDetails: { "@type": "OfferShippingDetails", shippingRate: { value: 0, currency: "GBP" } }, hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", merchantReturnDays: 30 } } } as never])).toEqual([]);
  });
  it("flags imperial units, long addresses and duplicate alt text", () => {
    const handle = "outwell-colour-changing-rechargeable-camping-lantern-with-remote";
    const r = auditCatalogue([{ id: "p", title: "Lantern", kind: "product", keyword: "", facts: "{}", payload: JSON.stringify({ title: "Lantern", handle, descriptionHtml: "<p>" + "A 10 inch lantern weighing 2 lbs. ".repeat(20) + "</p>", seo: { title: "Lantern for vans | VLE", description: "A lantern." }, images: [{ id: "1", url: "u", alt: "Lantern", filename: "a" }, { id: "2", url: "u", alt: "lantern", filename: "b" }], collections: [], variants: [] }) }]);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["imperial-units", "long-url", "duplicate-alt"]));
    expect(duplicateAlts([{ alt: "A" }, { alt: "B" }])).toEqual([]);
  });
});

describe("R19-19 jobs that failed look failed", () => {
  it("a job where every item failed is failed", async () => {
    expect(jobLabel({ kind: "links", status: "completed", payload: JSON.stringify({ result: [{ error: "404" }, { error: "404" }] }) })).toBe("failed");
    const job = await prisma.job.create({ data: { storeId: STORE, kind: "optimise", dedup: "r19-allfail", payload: JSON.stringify({ ids: ["missing-1", "missing-2"], feature: "links" }) } });
    await tick({ jobId: job.id });
    await tick({ jobId: job.id });
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/^All 2 items failed/);
  });
});

describe("R19-20, R19-21, R19-22", () => {
  it("has a phone layout at 390 px", () => {
    const css = readFileSync("app/styles.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 600px\)[\s\S]*\.topbar \{ display: none; \}[\s\S]*table\.catalogue-table tr/);
  });
  it("returns a 10-item batch within 10 seconds", async () => {
    vi.useRealTimers();
    const ids = (await prisma.resource.findMany({ where: { storeId: STORE }, take: 10, select: { id: true } })).map((r) => r.id);
    const started = Date.now();
    const out = await bulkDescription(STORE, { items: ids.map((resourceId) => ({ resourceId, html: body.replace("warm", "cosy") })), dryRun: false, apply: true });
    expect(Date.now() - started).toBeLessThan(10000);
    expect(out.results).toHaveLength(10);
  }, 20000);
  it("no longer shows the empty supplier copy panel", () => {
    expect(readFileSync("app/components/Workspace.tsx", "utf8")).not.toContain("SupplierCopy");
  });
});

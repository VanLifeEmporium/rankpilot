import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { auditCatalogue, type AuditResource } from "../app/core/catalogue";
import { detectBrand, brandList, vendorRuleCollections } from "../app/core/brand-detect";
import { proposeBrands, suggestBook, applyBook } from "../app/core/brand-proposals.server";
import { missingSearchTerms } from "../app/core/search-signals";
import { searchSignalIssues } from "../app/core/search-signals.server";
import { brandGate } from "../app/core/brand-rules";
import { validIsbn13, isbn10to13 } from "../app/core/book-flow";
import { faqQuestionTexts } from "../app/core/catalogue-checks";
import { approve, applyChange } from "../app/core/service.server";
import type { Payload } from "../app/core/types";

const STORE = "demo-r20-s3";
const STORE_NAME = "Van Life Emporium";
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true, discoveries: JSON.stringify({ shop: { name: STORE_NAME } }) } }); });
afterAll(wipe);

let n = 0;
const payload = (over: Partial<Payload> = {}): Payload => {
  n++;
  return { title: `Product ${n}`, handle: `product-${n}`, seo: { title: "", description: "" }, descriptionHtml: "<p>A product.</p>", images: [], collections: [], vendor: STORE_NAME, productType: "Camping", variants: [{ id: `gid://shopify/ProductVariant/${n}`, sku: `S${n}`, barcode: "", price: "20" }], ...over };
};
const row = (p: Payload, facts: object = {}): AuditResource => ({ id: `r${n}`, title: p.title, kind: "product", payload: JSON.stringify(p), keyword: "", facts: JSON.stringify(facts) });
const opts = { storeName: STORE_NAME };
const saveProduct = (p: Payload, facts: object = {}) => prisma.resource.create({ data: { storeId: STORE, remoteId: `gid://shopify/Product/${n}-${p.handle}`, kind: "product", title: p.title, handle: p.handle, payload: JSON.stringify(p), facts: JSON.stringify(facts) } });

describe("RP-201 brand detection", () => {
  it("proposes the brand named in the title, with evidence", () => {
    const r = auditCatalogue([row(payload({ title: "Helinox Chair One Original" }))], opts);
    const f = r.issues.find((i) => i.code === "brand-is-store")!;
    expect(f.brand).toMatchObject({ vendor: "Helinox", confidence: "high", evidence: [{ where: "title", text: "Helinox Chair One Original" }] });
    expect(f.detail).toContain("Helinox");
  });
  it("finds a brand only in the handle with medium confidence", () => {
    const b = detectBrand(payload({ title: "XL Mummy Sleeping Bag", handle: "andes-nevado-400-xl-mummy-sleeping-bag" }), brandList([], STORE_NAME));
    expect(b).toMatchObject({ vendor: "Andes", confidence: "medium", evidence: [{ where: "handle" }] });
  });
  it("raises nothing for an own-label product", () => {
    const r = auditCatalogue([row(payload({ title: "Helinox Style Camp Chair", tags: ["own-label"] }))], opts);
    expect(r.issues.some((i) => i.code === "brand-is-store")).toBe(false);
  });
  it("prepares pending vendor changes that warn about vendor-based smart collections", async () => {
    const p = payload({ title: "XL Mummy Sleeping Bag", handle: "andes-nevado-400-xl-mummy-sleeping-bag", collections: ["Sleeping bags by brand"] });
    const r = await saveProduct(p);
    await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Collection/1", kind: "collection", title: "Sleeping bags by brand", handle: "sleeping-bags", payload: JSON.stringify({ title: "Sleeping bags by brand", handle: "sleeping-bags", seo: { title: "", description: "" }, descriptionHtml: "", images: [], collections: [], rules: [{ column: "VENDOR", relation: "EQUALS", condition: "Van Life Emporium" }] }) } });
    const audit = auditCatalogue([{ ...row(p), id: r.id }], opts);
    await prisma.audit.create({ data: { storeId: STORE, score: 90, aeoScore: 0, coverage: "{}", resourceCount: 1, issues: JSON.stringify(audit.issues) } });
    const { results } = await proposeBrands(STORE, { ids: [r.id] });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, status: "pending", vendor: "Andes" });
    expect(results[0].warnings![0]).toContain("Sleeping bags by brand");
    const change = await prisma.change.findUniqueOrThrow({ where: { id: results[0].changeId! } });
    expect(change).toMatchObject({ feature: "vendor", status: "pending", after: JSON.stringify("Andes") });
    expect(change.reasons).toContain("handle");
    expect(vendorRuleCollections([{ title: "A", rules: [{ column: "TAG", condition: "x" }] }], ["A"])).toEqual([]);
    // Approving applies it (demo store) and it can be undone like any change.
    await approve(STORE, change.id, "merchant");
    await applyChange(STORE, change.id);
    expect(JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: r.id } })).payload).vendor).toBe("Andes");
  });
});

describe("RP-202 brand and model search terms", () => {
  it("flags a title missing the brand and model people search for", async () => {
    const p = payload({ title: "XL Mummy Sleeping Bag", handle: "andes-nevado-400-xl-mummy-sleeping-bag", url: "https://vanlifeemporium.com/products/andes-nevado-400-xl-mummy-sleeping-bag" });
    expect(missingSearchTerms(p, [{ query: "andes nevado 400", impressions: 60 }], ["Andes"])).toMatchObject({ phrase: "Andes Nevado 400" });
    expect(missingSearchTerms({ ...p, seo: { title: "Andes Nevado 400 XL Mummy Sleeping Bag", description: "" } }, [{ query: "andes nevado 400", impressions: 60 }], ["Andes"])).toBeNull();
    const r = await saveProduct(p);
    await prisma.metric.create({ data: { storeId: STORE, provider: "gsc", period: "2026-09-30", payload: JSON.stringify({ rows: [{ keys: [p.url, "andes nevado 400"], impressions: 60, clicks: 1, position: 8.8 }] }) } });
    const issues = await searchSignalIssues(STORE, []);
    const f = issues.find((i) => i.resourceId === r.id && i.code === "title-missing-search-terms")!;
    expect(f.detail).toContain("Andes Nevado 400");
    expect(f.feature).toBe("seo");
  });
  it("blocks a new title that removes the brand", () => {
    const before = { title: "Helinox Chair One | Van Life Emporium", description: "" };
    expect(brandGate("seo", before, { title: "Lightweight Camping Chair | Van Life Emporium", description: "" }, {}, { brands: ["Helinox"] }).join(" ")).toContain("drops the brand “Helinox”");
    expect(brandGate("seo", before, { title: "Helinox Chair One Lightweight Camping Chair", description: "" }, {}, { brands: ["Helinox"] })).toEqual([]);
  });
});

describe("RP-203 book flow", () => {
  it("suggests the publisher and a 978/979 ISBN, and needs the edition confirmed before saving", async () => {
    expect(isbn10to13("0141036141")).toBe("9780141036144");
    const p = payload({ title: "Wild Guide Wales (Paperback)", productType: "Books", handle: "wild-guide-wales" });
    const r = await saveProduct(p);
    const fetcher = async () => ({ docs: [{ title: "Wild Guide Wales", editions: { docs: [{ title: "Wild Guide Wales", publisher: ["Wild Things Publishing"], isbn: ["9781910636114", "1910636118"], publish_date: ["2017"] }] } }] });
    const s = await suggestBook(STORE, r.id, fetcher);
    expect(s.ok).toBe(true);
    expect(s.candidates[0]).toMatchObject({ publisher: "Wild Things Publishing", year: "2017" });
    expect(validIsbn13(s.candidates[0].isbn)).toBe(true);
    const facts = JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: r.id } })).facts);
    expect(facts.isbn).toMatchObject({ value: s.candidates[0].isbn, confirmed: false });
    await expect(applyBook(STORE, r.id, { isbn: s.candidates[0].isbn, publisher: "Wild Things Publishing", editionConfirmed: false })).rejects.toThrow(/Confirm the edition/);
    await expect(applyBook(STORE, r.id, { isbn: "9781910636115", publisher: "Wild Things Publishing", editionConfirmed: true })).rejects.toThrow(/13-digit ISBN/);
    const done = await applyBook(STORE, r.id, { isbn: s.candidates[0].isbn, publisher: "Wild Things Publishing", editionConfirmed: true });
    expect(done.changeIds).toHaveLength(2);
    const changes = await prisma.change.findMany({ where: { id: { in: done.changeIds } } });
    expect(changes.map((c) => c.feature).sort()).toEqual(["barcode", "vendor"]);
    expect(changes.every((c) => c.status === "pending")).toBe(true);
    const barcode = changes.find((c) => c.feature === "barcode")!;
    await approve(STORE, barcode.id, "merchant");
    await applyChange(STORE, barcode.id);
    expect(JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: r.id } })).payload).variants[0].barcode).toBe(s.candidates[0].isbn);
  });
});

describe("RP-401 repeated template text", () => {
  const TEMPLATE = (name: string) => `<h3>What should I check before buying the ${name}?</h3><p>Check the size and your space first.</p>`;
  it("raises one store-level finding with the phrase and page count; a short shared delivery block is not raised", () => {
    const rows = Array.from({ length: 20 }, (_, i) => {
      const title = `Camp Stool ${i}`;
      return row(payload({ title, descriptionHtml: `<p>A folding stool number ${i} with a steel frame for small spaces.</p>${i < 17 ? TEMPLATE(title) : ""}<p>Free UK delivery on orders over £50, dispatched within two working days.</p>` }));
    });
    const r = auditCatalogue(rows, opts);
    const t = r.issues.filter((i) => i.code === "repeated-template");
    const q = t.find((i) => i.detail.includes("What should I check before buying the <product>?"))!;
    expect(q).toMatchObject({ count: 17, severity: "notice" });
    expect(q.detail).toContain("17 of 20 products");
    expect(t.some((i) => /delivery/i.test(i.detail))).toBe(false);
  });
});

describe("RP-402 FAQ quality", () => {
  it("counts an FAQ section in the description", () => {
    const p = payload({ descriptionHtml: "<h2>FAQs</h2><p>Does the stool fold flat for a locker?</p><p>Yes, to 4 cm.</p><p>Q: Can it take 100 kg</p><p>Q: Is the frame rust-proof steel?</p>" });
    expect(faqQuestionTexts(p)).toHaveLength(3);
    const r = auditCatalogue([row(p)], opts);
    expect(r.issues.some((i) => i.code === "missing-product-faq" || i.code === "generic-faq")).toBe(false);
  });
  it("suggests questions from the page's facts when only the template question exists", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(payload({ title: `Stool ${i}`, descriptionHtml: `<p>Dimensions: 30 x 20 x 40 cm</p><p>Material: Powder-coated steel</p><h3>Need a detail before ordering?</h3><p>Email us.</p>` })));
    const r = auditCatalogue(rows, opts);
    const g = r.issues.filter((i) => i.code === "generic-faq");
    expect(g).toHaveLength(12);
    expect(g[0].detail).toContain("“How big is it?” 30 x 20 x 40 cm (source: Product description");
    expect(g[0].detail).toContain("“What is it made from?” Powder-coated steel");
    // Every suggested answer cites where it came from.
    for (const m of g[0].detail.matchAll(/“[^”]+\?” [^(]+\(source: ([^)]+)\)/g)) expect(m[1]).toMatch(/Product description|Confirmed fact/);
  });
});

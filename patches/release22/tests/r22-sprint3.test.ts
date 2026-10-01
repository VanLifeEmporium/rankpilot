import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { createPrescan, createCatalogueAuditor, type AuditResource } from "../app/core/catalogue";
import { answeredQuestions, relevantQuestions, fitQuestion, faqSuggestions } from "../app/core/catalogue-checks";
import { sampleByTemplate } from "../app/core/crawl-sample";
import { renderedChecks } from "../app/core/rendered-page";
import { redirectSuggestion, deadPageIssue, type DeadPage } from "../app/core/index-hygiene";
import { rememberRetired } from "../app/core/index-hygiene.server";
import { missingSearchTerms, searchTermIssue, exampleTitle } from "../app/core/search-signals";
import { openLibraryCandidates, titleMatches } from "../app/core/book-flow";
import { altProblem, cleanAlt } from "../app/core/alt-text";
import { confirmBrand } from "../app/core/brand-proposals.server";
import type { Payload } from "../app/core/types";

const STORE = "demo-r22-s3";
const NAME = "Van Life Emporium";
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true, domain: "https://vanlifeemporium.com", discoveries: JSON.stringify({ shop: { name: NAME } }) } }); });
afterAll(wipe);
let n = 0;
const payload = (over: Partial<Payload> = {}): Payload => {
  n++;
  return { title: `Item ${n}`, handle: `item-${n}`, seo: { title: "", description: "" }, descriptionHtml: "<p>An item.</p>", images: [], collections: [], vendor: NAME, productType: "Camping", ...over };
};

describe("R22-301 every product template sampled", () => {
  it("verify the reported page first: the default template outputs Product data (recorded in docs/release22.md)", () => {
    // The live theme's main-product section outputs {{ product | structured_data }} without a condition,
    // and /products/led-camping-lantern-power-bank uses the default template (no template suffix).
    const res = [
      { id: "a", kind: "product", payload: JSON.stringify({ templateSuffix: null }) },
      { id: "b", kind: "product", payload: JSON.stringify({ templateSuffix: null }) },
      { id: "c", kind: "collection", payload: "{}" },
      { id: "d", kind: "product", payload: JSON.stringify({ templateSuffix: "bundle" }) },
    ];
    expect(sampleByTemplate(res).slice(0, 3).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });
  it("fetches at least one product per template in use, even with a small crawl limit", () => {
    const res = [...Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, kind: "product", payload: "{}" })), { id: "alt", kind: "product", payload: JSON.stringify({ templateSuffix: "no-schema" }) }];
    expect(sampleByTemplate(res).slice(0, 5).map((r) => r.id)).toContain("alt");
  });
  it("raises product-schema-missing naming the template when the JSON-LD has only Organization", () => {
    const org = { "@context": "https://schema.org", "@type": "Organization", name: NAME };
    const html = `<html><head><meta property="og:image" content="https://cdn.shopify.com/x.jpg"><script type="application/ld+json">${JSON.stringify(org)}</script></head><body class="template-product template-suffix-no-schema"><h1>Lantern</h1></body></html>`;
    const issues = renderedChecks(html, [org], { id: "p", title: "Lantern", url: "https://vanlifeemporium.com/products/x", kind: "product" });
    const f = issues.find((i) => i.code === "product-schema-missing")!;
    expect(f.severity).toBe("critical");
    expect(f.detail).toContain("only Organization");
    expect(f.detail).toContain("“product.no-schema”");
  });
});

describe("R22-501 redirect suggestions match the type", () => {
  const live = [
    { id: "t", kind: "product", title: "Folding Camping Toilet with Lid", handle: "folding-camping-toilet-with-lid", payload: JSON.stringify({ url: "/products/folding-camping-toilet-with-lid", published: true }), productType: "Toilets" },
    { id: "c", kind: "collection", title: "Camping Tables", handle: "camping-tables", payload: JSON.stringify({ url: "/collections/camping-tables", published: true }) },
    { id: "g", kind: "collection", title: "Camping Gadgets", handle: "camping-gadgets", payload: JSON.stringify({ url: "/collections/camping-gadgets", published: true }) },
    { id: "l", kind: "product", title: "Portable Camping Gadget Lantern", handle: "portable-camping-gadget-lantern", payload: JSON.stringify({ url: "/products/portable-camping-gadget-lantern", published: true }), productType: "Lighting" },
  ];
  it("keeps handle, title and product type of a deleted product", async () => {
    await rememberRetired(STORE, [{ kind: "product", handle: "picnic-wooden-table-and-bench-set-p", title: "Picnic Wooden Table and Bench Set", payload: JSON.stringify({ url: "/products/picnic-wooden-table-and-bench-set-p", productType: "Camping Tables" }) }]);
    const d = JSON.parse((await prisma.store.findUniqueOrThrow({ where: { id: STORE } })).discoveries);
    expect(d.retired[0]).toMatchObject({ path: "/products/picnic-wooden-table-and-bench-set-p", handle: "picnic-wooden-table-and-bench-set-p", title: "Picnic Wooden Table and Bench Set", productType: "Camping Tables" });
  });
  it("rejects a product of another type and suggests the closest collection", () => {
    const dead: DeadPage = { url: "https://vanlifeemporium.com/products/picnic-wooden-table-and-bench-set-p", impressions: 120, queries: ["folding camping table with lid"], reason: "not-found", productType: "Camping Tables" };
    const s = redirectSuggestion(dead, live)!;
    expect(s.title).not.toBe("Folding Camping Toilet with Lid");
    expect(s).toMatchObject({ kind: "collection", title: "Camping Tables" });
  });
  it("gives ties to the collection", () => {
    const tie = [
      { id: "p", kind: "product", title: "Camping Table", handle: "camping-table", payload: JSON.stringify({ url: "/products/camping-table", published: true }), productType: "Tables" },
      { id: "q", kind: "collection", title: "Old Camping Table Sets", handle: "old-camping-table-sets", payload: JSON.stringify({ url: "/collections/old-camping-table-sets", published: true }) },
    ];
    // Product: camping, table + 2 for the same type = 4; collection: old, camping, table, set = 4.
    const dead: DeadPage = { url: "https://vanlifeemporium.com/products/old-camping-table-set", impressions: 50, queries: [], reason: "not-found", productType: "Tables" };
    const s = redirectSuggestion(dead, tie)!;
    expect(s.kind).toBe("collection");
  });
  it("sends a dead collection to a live collection, not a product", () => {
    const dead: DeadPage = { url: "https://vanlifeemporium.com/collections/portable-camping-gadgets", impressions: 80, queries: ["portable camping gadgets"], reason: "not-found" };
    const s = redirectSuggestion(dead, live)!;
    expect(s).toMatchObject({ kind: "collection", title: "Camping Gadgets" });
  });
  it("recommends leaving the 404 when nothing shares the type or search term", () => {
    const dead: DeadPage = { url: "https://vanlifeemporium.com/products/vintage-typewriter-ribbon", impressions: 30, queries: ["typewriter ribbon"], reason: "not-found", productType: "Stationery" };
    const s = redirectSuggestion(dead, live);
    expect(s).toBeNull();
    expect(deadPageIssue(dead, s).detail).toMatch(/leave it as a 404/);
  });
});

describe("R22-503 title advice says what a missing term is", () => {
  const flask = payload({ title: "Thermos 16oz Food Flask", handle: "thermos-stainless-steel-food-flask", productType: "Food Flasks" });
  it("calls 'stainless steel' a description and keeps the brand first", () => {
    const hit = missingSearchTerms(flask, [{ query: "stainless steel food flask", impressions: 90 }], ["Thermos"])!;
    expect(hit.kinds).toEqual({ stainless: "description", steel: "description" });
    const issue = searchTermIssue("f", flask, hit, ["Thermos"], { volume: true });
    expect(issue.detail).toContain("“stainless steel” is a description");
    expect(issue.detail).toContain("not a brand or model");
    expect(exampleTitle(flask, hit, ["Thermos"], { volume: true })).toBe("Thermos 470ml Stainless Steel Food Flask");
  });
  it("never starts the example title with a bracket", () => {
    const set = payload({ title: "Bamboo Cutlery Set", handle: "bamboo-cutlery-set-brown-bag" });
    const hit = missingSearchTerms(set, [{ query: "(brown bag) bamboo cutlery set", impressions: 40 }])!;
    const t = exampleTitle(set, hit);
    expect(t.startsWith("(")).toBe(false);
    expect(t).toBe("Bamboo Cutlery Set (Brown Bag)");
  });
});

describe("R22-504 book suggestions", () => {
  it("excludes unrelated and pre-1980 titles and says no confident match was found", () => {
    const json = { docs: [
      { title: "In Morocco", author_name: ["Edith Wharton"], first_publish_year: 1920, isbn: ["9781234567897"] },
      { title: "Morocco that was", author_name: ["Walter Harris"], first_publish_year: 1921, isbn: ["9780306806032"] },
    ] };
    expect(titleMatches("Morocco – A Vanlife Guide", "In Morocco")).toBe(false);
    expect(openLibraryCandidates(json, "Morocco – A Vanlife Guide")).toEqual([]);
  });
  it("lists author, year and cover for each edition so the merchant can pick", () => {
    const json = { docs: [{ title: "Van Life Cookbook", author_name: ["Danae Moore"], first_publish_year: 2020, editions: { docs: [
      { title: "Van Life Cookbook", publisher: ["Ulysses Press"], isbn: ["9781646040001"], publish_date: ["2020"] },
      { title: "Van Life Cookbook", publisher: ["Pavilion Books"], isbn: ["9781911663010"], publish_date: ["2021"] },
    ] } }] };
    const c = openLibraryCandidates(json, "Van Life Cookbook");
    expect(c.map((x) => x.publisher)).toEqual(["Ulysses Press", "Pavilion Books"]);
    for (const x of c) {
      expect(x.author).toBe("Danae Moore");
      expect(x.year).toMatch(/^20\d\d$/);
      expect(x.cover).toBe(`https://covers.openlibrary.org/b/isbn/${x.isbn}-M.jpg`);
    }
  });
});

describe("R22-505 every image's alt text checked", () => {
  it("image 1 with a keyword-stuffed alt is rewritten too", () => {
    expect(altProblem("20L Cool Box, Ice Box, Large Cool Box, for Picnics, Beach, Camping", [], "20L Cool Box")).toBe("stuffed");
    expect(altProblem("A blue 20 litre cool box with a white lid.", [], "20L Cool Box")).toBeNull();
  });
  it("drops a scene the image does not show", () => {
    expect(cleanAlt("A blue cool box in a van-life setting.", { sceneVisible: false })).toBe("A blue cool box.");
    expect(cleanAlt("A blue cool box in a van-life setting.", { sceneVisible: true })).toBe("A blue cool box in a van-life setting.");
  });
  it("rewrites capitals in sentence case", () => {
    expect(altProblem("FALCON round Pie Dish White 26CM")).toBe("capitals");
    expect(cleanAlt("FALCON round Pie Dish White 26CM")).toBe("Falcon round Pie Dish White 26 cm");
    expect(altProblem("A white LED lantern with a USB cable.")).toBeNull();
  });
});

describe("R22-601 readiness questions by product type", () => {
  it("a CO alarm is not asked for material or care, but for power source and sensor life", () => {
    const keys = relevantQuestions(payload({ title: "Kidde CO Alarm", productType: "Carbon monoxide alarm" })).map((q) => q.key);
    expect(keys).not.toContain("material");
    expect(keys).not.toContain("care");
    expect(keys).toEqual(expect.arrayContaining(["power", "lifespan"]));
  });
  it("for a tent, fit means the packed size", () => {
    const tent = payload({ title: "4 Person Tunnel Tent", productType: "Tent" });
    expect(fitQuestion(tent)).toBe("What is the packed size?");
    expect(relevantQuestions(tent).find((q) => q.key === "fit")!.label).toMatch(/packed size/);
    const s = faqSuggestions(tent, {}, { dimensions: { value: "Packed size 60 x 20 x 20 cm", source: "Product description", confirmed: false } } as never);
    expect(s.suggestions.map((x) => x.question)).toContain("What is the packed size?");
  });
});

describe("R22-602 FAQ answers count once live", () => {
  const kidde = payload({ title: "Kidde CO Alarm", productType: "Carbon monoxide alarm", descriptionHtml: "<p>A CO alarm.</p>", faqs: [
    { question: "How big is it?", answer: "12 x 12 x 4 cm" },
    { question: "How much does it weigh?", answer: "250 g" },
  ] });
  it("live FAQ answers count for size and weight", () => {
    const a = answeredQuestions(kidde, {}, { faqLive: true });
    expect(a.size && a.weight).toBe(true);
  });
  it("'Saved, not live' FAQ answers do not count, in the catalogue audit too", () => {
    expect(answeredQuestions(kidde, {}, { faqLive: false })).toMatchObject({ size: false, weight: false });
    const r: AuditResource = { id: "kidde", title: kidde.title, kind: "product", payload: JSON.stringify(kidde), keyword: "", facts: "{}" };
    const run = (opts: { faqNotLive?: Set<string>; faqAllNotLive?: boolean }) => {
      const pre = createPrescan({ storeName: NAME, ...opts });
      pre.add([r]);
      const a = createCatalogueAuditor(pre.context());
      a.add([r]);
      return a.result().issues.find((i) => i.code === "answer-missing-size");
    };
    expect(run({})).toBeUndefined();
    expect(run({ faqNotLive: new Set(["kidde"]) })?.resourceIds).toContain("kidde");
    expect(run({ faqAllNotLive: true })?.resourceIds).toContain("kidde");
  });
});

describe("R22-403 confirm a brand once", () => {
  it("creates vendor proposals for every Polarbox product and shows smart-collection warnings first", async () => {
    await prisma.resource.create({ data: { id: "s3-smart", storeId: STORE, remoteId: "gid://shopify/Collection/9", kind: "collection", title: "By brand", handle: "by-brand", payload: JSON.stringify({ title: "By brand", rules: [{ column: "VENDOR", condition: NAME }] }) } });
    const items = [
      payload({ title: "Polarbox 20L Cool Box", handle: "polarbox-20l-cool-box", collections: ["By brand"] }),
      payload({ title: "Polarbox 10L Cool Box", handle: "polarbox-10l-cool-box" }),
      payload({ title: "Classic 30L Cool Box", handle: "polarbox-classic-30l" }),
      payload({ title: "Thermos Food Flask", handle: "thermos-food-flask", vendor: "Thermos" }),
    ];
    for (const [i, p] of items.entries()) await prisma.resource.create({ data: { id: `s3-p${i}`, storeId: STORE, remoteId: `gid://shopify/Product/${900 + i}`, kind: "product", title: p.title, handle: p.handle!, payload: JSON.stringify(p) } });
    const { brand, results } = await confirmBrand(STORE, { brand: "Polarbox" });
    expect(brand).toBe("Polarbox");
    expect(results.filter((r) => r.status === "pending").map((r) => r.resourceId).sort()).toEqual(["s3-p0", "s3-p1", "s3-p2"]);
    expect(results.find((r) => r.resourceId === "s3-p0")!.warnings![0]).toMatch(/Smart collection “By brand” uses the vendor/);
    const change = await prisma.change.findFirstOrThrow({ where: { storeId: STORE, resourceId: "s3-p0", feature: "vendor" } });
    expect(change.status).toBe("pending");
    expect(JSON.parse(change.reasons).join(" ")).toMatch(/You confirmed “Polarbox”.*Warning: Smart collection/);
    const cfg = JSON.parse((await prisma.store.findUniqueOrThrow({ where: { id: STORE } })).settings);
    expect(cfg.confirmedBrands).toEqual(["Polarbox"]);
    // Confirming again does not duplicate the proposals.
    const again = await confirmBrand(STORE, { brand: "polarbox" });
    expect(again.results.every((r) => r.status === "exists")).toBe(true);
    expect(await prisma.change.count({ where: { storeId: STORE, feature: "vendor", status: "pending" } })).toBe(3);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import prisma from "../app/db.server";
import { auditCatalogue, type AuditResource } from "../app/core/catalogue";
import { brandRuleHits, ruleErrors, metricTitle, VOLUME_PRODUCT, allowedCaps } from "../app/core/brand-rules";
import { sentencePattern } from "../app/core/catalogue-checks";
import { contentValue, sameContent, contentDiff } from "../app/core/content-diff";
import { removeFaqSection } from "../app/core/faq-facts";
import { faqOnPage } from "../app/core/faq-live";
import { detectBrand, brandList, learnTitleBrands } from "../app/core/brand-detect";
import { proposeBrands } from "../app/core/brand-proposals.server";
import { findings } from "../app/core/agent.server";
import { approve, applyChange, scheduleCatalogueRefresh, audit, REFRESH_WINDOW_MS } from "../app/core/service.server";
import type { Payload } from "../app/core/types";

const STORE = "demo-r22-s2";
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
const row = (p: Payload): AuditResource => ({ id: `r${n}`, title: p.title, kind: "product", payload: JSON.stringify(p), keyword: "", facts: "{}" });

describe("R22-105 duplicate FAQ sources", () => {
  it("names another app's FAQ data alongside RankPilot's", () => {
    const r = auditCatalogue([row(payload({ faqs: [{ question: "Does it fold?", answer: "Yes." }], metafields: { "faqs.settings": '{"items":[{"q":"Does it fold?"}]}' } }))]);
    const f = r.issues.find((i) => i.code === "duplicate-faq-source")!;
    expect(f.detail).toContain("faqs.settings");
    expect(f.detail).toMatch(/Keep the RankPilot FAQs/);
  });
  it("offers to remove a description FAQ section once the block shows the FAQs", () => {
    const html = "<p>A sturdy table.</p><h2>FAQs</h2><h3>Does it fold?</h3><p>Yes, flat.</p><h3>Is it heavy?</h3><p>No, 4 kg.</p><h2>Care</h2><p>Wipe clean.</p>";
    const r = auditCatalogue([row(payload({ descriptionHtml: html, faqs: [{ question: "Does it fold?", answer: "Yes, flat." }] }))]);
    const f = r.issues.find((i) => i.code === "duplicate-faq-source" && i.feature === "description")!;
    expect(f.detail).toMatch(/Remove the description FAQ section/);
    const cut = removeFaqSection(html);
    expect(cut.html).toBe("<p>A sturdy table.</p><h2>Care</h2><p>Wipe clean.</p>");
    expect(cut.removed[0]).toBe("FAQs");
  });
  it("says the page has two FAQPage entities, and spots a stopgap Custom Liquid block", () => {
    const faqs = [{ question: "Does it fold?", answer: "Yes." }];
    const block = '<section data-rankpilot-faq="1"><details><summary>Does it fold?</summary><div>Yes.</div></details></section><script type="application/ld+json" data-rankpilot-faq-schema>{"@type":"FAQPage","mainEntity":[]}</script>';
    const theme = '<script type="application/ld+json" id="theme-faq">{"@type":"FAQPage","mainEntity":[]}</script>';
    const custom = '<div class="custom-liquid"><h3>Does it fold?</h3><p>Yes.</p></div>';
    const check = faqOnPage(`<html><head>${theme}</head><body>${block}${custom}</body></html>`, faqs);
    expect(check).toMatchObject({ block: true, live: true, faqPages: 2, shownElsewhere: 1 });
    expect(check.sources).toEqual(["theme-faq", "RankPilot FAQ block"]);
  });
});

describe("R22-202 single write time", () => {
  it("20 single FAQ writes stay well under 3 s at the 95th percentile; the re-audit runs once in the background", async () => {
    const desc = (i: number) => `<h3>What should I check before buying the Item ${i}?</h3><p>Dimensions: 30 x 20 cm. Material: steel.</p><p>${"Detail about everyday use on the road. ".repeat(12)}</p>`;
    await prisma.resource.createMany({ data: Array.from({ length: 150 }, (_, i) => ({ storeId: STORE, remoteId: `gid://shopify/Product/bench${i}`, kind: "product", title: `Bench Item ${i}`, handle: `bench-item-${i}`, payload: JSON.stringify(payload({ title: `Bench Item ${i}`, handle: `bench-item-${i}`, descriptionHtml: desc(i) })) })) });
    await audit(STORE);
    const r = await prisma.resource.findFirstOrThrow({ where: { storeId: STORE, title: "Bench Item 0" } });
    const was = process.env.VITEST;
    delete process.env.VITEST;
    const times: number[] = [];
    try {
      for (let i = 0; i < 20; i++) {
        const c = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "faq", before: JSON.stringify(i ? [{ question: "Q?", answer: `A${i - 1}` }] : []), after: JSON.stringify([{ question: "Q?", answer: `A${i}` }]), reasons: JSON.stringify(["merchant-reviewed-v1: timing"]) } });
        const t0 = Date.now();
        await approve(STORE, c.id, "merchant");
        await applyChange(STORE, c.id);
        times.push(Date.now() - t0);
        // The apply was run directly; its queued job must not be picked up by other test files.
        await prisma.job.deleteMany({ where: { storeId: STORE, kind: "apply" } });
      }
    } finally { process.env.VITEST = was; }
    const p95 = [...times].sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1];
    expect(p95).toBeLessThan(3000);
    const refreshes = await prisma.job.findMany({ where: { storeId: STORE, kind: "refresh-audit" } });
    expect(refreshes.length).toBeGreaterThanOrEqual(1);
    expect(refreshes.length).toBeLessThanOrEqual(2);
    for (const j of refreshes) expect(j.runAt.getTime() % REFRESH_WINDOW_MS).toBe(2000);
    await prisma.job.deleteMany({ where: { storeId: STORE } });
  }, 120000);
  it("one refresh per window, run after the window closes", async () => {
    const now = Date.parse("2026-10-01T13:00:05Z");
    const a = await scheduleCatalogueRefresh(STORE, { inline: false, now });
    const b = await scheduleCatalogueRefresh(STORE, { inline: false, now: now + 5000 });
    expect(b && "id" in b && a && "id" in a && b.id === a.id).toBe(true);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: (a as { id: string }).id } });
    expect(job.runAt.toISOString()).toBe("2026-10-01T13:00:22.000Z");
    await prisma.job.deleteMany({ where: { storeId: STORE } });
  });
});

describe("R22-302 units converted by what they measure", () => {
  it("a flask's 16oz is 470 ml; 'weighs 16oz' is 454 g; the title gets its own proposal", () => {
    expect(VOLUME_PRODUCT.test("Thermoses 16oz Thermos Food Flask")).toBe(true);
    expect(brandRuleHits("Holds 16oz of soup.", { volume: true }).find((h) => h.rule === "Imperial units")?.match).toBe("16oz → 470 ml");
    expect(brandRuleHits("It weighs 16oz empty.", { volume: true }).find((h) => h.rule === "Imperial units")?.match).toBe("16oz → 454 g");
    expect(brandRuleHits("Pack weighs 16oz.").find((h) => h.rule === "Imperial units")?.match).toBe("16oz → 454 g");
    expect(metricTitle("16oz Thermos Food Flask", { volume: true })).toBe("470ml Thermos Food Flask");
    const r = auditCatalogue([row(payload({ title: "16oz Thermos Food Flask", vendor: "Thermos", productType: "Thermoses", descriptionHtml: "<p>Keeps 16oz of food hot for 9 hours.</p>" }))]);
    const units = r.issues.filter((i) => i.code === "imperial-units");
    expect(units.map((u) => u.feature).sort()).toEqual(["description", "title"]);
    expect(units.find((u) => u.feature === "title")!.detail).toContain("Suggested title: “470ml Thermos Food Flask”");
    expect(units.find((u) => u.feature === "description")!.detail).toContain("16oz → 470 ml");
  });
});

describe("R22-303 repeated text counted by its pattern", () => {
  it("counts every product that uses the template, and shows it with a placeholder", () => {
    const titles = Array.from({ length: 272 }, (_, i) => `${["Helinox", "Outsunny", "Polarbox", "Betron"][i % 4]} ${["Chair", "Table", "Cool Box", "Speaker"][i % 4]} ${i}`);
    expect(sentencePattern("What should I check before buying the Helinox Chair 0?", "Helinox Chair 0").sample).toBe("What should I check before buying the <product name>?");
    const rows = [...titles.map((t) => row(payload({ title: t, descriptionHtml: `<h3>What should I check before buying the ${t}?</h3><p>Measure your space first.</p>` }))), ...Array.from({ length: 47 }, () => row(payload({ descriptionHtml: "<p>A distinct description for a different product line.</p>" })))];
    const r = auditCatalogue(rows);
    const t = r.issues.find((i) => i.code === "repeated-template" && i.detail.includes("<product name>"))!;
    expect(t.count).toBe(272);
    expect(t.detail).toContain("“What should I check before buying the <product name>?” appears on 272 of 319 products");
  });
});

describe("R22-304 changed-outside ignores formatting", () => {
  it("reproduce first: inline style spacing already compares equal; CSS in a <style> block did not", () => {
    expect(contentValue('<p style="margin:28px 0">Open daily.</p>')).toBe(contentValue('<p style="margin: 28px 0">Open daily.</p>'));
    expect(sameContent("<style>.box{margin:28px 0}</style><p>Open daily.</p>", "<style>.box { margin: 28px 0; }</style><p>Open daily.</p>")).toBe(true);
    expect(sameContent("<style>.box{margin:28px 0}</style>", "<style>.box{margin:30px 0}</style>")).toBe(false);
  });
  it("shows a real edit's two phrases side by side", () => {
    const d = contentDiff("<p>The site is open 2 November 2026–11 March 2027 for winter stays.</p>", "<p>The site is open from November to mid-March for winter stays.</p>");
    expect(d.rankpilot).toContain("2 November 2026–11 March 2027");
    expect(d.shopify).toContain("from November to mid-March");
  });
});

describe("R22-401 brands not on the list", () => {
  it("learns a brand repeated at the start of titles, with high confidence", () => {
    expect(brandList([], NAME).some((b) => b.toLowerCase() === "betron")).toBe(false);
    const rows = ["Betron KBS08 Blue Bluetooth Speaker", "Betron KBS08 Titanium Bluetooth Speaker", "Betron D51 Bluetooth Speaker"].map((t) => row(payload({ title: t, handle: t.toLowerCase().replace(/\s+/g, "-") })));
    const found = auditCatalogue(rows, { storeName: NAME }).issues.filter((i) => i.code === "brand-is-store");
    expect(found).toHaveLength(3);
    expect(found.every((f) => f.brand?.vendor === "Betron" && f.brand.confidence === "high")).toBe(true);
  });
  it("finds a brand only in the handle with medium confidence", () => {
    const b = detectBrand(payload({ title: "Marine Ultra 51L Cool Box", handle: "igloo-marine-ultra-cool-box-51-litre" }), brandList([], NAME).filter((x) => x !== "Igloo"));
    expect(b).toMatchObject({ vendor: "Igloo", confidence: "medium", evidence: [{ where: "handle" }] });
  });
  it("does not treat ordinary words as brands", () => {
    expect(learnTitleBrands(["Folding Camping Table", "Folding Chair", "Portable Stove", "Portable Fan"])).toEqual([]);
    const rows = ["Folding Camping Table", "Folding Sling Chair", "Portable Camping Shower", "Portable Mini Projector"].map((t) => row(payload({ title: t, handle: t.toLowerCase().replace(/\s+/g, "-") })));
    expect(auditCatalogue(rows, { storeName: NAME }).issues.filter((i) => i.code === "brand-is-store")).toEqual([]);
  });
  it("remembers a brand once the merchant approves it", () => {
    const rows = [row(payload({ title: "Polarbox Pink 12L Cool Box", vendor: "Polarbox" })), row(payload({ title: "Pink Retro Cool Box", handle: "pink-retro-cool-box-polarbox" }))];
    const f = auditCatalogue(rows, { storeName: NAME }).issues.find((i) => i.code === "brand-is-store")!;
    expect(f.brand?.vendor).toBe("Polarbox");
  });
  it("on the Van Life Emporium catalogue, finds at least 35 of the brands with no confident false proposal", () => {
    const d = JSON.parse(readFileSync("tests/fixtures/vle-store-branded.json", "utf8")) as { otherVendors: string[]; products: [string, string, string | null][] };
    const rows: AuditResource[] = d.products.map(([title, handle], i) => ({ id: `p${i}`, title, kind: "product", keyword: "", facts: "{}", payload: JSON.stringify(payload({ title, handle })) }));
    d.otherVendors.forEach((v, i) => rows.push({ id: `v${i}`, title: `x${i}`, kind: "product", keyword: "", facts: "{}", payload: JSON.stringify(payload({ title: `Other ${i}`, handle: `other-${i}`, vendor: v })) }));
    const issues = auditCatalogue(rows, { storeName: NAME }).issues.filter((i) => i.code === "brand-is-store");
    const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const byId = new Map(issues.map((i) => [i.resourceId, i]));
    const truth = d.products.map(([, , b], i) => ({ b, f: byId.get(`p${i}`) }));
    const brandsFound = new Set(truth.filter((t) => t.b && t.f && k(t.f.brand!.vendor) === k(t.b)).map((t) => k(t.b!)));
    expect(brandsFound.size).toBeGreaterThanOrEqual(35);
    // No high-confidence proposal for a product without a brand, and no wrong brand.
    expect(truth.filter((t) => !t.b && t.f && t.f.brand?.confidence === "high")).toEqual([]);
    expect(truth.filter((t) => t.b && t.f && k(t.f.brand!.vendor) !== k(t.b))).toEqual([]);
    // Own-label merchandise is never flagged.
    for (const title of ["Van Life Mug", "Stay Wild Tote", "Mountains Water Bottle", "Wild & Free Wood Print"]) expect(truth[d.products.findIndex((p) => p[0] === title)].f).toBeUndefined();
  });
});

describe("R22-402 proposal already pending", () => {
  it("shows the pending proposal and /brands does not create a second", async () => {
    const p = payload({ title: "Betron D51 Bluetooth Speaker", handle: "betron-d51-portable-bluetooth-speaker" });
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/betron", kind: "product", title: p.title, handle: p.handle, payload: JSON.stringify(p) } });
    const issues = auditCatalogue([{ ...row(p), id: r.id }], { storeName: NAME }).issues;
    await prisma.audit.create({ data: { storeId: STORE, score: 90, aeoScore: 0, coverage: "{}", resourceCount: 1, issues: JSON.stringify(issues) } });
    const first = await proposeBrands(STORE, { ids: [r.id] });
    expect(first.results[0]).toMatchObject({ status: "pending", vendor: "Betron" });
    const again = await proposeBrands(STORE, { ids: [r.id] });
    expect(again.results[0]).toMatchObject({ status: "exists", changeId: first.results[0].changeId, message: "Proposal pending" });
    expect(await prisma.change.count({ where: { storeId: STORE, resourceId: r.id, feature: "vendor" } })).toBe(1);
    const item = (await findings(STORE)).flatMap((g) => g.items).find((i) => i.resourceId === r.id && i.code === "brand-is-store")!;
    expect(item).toMatchObject({ status: "Proposal pending", pendingChangeId: first.results[0].changeId });
  });
});

describe("R22-305 brand names in capitals", () => {
  it("allows NETGEAR and AFERIY when they are the vendor, the title brand, an approved brand or a pending proposal", () => {
    expect(ruleErrors("The AFERIY P210 keeps a NETGEAR router running.").map((h) => h.match)).toEqual(expect.arrayContaining(["AFERIY", "NETGEAR"]));
    expect(ruleErrors("The AFERIY P210 keeps a NETGEAR router running.", { allow: allowedCaps("Aferiy", "Netgear") }).filter((h) => h.rule === "Capitals")).toEqual([]);
    const desc = "<p>The AFERIY P210 power station also runs a NETGEAR router.</p>";
    const approved = auditCatalogue([row(payload({ title: "Nighthawk M7 Router", vendor: "Netgear", descriptionHtml: "<p>A router.</p>" })), row(payload({ title: "P210 Power Station", handle: "aferiy-p210-power-station-dc600", descriptionHtml: desc }))], { storeName: NAME, knownBrands: ["Aferiy"] });
    expect(approved.issues.filter((i) => i.code === "supplier-formatting")).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { extractSpecs, labelledSegments, groundedProposal } from "../app/core/spec-extract";
import { extractFacts, auditCatalogue, optimise } from "../app/core/catalogue";
import { legacyWordCap } from "../app/core/metadata-quality";
import { assertSafeCopy } from "../app/core/service.server";
import { technicalHealth, storeScore } from "../app/core/store-score";
import { coverageGroup, coverageReport, nextStep, pageKind } from "../app/core/index-coverage";
import { parseCrux, fieldScore, fieldLine } from "../app/core/field-speed";
import { applyFindingState, snooze, unsnooze, keepShopify, noBarcodeFact } from "../app/core/finding-state";
import { driftIssues } from "../app/core/history-hygiene.server";
import { themeSignals, themeFindings } from "../app/core/theme-leftovers";
import { cleanSupplierHtml, blockingMarkup } from "../app/core/html-cleanup";
import { supplierOverlap } from "../app/core/supplier-copy";
import { fillSpecsJob, specReviewList, confirmAllSpecs, discardSpecs, specCoverage } from "../app/core/spec-review.server";
import { saveSupplierOriginals, supplierCopyReport, proposeCleanFormatting } from "../app/core/supplier-copy.server";
import { answersBreakdown } from "../app/core/ai-answers";
import { descriptionProblems, bulkDescription } from "../app/core/agent.server";
import { hasFaqSources } from "../app/core/finding-workflow";
import { defaults, type Issue, type Payload, type Settings } from "../app/core/types";

const STORE = "demo-r18";
const payload = (over: Partial<Payload> & Record<string, unknown> = {}) => JSON.stringify({
  title: "Seagrass Basket", handle: "basket", descriptionHtml: "<p>A basket.</p>",
  seo: { title: "Seagrass Basket | Van Life Emporium", description: "A seagrass basket." }, images: [], collections: [], published: true, ...over,
});
async function reset() {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const)
    await (prisma[m] as unknown as { deleteMany(a: { where: { storeId: string } }): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
}
beforeAll(async () => {
  await reset();
  await prisma.store.create({ data: { id: STORE, demo: true, domain: "https://vanlifeemporium.com" } });
});
afterAll(reset);

describe("item 1: specification extraction", () => {
  it("reads several labels on one supplier line", () => {
    const specs = extractSpecs("<p>Length: 30cm x 22cm x 15cm Material: Seagrass In the Box: 2 x baskets</p>");
    expect(specs.map((s) => [s.key, s.value])).toEqual([["dimensions", "Length 30cm x 22cm x 15cm"], ["materials", "Seagrass"], ["included", "2 x baskets"]]);
    expect(specs[0].source).toContain("Length: 30cm x 22cm x 15cm Material: Seagrass");
  });
  it("reads house-style section headings followed by a list", () => {
    const specs = extractSpecs("<h3>What is included</h3><ul><li>1 x chair</li><li>Carry bag</li></ul><p><strong>Check the fit</strong></p><ul><li>Seat width 45cm</li><li>Folds to 80cm</li></ul>");
    const byKey = Object.fromEntries(specs.map((s) => [s.key, s]));
    expect(byKey.included.value).toBe("1 x chair; Carry bag");
    expect(byKey.included.source).toMatch(/“What is included” section: “1 x chair” “Carry bag”/);
    expect(byKey.dimensions.value).toBe("Seat width 45cm; Folds to 80cm");
  });
  it("combines height, diameter, open and folded into dimensions, and adds capacity and wider labels", () => {
    const f = extractFacts({ descriptionHtml: "<ul><li>Height: 80cm</li><li>Diameter: 45cm</li><li>Capacity: 12 litres</li><li>Fabric: 100% cotton</li><li>Max wattage: 60W</li><li>Set includes: 4 pegs</li></ul>" } as Payload);
    expect(f.dimensions.value).toBe("Height 80cm; Diameter 45cm");
    expect(f.capacity.value).toBe("12 litres");
    expect(f.materials.value).toBe("100% cotton");
    expect(f.power.value).toBe("60W");
    expect(f.included.value).toBe("4 pegs");
    expect(Object.values(f).every((x) => !x.confirmed && x.source.startsWith("Product description"))).toBe(true);
  });
  it("does not read prose as a specification", () => {
    expect(labelledSegments("Ideal for size: small vans and campers.")).toEqual([]);
    expect(extractSpecs("<p>Lightweight and ideal for adventures.</p>")).toEqual([]);
    expect(labelledSegments("Colour: Grey Weight: 2kg")).toEqual([{ label: "Weight", value: "2kg" }]);
  });
  it("keeps a grounded AI proposal only when its quote is in the description and its numbers are in the quote", () => {
    const text = "Folds flat for storage. Supports up to 100kg on firm ground.";
    expect(groundedProposal(text, { key: "capacity", value: "Up to 100kg", quote: "Supports up to 100kg on firm ground." })?.source).toContain("quote checked");
    expect(groundedProposal(text, { key: "capacity", value: "Up to 120kg", quote: "Supports up to 100kg on firm ground." })).toBeNull();
    expect(groundedProposal(text, { key: "capacity", value: "Up to 100kg", quote: "Tested to 100kg by an independent lab." })).toBeNull();
    expect(groundedProposal(text, { key: "colour", value: "Grey", quote: "Folds flat for storage." })).toBeNull();
  });
  it("bulk fill writes unconfirmed suggestions to empty fields only, then confirm-all and discard work per product", async () => {
    const a = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/1", kind: "product", title: "Basket", handle: "basket", payload: payload({ descriptionHtml: "<p>Length: 30cm Material: Seagrass In the Box: 2 x baskets</p>" }), facts: JSON.stringify({ materials: { value: "Rattan", source: "Supplier sheet", confirmed: false } }) } });
    const b = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/2", kind: "product", title: "Chair", handle: "chair", payload: payload({ descriptionHtml: "<p>Weight: 3kg</p>" }) } });
    const saved: object[] = [];
    const result = await fillSpecsJob(STORE, {}, async (p) => { saved.push(p); });
    expect(result).toMatchObject({ done: true, filled: 3, products: 2, total: 2 });
    const facts = JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: a.id } })).facts);
    expect(facts.materials.value).toBe("Rattan");
    expect(facts.dimensions.value).toBe("Length 30cm");
    const list = await specReviewList(STORE);
    expect(list.map((r) => r.facts.length).sort()).toEqual([1, 3]);
    expect(await confirmAllSpecs(STORE, a.id)).toBe(3);
    expect(JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: a.id } })).facts).included.confirmed).toBe(true);
    expect(await discardSpecs(STORE, b.id)).toBe(1);
    expect(await specReviewList(STORE)).toEqual([]);
    expect(specCoverage([{ payload: payload({ descriptionHtml: "<p>Nothing here.</p>" }) }, { payload: payload({ descriptionHtml: "<p>Weight: 2kg</p>" }) }])).toEqual({ total: 2, none: 1, share: 0.5 });
  });
});

describe("item 2: the retired five-word rule", () => {
  it("no longer trips on a word-count change note (the mug case)", () => {
    expect(legacyWordCap(["agent-reviewed-v1: x", "Description rewrite (83 → 135 words)."])).toBe(false);
    expect(legacyWordCap(["Description rewrite (word count 83 to 135)."])).toBe(false);
    expect(legacyWordCap(["125 word description", "Uses 25 words"])).toBe(false);
    expect(() => assertSafeCopy("description", "<p>old</p>", "<p>new</p>", ["agent-reviewed-v1: written by the agent", "Description rewrite (83 → 135 words)."])).not.toThrow();
  });
  it("still recognises the original wording", () => {
    for (const r of ["Search titles must satisfy BOTH limits: at most five words AND 60 characters", "Maximum five words and 60 characters", "Title must contain one to five words.", "maximum 5 words", "5-word limit"])
      expect(legacyWordCap([r])).toBe(true);
  });
  it("agent notes use the new wording", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/3", kind: "product", title: "Camping Mug", handle: "mug", payload: payload({ title: "Camping Mug", descriptionHtml: "<p>" + "Enamel mug for the road. ".repeat(10) + "</p>" }) } });
    const out = await bulkDescription(STORE, { items: [{ resourceId: r.id, html: "<p>" + "A tough enamel camping mug that holds a proper brew. ".repeat(12) + "</p>" }] });
    expect(out.results[0].message).toMatch(/^word count \d+ to \d+$/);
    expect(legacyWordCap([String(out.results[0].message)])).toBe(false);
  });
});

describe("items 3 and 5: honest scores and real-visitor speed", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const metric = (provider: string, value: object) => ({ provider, period: "2026-09-28", payload: JSON.stringify(value) });
  it("labels the checklist as Catalogue checks and weights index coverage and speed up", () => {
    const t = technicalHealth({ metrics: [metric("indexation", { checkedAt: "2026-09-28T00:00:00Z", inspected: 100, indexed: 74, submitted: 400 })], technical: 98, healthScores: {}, observations: [], now });
    expect(t.parts.map((p) => [p.label, p.weight])).toEqual([["Catalogue checks", 25], ["Mobile speed (single lab sample)", 25], ["Inspected Google index coverage (100 pages inspected)", 30], ["Scanned structured data", 20]]);
    // 98 no longer reads as technical health: 74% index coverage pulls it down.
    expect(t.score).toBe(Math.round((25 * 98 + 30 * 74) / 55));
    expect(storeScore({ metrics: [], healthScores: {}, observations: [], now }).version).toBe(5);
  });
  it("prefers Chrome UX Report field data over the lab sample", () => {
    const page = parseCrux("Home page", "https://vanlifeemporium.com/", "url", { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 2100 } }, interaction_to_next_paint: { percentiles: { p75: 350 } }, cumulative_layout_shift: { percentiles: { p75: "0.30" } } } } });
    expect([page.lcp.rating, page.inp.rating, page.cls.rating]).toEqual(["good", "needs-improvement", "poor"]);
    const crux = { checkedAt: "2026-09-28T00:00:00Z", pages: [page] };
    expect(fieldScore(crux)).toBe(50);
    expect(fieldLine(page)).toBe("Home page: LCP 2.1 s (good) · INP 350 ms (needs improvement) · CLS 0.30 (poor)");
    const t = technicalHealth({ metrics: [metric("crux", crux), metric("pagespeed", { checkedAt: "2026-09-28T00:00:00Z", score: 0.9 })], healthScores: {}, observations: [], now });
    expect(t.parts[1]).toMatchObject({ label: "Real-visitor speed (Chrome UX Report)", value: 50 });
  });
  it("says clearly when no field data exists", () => {
    const none = parseCrux("Product template", "https://vanlifeemporium.com/products/x", "origin", null);
    expect(none.level).toBe("none");
    expect(fieldScore({ checkedAt: "", pages: [none] })).toBeNull();
    expect(fieldLine(none)).toContain("no real-visitor data");
  });
});

describe("item 4: index coverage report", () => {
  const rows = [
    { url: "https://vanlifeemporium.com/products/a", checkedAt: "2026-09-28", verdict: "PASS", coverageState: "Submitted and indexed" },
    { url: "https://vanlifeemporium.com/products/b", checkedAt: "2026-09-28", verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" },
    { url: "https://vanlifeemporium.com/collections/summer-festival", checkedAt: "2026-09-28", verdict: "NEUTRAL", coverageState: "Page with redirect" },
    { url: "https://vanlifeemporium.com/products/c", checkedAt: "2026-09-28", verdict: "NEUTRAL", coverageState: "Duplicate, Google chose different canonical than user", googleCanonical: "https://vanlifeemporium.com/products/a" },
    { url: "https://vanlifeemporium.com/blogs/news/x", checkedAt: "2026-09-28", verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" },
    { url: "https://vanlifeemporium.com/pages/y", checkedAt: "2026-09-28", error: "Quota exceeded" },
  ];
  it("groups every non-indexed page with Google's reason and a next step", () => {
    const r = coverageReport(rows, { status: "not-indexed" });
    expect(r).toMatchObject({ inspected: 5, indexed: 1 });
    expect(r.rows).toHaveLength(5);
    expect(r.rows.every((x) => x.reason && x.nextStep.length > 10)).toBe(true);
    expect(r.groups).toMatchObject({ "crawled-not-indexed": 1, redirect: 1, duplicate: 1, "discovered-not-indexed": 1, "check-unavailable": 1 });
    expect(nextStep(rows[3])).toContain("/products/a");
  });
  it("can be limited to products and collections", () => {
    const r = coverageReport(rows, { kind: "catalogue", status: "all" });
    expect(r.rows.map((x) => x.kind)).toEqual(expect.arrayContaining(["product", "collection"]));
    expect(r.rows.some((x) => x.kind === "article")).toBe(false);
    expect(pageKind("https://vanlifeemporium.com/en-gb/products/a")).toBe("product");
    expect(coverageGroup({ url: "x", checkedAt: "", coverageState: "Excluded by ‘noindex’ tag" })).toBe("noindex");
  });
});

describe("items 6–8: keep Shopify's version, confirmed no barcode, snooze", () => {
  const cfg = (over: Partial<Settings> = {}) => ({ ...defaults, ...over }) as Settings;
  const issue = (code: string, over: Partial<Issue> = {}): Issue => ({ resourceId: "r1", title: "Summer Festival", code, severity: "warning", detail: "d", ...over });
  it("snoozes a finding until a date with a reason, and lists it", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    const s = snooze(cfg(), { resourceId: "r1", code: "redirects-home", until: "2027-06-01", reason: "Redirect to home is intentional" }, now);
    const split = applyFindingState([issue("redirects-home"), issue("long-title")], s, now);
    expect(split.active.map((i) => i.code)).toEqual(["long-title"]);
    expect(split.snoozed[0].snooze.reason).toBe("Redirect to home is intentional");
    expect(applyFindingState([issue("redirects-home")], s, Date.parse("2027-06-02")).active).toHaveLength(1);
    expect(applyFindingState([issue("redirects-home")], unsnooze(s, { resourceId: "r1", code: "redirects-home" }), now).active).toHaveLength(1);
    expect(() => snooze(cfg(), { resourceId: "r1", code: "x", until: "2020-01-01", reason: "old" }, now)).toThrow("future");
    expect(() => snooze(cfg(), { resourceId: "r1", code: "x", until: "2027-01-01", reason: "" }, now)).toThrow("reason");
  });
  it("clears a changed-outside flag without a Shopify write", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/9", kind: "product", title: "Rug", handle: "rug", payload: payload({ title: "Rug", seo: { title: "Edited in Shopify", description: "x" } }) } });
    const c = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "seo", before: JSON.stringify({ title: "Old", description: "x" }), after: JSON.stringify({ title: "RankPilot title", description: "x" }), status: "applied", appliedAt: new Date() } });
    const flagged = await driftIssues(STORE, [r]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].changeId).toBe(c.id);
    await prisma.store.update({ where: { id: STORE }, data: { settings: JSON.stringify(keepShopify(cfg(), c.id)) } });
    expect(await driftIssues(STORE, [r])).toHaveLength(0);
    expect((await prisma.change.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("applied");
    await prisma.store.update({ where: { id: STORE }, data: { settings: "{}" } });
  });
  it("stops flagging GTIN for confirmed own-label products and keeps the decision out of copy", () => {
    const res = (facts: object) => ({ id: "p", title: "Own-label rug", kind: "product", handle: "rug", keyword: "", facts: JSON.stringify(facts), payload: payload({ variants: [{ sku: "RUG-1", barcode: "", price: "40.00" }] }) });
    expect(auditCatalogue([res({})]).issues.some((i) => i.code === "missing-gtin")).toBe(true);
    expect(auditCatalogue([res({ barcode: noBarcodeFact() })]).issues.some((i) => i.code === "missing-gtin")).toBe(false);
    expect(hasFaqSources({ barcode: noBarcodeFact() }, defaults)).toBe(false);
    const faq = optimise(JSON.parse(payload()), "product", "faq", { barcode: noBarcodeFact(), weight: { value: "2kg", source: "Supplier", confirmed: true } }, "rug", defaults);
    expect(JSON.stringify(faq.after)).not.toContain("barcode");
  });
});

describe("item 9: theme leftovers", () => {
  it("flags an AVADA-style snippet, dead app blocks and duplicate head tags on the first audit", () => {
    const avada = `<html><head><title>Rug – Van Life Emporium</title><!-- Avada SEO meta start --><title>Rug | Cheap Rugs</title><meta name="description" content="a"><meta name="description" content="b"><script src="https://cdn.shopify.com/extensions/avada-seo-suite/app.js"></script></head><body><p>Failed to render app block "123": app block path "shopify://apps/old/blocks/x" does not exist</p></body></html>`;
    const clean = `<html><head><title>Mug</title><meta name="description" content="m"></head><body><p>We avoid hype in our reviews.</p></body></html>`;
    const findings = themeFindings([themeSignals(avada, "https://vanlifeemporium.com/products/rug"), themeSignals(clean, "https://vanlifeemporium.com/products/mug")]);
    expect(findings.map((f) => f.code).sort()).toEqual(["app-block-failed", "duplicate-head-tags", "theme-leftover"]);
    expect(findings.find((f) => f.code === "theme-leftover")!.detail).toContain("AVADA SEO code is in the live theme on 1 of 2 scanned pages");
    expect(themeFindings([themeSignals(clean, "https://vanlifeemporium.com/")])).toEqual([]);
  });
});

describe("item 10: supplier HTML clean-up", () => {
  const blanket = `<h1 style="color:red">Multifunctional Camping Blanket</h1><div data-app="x"><p>Warm <b>fleece</b> for cold nights.</p><button onclick="buy()">Buy now</button> <a href="http://supplier.example/x">See supplier</a> <a href="https://vanlifeemporium.com/collections/blankets">Our blankets</a></div>`;
  it("strips disallowed markup and keeps every word", () => {
    const r = cleanSupplierHtml(blanket);
    expect(r.sameText).toBe(true);
    expect(r.html).not.toMatch(/<h1|<button|<div|style=|onclick|http:\/\//);
    expect(r.html).toContain('<a href="https://vanlifeemporium.com/collections/blankets">Our blankets</a>');
    expect(blockingMarkup(blanket)).toEqual(expect.arrayContaining(["an H1 heading", "buttons or form fields", "non-HTTPS links"]));
    expect(blockingMarkup(r.html)).toEqual([]);
  });
  it("prepares an approvable formatting-only proposal so the blanket can take an FAQ section", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/10", kind: "product", title: "Blanket", handle: "blanket", payload: payload({ descriptionHtml: blanket }) } });
    expect(auditCatalogue([{ ...r }]).issues.some((i) => i.code === "supplier-markup")).toBe(true);
    const { change } = await proposeCleanFormatting(STORE, r.id);
    expect(change).not.toBeNull();
    expect(() => assertSafeCopy("description", JSON.parse(change!.before), JSON.parse(change!.after), JSON.parse(change!.reasons))).not.toThrow();
    const withFaq = JSON.parse(change!.after) + "<h2>Questions</h2><p>" + "Is it machine washable? Yes, at thirty degrees on a gentle cycle. ".repeat(6) + "</p>";
    // Release 19: rules apply to new text; wording already on the page is not counted as new.
    expect(descriptionProblems(withFaq, { before: JSON.parse(change!.after) }).errors).toEqual([]);
  });
});

describe("item 12: supplier copy check", () => {
  it("measures how much supplier wording remains", async () => {
    const original = "This premium seagrass storage basket is hand woven by skilled artisans and perfect for organising your home with style and ease every day.";
    expect(supplierOverlap(original, `<p>${original}</p>`)).toBe(1);
    expect(supplierOverlap(original, "<p>A hand-woven seagrass basket for the van: stores shoes, cables or veg under the bench seat.</p>")).toBeLessThan(0.1);
    const r = await prisma.resource.findFirstOrThrow({ where: { storeId: STORE, handle: "basket" } });
    await prisma.resource.update({ where: { id: r.id }, data: { payload: payload({ descriptionHtml: `<p>${original}</p>` }) } });
    const saved = await saveSupplierOriginals(STORE, { items: [{ handle: "basket", text: original, source: "Store Operations" }, { handle: "missing", text: original, source: "Store Operations" }] });
    expect(saved.saved).toBe(1);
    const report = await supplierCopyReport(STORE);
    expect(report.onSupplierCopy.map((x) => x.handle)).toEqual(["basket"]);
  });
});

describe("item 16: AI answers breakdown", () => {
  it("shows who was cited instead for each tracked question", () => {
    const now = Date.parse("2026-09-29T00:00:00Z");
    const o = (prompt: string, cited: boolean, competitors: string[]) => ({ engine: "openai", prompt, cited, mentioned: cited, competitors: JSON.stringify(competitors), createdAt: "2026-09-28T00:00:00Z" });
    const rows = answersBreakdown([o("best campervan rug", false, ["example-rugs.co.uk", "vanbits.com"]), o("best campervan rug", false, ["example-rugs.co.uk"]), o("folding van table", true, [])], now);
    expect(rows[0]).toMatchObject({ prompt: "best campervan rug", cited: 0, samples: 2, competitors: [{ name: "example-rugs.co.uk", count: 2 }, { name: "vanbits.com", count: 1 }] });
    expect(rows[0].gap).toContain("example-rugs.co.uk was cited instead");
    expect(rows[1].cited).toBe(1);
  });
});

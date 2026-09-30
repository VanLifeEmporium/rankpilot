import React from "react";
import { describe, it, expect, vi } from "vitest";
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn(), load: vi.fn(), Form: "form" }),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => React.createElement("a", { href: to }, children),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { auditCatalogue, type AuditResource } from "../app/core/catalogue";
import { gtinCheckDigitValid, answeredQuestions } from "../app/core/catalogue-checks";
import { storeScore } from "../app/core/store-score";
import { noBarcodeFact } from "../app/core/finding-state";
import { ScoreBoard } from "../app/components/ScoreBoard";
import type { Payload } from "../app/core/types";

const TEMPLATE = '<h3>What should I check before buying the {name}?</h3><p>Check the size.</p><h3>Need a detail before ordering?</h3><p>Email us.</p>';
let n = 0;
const product = (over: Partial<Payload> = {}, facts: object = {}): AuditResource => {
  n++;
  const title = over.title || `Seagrass Basket ${n}`;
  const p: Payload = {
    title, handle: `p-${n}`, seo: { title: `${title} for campervans | Van Life Emporium`, description: `A seagrass basket ${n} for storing shoes and cables in the van. Hand woven, light and easy to wipe clean after a weekend away on the road.` },
    descriptionHtml: `<p>A hand-woven seagrass basket that fits in a van locker. Measures 30 x 20 cm and weighs 400 g. Made from seagrass. Includes one basket. Wipe clean. UK delivery in 2 to 4 days.</p>${TEMPLATE.replace("{name}", title)}<p>${"More detail about everyday use. ".repeat(10)}</p>`,
    images: [{ id: "i", url: "https://cdn.shopify.com/a.jpg", alt: "Basket", filename: "a.jpg" }], collections: [], vendor: "Van Life Emporium", productType: "Storage",
    variants: [{ sku: `S${n}`, barcode: "5012345678900", price: "20.00" }], ...over,
  };
  return { id: `p${n}`, title, kind: "product", payload: JSON.stringify(p), keyword: "", facts: JSON.stringify(facts) };
};
const opts = { storeName: "Van Life Emporium" };
const codes = (r: ReturnType<typeof auditCatalogue>, code: string) => r.issues.filter((i) => i.code === code);

describe("R19-04 Answer readiness from 7 shopper questions", () => {
  it("detects answers in the description, confirmed facts and product fields", () => {
    const bare = JSON.parse(product({ descriptionHtml: "<p>A basket.</p>" }).payload);
    expect(Object.values(answeredQuestions(bare, {})).filter(Boolean)).toHaveLength(0);
    const facts = { dimensions: { value: "30 x 20 cm", source: "Supplier", confirmed: true }, weight: { value: "1 kg", source: "Supplier", confirmed: false } };
    expect(answeredQuestions(bare, facts)).toMatchObject({ size: true, weight: false });
    expect(answeredQuestions({ ...bare, metafields: { "shopify.material": "Seagrass", "custom.weight": '{"value":0.4,"unit":"KILOGRAMS"}' } }, {})).toMatchObject({ material: true, weight: true });
    expect(answeredQuestions(bare, {}, { deliveryPolicy: true }).delivery).toBe(true);
  });
  it("raises one finding per missing answer with a product count, and one readiness number", () => {
    const rows = [...Array.from({ length: 12 }, () => product()), ...Array.from({ length: 8 }, () => product({ descriptionHtml: "<p>A hand-woven seagrass basket for the van, made from seagrass.</p>" }))];
    const r = auditCatalogue(rows, opts);
    const size = codes(r, "answer-missing-size");
    expect(size).toHaveLength(1);
    expect(size[0]).toMatchObject({ title: "No size given", count: 8, severity: "notice" });
    expect(size[0].resourceIds).toHaveLength(8);
    // The 8 thin products answer only "material".
    // Release 20 (RP-104): 6 product questions each, plus delivery once for the store (12 of 20 mention it: shared).
    expect(r.answerReadiness).toBe(Math.round((100 * (12 * 6 + 8 * 1 + 1)) / (20 * 6 + 1)));
    expect(r.aeoScore).toBe(r.answerReadiness);
  });
});

describe("R19-05 template FAQs don't count", () => {
  it("flags products whose only questions are the shared template", () => {
    const rows = Array.from({ length: 30 }, () => product());
    rows.push(product({ faqs: [{ question: "Will it fit under the passenger seat?", answer: "Yes, it is 20 cm tall." }] }));
    rows.push(product({ descriptionHtml: TEMPLATE.replace("{name}", "Rug") + "<h3>Can the rug go in the washing machine?</h3><p>Yes.</p>" }));
    const flagged = codes(auditCatalogue(rows, opts), "missing-product-faq");
    expect(flagged).toHaveLength(30);
    expect(flagged[0].detail).toContain("Shared template questions do not count");
  });
});

describe("R19-06 barcode validity", () => {
  it("validates GTIN-8, 12, 13 and 14 check digits", () => {
    for (const ok of ["96385074", "036000291452", "5012345678900", "9780141036144", "15012345678907"]) expect(gtinCheckDigitValid(ok)).toBe(true);
    for (const bad of ["5012345678901", "036000291453", "12345", "50123456789OO"]) expect(gtinCheckDigitValid(bad)).toBe(false);
  });
  it("flags invalid codes and books without an ISBN, passes valid codes and never proposes a code", () => {
    const bad = ["5060123456781", "5055987612344", "5031234567891", "5019876543212", "5012345678909"].filter((c) => !gtinCheckDigitValid(c));
    expect(bad).toHaveLength(5);
    const rows = [
      ...bad.map((b) => product({ variants: [{ sku: "x", barcode: b, price: "1" }] })),
      ...Array.from({ length: 17 }, () => product({ productType: "Books & Guides", vendor: "Vertebrate Publishing", variants: [{ sku: "b", barcode: "", price: "12" }] })),
      product({ productType: "Books & Guides", vendor: "Vertebrate Publishing", variants: [{ sku: "b", barcode: "9780141036144", price: "12" }] }),
      product(),
    ];
    const r = auditCatalogue(rows, opts);
    expect(codes(r, "invalid-gtin")).toHaveLength(5);
    expect(codes(r, "book-without-isbn")).toHaveLength(17);
    const flaggedIds = new Set(r.issues.filter((i) => ["invalid-gtin", "book-without-isbn"].includes(i.code)).map((i) => i.resourceId));
    expect(flaggedIds.has(rows[rows.length - 1].id)).toBe(false);
    expect(flaggedIds.has(rows[rows.length - 2].id)).toBe(false);
    // Only the product's own code may appear in the text; no valid replacement is ever suggested.
    for (const i of r.issues) for (const m of i.detail.match(/\d{8,14}/g) || []) expect(bad.includes(m) || !gtinCheckDigitValid(m)).toBe(true);
  });
});

describe("R19-07 vendor checks", () => {
  it("flags placeholder vendors, near-duplicates, the store name on books and mismatched titles; own-label passes", () => {
    const rows = [
      product({ vendor: "N/A" }),
      product({ productType: "Books & Guides", vendor: "Van Life Emporium", variants: [{ sku: "b", barcode: "9780141036144", price: "1" }] }),
      product({ vendor: "Outwell" }), product({ vendor: "Outwell" }), product({ vendor: "OUTWELL Ltd" }),
      product({ title: "Outwell Folding Table", vendor: "Van Life Emporium" }),
      product({ vendor: "Van Life Emporium" }),
    ];
    const r = auditCatalogue(rows, opts);
    const by = (id: string) => r.issues.filter((i) => i.resourceId === id && i.code.startsWith("vendor-")).map((i) => i.code);
    expect(by(rows[0].id)).toEqual(["vendor-placeholder"]);
    expect(by(rows[1].id)).toEqual(["vendor-store-on-book"]);
    expect(by(rows[4].id)).toEqual(["vendor-near-duplicate"]);
    expect(by(rows[2].id)).toEqual([]);
    expect(by(rows[5].id)).toEqual(["vendor-mismatch"]);
    expect(by(rows[6].id)).toEqual([]);
  });
});

describe("R19-08 honest scores", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  it("confirming no barcode on 6 products moves the Store Score by less than 1 point", () => {
    const rows = [...Array.from({ length: 14 }, () => product()), ...Array.from({ length: 6 }, () => product({ variants: [{ sku: "o", barcode: "", price: "1" }] }))];
    const before = auditCatalogue(rows, opts);
    expect(codes(before, "missing-gtin")).toHaveLength(6);
    const confirmed = rows.map((r, i) => (i >= 14 ? { ...r, facts: JSON.stringify({ barcode: noBarcodeFact() }) } : r));
    const after = auditCatalogue(confirmed, opts);
    expect(codes(after, "missing-gtin")).toHaveLength(0);
    const s = (technical: number, answerReadiness: number) => storeScore({ metrics: [], technical, answerReadiness, healthScores: {}, observations: [], now }).score!;
    expect(Math.abs(s(after.score, after.answerReadiness) - s(before.score, before.answerReadiness))).toBeLessThan(1);
  });
  it("counts each check once, excludes AI samples, and shows each score name once with its method", () => {
    const sc = storeScore({ metrics: [], technical: 80, answerReadiness: 60, healthScores: { product: { score: 10 } }, observations: [{ createdAt: new Date(now - 86400000), cited: false }], now });
    expect(sc.parts.map((p) => p.key)).toEqual(["search", "technical", "answers", "revenue", "ai"]);
    expect(sc.parts.find((p) => p.key === "ai")!.weight).toBe(0);
    // Per-type catalogue averages are no longer a separate part.
    expect(sc.coverage).toBe(50);
    // With no Google clicks yet the evidence cap of 55 applies.
    expect(sc.score).toBe(Math.min(55, Math.round((30 * 80 + 20 * 60) / 50)));
    const d = { measuredAt: new Date(now).toISOString(), audits: [{ score: 80, coverage: JSON.stringify({ answerReadiness: 60 }), issues: "[]", createdAt: new Date(now).toISOString() }], metrics: [], discoveries: { schemas: [] }, healthScores: { product: { score: 90, checks: 10, failed: 1 } }, observations: [], jobs: [], changes: [], resources: [], appliedCount: 0 };
    const html = renderToStaticMarkup(React.createElement(ScoreBoard, { d: d as never }));
    const labels = [...html.matchAll(/<div class="metric[^"]*"><div title="[^"]*">([^<]+)</g)].map((m) => m[1]);
    for (const name of ["Google search visibility", "Technical health", "Answer readiness", "AI answer samples"]) expect(labels.filter((l) => l === name)).toHaveLength(1);
    expect(html.match(/<h2 title="[^"]*">Store Score/g)).toHaveLength(1);
    expect(html).not.toContain("Discovery readiness");
    expect(html).toMatch(/title="Answer readiness: share of 7 shopper questions/);
  });
});

describe("R19-24 category metafields as read-only facts", () => {
  it("keeps plain values and skips references and SEO fields", async () => {
    const { plainMetafields } = await import("../app/core/shopify-api.server");
    expect(plainMetafields([
      { namespace: "shopify", key: "material", value: '["gid://shopify/Metaobject/1"]', type: "list.metaobject_reference" },
      { namespace: "custom", key: "width", value: '{"value":45,"unit":"CENTIMETERS"}', type: "dimension" },
      { namespace: "global", key: "title_tag", value: "x", type: "single_line_text_field" },
    ])).toEqual({ "custom.width": '{"value":45,"unit":"CENTIMETERS"}' });
    expect(plainMetafields([])).toBeUndefined();
  });
});

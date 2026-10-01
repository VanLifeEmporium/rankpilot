import { describe, it, expect } from "vitest";
import { auditCatalogue, combinedScore, SCORED_CHECKS, type AuditResource } from "../app/core/catalogue";
import { answeredQuestions } from "../app/core/catalogue-checks";
import { schemaVerdict } from "../app/core/schema-verdict";
import type { Payload } from "../app/core/types";

let n = 0;
const body = (i: number) => `<p>Basket ${i}. ${"A hand-woven seagrass basket that fits in a van locker, measures 30 x 20 cm and weighs 400 g. ".repeat(8)}</p>`;
const product = (over: Partial<Payload> = {}): AuditResource => {
  n++;
  const title = over.title || `Seagrass Basket ${n}`;
  const p: Payload = {
    title, handle: `p-${n}`, seo: { title: `${title} | Shop`, description: `Seagrass basket ${n} for storing shoes and cables in the van. Hand woven, light and easy to wipe clean after a trip.` },
    descriptionHtml: body(n), images: [{ id: "i", url: "https://cdn.shopify.com/a.jpg", alt: "Basket", filename: "a.jpg" }], collections: [], vendor: "Acme", productType: "Storage",
    variants: [{ sku: `S${n}`, barcode: "5012345678900", price: "20.00" }], ...over,
  } as Payload;
  return { id: `p${n}`, title, kind: "product", payload: JSON.stringify(p), keyword: "", facts: "{}" };
};
const codes = (r: ReturnType<typeof auditCatalogue>, code: string) => r.issues.filter((i) => i.code === code);

describe("Release 21: Shopify fallbacks", () => {
  it("does not fail a page for an empty SEO title or description when Shopify has something to show", () => {
    const r = auditCatalogue([product({ seo: { title: "", description: "" } })]);
    expect(codes(r, "missing-meta-title")[0]).toMatchObject({ severity: "notice" });
    expect(codes(r, "missing-meta-description")[0]).toMatchObject({ severity: "notice" });
    expect(codes(r, "missing-meta-description")[0].detail).toContain("A hand-woven seagrass basket");
    expect(r.score).toBe(100);
  });
  it("flags duplicates on the title Google receives, including fallbacks, ignoring case", () => {
    const same = { seo: { title: "", description: "" }, descriptionHtml: body(0) };
    const r = auditCatalogue([product({ title: "Teak Spoon", ...same }), product({ title: "teak spoon", ...same })]);
    expect(codes(r, "duplicate-title")).toHaveLength(1);
    expect(codes(r, "duplicate-meta-description")).toHaveLength(1);
  });
  it("does not flag a live page as a duplicate of a draft", () => {
    const r = auditCatalogue([product({ title: "Mug", published: false }), product({ title: "Mug" })]);
    expect(codes(r, "duplicate-title")).toHaveLength(0);
  });
  it("warns on a summary too short for Google to keep", () => {
    const r = auditCatalogue([product({ seo: { title: "Basket | Shop", description: "A basket." } })]);
    expect(codes(r, "short-meta-description")[0]).toMatchObject({ severity: "warning" });
  });
});

describe("Release 21: score is the share of checks passed", () => {
  it("one bad page cannot use up the checks of clean pages", () => {
    const bad = product({ title: "X".repeat(90), seo: { title: "X".repeat(90), description: "Y".repeat(200) }, descriptionHtml: "<p>Short.</p>", images: [{ id: "a", url: "u", alt: "", filename: "a.jpg" }], variants: [{ sku: "B", barcode: "123", price: "1" }] });
    const r = auditCatalogue([bad, product(), product(), product()]);
    expect(r.checks).toBe(4 * SCORED_CHECKS.length);
    expect(r.failed).toBeLessThanOrEqual(SCORED_CHECKS.length);
    expect(r.score).toBeGreaterThanOrEqual(75);
  });
  it("counts missing alt text by image", () => {
    const r = auditCatalogue([product({ images: [{ id: "a", url: "u", alt: "", filename: "a.jpg" }, { id: "b", url: "u", alt: "Basket", filename: "b.jpg" }] })]);
    expect(codes(r, "missing-alt")[0].detail).toContain("1 of 2");
  });
  it("uses a longer thin-content limit for guides than for products", () => {
    const article: AuditResource = { id: "a1", title: "Guide", kind: "article", keyword: "", facts: "{}", payload: JSON.stringify({ title: "Guide", handle: "g", seo: { title: "Guide | Shop", description: "x".repeat(120) }, descriptionHtml: `<p>${"word ".repeat(150)}</p>`, images: [], collections: [] }) };
    expect(codes(auditCatalogue([article]), "thin-content")[0].detail).toContain("300");
    expect(codes(auditCatalogue([product()]), "thin-content")).toHaveLength(0);
  });
  it("treats nothing measured as unmeasured, and caps failures at the checks", () => {
    expect(combinedScore(0, 0)).toBeNull();
    expect(combinedScore(10, 20)).toBe(0);
    expect(combinedScore(10, 1)).toBe(90);
  });
});

describe("Release 21: answer readiness wording", () => {
  const p = (html: string) => ({ title: "Chair", handle: "c", seo: { title: "", description: "" }, descriptionHtml: html, images: [], collections: [] }) as unknown as Payload;
  it("does not count unrelated phrases as answers", () => {
    const a = answeredQuestions(p("<p>We care about the planet. It packs down small, including on trips.</p>"), {});
    expect(a).toMatchObject({ care: false, material: false, included: false });
  });
  it("still counts real answers", () => {
    const a = answeredQuestions(p("<p>Made from goose down. Includes a carry bag. Machine washable.</p>"), {});
    expect(a).toMatchObject({ care: true, material: true, included: true });
  });
});

describe("Release 21: schema verdict", () => {
  it("accepts a collection with breadcrumbs only", () => {
    expect(schemaVerdict({ url: "https://s.com/collections/mugs", types: ["BreadcrumbList"], valid: true }).pass).toBe(true);
  });
  it("needs Organization or WebSite on the home page", () => {
    expect(schemaVerdict({ url: "https://s.com/", types: ["WebPage"], valid: true }).pass).toBe(false);
    expect(schemaVerdict({ url: "https://s.com/", types: ["WebSite"], valid: true }).pass).toBe(true);
  });
  it("accepts BlogPosting on articles", () => {
    expect(schemaVerdict({ url: "https://s.com/blogs/news/post", types: ["BlogPosting"], valid: true }).pass).toBe(true);
  });
});

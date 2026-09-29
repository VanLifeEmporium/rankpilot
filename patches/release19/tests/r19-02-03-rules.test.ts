import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { brandRuleHits, ruleErrors, brandGate, unverifiedClaims } from "../app/core/brand-rules";
import { descriptionProblems, bulkDescription, bulkSeo, readiness } from "../app/core/agent.server";
import { sourceDraft } from "../app/core/source-drafts";
import { approve } from "../app/core/service.server";
import type { Payload } from "../app/core/types";

const STORE = "demo-r19-02";
const body = (extra = "") => "<p>" + "A warm, packable camping blanket for cold evenings in the van. ".repeat(10) + extra + "</p>";
const payload = (over: Partial<Payload> = {}) => JSON.stringify({ title: "Insulated Camping Blanket", handle: "blanket", descriptionHtml: body(), seo: { title: "Insulated Camping Blanket | Van Life Emporium", description: "A warm, packable camping blanket for cold evenings in the van. Machine washable fleece that folds into its own bag for the road and the campsite." }, images: [{ id: "i", url: "https://cdn.shopify.com/a.jpg", alt: "Blanket", filename: "a.jpg" }], collections: [], published: true, ...over });
const reset = async () => {
  for (const m of ["change", "resource", "audit", "event", "job"] as const)
    await (prisma[m] as unknown as { deleteMany(a: { where: { storeId: string } }): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
let id = "", supplierId = "";
beforeAll(async () => {
  await reset();
  await prisma.store.create({ data: { id: STORE, demo: true } });
  id = (await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/1", kind: "product", title: "Insulated Camping Blanket", handle: "blanket", payload: payload(), facts: JSON.stringify({ weight: { value: "1.2kg", source: "Supplier sheet", confirmed: true } }) } })).id;
  supplierId = (await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/2", kind: "product", title: "Mat", handle: "mat", payload: payload({ title: "Mat", descriptionHtml: "<h3>【ULTRA-LIGHTWEIGHT】</h3>" + body() }) } })).id;
});
afterAll(reset);

describe("R19-03 one enforced brand rule list", () => {
  it("fails the brief's examples with the rule names listed", () => {
    const rules = (t: string) => [...new Set(ruleErrors(t).map((h) => h.rule))].sort();
    expect(rules("HOT SALE Camping Blanket!!! Best ever")).toEqual(["Capitals", "Exclamation mark", "Sales language"]);
    expect(rules("Pimp your wagon… buy now while stocks last!!!")).toEqual(["Exclamation mark", "Sales language"]);
    expect(rules("<h3>【ULTRA-LIGHTWEIGHT】</h3>")).toEqual(["Capitals", "Supplier formatting"]);
    expect(rules("Product Description: The video showcases the chair")).toEqual(["Supplier formatting"]);
    expect(rules("A 12 inch pan that weighs 2 lbs")).toEqual(["Imperial units"]);
  });
  it("allows common acronyms and metric units, and warns on US spellings", () => {
    expect(ruleErrors("USB-C LED lamp, BPA free, XL size, UK plug, 30 cm wide, fits 2 in a van")).toEqual([]);
    const hits = brandRuleHits("Gray aluminum organizer");
    expect(hits.every((h) => h.severity === "warning" && h.rule === "US spelling")).toBe(true);
    expect(hits).toHaveLength(3);
  });
  it("is enforced for SEO, descriptions, source drafts and the go-live check", async () => {
    // SEO, as an agent dry run.
    const seo = await bulkSeo(STORE, { items: [{ resourceId: id, title: "HOT SALE Camping Blanket!!! Best ever", description: "x".repeat(150) }] });
    expect(seo.results[0]).toMatchObject({ ok: false, status: "invalid" });
    expect(seo.results[0].message).toMatch(/Exclamation mark.*Sales language.*|Sales language.*Exclamation mark/);
    // Description.
    expect(descriptionProblems(body("Buy now while stocks last."), { before: body() }).errors.join(" ")).toContain("Sales language");
    // Source draft.
    const draft = sourceDraft(JSON.parse(payload({ title: "HOT SALE Camping Blanket", seo: { title: "", description: "" } })), "product", { titleBrandMode: "omit" } as never);
    expect(draft.blockers.join(" ")).toContain("Sales language");
    // Go-live check.
    const [ready] = await readiness(STORE, { ids: [supplierId] });
    expect(ready.ready).toBe(false);
    expect(ready.reasons).toContain("Supplier formatting");
  });
  it("blocks approval for every writer, including the merchant and AI drafts", async () => {
    const c = await prisma.change.create({ data: { storeId: STORE, resourceId: id, feature: "seo", before: JSON.stringify({ title: "Old", description: "Old" }), after: JSON.stringify({ title: "HOT SALE Camping Blanket!!! Best ever", description: "Old" }), reasons: JSON.stringify(["merchant-reviewed-v1: edited by the merchant"]) } });
    await expect(approve(STORE, c.id, "merchant")).rejects.toThrow(/content rules.*Exclamation mark/);
    expect((await prisma.change.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("pending");
  });
});

describe("R19-02 agents can't publish invented claims or bypass review", () => {
  it("rejects an invented rating in a dry run", async () => {
    const out = await bulkDescription(STORE, { items: [{ resourceId: id, html: body("Rated 5 stars by 2,000 customers.") }] });
    expect(out.results[0]).toMatchObject({ ok: false, status: "invalid" });
    expect(out.results[0].message).toContain("Unverified rating or review claim");
  });
  it("rejects certifications, waterproof ratings, GTINs, prices, marketplace links and big cuts unless confirmed", () => {
    const errs = (extra: string, facts = {}) => descriptionProblems(body(extra), { before: body(), facts }).errors;
    expect(errs("CE certified.")).toContain("Unverified certification");
    expect(errs("Waterproof to IPX7.")).toContain("Unverified waterproof or IP rating");
    expect(errs("EAN 5012345678900.")).toContain("Unverified GTIN or EAN");
    expect(errs("Only £19.99.")).toContain("Price in copy");
    expect(errs('<a href="https://www.amazon.co.uk/dp/x">Amazon</a>')).toContain("Marketplace link");
    expect(descriptionProblems("<p>" + "Short text here. ".repeat(10) + "</p>", { before: body() }).errors.join(" ")).toMatch(/Word count cut by \d+%/);
    // A confirmed fact is allowed.
    expect(errs("Waterproof to IPX7.", { care: { value: "Waterproof to IPX7", source: "Manufacturer spec sheet", confirmed: true } })).not.toContain("Unverified waterproof or IP rating");
    expect(unverifiedClaims("Weighs 1.2kg", {})).toEqual([]);
  });
  it("creates a pending proposal by default and changes nothing in Shopify until approved", async () => {
    const html = body("It folds into its own bag.");
    const out = await bulkDescription(STORE, { items: [{ resourceId: id, html }], dryRun: false });
    expect(out.results[0]).toMatchObject({ ok: true, status: "pending" });
    const change = await prisma.change.findUniqueOrThrow({ where: { id: out.results[0].changeId! } });
    expect(change.status).toBe("pending");
    expect(await prisma.job.count({ where: { storeId: STORE, kind: "apply" } })).toBe(0);
    expect(JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id } })).payload).descriptionHtml).toBe(body());
    expect(brandGate("description", body(), html)).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
// The AI generator is replaced so the learned rule and title validation can be tested on its output.
const generated = vi.hoisted(() => ({ title: "" }));
const DESCRIPTION = vi.hoisted(() => "A calm A4 print of a campervan under the stars, printed on thick matt paper and posted flat in a card envelope so it arrives flat and ready for your frame.");
vi.mock("../app/core/generation.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("../app/core/generation.server")>();
  return { ...real, generateCopy: async (_s: string, p: { seo: { title: string; description: string } }) => ({ before: p.seo, after: { title: generated.title, description: DESCRIPTION }, blockers: [], reasons: ["source-reviewed-v1: test"] }) };
});
import prisma from "../app/db.server";
import { learnRules, restoreSuffix, titleProblems, suffixRemoved } from "../app/core/learned-rules";
import { learnedRules } from "../app/core/learned-rules.server";
import { propose, approve } from "../app/core/service.server";
import { wordCut, brandGate, uniqueWordCount } from "../app/core/brand-rules";
import { bulkProduct, bulkFaq, NO_CHANGE } from "../app/core/agent.server";
import type { Payload } from "../app/core/types";

const STORE = "demo-r20-s4";
const NAME = "Van Life Emporium";
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
let resourceId = "";
const seo = { title: "Sweet Dreams Print | Van Life Emporium", description: "A calm A4 print of a campervan under the stars, printed on thick matt paper and posted flat in a card envelope." };
beforeAll(async () => {
  await wipe();
  await prisma.store.create({ data: { id: STORE, demo: true, discoveries: JSON.stringify({ shop: { name: NAME } }), settings: JSON.stringify({ titleBrandMode: "omit" }) } });
  const p: Payload = { title: "Sweet Dreams Print", handle: "sweet-dreams-print", seo, descriptionHtml: "<p>A calm A4 print of a campervan under the stars.</p>", images: [], collections: [], vendor: "Senelux", productType: "Prints", variants: [{ id: "gid://shopify/ProductVariant/1", sku: "P1", barcode: "", price: "12" }] };
  resourceId = (await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/sd", kind: "product", title: p.title, handle: p.handle, payload: JSON.stringify(p) } })).id;
});
afterAll(wipe);

describe("RP-403 learning from rejected proposals", () => {
  it("learns the keep-the-store-name rule after repeated rejections, and can be reset", async () => {
    expect(suffixRemoved(seo, { title: "Sweet Dreams Print", description: "" }, [NAME])).toBe(true);
    await prisma.change.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ storeId: STORE, resourceId, feature: "seo", status: "rejected", before: JSON.stringify(seo), after: JSON.stringify({ title: `Campervan Print ${i}`, description: seo.description }), updatedAt: new Date(Date.now() - (10 - i) * 1000) })) });
    const { rules } = await learnedRules(STORE);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ key: "keepStoreSuffix", count: 10 });
    expect(rules[0].label).toContain("Van Life Emporium");
    expect(learnRules([], [NAME])).toEqual([]);
    const reset = learnRules((await prisma.change.findMany({ where: { storeId: STORE } })), [NAME], new Date(Date.now() + 1000).toISOString());
    expect(reset).toEqual([]);
  });
  it("keeps the store name suffix on the next generated title", async () => {
    generated.title = "Sweet Dreams Print Campervan Wall Art";
    const outcome: { message?: string } = {};
    const row = await propose(STORE, resourceId, "seo", outcome);
    if (!row) throw new Error("no row: " + outcome.message);
    expect(JSON.parse(row!.after).title).toBe("Sweet Dreams Print Campervan Wall Art | Van Life Emporium");
    expect(row!.reasons).toContain("Learned rule");
    await prisma.change.update({ where: { id: row!.id }, data: { status: "superseded" } });
    expect(restoreSuffix("A – Van Life Emporium", "B", [NAME])).toBe("B – Van Life Emporium");
  });
  it("blocks a malformed title: missing separator and a changed product name", async () => {
    expect(titleProblems("Sweet-Dreams Print Van Life Emporium", "Sweet Dreams Print", [NAME])).toEqual([
      "Missing separator before “Van Life Emporium” (use “ | Van Life Emporium”)",
      "The product name is changed from “Sweet Dreams Print”; keep it as written",
    ]);
    expect(titleProblems("Sweet Dreams Print | Van Life Emporium", "Sweet Dreams Print", [NAME])).toEqual([]);
    generated.title = "Sweet-Dreams Print Van Life Emporium";
    await expect(propose(STORE, resourceId, "seo")).rejects.toThrow(/Missing separator.*product name is changed/);
    // The same rule applies at approval, whoever wrote the proposal.
    expect(brandGate("seo", seo, { title: "Sweet-Dreams Print Van Life Emporium", description: seo.description }, {}, { productTitle: "Sweet Dreams Print", storeNames: [NAME] }).length).toBe(2);
    const agentRow = await prisma.change.create({ data: { storeId: STORE, resourceId, feature: "seo", before: JSON.stringify(seo), after: JSON.stringify({ title: "Sweet-Dreams Print Van Life Emporium", description: seo.description }), reasons: JSON.stringify(["agent-reviewed-v1: test"]) } });
    await expect(approve(STORE, agentRow.id, "merchant")).rejects.toThrow(/Missing separator/);
  });
});

describe("RP-504 word-count guard ignores removed repeats", () => {
  it("accepts a rewrite that removes only the repeated warranty bullet and product copy", () => {
    const copy = "<p>This insulated window cover keeps the cab warm on cold nights and blocks light for sleeping in late. It fits with suction cups and folds into its own bag for storage under a seat.</p>";
    const bullets = "<ul><li>Two year warranty against manufacturing faults</li><li>Machine washable at 30 degrees</li><li>Two year warranty against manufacturing faults</li></ul>";
    const before = copy + bullets + copy;
    const after = copy + "<ul><li>Two year warranty against manufacturing faults</li><li>Machine washable at 30 degrees</li></ul>";
    expect(uniqueWordCount(before)).toBe(uniqueWordCount(after));
    expect(wordCut(before, after)).toBeNull();
    expect(brandGate("description", before, after)).toEqual([]);
    // Real loss of detail is still caught.
    expect(wordCut(before, "<p>A window cover.</p>")).toMatch(/Word count cut/);
  });
});

describe("RP-605 writes say why nothing happened", () => {
  it("says the vendor is already set", async () => {
    const r = await bulkProduct(STORE, { items: [{ resourceId, vendor: "Senelux" }], dryRun: false });
    expect(r.results).toEqual([expect.objectContaining({ field: "vendor", ok: true, status: "unchanged", message: "No change: value already set" })]);
    expect(NO_CHANGE).toBe("No change: value already set");
  });
  it("says identical FAQs are already saved", async () => {
    const faqs = [{ question: "Is it framed?", answer: "No, it is posted flat without a frame." }];
    const p = JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: resourceId } })).payload);
    await prisma.resource.update({ where: { id: resourceId }, data: { payload: JSON.stringify({ ...p, faqs }) } });
    const r = await bulkFaq(STORE, { items: [{ resourceId, faqs }], dryRun: false });
    expect(r.results[0]).toMatchObject({ status: "unchanged", message: NO_CHANGE });
  });
});

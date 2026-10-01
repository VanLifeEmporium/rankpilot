import React from "react";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn(), load: vi.fn(), Form: "form" }),
}));
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "cheerio";
import { renderToStaticMarkup } from "react-dom/server";
import { PrismaClient } from "@prisma/client";
import prisma, { sqliteUrl, ensureDatabaseSettings } from "../app/db.server";
import { withDbRetry, isBusyError } from "../app/core/db-retry";
import { factFaq, factFaqs, faqAnswerProblems, correctedFaqs } from "../app/core/faq-facts";
import { faqSuggestions } from "../app/core/catalogue-checks";
import { specFacts } from "../app/core/spec-extract";
import { auditCatalogue, optimise } from "../app/core/catalogue";
import { faqOnPage, faqBlockLink } from "../app/core/faq-live";
import { checkFaqChange, recheckFaqChanges, reviewSavedFaqs, refreshFaqStatus, faqNotLiveIssue } from "../app/core/faq-live.server";
import { changeStatus } from "../app/core/workflow-ui";
import { bulkApprove, changes } from "../app/core/agent.server";
import { FaqBanner } from "../app/components/FaqBanner";
import { defaults, type Payload } from "../app/core/types";

const STORE = "demo-r22-s1";
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true, domain: "https://vanlifeemporium.com" } }); });
afterAll(wipe);
let n = 0;
const product = (over: Partial<Payload> = {}) => {
  n++;
  const p: Payload = { title: `Table ${n}`, handle: `table-${n}`, seo: { title: "", description: "" }, descriptionHtml: "<p>A table.</p>", images: [], collections: [], productType: "Furniture", variants: [], ...over };
  return prisma.resource.create({ data: { storeId: STORE, remoteId: `gid://shopify/Product/r22s1-${n}`, kind: "product", title: p.title, handle: p.handle, payload: JSON.stringify(p) } });
};

describe("R22-200 SQLite WAL and busy timeout", () => {
  const dir = mkdtempSync(join(tmpdir(), "r22-wal-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("uses one connection per process, a 10 s busy timeout and a 30 s queue", () => {
    expect(sqliteUrl("file:./x.sqlite")).toBe("file:./x.sqlite?connection_limit=1&socket_timeout=10&pool_timeout=30");
    expect(sqliteUrl("file:./x.sqlite?connection_limit=3")).toBe("file:./x.sqlite?connection_limit=3&socket_timeout=10&pool_timeout=30");
    expect(sqliteUrl("file:./x.sqlite?socket_timeout=30")).toBe("file:./x.sqlite?socket_timeout=30&connection_limit=1&pool_timeout=30");
    expect(sqliteUrl("postgres://x")).toBe("postgres://x");
  });
  it("switches to WAL once, after taking a backup, and reports the settings", async () => {
    const file = join(dir, "app.sqlite");
    const client = new PrismaClient({ datasources: { db: { url: sqliteUrl(`file:${file}`) } } });
    await client.$executeRawUnsafe("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const first = await ensureDatabaseSettings(client, file);
    expect(first).toMatchObject({ journalMode: "wal" });
    expect(first.busyTimeout).toBeGreaterThanOrEqual(5000);
    expect(first.backup && existsSync(first.backup)).toBe(true);
    const again = await ensureDatabaseSettings(client, file);
    expect(again.journalMode).toBe("wal");
    expect(again.backup).toBeUndefined();
    await client.$disconnect();
  });
  it("in one process, an open transaction and concurrent saves all succeed (they failed with a pool)", async () => {
    const file = join(dir, "one.sqlite");
    const run = async (url: string) => {
      const client = new PrismaClient({ datasources: { db: { url } } });
      await client.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)");
      await ensureDatabaseSettings(client, null);
      const started = Date.now();
      const job = client.$transaction(async (tx) => { await tx.$executeRawUnsafe("INSERT INTO t (v) VALUES ('approval')"); await new Promise((r) => setTimeout(r, 800)); }, { timeout: 10000 });
      await new Promise((r) => setTimeout(r, 50));
      const saves = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => client.$executeRawUnsafe(`INSERT INTO t (v) VALUES ('faq ${i}')`)));
      await job;
      await client.$disconnect();
      return { failed: saves.filter((x) => x.status === "rejected").length, ms: Date.now() - started };
    };
    const fixed = await run(sqliteUrl(`file:${file}`));
    expect(fixed.failed).toBe(0);
    expect(fixed.ms).toBeLessThan(5000);
  }, 30000);
  it("lets one process write while another holds a write, instead of failing as busy", async () => {
    const file = join(dir, "two.sqlite");
    const url = sqliteUrl(`file:${file}`);
    const worker = new PrismaClient({ datasources: { db: { url } } });
    const web = new PrismaClient({ datasources: { db: { url } } });
    await worker.$executeRawUnsafe("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    await ensureDatabaseSettings(worker, file);
    const slowJob = worker.$transaction(async (tx) => {
      for (let i = 0; i < 5; i++) await tx.$executeRawUnsafe(`INSERT INTO t (v) VALUES ('alt ${i}')`);
      await new Promise((r) => setTimeout(r, 1200));
    }, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 100));
    // Reads are not blocked by the worker's open write in WAL mode.
    expect(await web.$queryRawUnsafe("SELECT COUNT(*) AS n FROM t")).toBeTruthy();
    const saves = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => web.$executeRawUnsafe(`INSERT INTO t (v) VALUES ('faq ${i}')`)));
    await slowJob;
    expect(saves.filter((s) => s.status === "rejected")).toEqual([]);
    await worker.$disconnect(); await web.$disconnect();
  }, 30000);
});

describe("R22-201 retries when the database is still busy", () => {
  it("retries up to 3 times with backoff and only then fails", async () => {
    let calls = 0;
    const busy = () => Object.assign(new Error("SQLITE_BUSY: database is locked"), {});
    expect(await withDbRetry(async () => { calls++; if (calls < 3) throw busy(); return "saved"; }, { baseMs: 1 })).toBe("saved");
    expect(calls).toBe(3);
    calls = 0;
    await expect(withDbRetry(async () => { calls++; throw busy(); }, { baseMs: 1 })).rejects.toThrow(/locked/);
    expect(calls).toBe(4);
    calls = 0;
    await expect(withDbRetry(async () => { calls++; throw new Error("Shopify: invalid value"); }, { baseMs: 1 })).rejects.toThrow(/Shopify/);
    expect(calls).toBe(1);
    expect(isBusyError(new Error("Transaction API error: Unable to start a transaction in the given time."))).toBe(true);
  });
  it("wraps only the database step after a Shopify write", () => {
    const src = readFileSync("app/core/service.server.ts", "utf8");
    const apply = src.slice(src.indexOf("export async function applyChange"), src.indexOf("await refreshCatalogueAudit(storeId);\n  if(!rollback)await scheduleIndexRecheck"));
    expect(apply).toMatch(/await updateResource\(client[^\n]*\n\s*\/\/ Release 22 \(R22-201\)[^\n]*\n\s*if\(!rollback\)await withDbRetry/);
    expect(apply).not.toMatch(/withDbRetry\(\(\)=>updateResource/);
  });
});

describe("R22-203 partial batch failure, safe to resend", () => {
  it("reports each failure's reason and a resend applies only the failed items", async () => {
    const rows = await Promise.all(Array.from({ length: 5 }, () => product()));
    const made = [];
    for (const r of rows) made.push(await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "title", before: JSON.stringify(r.title), after: JSON.stringify(`${r.title} Folding Camping Table`) } }));
    // Two pages were edited in Shopify after the proposal was prepared.
    for (const r of rows.slice(3)) await prisma.resource.update({ where: { id: r.id }, data: { payload: JSON.stringify({ ...JSON.parse(r.payload), title: "Edited in Shopify" }) } });
    const first = await bulkApprove(STORE, { ids: made.map((c) => c.id) });
    expect(first.results.filter((r) => r.status === "applied")).toHaveLength(3);
    const failed = first.results.filter((r) => !r.ok);
    expect(failed).toHaveLength(2);
    for (const f of failed) expect(f.message).toMatch(/changed in Shopify/);
    // The cause is fixed (e.g. a transient error) and the same 5 ids are sent again.
    for (const r of rows.slice(3)) await prisma.resource.update({ where: { id: r.id }, data: { payload: r.payload } });
    await prisma.change.updateMany({ where: { id: { in: made.slice(3).map((c) => c.id) } }, data: { status: "apply_failed" } });
    const before = await prisma.job.count({ where: { storeId: STORE, kind: "apply" } });
    const again = await bulkApprove(STORE, { ids: made.map((c) => c.id) });
    expect(again.results.slice(0, 3).every((r) => r.ok && r.message === "No change: already applied")).toBe(true);
    expect(again.results.slice(3).every((r) => r.ok && r.status === "applied")).toBe(true);
    expect((await prisma.job.count({ where: { storeId: STORE, kind: "apply" } })) - before).toBe(2);
  }, 120000);
});

describe("R22-502 FAQ answers use the right fact", () => {
  it("does not answer 'How big is it?' with a load, and asks about the load instead", () => {
    const facts = specFacts("<p>Max load: 204 kg</p><p>Weight: 14 kg</p>");
    const faqs = factFaqs(facts);
    expect(faqs.find((f) => f.question === "How big is it?")).toBeUndefined();
    expect(faqs).toEqual(expect.arrayContaining([expect.objectContaining({ question: "How much weight does it hold?", answer: "204 kg" }), expect.objectContaining({ question: "How much does it weigh?", answer: "14 kg" })]));
    const p = { title: "Picnic Table", handle: "t", seo: { title: "", description: "" }, descriptionHtml: "<p>Max load: 204 kg</p>", images: [], collections: [], productType: "Furniture" } as Payload;
    expect(faqSuggestions(p, {}, specFacts(p.descriptionHtml)).suggestions.map((s) => s.question)).not.toContain("How big is it?");
    const generated = optimise(p, "product", "faq", { capacity: { value: "204 kg", source: "Product description", confirmed: true } }, "", defaults).after as { question: string; answer: string }[];
    expect(generated).toEqual([{ question: "How much weight does it hold?", answer: "204 kg" }]);
  });
  it("needs a length or volume for a size answer", () => {
    expect(factFaq("dimensions", "Large")).toBeNull();
    expect(factFaq("dimensions", "120 x 60 x 70 cm")?.question).toBe("How big is it?");
    expect(factFaq("capacity", "35 litres")?.question).toBe("How much does it hold?");
  });
  it("does not use storage advice to answer cleaning", () => {
    expect(factFaq("care", "Store in a dry place")).toBeNull();
    expect(factFaq("care", "Wipe clean with a damp cloth")?.question).toBe("How do I clean it?");
  });
  it("says which part a component material belongs to", () => {
    const facts = specFacts("<p>Cover: Fleece</p>");
    expect(facts.materials.value).toBe("Cover: Fleece");
    expect(factFaq("materials", facts.materials.value)?.answer).toBe("The cover is Fleece.");
  });
});

describe("R22-106 review saved FAQs before go-live", () => {
  it("lists failing answers and proposes a corrected list", async () => {
    expect(faqAnswerProblems("How big is it?", "204 kg")).toEqual(["A size question is answered with a weight or load"]);
    const fixed = correctedFaqs([{ question: "How big is it?", answer: "204 kg" }, { question: "Does it fold?", answer: "Yes, flat." }], {}, "Max load 204 kg. Folds flat.");
    expect(fixed.faqs).toEqual([{ question: "How much weight does it hold?", answer: "204 kg" }, { question: "Does it fold?", answer: "Yes, flat." }]);
    const bad = await product({ descriptionHtml: "<p>Max load: 204 kg</p><p>Weight: 14 kg</p>", faqs: [{ question: "How big is it?", answer: "204 kg" }, { question: "How much does it weigh?", answer: "14 kg" }] });
    await product({ faqs: [{ question: "How big is it?", answer: "120 x 60 cm" }] });
    const audit = auditCatalogue([{ ...bad, keyword: "", facts: "{}" }]);
    expect(audit.issues.find((i) => i.code === "faq-answer-wrong")?.detail).toContain("“How big is it?” 204 kg");
    const results = await reviewSavedFaqs(STORE, { propose: true });
    expect(results).toHaveLength(1);
    const change = await prisma.change.findUniqueOrThrow({ where: { id: results[0].changeId! } });
    expect(change.status).toBe("pending");
    expect(JSON.parse(change.after)).toEqual([{ question: "How much weight does it hold?", answer: "204 kg" }, { question: "How much does it weigh?", answer: "14 kg" }]);
    const status = await refreshFaqStatus(STORE);
    expect(status).toMatchObject({ products: 2, needReview: 1 });
  });
});

const fixture = readFileSync("tests/fixtures/r22-faq-block.html", "utf8");
const fixtureFaqs = [{ question: "How big is it?", answer: "30 x 20 cm" }, { question: 'Is it "waterproof"?', answer: "No – it's <b>splash</b> resistant.\nKeep dry." }, { question: "What comes in the box?", answer: "One basket </script><b>x</b>" }];
describe("R22-101, R22-102 RankPilot FAQ block", () => {
  const block = readFileSync("extensions/rankpilot-schema/blocks/faq.liquid", "utf8");
  const schema = JSON.parse(block.slice(block.indexOf("{% schema %}") + 12, block.indexOf("{% endschema %}")));
  it("is a product app block with heading and open-first settings, and no namespace setting", () => {
    expect(schema).toMatchObject({ name: "RankPilot FAQ", target: "section", enabled_on: { templates: ["product"] } });
    expect(schema.settings.map((s: { id?: string }) => s.id).filter(Boolean)).toEqual(["heading", "open_first", "text_colour", "background_colour"]);
    expect(block).toContain("product.metafields['$app'].faqs.value");
    expect(block).not.toMatch(/metafield_namespace/);
    // Nothing (not even a heading) is rendered without FAQs.
    expect(block.indexOf("{%- if product and rp_count > 0 -%}")).toBeLessThan(block.indexOf("<section"));
  });
  it("outputs each question as a row and exactly one FAQPage whose answers match the visible text", () => {
    const check = faqOnPage(fixture, fixtureFaqs);
    expect(check).toMatchObject({ block: true, live: true, missing: [], faqPages: 1, sources: ["RankPilot FAQ block"] });
    const $ = load(fixture);
    expect($("details").length).toBe(3);
    const ld = JSON.parse($("script[data-rankpilot-faq-schema]").text());
    expect(ld.mainEntity).toHaveLength(3);
    $("details").each((i, el) => {
      expect(ld.mainEntity[i].name).toBe($(el).find("summary").text());
      expect(ld.mainEntity[i].acceptedAnswer.text.replace(/\s+/g, " ")).toBe($(el).find(".rankpilot-faq__answer").text().replace(/\s+/g, " "));
    });
  });
  it("the embed no longer shows FAQs or adds FAQPage with JavaScript", () => {
    const embed = readFileSync("extensions/rankpilot-schema/blocks/rankpilot.liquid", "utf8").replace(/{%- comment -%}[\s\S]*?{%- endcomment -%}/, "");
    expect(embed).not.toMatch(/FAQPage|rp_faqs|rankpilot-faqs|metafield_namespace/);
  });
});

describe("R22-103 FAQs saved but not on the store", () => {
  it("shows the banner with the count and a theme editor button", () => {
    const html = renderToStaticMarkup(React.createElement(FaqBanner, { status: { products: 17, live: 0, notLive: 17, needReview: 3, block: false }, link: faqBlockLink("vanlifeemporium.myshopify.com", "key123") }));
    expect(html).toContain("17 products have FAQs that aren&#x27;t on your store");
    expect(html).toContain("3 products need FAQ answers reviewed before you add the block");
    expect(html).toContain("https://vanlifeemporium.myshopify.com/admin/themes/current/editor?template=product&amp;addAppBlockId=key123%2Ffaq&amp;target=mainSection");
    expect(renderToStaticMarkup(React.createElement(FaqBanner, { status: { products: 17, live: 17, notLive: 0, needReview: 0, block: true }, link: "x" }))).toBe("");
  });
  it("raises the warning in the audit when the theme loses the block", () => {
    expect(faqNotLiveIssue({ products: 17, live: 0, notLive: 17, needReview: 0, block: false })?.detail).toMatch(/^17 products have FAQs that aren't on your store: the RankPilot FAQ block is not on the live product template/);
    expect(faqNotLiveIssue({ products: 17, live: 17, notLive: 0, needReview: 0, block: true })).toBeNull();
  });
});

describe("R22-104 FAQ changes verified on the live page", () => {
  it("labels 'Saved, not live' until the questions are in the page HTML, then 'Verified'", async () => {
    const r = await product({ faqs: fixtureFaqs });
    const c = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "faq", before: "[]", after: JSON.stringify(fixtureFaqs), status: "applied", appliedAt: new Date() } });
    const withoutBlock = await checkFaqChange(STORE, c.id, async () => "<html><body><h1>Basket</h1></body></html>");
    expect(withoutBlock).toMatchObject({ live: false, status: "Saved, not live" });
    const saved = await prisma.change.findUniqueOrThrow({ where: { id: c.id } });
    expect(saved.error).toMatch(/^Saved, not live: the RankPilot FAQ block is not on the live product template/);
    expect(changeStatus(saved.status, saved.error)).toBe("Saved, not live");
    const listed = (await changes(STORE, { ids: [c.id] })) as { verified: boolean; live?: boolean }[];
    expect(listed[0]).toMatchObject({ verified: false, live: false });
    const live = await checkFaqChange(STORE, c.id, async () => `<html><body>${fixture}</body></html>`);
    expect(live).toMatchObject({ live: true, status: "Verified" });
    expect((await prisma.change.findUniqueOrThrow({ where: { id: c.id } })).error).toBeNull();
    expect(changeStatus("applied", null)).toBe("Applied and verified");
  });
  it("re-checks FAQ changes marked verified before this release", async () => {
    const r = await product({ faqs: [{ question: "Q1?", answer: "A1" }] });
    await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "faq", before: "[]", after: JSON.stringify([{ question: "Q1?", answer: "A1" }]), status: "applied", appliedAt: new Date() } });
    const out = await recheckFaqChanges(STORE, async () => "<html><body>No block here</body></html>");
    expect(out.notLive).toBeGreaterThanOrEqual(1);
    expect(out.live).toBe(0);
  });
});

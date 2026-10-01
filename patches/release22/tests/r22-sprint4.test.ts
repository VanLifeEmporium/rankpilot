import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prisma from "../app/db.server";
import { createErrorWindow, createRing, restartAlert, readState, writeState, sendAlert, stateFile } from "../scripts/monitor.mjs";
import { technicalHealth, coverageAverage, coverageLabel } from "../app/core/store-score";
import { auditCatalogue, type AuditResource } from "../app/core/catalogue";
import { rewriteTemplate, templateKey } from "../app/core/template-rewrite";
import { rewriteTemplateBatch } from "../app/core/template-rewrite.server";
import { faqAnswerProblems } from "../app/core/faq-facts";
import { specFacts } from "../app/core/spec-extract";
import { deadPageIssue, redirectSuggestion, datedFacts, type DeadPage } from "../app/core/index-hygiene";
import { splitInProgress, dropRedirectedPageFindings } from "../app/core/finding-state";
import { findings, stageChange } from "../app/core/agent.server";
import { approve, applyChange } from "../app/core/service.server";
import { suggestBook } from "../app/core/brand-proposals.server";
import type { Issue, Payload } from "../app/core/types";

const STORE = "demo-r22-s4";
const NAME = "Van Life Emporium";
const wipe = async () => {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => { await wipe(); await prisma.store.create({ data: { id: STORE, demo: true, domain: "https://vanlifeemporium.com", discoveries: JSON.stringify({ shop: { name: NAME } }) } }); });
afterAll(wipe);
const base = (over: Partial<Payload> = {}): Payload => ({ title: "Item", handle: "item", seo: { title: "", description: "" }, descriptionHtml: "<p>An item.</p>", images: [], collections: [], vendor: NAME, productType: "Camping", ...over });

describe("R22-204 owner alerts", () => {
  it("alerts once when more than 3 responses return 5xx within 5 minutes, naming the routes and time", () => {
    const w = createErrorWindow();
    const t0 = Date.parse("2026-10-01T13:00:00Z");
    expect(w.line("GET /health 200 - - 1.7 ms", t0)).toBeNull();
    expect(w.line("POST /app/audit 500 - - 20 ms", t0)).toBeNull();
    expect(w.line("POST /app/audit 502 - - 20 ms", t0 + 60_000)).toBeNull();
    expect(w.line("GET /api/agent/findings?x=1 500 - - 9 ms", t0 + 120_000)).toBeNull();
    const alert = w.line("\u001b[31mPOST /app/audit 503 - - 5 ms\u001b[0m", t0 + 180_000)!;
    expect(alert.kind).toBe("5xx");
    expect(alert.text).toContain("4 server errors (5xx) in the last 5 minutes");
    expect(alert.text).toContain("POST /app/audit (3)");
    expect(alert.text).toContain("GET /api/agent/findings (1)");
    expect(alert.text).toContain("2026-10-01T13:00:00.000Z");
    // No repeat inside the cooldown; errors spread over more than 5 minutes don't alert.
    expect(w.line("POST /app/audit 500 - - 5 ms", t0 + 200_000)).toBeNull();
    const slow = createErrorWindow();
    for (let i = 0; i < 6; i++) expect(slow.line("GET /app 500 - - 1 ms", t0 + i * 120_000)).toBeNull();
  });
  it("alerts after a restart outside a deploy, with the time and last log lines", () => {
    const ring = createRing(5);
    ring.push("GET /health 200 - - 1 ms\nRankPilot worker ready\nFATAL ERROR: Reached heap limit\n");
    const prev = { commit: "abc", startedAt: "2026-10-01T12:00:00Z", lastSeen: "2026-10-01T12:59:45Z", clean: false, lastLines: ring.lines() };
    const a = restartAlert(prev, { commit: "abc", startedAt: "2026-10-01T13:00:10Z" })!;
    expect(a.text).toContain("restarted at 2026-10-01T13:00:10Z");
    expect(a.text).toContain("Last seen running at 2026-10-01T12:59:45Z");
    expect(a.text).toContain("FATAL ERROR: Reached heap limit");
    expect(a.text).not.toContain("/health");
    // A deploy (new commit, clean stop) raises nothing; a crash during a deploy still does.
    expect(restartAlert({ ...prev, clean: true }, { commit: "def", startedAt: "x" })).toBeNull();
    expect(restartAlert({ ...prev, clean: false }, { commit: "def", startedAt: "x" })).not.toBeNull();
    expect(restartAlert({ ...prev, alerted: true }, { commit: "abc", startedAt: "x" })).toBeNull();
    expect(restartAlert(null, { commit: "abc", startedAt: "x" })).toBeNull();
  });
  it("keeps its state next to the database and posts to the webhook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rp-mon-"));
    try {
      const file = stateFile({ DATABASE_URL: `file:${dir}/rankpilot.sqlite?connection_limit=1` });
      expect(file).toBe(join(dir, "rankpilot-monitor.json"));
      writeState(file, { commit: "abc", startedAt: "s" });
      expect(readState(file)).toEqual({ commit: "abc", startedAt: "s" });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response("ok"));
    expect(await sendAlert({ kind: "5xx", text: "x" }, { ALERT_WEBHOOK_URL: "https://hooks.example/abc" }, fetcher)).toBe(true);
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ text: "x", content: "x" });
    expect(await sendAlert({ kind: "5xx", text: "x" }, {}, fetcher)).toBe(false);
    expect(err).toHaveBeenCalledWith("RankPilot ALERT (5xx): x");
    err.mockRestore();
  });
});

describe("R22-306 index coverage smoothed", () => {
  it("uses the average of the last 3 samples and shows how many pages were inspected", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const idx = { checkedAt: "2026-10-01T10:00:00Z", submitted: 400, indexed: 12, inspected: 20, history: [{ at: "a", indexed: 1, inspected: 2 }, { at: "b", indexed: 7, inspected: 10 }, { at: "c", indexed: 12, inspected: 20 }] };
    expect(coverageAverage({ ...idx, history: idx.history.slice(1) })).toBeCloseTo(65);
    expect(coverageAverage(idx)).toBeCloseTo((50 + 70 + 60) / 3);
    const t = technicalHealth({ metrics: [{ provider: "indexation", period: "current", payload: JSON.stringify(idx) }], healthScores: {}, observations: [], now });
    const part = t.parts.find((p) => p.label.startsWith("Inspected Google index coverage"))!;
    expect(part.value).toBeCloseTo(60);
    expect(part.label).toBe("Inspected Google index coverage (20 pages inspected, average of the last 3 checks)");
    expect(coverageLabel({ indexed: 1, inspected: 1 })).toBe("Inspected Google index coverage (1 page inspected)");
  });
});

describe("R22-603 bulk rewrite of a template", () => {
  const html = (name: string, facts: string) => `<p>The ${name} is built for vans.</p><h3>What should I check before buying the ${name}?</h3><p>Check it suits your needs and read the details carefully.</p><ul>${facts}</ul>`;
  it("replaces the template question with a product-specific one that quotes a fact and passes the R22-502 rules", () => {
    const p = base({ title: "Helinox Chair One", descriptionHtml: html("Helinox Chair One", "<li>Dimensions: 52 x 50 x 66 cm</li><li>Max load: 145 kg</li>") });
    const key = templateKey("What should I check before buying the <product name>?");
    const rw = rewriteTemplate(p, key, specFacts(p.descriptionHtml))!;
    expect(rw.question).toBe("How big is it?");
    expect(rw.answer).toBe("52 x 50 x 66 cm");
    expect(rw.fact).toMatchObject({ key: "dimensions", value: "52 x 50 x 66 cm" });
    expect(faqAnswerProblems(rw.question!, rw.answer!)).toEqual([]);
    expect(rw.html).not.toContain("What should I check");
    expect(rw.html).not.toContain("read the details carefully");
    expect(rw.html).toContain("<h3>How big is it?</h3><p>52 x 50 x 66 cm</p>");
    expect(rw.html).toContain("<li>Max load: 145 kg</li>");
    // A load is never offered as a size.
    const loadOnly = base({ title: "Camp Stool", descriptionHtml: html("Camp Stool", "<li>Max load: 120 kg</li>") });
    expect(rewriteTemplate(loadOnly, key, specFacts(loadOnly.descriptionHtml))!.question).toBe("How much weight does it hold?");
  });
  it("proposes rewrites 25 at a time, most-viewed pages first, each quoting its fact; the next batch moves on", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const title = `Trail Lantern Model ${String.fromCharCode(65 + (i % 26))}${i}`;
      const p = base({ title, handle: `trail-lantern-${i}`, url: `/products/trail-lantern-${i}`, descriptionHtml: html(title, i % 10 === 9 ? "" : `<li>Weight: ${200 + i} g</li>`) });
      return { id: `s4-t${i}`, storeId: STORE, remoteId: `gid://shopify/Product/${i + 1}`, kind: "product", title, handle: p.handle!, payload: JSON.stringify(p) };
    });
    await prisma.resource.createMany({ data: rows });
    await prisma.metric.create({ data: { storeId: STORE, provider: "gsc", period: "2026-09-03:2026-09-30", payload: JSON.stringify({ rows: rows.map((r, i) => ({ keys: [`https://vanlifeemporium.com/products/trail-lantern-${i}`, "lantern"], impressions: i * 10 })) }) } });
    const sample = "What should I check before buying the <product name>?";
    const audit = auditCatalogue(rows.map((r) => ({ id: r.id, title: r.title, kind: "product", payload: r.payload, keyword: "", facts: "{}" }) as AuditResource));
    const finding = audit.issues.find((i) => i.code === "repeated-template" && i.template === sample)!;
    expect(finding.count).toBe(30);
    const first = await rewriteTemplateBatch(STORE, { sample: finding.template! });
    expect(first.items).toHaveLength(25);
    expect(first.items[0]).toMatchObject({ resourceId: "s4-t29", impressions: 290 });
    expect(first.items.map((i) => i.impressions)).toEqual([...first.items.map((i) => i.impressions)].sort((a, b) => b - a));
    expect(first.remaining).toBe(5);
    const withFact = first.items.find((i) => i.status === "pending")!;
    expect(withFact.question).toBe("How much does it weigh?");
    expect(withFact.fact).toMatch(/^Fact used: weight “2\d\d g” \(source: Product description/);
    const change = await prisma.change.findUniqueOrThrow({ where: { id: withFact.changeId! } });
    expect(change).toMatchObject({ status: "pending", feature: "description" });
    expect(JSON.parse(change.reasons).join(" ")).toMatch(/Rewrites the repeated text.*on 30 products.*Fact used: weight/);
    const noFact = first.items.find((i) => i.resourceId === "s4-t19")!;
    expect(noFact.status).toBe("removed-only");
    const second = await rewriteTemplateBatch(STORE, { sample: finding.template! });
    expect(second.items.map((i) => i.resourceId).sort()).toEqual(["s4-t0", "s4-t1", "s4-t2", "s4-t3", "s4-t4"]);
    expect(second.remaining).toBe(0);
  });
});

describe("R22-604 unpublished guide with impressions", () => {
  const guide = { id: "g2", kind: "article", title: "Wild Camping in Scotland", handle: "wild-camping-scotland", payload: JSON.stringify({ url: "/blogs/news/wild-camping-scotland", published: true }) };
  it("suggests the closest live guide and notes dated facts to check", () => {
    const body = "Parking in Scotland is easy. In 2023 the car park at Glencoe cost £5 per night. Currently the toilets are open daily from 8am. The views are great.";
    const dead: DeadPage = { url: "https://vanlifeemporium.com/blogs/news/scotland-parking-guide", impressions: 17, queries: ["scotland camping parking"], reason: "unpublished", resourceId: "g1", kind: "article", dated: datedFacts(body, new Date("2026-10-01")) };
    const s = redirectSuggestion(dead, [guide, { id: "p", kind: "product", title: "Scotland Map", handle: "scotland-map", payload: JSON.stringify({ url: "/products/scotland-map", published: true }), productType: "Maps" } as never]);
    expect(s).toMatchObject({ kind: "article", title: "Wild Camping in Scotland" });
    const issue = deadPageIssue(dead, s);
    expect(issue.code).toBe("unpublished-with-impressions");
    expect(issue.detail).toMatch(/Republish it if it should be live, or redirect it to Wild Camping in Scotland/);
    expect(issue.detail).toContain("check these dated details: “In 2023 the car park at Glencoe cost £5 per night.”; “Currently the toilets are open daily from 8am.”");
    expect(datedFacts("The views are great. It is a lovely place to stay overnight.")).toEqual([]);
  });
  it("Republish is a logged, undoable change for a page or blog post", async () => {
    const p = base({ title: "Scotland parking guide", handle: "scotland-parking-guide", published: false, descriptionHtml: "<p>Guide.</p>" });
    await prisma.resource.create({ data: { id: "s4-guide", storeId: STORE, remoteId: "gid://shopify/Article/1", kind: "article", title: p.title, handle: p.handle!, payload: JSON.stringify(p) } });
    const change = await stageChange(STORE, "s4-guide", "published", false, true, ["merchant-reviewed-v1: Republish this page because Google still shows it."]);
    await approve(STORE, change.id, "merchant");
    await applyChange(STORE, change.id);
    expect(JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: "s4-guide" } })).payload).published).toBe(true);
    expect((await prisma.change.findUniqueOrThrow({ where: { id: change.id } })).status).toBe("applied");
    await applyChange(STORE, change.id, true);
    expect(JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: "s4-guide" } })).payload).published).toBe(false);
  });
});

describe("R22-701 findings in progress", () => {
  const path = "/products/2x-convex-blind-spot-mirror-for-vans";
  const dead: Issue = { resourceId: `url:${path}`, title: path, code: "404-with-impressions", severity: "warning", detail: "d", link: { url: `https://vanlifeemporium.com${path}`, status: 404, checkedAt: "x" } };
  it("labels a 404 with a pending redirect 'Redirect pending' and leaves it out of the open count", async () => {
    const other: Issue = { resourceId: "url:/products/other", title: "/products/other", code: "404-with-impressions", severity: "warning", detail: "d" };
    const split = splitInProgress([dead, other], [{ id: "c1", resourceId: "red1", feature: "redirect", status: "pending" }], [{ id: "red1", handle: path }]);
    expect(split.open).toEqual([other]);
    expect(split.inProgress[0].pending).toEqual({ changeId: "c1", label: "Redirect pending" });
    // Through the agent API: the item carries the status and change id; openPages leaves it out.
    const red = await prisma.resource.create({ data: { storeId: STORE, remoteId: `redirect:${path}`, kind: "redirect", title: path, handle: path, payload: JSON.stringify({ path, target: "/collections/mirrors" }) } });
    const c = await prisma.change.create({ data: { storeId: STORE, resourceId: red.id, feature: "redirect", before: "null", after: JSON.stringify({ path, target: "/collections/mirrors" }) } });
    await prisma.audit.create({ data: { storeId: STORE, score: 80, aeoScore: 0, resourceCount: 1, coverage: "{}", issues: JSON.stringify([dead, other]) } });
    const group = (await findings(STORE)).find((g) => g.items.some((i) => i.code === "404-with-impressions"))!;
    expect(group.pages).toBe(2);
    expect(group.openPages).toBe(1);
    expect(group.items.find((i) => i.resourceId === dead.resourceId)).toMatchObject({ status: "Redirect pending", pendingChangeId: c.id });
  });
  it("a finding with a matching pending proposal is 'Proposal pending'", () => {
    const vendor: Issue = { resourceId: "p1", title: "Betron speaker", code: "brand-is-store", severity: "warning", detail: "d", feature: "vendor" };
    expect(splitInProgress([vendor], [{ id: "c2", resourceId: "p1", feature: "vendor", status: "pending" }], []).inProgress[0].pending.label).toBe("Proposal pending");
    expect(splitInProgress([vendor], [{ id: "c2", resourceId: "p1", feature: "vendor", status: "rejected" }], []).open).toHaveLength(1);
  });
});

describe("R22-702 book screen", () => {
  it("keeps every candidate edition (cover, year, ISBN) for the side-by-side screen", async () => {
    const p = base({ title: "The Camper Van Cookbook", handle: "the-camper-van-cookbook", productType: "Books", images: [{ id: "i1", url: "https://cdn.shopify.com/book.jpg", alt: "Book", filename: "book.jpg" }] });
    await prisma.resource.create({ data: { id: "s4-book", storeId: STORE, remoteId: "gid://shopify/Product/77", kind: "product", title: p.title, handle: p.handle!, payload: JSON.stringify(p) } });
    const r = await suggestBook(STORE, "s4-book", async () => ({ docs: [{ title: "The Camper Van Cookbook", author_name: ["Martin Dorey"], first_publish_year: 2010, editions: { docs: [{ title: "The Camper Van Cookbook", publisher: ["Saltyard Books"], isbn: ["9781444735802"], publish_date: ["2012"] }] } }] }));
    expect(r.ok).toBe(true);
    const facts = JSON.parse((await prisma.resource.findUniqueOrThrow({ where: { id: "s4-book" } })).facts);
    expect(facts.isbn.options[0]).toMatchObject({ isbn: "9781444735802", year: "2012", author: "Martin Dorey", cover: "https://covers.openlibrary.org/b/isbn/9781444735802-M.jpg" });
    expect(facts.isbn.confirmed).toBe(false);
  });
  it("the screen shows the product image beside each cover and saving needs 'This is the edition I sell'", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/components/FixArena.tsx", "utf8");
    expect(src).toContain('className="book-compare"');
    expect(src).toMatch(/productImage\?\.url\?<img src=\{productImage\.url\}/);
    expect(src).toMatch(/<img src=\{o\.cover\}/);
    expect(src).toMatch(/name="editionConfirmed" required\/> This is the edition I sell/);
  });
});

describe("R22-703 redirected pages", () => {
  it("keeps only the redirected finding for a page that redirects", () => {
    const issues: Issue[] = [
      { resourceId: "c1", title: "Summer Festival Essentials", code: "thin-content", severity: "warning", detail: "12 words" },
      { resourceId: "c1", title: "Summer Festival Essentials", code: "missing-meta-description", severity: "notice", detail: "d" },
      { resourceId: "c1", title: "Summer Festival Essentials", code: "redirected", severity: "notice", detail: "/collections/summer-festival-essentials redirects to /collections/van-life-camping-gear." },
      { resourceId: "c2", title: "Van Life Camping Gear", code: "thin-content", severity: "warning", detail: "40 words" },
    ];
    const out = dropRedirectedPageFindings(issues);
    expect(out.filter((i) => i.resourceId === "c1").map((i) => i.code)).toEqual(["redirected"]);
    expect(out.find((i) => i.resourceId === "c2")?.code).toBe("thin-content");
  });
});

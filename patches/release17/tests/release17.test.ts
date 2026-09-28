import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import {
  fixHeadingOrder, seoWarnings, servedTitle, descriptionProblems, normalisePath,
  mintLink, exchange, agentContext, readiness, lookup, dismiss, opportunities,
} from "../app/core/agent.server";
import { servedTitleMismatch, redirectOutcome } from "../app/core/crawl.server";
import { platformNofollow, inspectPage } from "../app/core/technical-audit";
import { auditCatalogue, bodyFaqQuestions } from "../app/core/catalogue";
import { normalise } from "../app/core/shopify-api.server";
import { settleStaleChanges, driftIssues } from "../app/core/history-hygiene.server";

const STORE = "demo-r17";
const payload = (over: Record<string, unknown> = {}) => JSON.stringify({
  title: "Folding Teak Chair", handle: "teak", descriptionHtml: "<p>A folding teak chair.</p>",
  seo: { title: "Folding Teak Chair | Van Life Emporium", description: "A folding teak chair for vans and campsites, oiled and ready for the road. Folds flat for storage in a garage or under a bed." },
  images: [{ id: "m1", alt: "Teak chair", url: "https://cdn.shopify.com/a.jpg", filename: "a.jpg" }], collections: [], published: true, ...over,
});
async function reset() {
  for (const m of ["change", "resource", "audit", "event", "job", "metric"] as const)
    await (prisma[m] as unknown as { deleteMany(a: { where: { storeId: string } }): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
}
beforeAll(async () => {
  process.env.SESSION_SECRET = "release-17-test-secret-value";
  process.env.SHOPIFY_APP_URL = "https://rankpilot.example";
  await reset();
  await prisma.store.create({ data: { id: STORE, demo: true, domain: "https://vanlifeemporium.com", discoveries: JSON.stringify({ shop: { name: "Van Life Emporium" } }) } });
});
afterAll(reset);

describe("release 17 heading repair", () => {
  it("keeps the release 16 behaviour", () => {
    const r = fixHeadingOrder('<h3>Who is behind it?</h3><p>We are small.</p><h3>Delivery</h3><h4>UK</h4>');
    expect(r.html).toBe('<h2 class="h3">Who is behind it?</h2><p>We are small.</p><h2 class="h3">Delivery</h2><h3 class="h4">UK</h3>');
    expect(fixHeadingOrder('<h2>A</h2><h4 class="x">B</h4>').html).toBe('<h2>A</h2><h3 class="x h4">B</h3>');
    const ok = "<h2>A</h2><h3>B</h3>";
    expect(fixHeadingOrder(ok)).toEqual({ html: ok, changes: [] });
  });
  it("rewrites only heading tags and never re-serialises other markup", () => {
    const src = '<p><h3>Inside p</h3></p><table><tr><td>a</td></tr></table><iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe><h4 style="text-align:center">Centred</h4>';
    expect(fixHeadingOrder(src).html).toBe('<p><h2 class="h3">Inside p</h2></p><table><tr><td>a</td></tr></table><iframe src="https://www.youtube.com/embed/x" allowfullscreen></iframe><h3 style="text-align:center" class="h4">Centred</h3>');
  });
  it("turns empty headings into paragraphs and ignores them for levels", () => {
    const r = fixHeadingOrder("<h3>&nbsp;</h3><h2>Real</h2><h3></h3><h3>Next</h3>");
    expect(r.html).toBe("<p>&nbsp;</p><h2>Real</h2><p></p><h3>Next</h3>");
  });
  it("handles awkward attributes without corrupting them", () => {
    expect(fixHeadingOrder('<h3 class="price-$&">X</h3>').html).toBe('<h2 class="price-$& h3">X</h2>');
    expect(fixHeadingOrder("<h3 class>A</h3>").html).toBe('<h2 class="h3">A</h2>');
    expect(fixHeadingOrder('<h3 title="a>b">X</h3>').html).toBe('<h2 title="a>b" class="h3">X</h2>');
  });
  it("is idempotent and leaves broken nesting untouched", () => {
    const once = fixHeadingOrder("<h4>A</h4><h5>B</h5>").html;
    expect(fixHeadingOrder(once).changes).toEqual([]);
    const broken = "<h3>Unclosed<p>text</p>";
    expect(fixHeadingOrder(broken).html).toBe(broken);
  });
});

describe("release 17 detection", () => {
  it("spots a storefront title that differs from the Shopify SEO title", () => {
    expect(servedTitleMismatch("Geometric Indoor Outdoor Rug | Eldon Pink & Teal – Van Life Emporium", "Geometric Indoor Outdoor Rug | Van Life Emporium", "Van Life Emporium")).toEqual({ served: "Geometric Indoor Outdoor Rug | Eldon Pink & Teal" });
    expect(servedTitleMismatch("Folding Teak Chair – Van Life Emporium", "Folding Teak Chair", "Van Life Emporium")).toBeNull();
    expect(servedTitleMismatch("Folding Teak Chair | Van Life Emporium", "Folding Teak Chair | Van Life Emporium", "Van Life Emporium")).toBeNull();
    expect(servedTitleMismatch("Anything", "", "Van Life Emporium")).toBeNull();
  });
  it("classifies redirects", () => {
    expect(redirectOutcome("https://s.com/collections/old", ["https://s.com/"])).toEqual({ path: "/", home: true });
    expect(redirectOutcome("https://s.com/products/a", ["https://s.com/products/b"])).toEqual({ path: "/products/b", home: false });
    expect(redirectOutcome("https://x.myshopify.com/products/a", ["https://s.com/products/a"])).toBeNull();
    expect(redirectOutcome("https://s.com/products/a", [])).toBeNull();
    expect(redirectOutcome("https://s.com/products/a", ["https://s.com/en-gb/products/A"])).toBeNull();
    expect(redirectOutcome("https://s.com/collections/old", ["https://s.com/en-gb"])).toEqual({ path: "/en-gb", home: true });
  });
  it("ignores Shopify's own nofollow links", () => {
    expect(platformNofollow("/customer_authentication/redirect?locale=en", "https://s.com/")).toBe(true);
    expect(platformNofollow("https://www.shopify.com/?utm=x", "https://s.com/")).toBe(true);
    expect(platformNofollow("https://partner.example/offer", "https://s.com/")).toBe(false);
    const html = '<title>x</title><meta name="description" content="d"><a rel="nofollow" href="/customer_authentication/redirect">Log in</a><a rel="nofollow" href="https://www.shopify.com">Powered by Shopify</a>';
    expect(inspectPage(html, "https://s.com/p", "r", "t").issues.map((i) => i.code)).not.toContain("nofollow-review");
  });
  it("counts FAQs written in the body and stops flagging those products", () => {
    const body = "<h2>Teak chair FAQs</h2><h3>Does it fold flat?</h3><p>Yes.</p><h3>Is it oiled?</h3><p>Yes.</p>";
    expect(bodyFaqQuestions(body)).toBe(2);
    expect(bodyFaqQuestions("<p>No questions here.</p>")).toBe(0);
    expect(bodyFaqQuestions("<p>Questions? Email us.</p><strong>Why teak?</strong>")).toBe(0);
    const res = (html: string) => ({ id: "x", title: "x", kind: "product", keyword: "", facts: "{}", payload: payload({ descriptionHtml: html, images: [{ id: "i", alt: "a", url: "u", filename: "f", width: 4000, height: 4000 }], variants: [{ sku: "s", barcode: "1", price: "1" }] }) });
    expect(auditCatalogue([res(body)]).issues.map((i) => i.code)).not.toContain("missing-product-faq");
    expect(auditCatalogue([res("<p>Plain</p>")]).issues.map((i) => i.code)).toContain("missing-product-faq");
    expect(auditCatalogue([res(body)]).issues.map((i) => i.code)).not.toContain("large-image");
  });
  it("treats an active product that is off the Online Store as unpublished", () => {
    const node = { id: "gid://shopify/Product/1", title: "t", handle: "h", status: "ACTIVE", onlineStoreUrl: null } as never;
    expect(normalise(node, "product").published).toBe(false);
    expect(normalise({ ...(node as object), onlineStoreUrl: "https://s.com/products/h" } as never, "product").published).toBe(true);
  });
});

describe("release 17 agent validation", () => {
  it("warns when the theme suffix pushes the Google title past 65 characters", () => {
    expect(servedTitle("Geometric Indoor Outdoor Rug", "Van Life Emporium")).toBe("Geometric Indoor Outdoor Rug – Van Life Emporium");
    expect(servedTitle("Rug | Van Life Emporium", "Van Life Emporium")).toBe("Rug | Van Life Emporium");
    const long = "Camper Van Accessories | Premium Gear for Van Living";
    expect(seoWarnings(long, "x".repeat(150), "Van Life Emporium").join(" ")).toMatch(/Google will see 72 chars/);
    expect(seoWarnings("A good campervan title for Google here", "x".repeat(155), "Van Life Emporium")).toEqual([]);
  });
  it("accepts clean description HTML and refuses scripts, H1 and unknown markup", () => {
    const words = Array.from({ length: 90 }, (_, i) => "word" + i).join(" ");
    expect(descriptionProblems(`<h2>Key details</h2><p>${words}</p><ul><li>Oiled teak</li></ul><a href="/pages/delivery">Delivery</a>`).errors).toEqual([]);
    expect(descriptionProblems(`<p>${words}</p><script>alert(1)</script>`).errors.length).toBeGreaterThan(0);
    expect(descriptionProblems(`<h1>Title</h1><p>${words}</p>`).errors.join(" ")).toMatch(/H1/);
    expect(descriptionProblems(`<p onclick="x()">${words}</p>`).errors.length).toBeGreaterThan(0);
    expect(descriptionProblems(`<p>${words}</p><a href="javascript:x">x</a>`).errors.length).toBeGreaterThan(0);
    expect(descriptionProblems(`<p>Too short!</p>`).errors.join(" ")).toMatch(/words/);
  });
  it("normalises storefront paths for lookup", () => {
    expect(normalisePath("https://vanlifeemporium.com/Products/Teak/?variant=1#x")).toBe("/products/teak");
    expect(normalisePath("/collections/kitchen/products/teak")).toBe("/products/teak");
    expect(normalisePath("/en-gb/pages/faq/")).toBe("/pages/faq");
    expect(normalisePath("/pages/100%")).toBe("/pages/100%");
  });
});

describe("release 17 history, drift, readiness and access", () => {
  it("settles failed rows replaced by a later applied change and lets the agent dismiss others", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/10", kind: "product", title: "Folding Teak Chair", handle: "teak", payload: payload() } });
    const old = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "seo", before: "{}", after: '{"title":"Old","description":"Old"}', status: "verification_failed", approvedBy: "x", createdAt: new Date(Date.now() - 60000) } });
    const failedAlone = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "faq", before: "[]", after: "[]", status: "apply_failed", approvedBy: "x" } });
    await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "seo", before: "{}", after: JSON.stringify(JSON.parse(payload()).seo), status: "applied", approvedBy: "x", appliedAt: new Date() } });
    expect(await settleStaleChanges(STORE)).toEqual({ settled: 1 });
    expect((await prisma.change.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("superseded");
    expect((await prisma.change.findUniqueOrThrow({ where: { id: failedAlone.id } })).status).toBe("apply_failed");
    const out = await dismiss(STORE, { ids: [failedAlone.id], reason: "Stale" });
    expect(out.dismissed).toBe(1);
    await expect(dismiss(STORE, {})).rejects.toThrow(/Pass ids/);
    const unconfirmed = await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "title", before: '"a"', after: '"b"', status: "verification_failed", approvedBy: "x" } });
    const refused = await dismiss(STORE, { ids: [unconfirmed.id] });
    expect(refused.dismissed).toBe(0);
    expect(refused.skipped[0].message).toMatch(/may be live/);
  });
  it("reports fields changed outside RankPilot after an applied change", async () => {
    const r = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/11", kind: "product", title: "Rug", handle: "rug", payload: payload({ seo: { title: "Rug | Eldon Pink & Teal", description: "Edited elsewhere" } }) } });
    await prisma.change.create({ data: { storeId: STORE, resourceId: r.id, feature: "seo", before: "{}", after: '{"title":"Geometric Rug | Van Life Emporium","description":"Ours"}', status: "applied", approvedBy: "x", appliedAt: new Date() } });
    const issues = await driftIssues(STORE, await prisma.resource.findMany({ where: { storeId: STORE } }));
    expect(issues.map((i) => [i.resourceId, i.code])).toEqual([[r.id, "changed-outside"]]);
    expect(issues[0].detail).toMatch(/Rug \| Eldon Pink & Teal/);
  });
  it("does not treat alt text written into a page body as an outside edit", async () => {
    const page = await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Page/1", kind: "page", title: "Guide", handle: "guide", payload: payload({ descriptionHtml: '<p>Guide</p><img src="https://cdn.shopify.com/x.jpg" alt="New alt">' }) } });
    await prisma.change.create({ data: { storeId: STORE, resourceId: page.id, feature: "description", before: '""', after: JSON.stringify('<p>Guide</p><img src="https://cdn.shopify.com/x.jpg" alt="">'), status: "applied", approvedBy: "x", appliedAt: new Date(), createdAt: new Date(Date.now() - 60000) } });
    await prisma.change.create({ data: { storeId: STORE, resourceId: page.id, feature: "alt", before: "[]", after: "[]", status: "applied", approvedBy: "x", appliedAt: new Date() } });
    const issues = await driftIssues(STORE, [await prisma.resource.findUniqueOrThrow({ where: { id: page.id } })]);
    expect(issues).toEqual([]);
  });
  it("answers go-live readiness by Shopify id", async () => {
    await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/12", kind: "product", title: "No alt", handle: "no-alt", payload: payload({ images: [{ id: "m", alt: "", url: "u", filename: "f" }], seo: { title: "", description: "" } }) } });
    const [ready, notReady, unknown] = await readiness(STORE, { gids: ["gid://shopify/Product/10", "gid://shopify/Product/12", "gid://shopify/Product/999"] });
    expect(ready.ready).toBe(true);
    expect(notReady.ready).toBe(false);
    expect(notReady.reasons.join(" ")).toMatch(/alt text.*|No Google title/);
    expect(unknown.ready).toBe(false);
    expect((await lookup(STORE, ["https://vanlifeemporium.com/products/teak/"]))[0].title).toBe("Folding Teak Chair");
    await expect(readiness(STORE, { gids: ["gid://shopify/Collection/1"], refresh: true })).rejects.toThrow(/product ids/);
  });
  it("ranks striking-distance pages from the stored Search Console rows", async () => {
    await prisma.metric.create({ data: { storeId: STORE, provider: "gsc", period: "2026-09-22", payload: JSON.stringify({ start: "2026-08-26", end: "2026-09-22", rows: [
      { keys: ["https://vanlifeemporium.com/products/teak", "teak folding chair"], position: 9.4, impressions: 120, clicks: 1 },
      { keys: ["https://vanlifeemporium.com/products/teak", "camping chair wood"], position: 14, impressions: 60, clicks: 0 },
      { keys: ["https://vanlifeemporium.com/products/rug", "outdoor rug"], position: 3, impressions: 500, clicks: 20 },
    ] }) } });
    const out = await opportunities(STORE);
    expect(out.pages).toHaveLength(1);
    expect(out.pages[0]).toMatchObject({ title: "Folding Teak Chair", impressions: 180 });
    expect(out.pages[0].queries[0].query).toBe("teak folding chair");
  });
  it("uses each link once and honours revoke and the store switch", async () => {
    const url = await mintLink(STORE, "chris");
    const token = decodeURIComponent(new URL(url).searchParams.get("t")!);
    const cookie = (await exchange(token)).split(";")[0];
    await expect(exchange(token)).rejects.toThrow(/already been used/);
    const req = () => new Request("https://rankpilot.example/api/agent/overview", { headers: { Cookie: cookie } });
    expect((await agentContext(req())).store.id).toBe(STORE);
    const store = await prisma.store.findUniqueOrThrow({ where: { id: STORE } });
    await prisma.store.update({ where: { id: STORE }, data: { settings: JSON.stringify({ ...JSON.parse(store.settings), agentEpoch: 1 }) } });
    await expect(agentContext(req())).rejects.toBeInstanceOf(Response);
    await prisma.store.update({ where: { id: STORE }, data: { settings: JSON.stringify({ agentAccess: false, agentEpoch: 1 }) } });
    await expect(mintLink(STORE, "chris")).rejects.toThrow(/switched off/);
  });
});

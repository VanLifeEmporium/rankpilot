import { it, expect, vi, afterEach } from "vitest";
vi.hoisted(() => { process.env.CRAWL_SPACING_MS = "0"; });
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "23.227.38.65", family: 4 }] }));
import { crawlStore } from "../app/core/crawl.server";
import { pageNotFound, renderedChecks } from "../app/core/rendered-page";
afterEach(() => vi.unstubAllGlobals());

const page404 = `<html><head><title>404 Not Found – Van Life Emporium</title></head><body class="gradient template-404"><h1>Page not found</h1></body></html>`;
const productPage = (ld: object[], og = true) => `<html><head><title>Rug</title>${og ? '<meta property="og:image" content="https://cdn.shopify.com/rug.jpg">' : ""}${ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join("")}</head><body class="template-product"><h1>Rug</h1></body></html>`;
const product = { "@context": "https://schema.org", "@type": "Product", name: "Rug", image: ["https://cdn.shopify.com/rug.jpg"], brand: { "@type": "Brand", name: "Van Life Emporium" }, offers: { price: "40.00" } };

it("recognises the theme's 404 template and a Page not found heading", () => {
  expect(pageNotFound(page404)).toBe(true);
  expect(pageNotFound("<html><body><h1>Page not found</h1></body></html>")).toBe(true);
  expect(pageNotFound(productPage([product]))).toBe(false);
  expect(pageNotFound("<html><body><h1>Why a 404 is bad for your van</h1></body></html>")).toBe(false);
});

it("flags missing Product data, no image, no brand and duplicate Product entities", () => {
  const t = { id: "p", title: "Rug", url: "https://vanlifeemporium.com/products/rug", kind: "product" };
  expect(renderedChecks(productPage([product]), [product], t)).toEqual([]);
  expect(renderedChecks(productPage([], false), [], t).map((i) => i.code).sort()).toEqual(["product-schema-missing", "rendered-no-images"]);
  const noBrand = { ...product, brand: undefined };
  expect(renderedChecks(productPage([noBrand]), [noBrand], t).map((i) => i.code)).toEqual(["product-brand-missing"]);
  expect(renderedChecks(productPage([product, product]), [product, product], t).map((i) => i.code)).toEqual(["product-schema-multiple"]);
  // Collections and pages are only checked for the 404 template.
  expect(renderedChecks(productPage([]), [], { ...t, kind: "collection" })).toEqual([]);
});

it("an audit crawl raises a critical finding for a published product that renders the 404 template", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
    if (url.pathname === "/sitemap.xml") return new Response("<urlset></urlset>", { status: 200 });
    if (url.pathname === "/products/xxl-flannel-sleeping-bag") return new Response(page404, { status: 200 });
    if (url.pathname.startsWith("/products/")) return new Response(productPage([product]), { status: 200 });
    return new Response("<html><head><title>Home</title></head><body><h1>Van Life Emporium</h1></body></html>", { status: 200 });
  }));
  const res = (handle: string) => ({ id: handle, title: handle, kind: "product", handle, payload: JSON.stringify({ title: handle, published: true, seo: { title: handle }, url: `https://vanlifeemporium.com/products/${handle}` }) });
  const { issues } = await crawlStore("https://vanlifeemporium.com", [res("xxl-flannel-sleeping-bag"), res("rug")], 10);
  const found = issues.filter((i) => i.code === "page-not-found");
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ resourceId: "xxl-flannel-sleeping-bag", severity: "critical" });
  expect(issues.some((i) => i.resourceId === "rug" && i.code === "page-not-found")).toBe(false);
}, 30000);

it("the catalogue score goes down when a page renders Page not found", async () => {
  const prisma = (await import("../app/db.server")).default;
  const STORE = "live-r19-01";
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.store.create({ data: { id: STORE, demo: false, domain: "https://vanlifeemporium.com" } });
  const body = "<p>" + "A warm flannel sleeping bag for cold nights in the van. ".repeat(12) + "</p>";
  const make = (h: string) => prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/" + h, kind: "product", title: h, handle: h, payload: JSON.stringify({ title: h, handle: h, descriptionHtml: body.replace("flannel", h), seo: { title: `${h} sleeping bag for vans | VLE`, description: `${h} `.repeat(30).slice(0, 155) }, images: [{ id: "i", url: "u", alt: "a", filename: "f" }], collections: [], variants: [{ sku: "s", barcode: "5012345678900", price: "1" }], faqs: [{ question: "q", answer: "a" }] }) } });
  const a = await make("bag"); await make("mat");
  // Score from the catalogue checks alone, before the storefront is read.
  const clean = await (await import("../app/core/service.server")).catalogueAuditPaged(STORE);
  vi.doMock("../app/core/crawl.server", async (orig) => ({ ...(await orig<object>()), crawlStore: async () => ({ issues: [{ resourceId: a.id, title: "bag", code: "page-not-found", severity: "critical", detail: "d" }], discoveries: { scanned: 2, pages: [], schemas: [], errors: [] } }) }));
  vi.resetModules();
  const fresh = await import("../app/core/service.server");
  const row = await fresh.audit(STORE);
  expect(row.score).toBeLessThan(clean.result.score);
  expect(JSON.parse(row.issues).some((i: { code: string; resourceId: string }) => i.code === "page-not-found" && i.resourceId === a.id)).toBe(true);
  for (const m of ["resource", "audit", "event", "metric"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
});

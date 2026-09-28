import { it, expect, vi, afterEach } from "vitest";
vi.hoisted(() => { process.env.CRAWL_SPACING_MS = "0"; });
vi.mock("../app/db.server", () => ({ default: { store: { findUnique: async () => ({ active: true }) }, event: { create: vi.fn() } } }));
vi.mock("../app/core/security.server", () => ({ credentials: async () => ({ openaiKey: "test" }) }));
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "23.227.38.65", family: 4 }] }));
import { aiSpecProposals } from "../app/core/generation.server";
import { crawlStore } from "../app/core/crawl.server";
import type { Payload } from "../app/core/types";
afterEach(() => vi.unstubAllGlobals());
const answer = (obj: unknown) => new Response(JSON.stringify({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(obj) }] }] }), { status: 200 });

it("item 1: the AI pass keeps only proposals whose quoted sentence is in the description", async () => {
  const p = { title: "Folding stool", handle: "stool", descriptionHtml: "<ul><li>Supports up to 100kg</li><li>Includes carry bag</li></ul>", seo: { title: "", description: "" }, images: [], collections: [] } as Payload;
  const f = vi.fn().mockResolvedValue(answer({ facts: [
    { key: "capacity", value: "Up to 100kg", quote: "Supports up to 100kg" },
    { key: "included", value: "Carry bag", quote: "Includes carry bag" },
    { key: "weight", value: "1.2kg", quote: "Weighs 1.2kg" },
    { key: "materials", value: "Steel", quote: "Supports up to 100kg" },
  ] }));
  vi.stubGlobal("fetch", f);
  const out = await aiSpecProposals("s", p, ["capacity", "included", "weight", "materials"]);
  // weight: quote not in the description; materials: "Steel" is not in its quoted sentence.
  expect(out.map((s: { key: string; value: string }) => [s.key, s.value])).toEqual([["capacity", "Up to 100kg"], ["included", "Carry bag"]]);
  const request = JSON.parse(f.mock.calls[0][1].body);
  expect(request.text.format.schema.properties.facts.items.properties.key.enum).toEqual(["capacity", "included", "weight", "materials"]);
});

it("items 9 and 11: slows down after a 429, rechecks at the end and flags leftover theme code", async () => {
  const seen = new Map<string, number>();
  const page = (title: string, extra = "") => `<html><head><title>${title}</title><meta name="description" content="d">${extra}</head><body><h1>${title}</h1></body></html>`;
  vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    const n = (seen.get(url.pathname) || 0) + 1; seen.set(url.pathname, n);
    if (url.pathname === "/products/busy" && n <= 4) return new Response("slow down", { status: 429, headers: { "retry-after": "0.001" } });
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200 });
    if (url.pathname === "/sitemap.xml") return new Response("<urlset></urlset>", { status: 200 });
    if (url.pathname === "/products/rug") return new Response(page("Rug", '<!-- Avada SEO --><script src="https://cdn.example/avada-seo.js"></script>'), { status: 200 });
    return new Response(page(url.pathname), { status: 200 });
  }));
  const res = (handle: string) => ({ id: handle, title: handle, kind: "product", handle, payload: JSON.stringify({ title: handle, handle, descriptionHtml: "", seo: { title: handle, description: "" }, images: [], collections: [], url: `https://vanlifeemporium.com/products/${handle}` }) });
  const { issues, discoveries } = await crawlStore("https://vanlifeemporium.com", [res("busy"), res("rug"), res("mug")], 10);
  expect(issues.filter((i) => i.code === "http-error")).toEqual([]);
  expect((discoveries as { rateLimit: { hits: number; deferred: number; recovered: number; spacingMs: number } }).rateLimit).toMatchObject({ deferred: 1, recovered: 1 });
  expect((discoveries as { rateLimit: { spacingMs: number } }).rateLimit.spacingMs).toBeGreaterThanOrEqual(1000);
  expect(issues.some((i) => i.code === "theme-leftover" && i.detail.includes("AVADA SEO"))).toBe(true);
}, 60000);

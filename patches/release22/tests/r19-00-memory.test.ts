import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import prisma from "../app/db.server";
import { resourcePages, AUDIT_SELECT } from "../app/core/resource-pages.server";
import { auditCatalogue, type AuditResource } from "../app/core/catalogue";
import { catalogueAuditPaged, tick, CRAWL_JOBS } from "../app/core/service.server";
import { memoryWarning, resetMemoryWarning, currentMemory } from "../app/core/memory.server";
import { loader, RELEASE_TAG } from "../app/routes/health";

const STORE = "demo-r19-00";
const reset = async () => {
  for (const m of ["job", "resource", "audit", "event", "metric", "change"] as const)
    await (prisma[m] as unknown as { deleteMany(a: { where: { storeId: string } }): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
};
beforeAll(async () => {
  await reset();
  await prisma.store.create({ data: { id: STORE, demo: true } });
  const rows = Array.from({ length: 120 }, (_, i) => ({
    storeId: STORE, remoteId: `gid://shopify/Product/${i}`, kind: i % 10 === 0 ? "collection" : "product", title: `Item ${i}`, handle: `item-${i}`, keyword: "",
    payload: JSON.stringify({ title: `Item ${i}`, handle: `item-${i}`, descriptionHtml: `<p>${"Word ".repeat(i % 3 ? 90 : 10)}</p>`, seo: { title: i % 4 ? `Item ${i} | Store` : "", description: i % 5 ? `Summary ${i % 7}` : "" }, images: [], collections: [], variants: [{ sku: "s", barcode: i % 6 ? "5012345678900" : "", price: "1" }] }),
  }));
  await prisma.resource.createMany({ data: rows });
});
afterAll(reset);

describe("R19-00 memory", () => {
  it("reads resources in pages of 50 with only the selected fields", async () => {
    const sizes: number[] = [];
    for await (const page of resourcePages<{ id: string; title: string }>({ storeId: STORE }, { title: true })) {
      sizes.push(page.length);
      expect(Object.keys(page[0]).sort()).toEqual(["id", "title"]);
    }
    expect(sizes).toEqual([50, 50, 20]);
  });
  it("gives the same audit result paged as in one pass", async () => {
    const all = (await prisma.resource.findMany({ where: { storeId: STORE }, select: AUDIT_SELECT, orderBy: { id: "asc" } })) as AuditResource[];
    const whole = auditCatalogue(all);
    const paged = await catalogueAuditPaged(STORE);
    expect(paged.count).toBe(120);
    expect(paged.result.score).toBe(whole.score);
    expect(paged.result.issues.map((i) => i.resourceId + i.code).sort()).toEqual(whole.issues.map((i) => i.resourceId + i.code).sort());
    // The crawl receives slim records: no description HTML is kept between pages.
    expect(paged.slim.every((r) => JSON.parse(r.payload).descriptionHtml === "")).toBe(true);
  });
  it("holds crawling jobs back while changes are being applied", async () => {
    expect(CRAWL_JOBS).toEqual(expect.arrayContaining(["audit", "recheck-pages", "indexation"]));
    const apply = await prisma.job.create({ data: { storeId: STORE, kind: "apply", dedup: "r19-apply", payload: "{}", status: "running" } });
    const crawl = await prisma.job.create({ data: { storeId: STORE, kind: "recheck-pages", dedup: "r19-crawl", payload: "{}" } });
    expect(await tick({ lane: "background" })).toBe(false);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: crawl.id } })).status).toBe("queued");
    await prisma.job.delete({ where: { id: apply.id } });
    await prisma.job.delete({ where: { id: crawl.id } });
  });
  it("warns once above 80% of the container limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetMemoryWarning();
    const m = (rss: number) => ({ rss, heapUsed: 10, heapLimit: 180, at: Date.now() });
    expect(memoryWarning(m(150), m(150))).toBeNull();
    expect(memoryWarning(m(220), m(200))).toContain("420 MB of 512 MB");
    expect(memoryWarning(m(220), m(200))).toBeNull();
    warn.mockRestore();
  });
  it("reports rss and heapUsed for each process at /health", async () => {
    const res = await loader({ request: new Request("https://rankpilot.example/health") });
    expect(res.headers.get("X-RankPilot-Release")).toBe(RELEASE_TAG);
    expect(RELEASE_TAG).toMatch(/^2026-\d\d-\d\d-release-\d+(\.\d+|-s\d)?$/);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.memory.web).toMatchObject({ rss: expect.any(Number), heapUsed: expect.any(Number) });
    expect("worker" in body.memory).toBe(true);
    expect((await currentMemory()).heapLimit).toBeGreaterThan(0);
  });
  it("starts plain node processes with heap limits and a compiled worker", () => {
    const start = readFileSync("scripts/start.sh", "utf8");
    expect(start).toContain('--max-old-space-size="${WEB_HEAP_MB:-180}"');
    expect(start).toContain('--max-old-space-size="${WORKER_HEAP_MB:-200}" build/worker/worker.mjs');
    expect(start).not.toMatch(/\bnpm\b|tsx/);
    expect(readFileSync("scripts/build-worker.mjs", "utf8")).toContain("build/worker/worker.mjs");
    expect(readFileSync("scripts/worker.ts", "utf8")).not.toContain("dotenv");
  });
});

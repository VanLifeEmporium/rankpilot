import { it, expect, vi, beforeAll, afterAll } from "vitest";
const STORE = "demo-r19-10";
vi.mock("../app/core/context.server", async () => {
  const prisma = (await import("../app/db.server")).default;
  return { context: async () => ({ store: await prisma.store.findUniqueOrThrow({ where: { id: "demo-r19-10" } }), actor: "Merchant", admin: null }) };
});
vi.mock("../app/core/security.server", async (orig) => ({ ...(await orig<object>()), requireSameOrigin: () => {} }));
import prisma from "../app/db.server";
import { actionUI } from "../app/core/ui.server";
import { pageSuggestions } from "../app/core/suggestions.server";
import { findingProgress } from "../app/core/finding-workflow";
import { applyChange } from "../app/core/service.server";
import { changeStatus } from "../app/core/workflow-ui";

const post = (values: Record<string, string>) => actionUI(new Request("https://app.example/app/products", { method: "POST", headers: { Origin: "https://app.example" }, body: new URLSearchParams(values) }));
const payload = (over = {}) => JSON.stringify({ title: "Seagrass Basket", handle: "basket", descriptionHtml: "<p>A basket.</p>", seo: { title: "Seagrass Basket | VLE", description: "A basket." }, images: [], collections: [], ...over });
let id = "";
beforeAll(async () => {
  for (const m of ["change", "resource", "event", "job", "audit"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.store.create({ data: { id: STORE, demo: true } });
  id = (await prisma.resource.create({ data: { storeId: STORE, remoteId: "gid://shopify/Product/1", kind: "product", title: "Seagrass Basket", handle: "basket", payload: payload(), keyword: "seagrass storage basket campervan" } })).id;
});
afterAll(async () => {
  for (const m of ["change", "resource", "event", "job", "audit"] as const) await (prisma[m] as unknown as { deleteMany(a: object): Promise<unknown> }).deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
});

it("saving Product details without editing keeps the saved search phrase", async () => {
  const plan = await pageSuggestions(STORE, id);
  expect(plan.currentKeyword).toBe("seagrass storage basket campervan");
  // The form posts what it shows; an empty field (e.g. submitted before the detail loaded) must not wipe it.
  await post({ intent: "facts", id, keyword: "" });
  expect((await prisma.resource.findUniqueOrThrow({ where: { id } })).keyword).toBe("seagrass storage basket campervan");
  await post({ intent: "keyword", id, keyword: "  " });
  expect((await prisma.resource.findUniqueOrThrow({ where: { id } })).keyword).toBe("seagrass storage basket campervan");
  await post({ intent: "keyword", id, keyword: "seagrass basket" });
  expect((await prisma.resource.findUniqueOrThrow({ where: { id } })).keyword).toBe("seagrass basket");
});

it("a changed-outside finding opens the fix dialog (with Keep Shopify's version), not an old review", () => {
  const issue = { resourceId: id, title: "Basket", code: "changed-outside", severity: "warning" as const, detail: "d", feature: "seo" as const, changeId: "c1" };
  const changes = [{ id: "c1", resourceId: id, feature: "seo", status: "applied" }];
  expect(findingProgress(issue, changes, []).changeId).toBeUndefined();
});

it("after an undo or reject the fix dialog can prepare a new proposal", () => {
  const issue = { resourceId: id, title: "Basket", code: "missing-meta-description", severity: "warning" as const, detail: "d", feature: "seo" as const };
  for (const status of ["rolled_back", "rejected", "applied", "superseded"]) {
    const p = findingProgress(issue, [{ id: "c2", resourceId: id, feature: "seo", status }], []);
    expect(p.changeId).toBeUndefined();
    expect(p.canGenerate).toBe(true);
  }
  // A proposal still waiting is opened for review.
  expect(findingProgress(issue, [{ id: "c3", resourceId: id, feature: "seo", status: "pending" }], []).changeId).toBe("c3");
});

it("an undo that would overwrite a newer Shopify edit says Undo failed, in plain English", async () => {
  // RankPilot set the title; then someone edited it in Shopify.
  await prisma.resource.update({ where: { id }, data: { payload: payload({ seo: { title: "Edited in Shopify", description: "A basket." } }) } });
  const c = await prisma.change.create({ data: { storeId: STORE, resourceId: id, feature: "seo", before: JSON.stringify({ title: "Old", description: "A basket." }), after: JSON.stringify({ title: "RankPilot title", description: "A basket." }), status: "applied", appliedAt: new Date() } });
  await expect(applyChange(STORE, c.id, true)).rejects.toThrow(/Conflict/);
  const row = await prisma.change.findUniqueOrThrow({ where: { id: c.id } });
  expect(row.status).toBe("rollback_failed");
  expect(changeStatus(row.status)).toBe("Undo failed");
  expect(row.error).toMatch(/^Undo failed: this page was edited in Shopify/);
  expect(row.error).not.toMatch(/preview/i);
});

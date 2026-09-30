import { it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../app/db.server";
import { mintLink, exchange, agentContext } from "../app/core/agent.server";
import { loader } from "../app/routes/agent";

const STORE = "demo-r19-09";
beforeAll(async () => {
  process.env.SESSION_SECRET = "release-19-test-secret-value";
  process.env.SHOPIFY_APP_URL = "https://rankpilot.example";
  await prisma.store.deleteMany({ where: { id: STORE } });
  await prisma.store.create({ data: { id: STORE, demo: true } });
});
afterAll(async () => {
  await prisma.event.deleteMany({ where: { storeId: STORE } });
  await prisma.webhookReceipt.deleteMany({ where: { storeId: STORE } });
  await prisma.store.deleteMany({ where: { id: STORE } });
});
const tokenOf = (link: string) => new URL(link).searchParams.get("t")!;

it("loads the workspace on the first open from Shopify admin", async () => {
  const link = await mintLink(STORE, "merchant");
  // Opened from admin.shopify.com: a cross-site navigation.
  const first = await loader({ request: new Request(link, { headers: { Referer: "https://admin.shopify.com/" } }), params: {}, context: {} } as never);
  expect(first.status).toBe(200);
  const cookie = first.headers.get("Set-Cookie")!;
  expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("HttpOnly");
  expect(await first.text()).toContain('http-equiv="refresh" content="0;url=/agent"');
  // The follow-up navigation carries the cookie; no "No agent session".
  const session = cookie.split(";")[0];
  const { store } = await agentContext(new Request("https://rankpilot.example/agent", { headers: { Cookie: session } }));
  expect(store.id).toBe(STORE);
});

it("creates exactly one session when two requests open the same link at once", async () => {
  const token = tokenOf(await mintLink(STORE, "merchant"));
  const results = await Promise.allSettled([exchange(token), exchange(token), exchange(token)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected").every((r) => /already been used/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
  await expect(exchange(token)).rejects.toThrow(/already been used/);
});

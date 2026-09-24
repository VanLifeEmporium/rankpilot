import { createCookie, redirect } from "react-router";
import { randomUUID } from "node:crypto";
import prisma from "../db.server";
import { seedDemo } from "./demo.server";
import { defaults } from "./types";
const cookie = createCookie("rankpilot_demo", {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 86400 * 7,
  secure: process.env.SHOPIFY_APP_URL?.startsWith("https:"),
  secrets: [process.env.SESSION_SECRET || "local-demo-only"],
});
export async function context(request: Request) {
  if (process.env.DEMO_MODE === "true") {
    const id = await cookie.parse(request.headers.get("Cookie"));
    if (!id || typeof id !== "string" || !/^demo-[0-9a-f-]{36}$/.test(id)) {
      const shop = `demo-${randomUUID()}`;
      await seedDemo(shop);
      throw redirect(request.url, {
        headers: { "Set-Cookie": await cookie.serialize(shop) },
      });
    }
    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) await seedDemo(id);
    return {
      store: await prisma.store.findUniqueOrThrow({ where: { id } }),
      actor: "Demo reviewer",
      admin: null,
    };
  }
  // Direct document visits have no embedded launch context. API/data requests
  // continue through Shopify authentication rather than receiving landing HTML.
  if (request.method === "GET" && request.headers.get("accept")?.includes("text/html") &&
      !new URL(request.url).pathname.startsWith("/app/export") && !new URL(request.url).searchParams.has("shop") && !request.headers.has("authorization"))
    throw redirect("/");
  const { authenticate } = await import("../shopify.server");
  const { session, admin } = await authenticate.admin(request);
  const store = await prisma.store.upsert({
    where: { id: session.shop },
    create: { id: session.shop, settings: JSON.stringify(defaults) },
    update: { active: true },
  });
  return {
    store,
    actor: String(session.onlineAccessInfo?.associated_user.id || session.id),
    admin,
  };
}

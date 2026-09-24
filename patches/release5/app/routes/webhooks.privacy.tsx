import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic } = await authenticate.webhook(request);
  if (topic === "SHOP_REDACT") {
    await prisma.$transaction([
      prisma.generationCache.deleteMany({where:{storeId:shop}}),
      prisma.session.deleteMany({ where: { shop } }),
      prisma.resource.deleteMany({ where: { storeId: shop } }),
      prisma.audit.deleteMany({ where: { storeId: shop } }),
      prisma.change.deleteMany({ where: { storeId: shop } }),
      prisma.job.deleteMany({ where: { storeId: shop } }),
      prisma.event.deleteMany({ where: { storeId: shop } }),
      prisma.observation.deleteMany({ where: { storeId: shop } }),
      prisma.metric.deleteMany({ where: { storeId: shop } }),
      prisma.report.deleteMany({ where: { storeId: shop } }),
      prisma.webhookReceipt.deleteMany({ where: { storeId: shop } }),
      prisma.store.deleteMany({ where: { id: shop } }),
    ]);
  }
  return new Response(null, { status: 200 });
}

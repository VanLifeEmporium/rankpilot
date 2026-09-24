import prisma from "../db.server";
export const loader = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new Response("ok", { headers: { "Cache-Control": "no-store", "X-RankPilot-Release": "2026-09-24-workflow-1" } });
  } catch {
    return new Response("unhealthy", { status: 503 });
  }
};

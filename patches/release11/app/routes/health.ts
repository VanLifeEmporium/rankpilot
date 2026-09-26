import {workerHealthy} from '../core/worker-health.server';
import prisma from "../db.server";
export const loader = async ({request}: {request:Request}) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    if(new URL(request.url).searchParams.has('worker') && !(await workerHealthy())) return new Response('worker unavailable',{status:503});
    return new Response("ok", { headers: { "Cache-Control": "no-store", "X-RankPilot-Release": "2026-09-26-backlog-11" } });
  } catch {
    return new Response("unhealthy", { status: 503 });
  }
};

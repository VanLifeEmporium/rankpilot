import {workerHealthy} from '../core/worker-health.server';
import prisma from "../db.server";
export const RELEASE_TAG = "2026-09-29-release-17";
export const loader = async ({request}: {request:Request}) => {
  const headers = { "Cache-Control": "no-store", "X-RankPilot-Release": RELEASE_TAG };
  try {
    await prisma.$queryRaw`SELECT 1`;
    if(new URL(request.url).searchParams.has('worker') && !(await workerHealthy())) return new Response('worker unavailable',{status:503,headers});
    return new Response("ok", { headers });
  } catch {
    return new Response("unhealthy", { status: 503, headers });
  }
};

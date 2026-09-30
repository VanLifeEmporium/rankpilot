import {workerHealthy} from '../core/worker-health.server';
import {recordMemory,readMemory,memoryLimitMb,memoryWarning} from '../core/memory.server';
import prisma from "../db.server";
export const RELEASE_TAG = "2026-10-01-release-19";
export const loader = async ({request}: {request:Request}) => {
  const headers = { "Cache-Control": "no-store", "X-RankPilot-Release": RELEASE_TAG, "Content-Type": "application/json" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    if(new URL(request.url).searchParams.has('worker') && !(await workerHealthy())) return new Response(JSON.stringify({status:'worker unavailable',release:RELEASE_TAG}),{status:503,headers});
    // Release 19: memory per process (MB). The worker reports its own figures every few seconds.
    const [web,worker]=await Promise.all([recordMemory('web'),readMemory('worker')]);
    memoryWarning(web,worker);
    return new Response(JSON.stringify({status:'ok',release:RELEASE_TAG,memory:{limitMb:memoryLimitMb(),totalRss:web.rss+(worker?.rss||0),web,worker}}), { headers });
  } catch {
    return new Response(JSON.stringify({status:'unhealthy',release:RELEASE_TAG}), { status: 503, headers });
  }
};

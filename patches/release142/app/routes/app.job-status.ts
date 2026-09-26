import type {LoaderFunctionArgs} from 'react-router';
import {context} from '../core/context.server';
import {visibleJobs} from '../core/jobs.server';
import {workerHealthy} from '../core/worker-health.server';
import {jobRevision} from '../core/job-revision';
import {workspaceRevision} from '../core/live-refresh';
import {indexSummary} from '../core/index-summary';
import prisma from '../db.server';
export async function loader({request}:LoaderFunctionArgs) {
 const {store}=await context(request);
 const jobs=await visibleJobs(store.id);
 const metric=await prisma.metric.findFirst({where:{storeId:store.id,provider:'indexation'},orderBy:{period:'desc'}});
 const indexJobs=jobs.filter(j=>j.kind==='indexation').map(j=>({id:j.id,status:j.status,payload:j.payload}));
 return Response.json({revision:jobRevision(jobs),workspaceRevision:workspaceRevision(jobs),indexJobs,indexation:metric?{...metric,payload:JSON.stringify(indexSummary(metric.payload))}:null,workerHealthy:await workerHealthy()},{headers:{'Cache-Control':'no-store'}});
}

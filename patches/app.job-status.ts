import type {LoaderFunctionArgs} from 'react-router';
import {context} from '../core/context.server';
import {visibleJobs} from '../core/jobs.server';
import {workerHealthy} from '../core/worker-health.server';
import {jobRevision} from '../core/job-revision';
export async function loader({request}:LoaderFunctionArgs) {
 const {store}=await context(request);
 const jobs=await visibleJobs(store.id);
 return Response.json({revision:jobRevision(jobs),workerHealthy:await workerHealthy()},{headers:{'Cache-Control':'no-store'}});
}

// Index inspection progress does not change catalogue content. Only transitions,
// results and other job progress require a complete workspace reload.
import {jobRevision} from './job-revision';
type Job={id:string;kind:string;status:string;payload:string;error?:string|null};
export function workspaceRevision(jobs:Job[]) {
 return jobRevision(jobs.map(j=>j.kind==='indexation' ? {...j,payload:'{}'} : j));
}
export function shareWorkspace<T extends Record<string,unknown>>(previous:T,next:T):T {
 const shared={...next};
 for(const key of Object.keys(next) as (keyof T)[]) {
  if(key==='measuredAt')continue;
  if(previous[key]===next[key] || JSON.stringify(previous[key])===JSON.stringify(next[key])) shared[key]=previous[key];
 }
 return shared;
}

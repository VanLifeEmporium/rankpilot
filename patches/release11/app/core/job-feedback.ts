import {changeStatus} from './workflow-ui';
type Job = {kind:string;status:string;payload:string;error?:string|null};
type Change = {id:string;status:string};
export type JobResult = {resourceId?:string;changeId?:string;message?:string;error?:string};
export function jobResults(job:Job):JobResult[] {
  try {
    const value=JSON.parse(job.payload)?.result;
    if(!Array.isArray(value)) return [];
    return value.filter((r):r is JobResult => r !== null && typeof r === 'object' &&
      ['resourceId','changeId','message','error'].every(k => r[k] === undefined || typeof r[k] === 'string'));
  } catch { return []; }
}
export function resultMessage(result:JobResult,changes:Change[]):string {
  if(result.error) return result.error;
  const change=changes.find(c=>c.id===result.changeId);
  if(change) return ({pending:'Proposal ready for review; not published',approved:'Approved; waiting to apply',applied:'Change applied',rejected:'Proposal rejected; not published',rolled_back:'Change rolled back'} as Record<string,string>)[change.status] || changeStatus(change.status);
  return result.message || 'No result details available';
}
export function jobLabel(job:Job):string {
  if(job.status==='completed' && jobResults(job).some(r=>r.error)) return 'needs attention';
  return job.status;
}
export function jobMessage(job:Job,changes:Change[]=[]):string {
  if(job.kind==='apply') {
    let id='';try{id=JSON.parse(job.payload).changeId;}catch{/* Invalid history falls through. */}
    const change=changes.find(c=>c.id===id);
    if(change?.status==='applied')return 'Done. Your shop has been updated.';
    if(change?.status==='verifying')return 'Checking your saved update automatically. You can keep working.';
    if(change?.status==='verification_failed')return 'We could not confirm this update. Open the change to check its saved result without saving again.';
    if(['queued','running'].includes(job.status))return 'Saving your change…';
  }
  if(job.error && !['queued','running'].includes(job.status)) return job.error;
  const name=job.kind==='audit'?'Audit':job.kind==='optimise'?'Preparing suggestions':job.kind==='apply'?'Application':'Job';
  if(job.status!=='completed') {
    const payload=(()=>{try{return JSON.parse(job.payload);}catch{return {};}})();
    const progress=job.kind==='optimise' && Array.isArray(payload.ids) ? ` ${jobResults(job).length} of ${payload.ids.length} processed.` : '';
    return `${name} ${job.status}…${progress}${job.kind==='optimise'?' Source checks can take up to 40 seconds per text preview; a timeout offers a retry without publishing.':''}`;
  }
  if(job.kind==='audit') return 'Audit completed. Findings updated.';
  const results=jobResults(job);
  if(results.length) return results.map(r=>resultMessage(r,changes)).join('; ');
  if(job.kind==='optimise') return 'Generation finished without readable result details. Check Recent jobs before retrying.';
  return `${name} completed.`;
}

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
  if(change) return ({pending:'Proposal ready for review; not published',approved:'Approved; waiting to apply',applied:'Change applied',rejected:'Proposal rejected; not published',rolled_back:'Change rolled back'} as Record<string,string>)[change.status] || `Change ${change.status}`;
  return result.message || 'No result details available';
}
export function jobLabel(job:Job):string {
  if(job.status==='completed' && job.kind==='optimise' && jobResults(job).some(r=>r.error)) return 'needs attention';
  return job.status;
}
export function jobMessage(job:Job,changes:Change[]=[]):string {
  if(job.error) return job.error;
  const name=job.kind==='audit'?'Audit':job.kind==='optimise'?'Generation':job.kind==='apply'?'Application':'Job';
  if(job.status!=='completed') return `${name} ${job.status}…`;
  if(job.kind==='audit') return 'Audit completed. Findings updated.';
  const results=jobResults(job);
  if(results.length) return results.map(r=>resultMessage(r,changes)).join('; ');
  if(job.kind==='optimise') return 'Generation finished without readable result details. Check Recent jobs before retrying.';
  return `${name} completed.`;
}

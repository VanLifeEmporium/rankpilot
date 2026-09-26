export function providerMessage(error:unknown) {
 const s=error instanceof Error?error.message:String(error);
 if(/abort|timeout|timed out|in time/i.test(s))return 'The service took too long to reply. Try again; no failed request counts as an AI answer.';
 if(/401|403|key|permission|access/i.test(s))return 'The service could not authorise this request. Check its saved key and model access in Settings.';
 if(/429|quota|credit|billing/i.test(s))return 'The service has reached an account or request limit. Check billing and limits in the provider account.';
 if(/incomplete|finish|empty|completed|grounded/i.test(s))return 'The service did not return a complete, usable answer. Try sampling again.';
 return 'The service is temporarily unavailable. Please retry from its section.';
}
type Observation={createdAt:Date|string;cited:boolean;engine?:string};
export function citationMeasure(observations:Observation[],snapshot:{status?:string;startedAt?:string;checkedAt?:string;completed?:number;failed?:number}|undefined,now:number){
 const rows=observations.filter(o=>now-new Date(o.createdAt).getTime()<=28*86400000&&now>=new Date(o.createdAt).getTime());
 const failed=!!snapshot && ['failed','running'].includes(snapshot.status||'') && !snapshot.completed;
 const count=rows.length;const cited=rows.filter(o=>o.cited).length;
 return {score:count&&!failed?100*cited/count:null,count,cited,unavailable:failed,partial:snapshot?.status==='partial',note:failed?'Latest sampling could not complete. Older answers are retained in history; this is not a measured zero.':count?`${snapshot?.status==='partial'?'Partial sampling: some requests were unavailable. ':''}${cited} citations from ${count} successful answers in the last 28 days. Failed requests are excluded.`:'No successful recent answers have been recorded.'};
}

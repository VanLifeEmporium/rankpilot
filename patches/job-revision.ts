export function jobRevision(jobs:{id:string;status:string;payload:string;error?:string|null}[]) {
 return JSON.stringify(jobs.map(j=>{let count=0;try{const result=JSON.parse(j.payload).result;if(Array.isArray(result))count=result.length;}catch{}return [j.id,j.status,count,j.error||''];}));
}

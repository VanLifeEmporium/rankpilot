// Compact change token shared by the loader and lightweight polling endpoint.
// Do not send entire generation results on every poll or refresh for heartbeats.
export function jobRevision(jobs:{id:string;status:string;payload:string;error?:string|null}[]) {
 return JSON.stringify(jobs.map(j=>{
  let fingerprint=0;
  try {
   const result=JSON.parse(j.payload).result;
   if(result!==undefined){const value=JSON.stringify(result);fingerprint=2166136261;for(let i=0;i<value.length;i++)fingerprint=Math.imul(fingerprint^value.charCodeAt(i),16777619)>>>0;}
  }catch{ /* Malformed history does not interrupt polling. */ }
  return [j.id,j.status,fingerprint,j.error||''];
 }));
}

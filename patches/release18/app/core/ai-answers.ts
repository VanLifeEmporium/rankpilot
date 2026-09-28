/** Release 18: per tracked question — how often the store was cited, who was cited instead, and a content gap suggestion. */
export type ObservationRow={engine:string;prompt:string;cited:boolean;mentioned:boolean;competitors:string;createdAt:string|Date};
export function answersBreakdown(observations:ObservationRow[],now:number,days=28){
 const recent=observations.filter(o=>{const age=now-new Date(o.createdAt).getTime();return age>=0&&age<=days*86400000;});
 const byPrompt=new Map<string,ObservationRow[]>();for(const o of recent)byPrompt.set(o.prompt,[...(byPrompt.get(o.prompt)||[]),o]);
 return [...byPrompt].map(([prompt,rows])=>{
  const competitors=new Map<string,number>();
  for(const o of rows){try{for(const c of JSON.parse(o.competitors||'[]'))if(typeof c==='string'&&c.trim())competitors.set(c.trim(),(competitors.get(c.trim())||0)+1);}catch{/* unstructured evidence */}}
  const cited=rows.filter(r=>r.cited).length,mentioned=rows.filter(r=>r.mentioned).length;
  const top=[...competitors].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count}));
  const engines=[...new Set(rows.map(r=>r.engine==='openai'?'ChatGPT':r.engine))];
  const gap=cited?`Cited in ${cited} of ${rows.length} answers. Keep the page that answers this current and specific.`
   :top.length?`Not cited in ${rows.length} answers; ${top[0].name} was cited instead. Publish or expand a page that answers “${prompt}” directly, with confirmed specifications and an FAQ, and link to it from the relevant collection.`
   :`Not cited in ${rows.length} answers and no competitor was named. Publish a page that answers “${prompt}” directly, then check again.`;
  return {prompt,samples:rows.length,cited,mentioned,engines,competitors:top,gap};
 }).sort((a,b)=>a.cited-b.cited||b.samples-a.samples);
}

/**
 * Release 20 (RP-403): learn from rejected proposals. When the merchant keeps rejecting SEO titles
 * that drop the store name suffix, new titles keep it. The rule is shown in Settings and can be reset.
 */
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const titleOf=(v:unknown)=>typeof v==='string'?v:v&&typeof v==='object'?String((v as {title?:string}).title||''):'';
export const hasStore=(title:string,names:string[])=>names.some(n=>n.trim()&&new RegExp(esc(n.trim()),'i').test(title));
/** The proposal removed the store name that the current title had. */
export function suffixRemoved(before:unknown,after:unknown,names:string[]){
 const b=titleOf(before),a=titleOf(after);
 return !!b&&!!a&&hasStore(b,names)&&!hasStore(a,names);
}
export type LearnedRule={key:'keepStoreSuffix';label:string;count:number;since:string};
export const LEARN_AFTER=3;
export function learnRules(rows:{feature:string;status:string;before:string;after:string;updatedAt:Date}[],names:string[],resetAt?:string):LearnedRule[]{
 const since=resetAt?Date.parse(resetAt):0;
 const recent=rows.filter(r=>['seo','title'].includes(r.feature)&&r.updatedAt.getTime()>since);
 const removed=(r:typeof recent[number])=>{try{return suffixRemoved(JSON.parse(r.before),JSON.parse(r.after),names);}catch{return false;}};
 const rejected=recent.filter(r=>r.status==='rejected'&&removed(r));
 const accepted=recent.filter(r=>['applied','approved','applying','verifying'].includes(r.status)&&removed(r)).length;
 if(rejected.length<LEARN_AFTER||rejected.length<=accepted*2)return [];
 const first=rejected.map(r=>r.updatedAt.getTime()).sort((a,b)=>a-b)[0];
 return [{key:'keepStoreSuffix',label:`Keep the store name in SEO titles: you rejected ${rejected.length} titles that removed “${names[0]||'the store name'}”.`,count:rejected.length,since:new Date(first).toISOString().slice(0,10)}];
}
/** Put the store name back with the separator the current title used; null if it would not fit. */
export function restoreSuffix(before:string,after:string,names:string[],max=70){
 const name=names.find(n=>n.trim()&&new RegExp(esc(n.trim()),'i').test(before));if(!name)return after;
 const sep=(before.match(new RegExp(`\\s*([|–—:·-])\\s*${esc(name.trim())}\\s*$`,'i'))||[])[1]||'|';
 const next=`${after.trim()} ${sep} ${name.trim()}`;
 return next.length<=max?next:null;
}
/** Release 20 (RP-403): a generated SEO title must keep the product name as written and separate the store name. */
export function titleProblems(seoTitle:string,productTitle:string,names:string[]){
 const problems:string[]=[];const t=seoTitle.trim();
 for(const n of names.map(x=>x.trim()).filter(Boolean)){
  const m=t.match(new RegExp(`(.*?)(\\s*)${esc(n)}\\s*$`,'i'));
  if(m&&m[1].trim()&&!/[|–—:·-]\s*$/.test(m[1])){problems.push(`Missing separator before “${n}” (use “ | ${n}”)`);break;}
 }
 const fold=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 const name=productTitle.trim();
 if(name&&fold(t).includes(fold(name))&&!t.toLowerCase().includes(name.toLowerCase()))problems.push(`The product name is changed from “${name}”; keep it as written`);
 return problems;
}

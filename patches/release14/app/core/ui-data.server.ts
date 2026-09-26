import {legacyWordCap} from './metadata-quality';
import {validateProposalValue} from "./proposal-value";
import type {Change,Resource} from '@prisma/client';
// Invalid saved data must not crash every page or silently become an approvable edit.
export function jsonObject(value:string):Record<string,unknown>{try{const parsed=JSON.parse(value);return parsed && typeof parsed==='object' && !Array.isArray(parsed)?parsed:{};}catch{return {};}}
export function jsonList(value:string):unknown[]{try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return [];}}
export function displayResource(resource:Resource,includeBody=false){
 const p=jsonObject(resource.payload);
 return {...resource,facts:JSON.stringify(jsonObject(resource.facts)),payload:JSON.stringify({title:resource.title,handle:resource.handle,descriptionHtml:includeBody && typeof p.descriptionHtml==='string'?p.descriptionHtml:'',seo:p.seo && typeof p.seo==='object'?p.seo:{title:'',description:''},images:Array.isArray(p.images)?p.images:[],collections:Array.isArray(p.collections)?p.collections:[],faqs:Array.isArray(p.faqs)?p.faqs:[],faqNamespace:p.faqNamespace,blogHandle:p.blogHandle,blogId:p.blogId,published:p.published,url:p.url,productType:p.productType,tags:p.tags,variants:p.variants,productsCount:p.productsCount,publicationCount:p.publicationCount})};
}
export function displayChange(change:Change){
 let invalid=false;for(const key of ['before','after'] as const){try{JSON.parse(change[key]);}catch{invalid=true;}}
 const reasons=jsonList(change.reasons).filter(r=>typeof r==='string'&&!r.startsWith('Link fix: '));const blockers=jsonList(change.blockers).filter(r=>typeof r==='string');
 if(!invalid && change.status==='pending'){const issue=validateProposalValue(change.feature,JSON.parse(change.after));if(issue)blockers.push(issue);}
 if(legacyWordCap(reasons as string[]))blockers.push('This older preview used a retired word limit. Generate a new content review before accepting.');
 if(reasons.some(r=>String(r).startsWith('source-reviewed-v1: The existing Shopify page title')))blockers.push('This older preview needs a new content review. Generate a replacement before accepting.');
 if(invalid)blockers.push('This saved preview is unreadable. Reject it and generate a replacement.');
 return {...change,before:invalid?'null':change.before,after:invalid?'null':change.after,reasons:JSON.stringify(reasons),blockers:JSON.stringify(blockers)};
}

/** Keep score/impact history, but send only comparable snapshots for heavy analytics. */
export function compactMetrics<T extends {provider:string;period:string;payload:string}>(metrics:T[]):T[]{
 const grouped=new Map<string,T[]>();for(const m of metrics)grouped.set(m.provider,[...(grouped.get(m.provider)||[]),m]);
 return [...grouped].flatMap(([provider,rows])=>{
  if(provider==='change-impact')return rows;
  if(provider==='store-score'){if(rows.length<=91)return rows;const days=new Map<string,T[]>();for(const row of [...rows].sort((a,b)=>a.period.localeCompare(b.period))){const key=row.period.slice(0,10)+':'+String(jsonObject(row.payload).version);const group=days.get(key)||[];days.set(key,group.length?[group[0],row]:[row]);}return [...days.values()].flat().slice(-190);}
  rows.sort((a,b)=>b.period.localeCompare(a.period));const first=rows[0],value=jsonObject(first.payload);
  if(!value.start)return [first];
  const end=new Date(Date.parse(String(value.start))-86400000);if(!Number.isFinite(end.getTime()))return [first];
  const start=new Date(end.getTime()-27*86400000);const period=start.toISOString().slice(0,10)+':'+end.toISOString().slice(0,10);
  const prior=rows.find(r=>r.period===period);return prior?[first,prior]:[first];
 });
}

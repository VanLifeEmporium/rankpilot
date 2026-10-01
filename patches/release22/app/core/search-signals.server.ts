import prisma from '../db.server';
import {normalisePath,resourcePath} from './page-liveness';
import {missingSearchTerms,searchTermIssue,rankByImpressions,type QueryRow} from './search-signals';
import {productBrands,storeNames} from './brand-detect';
import {VOLUME_PRODUCT} from './brand-rules';
import type {Issue,Payload} from './types';
/**
 * Release 20: Search Console signals added to an audit. RP-202 titles missing the brand or model
 * people search for; RP-401 repeated-template pages ranked by impressions.
 */
export async function searchSignalIssues(storeId:string,issues:Issue[]):Promise<Issue[]>{
 const [store,gsc]=await Promise.all([
  prisma.store.findUnique({where:{id:storeId},select:{discoveries:true,settings:true}}),
  prisma.metric.findFirst({where:{storeId,provider:'gsc'},orderBy:{period:'desc'}}),
 ]);
 if(!gsc)return issues;
 let rows:{keys:string[];impressions:number}[]=[];try{rows=JSON.parse(gsc.payload).rows||[];}catch{/* none */}
 const byPath=new Map<string,QueryRow[]>();
 for(const r of rows){const url=r.keys?.[0];if(!url)continue;const k=normalisePath(url);const list=byPath.get(k)||[];list.push({query:r.keys[1]||'',impressions:r.impressions||0});byPath.set(k,list);}
 if(!byPath.size)return issues;
 const names=storeNames(store);
 const out:Issue[]=[];const impressions=new Map<string,number>();const titles=new Map<string,string>();
 // Stream products in pages to keep memory flat on large catalogues.
 for(let cursor:string|undefined;;){
  const page=await prisma.resource.findMany({where:{storeId,kind:'product'},orderBy:{id:'asc'},take:200,...(cursor?{skip:1,cursor:{id:cursor}}:{}),select:{id:true,kind:true,handle:true,title:true,payload:true}});
  if(!page.length)break;cursor=page[page.length-1].id;
  for(const r of page){
   let p:Payload;try{p=JSON.parse(r.payload);}catch{continue;}
   const queries=byPath.get(resourcePath({...r,payload:JSON.stringify({url:p.url})}))||[];
   titles.set(r.id,r.title);impressions.set(r.id,queries.reduce((n,q)=>n+q.impressions,0));
   if(p.published===false||!queries.some(q=>q.query))continue;
   const brands=productBrands(p,names);const hit=missingSearchTerms(p,queries.filter(q=>q.query),brands);
   if(hit)out.push(searchTermIssue(r.id,p,hit,brands,{volume:VOLUME_PRODUCT.test(`${p.productType||''} ${p.title}`)}));
  }
 }
 return [...issues.map(i=>i.code==='repeated-template'?rankByImpressions(i,impressions,titles):i),...out];
}

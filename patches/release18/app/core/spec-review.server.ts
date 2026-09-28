import prisma from '../db.server';
import {extractSpecs,specKeys,type SpecSuggestion} from './spec-extract';
import type {Facts,Payload} from './types';
/**
 * Release 18: specification suggestions for one product. Rules first; the grounded AI pass
 * only looks for fields that are still empty. Suggestions never replace an existing value.
 */
export async function suggestSpecs(storeId:string,p:Payload,existing:Facts,useAi:boolean){
 const empty=(k:string)=>!existing[k]?.value?.trim();
 const found:SpecSuggestion[]=extractSpecs(p.descriptionHtml||'').filter(s=>empty(s.key));
 let aiNote='';
 const missing=specKeys.filter(k=>empty(k)&&!found.some(s=>s.key===k));
 if(useAi&&missing.length){
  try{const {aiSpecProposals}=await import('./generation.server');found.push(...await aiSpecProposals(storeId,p,[...missing]));}
  catch(e){aiNote=e instanceof Error?e.message:'AI reading unavailable.';}
 }
 return {suggestions:found,aiNote};
}
export async function aiAvailable(storeId:string){
 const {credentials}=await import('./security.server');
 return Boolean((await credentials(storeId)).openaiKey);
}
/** Background job: fills empty fields of every product with unconfirmed, sourced suggestions. */
export async function fillSpecsJob(storeId:string,payload:{ai?:boolean;cursor?:number;filled?:number;products?:number},save:(p:object)=>Promise<void>){
 const products=await prisma.resource.findMany({where:{storeId,kind:'product'},orderBy:{id:'asc'},select:{id:true,payload:true,facts:true}});
 const batch=payload.ai?10:1000;let cursor=payload.cursor||0,filled=payload.filled||0,touched=payload.products||0;
 for(const r of products.slice(cursor,cursor+batch)){
  const facts:Facts=JSON.parse(r.facts||'{}');
  const {suggestions}=await suggestSpecs(storeId,JSON.parse(r.payload),facts,!!payload.ai);
  if(suggestions.length){
   // Re-read inside the write so a value typed meanwhile is never replaced.
   await prisma.$transaction(async tx=>{const fresh:Facts=JSON.parse((await tx.resource.findUniqueOrThrow({where:{id:r.id}})).facts||'{}');let n=0;
    for(const s of suggestions)if(!fresh[s.key]?.value?.trim()){fresh[s.key]={value:s.value,source:s.source,confirmed:false};n++;}
    if(n){await tx.resource.update({where:{id:r.id},data:{facts:JSON.stringify(fresh)}});filled+=n;touched++;}});
  }
  cursor++;
  await save({...payload,cursor,filled,products:touched,total:products.length});
 }
 return {done:cursor>=products.length,cursor,filled,products:touched,total:products.length};
}
export type SpecReviewRow={id:string;title:string;facts:{key:string;value:string;source:string}[]};
/** Products with unconfirmed suggestions, for the bulk review list. */
export async function specReviewList(storeId:string):Promise<SpecReviewRow[]>{
 const rows=await prisma.resource.findMany({where:{storeId,kind:'product'},orderBy:{title:'asc'},select:{id:true,title:true,facts:true}});
 return rows.map(r=>{const f:Facts=JSON.parse(r.facts||'{}');return {id:r.id,title:r.title,facts:specKeys.filter(k=>f[k]?.value?.trim()&&!f[k].confirmed).map(k=>({key:k,value:f[k].value,source:f[k].source}))};}).filter(r=>r.facts.length);
}
/** Confirms every unconfirmed suggestion on one product, after the merchant has checked them. */
export async function confirmAllSpecs(storeId:string,id:string,keys?:string[]){
 return prisma.$transaction(async tx=>{
  const r=await tx.resource.findFirstOrThrow({where:{id,storeId,kind:'product'}});const f:Facts=JSON.parse(r.facts||'{}');let n=0;
  for(const k of Object.keys(f))if((!keys||keys.includes(k))&&!f[k].confirmed&&f[k].value?.trim()&&f[k].source?.trim()){f[k]={...f[k],confirmed:true};n++;}
  if(n)await tx.resource.update({where:{id:r.id},data:{facts:JSON.stringify(f)}});
  return n;
 });
}
/** Removes unconfirmed suggestions from one product (confirmed facts are kept). */
export async function discardSpecs(storeId:string,id:string){
 return prisma.$transaction(async tx=>{
  const r=await tx.resource.findFirstOrThrow({where:{id,storeId,kind:'product'}});const f:Facts=JSON.parse(r.facts||'{}');
  const kept=Object.fromEntries(Object.entries(f).filter(([,v])=>v.confirmed));const n=Object.keys(f).length-Object.keys(kept).length;
  if(n)await tx.resource.update({where:{id:r.id},data:{facts:JSON.stringify(kept)}});
  return n;
 });
}
/** Coverage: how many products have at least one suggestion or fact (baseline check before deploy). */
export function specCoverage(products:{payload:string}[]){
 const none=products.filter(p=>!extractSpecs(JSON.parse(p.payload).descriptionHtml||'').length).length;
 return {total:products.length,none,share:products.length?none/products.length:0};
}

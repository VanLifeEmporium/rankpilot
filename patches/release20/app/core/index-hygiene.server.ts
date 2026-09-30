import prisma from '../db.server';
import {livenessIndex,normalisePath} from './page-liveness';
import {deadPageIssue,redirectSuggestion,type DeadPage} from './index-hygiene';
import type {Issue} from './types';
/** Release 20 (RP-302): Search Console pages with impressions that return 404 or are unpublished. */
export async function deadPagesWithImpressions(storeId:string,opts:{confirm?:(url:string)=>Promise<number|null>}={}):Promise<Issue[]>{
 const [store,gsc,resources,idx]=await Promise.all([
  prisma.store.findUnique({where:{id:storeId},select:{discoveries:true}}),
  prisma.metric.findFirst({where:{storeId,provider:'gsc'},orderBy:{period:'desc'}}),
  prisma.resource.findMany({where:{storeId,kind:{in:['product','collection','page','article']}},select:{id:true,kind:true,handle:true,title:true,payload:true}}),
  prisma.metric.findFirst({where:{storeId,provider:'indexation'},orderBy:{period:'desc'}}),
 ]);
 if(!gsc)return [];
 const slim=resources.map(r=>{let p:Record<string,unknown>={};try{p=JSON.parse(r.payload);}catch{/* empty */}return {...r,payload:JSON.stringify({url:p.url,published:p.published,blogHandle:p.blogHandle}),productType:String(p.productType||'')};});
 const pages=(()=>{try{return JSON.parse(store?.discoveries||'{}').pages||[];}catch{return [];}})();
 const rows0=(()=>{try{return idx?JSON.parse(idx.payload).rows||[]:[];}catch{return [];}})();
 const live=livenessIndex(slim,pages,rows0);
 let rows:{keys:string[];impressions:number}[]=[];try{rows=JSON.parse(gsc.payload).rows||[];}catch{/* none */}
 const byPage=new Map<string,{url:string;impressions:number;queries:Map<string,number>}>();
 for(const r of rows){const url=r.keys?.[0];if(!url||!/^\/(products|collections|blogs|pages)\//.test(normalisePath(url)))continue;const key=normalisePath(url);const e=byPage.get(key)||{url,impressions:0,queries:new Map()};e.impressions+=r.impressions||0;if(r.keys[1])e.queries.set(r.keys[1],(e.queries.get(r.keys[1])||0)+(r.impressions||0));byPage.set(key,e);}
 const candidates=slim.filter(r=>live(JSON.parse(r.payload).url||`/${r.kind}s/${r.handle}`).live);
 const out:Issue[]=[];let confirmed=0;
 for(const e of [...byPage.values()].filter(e=>e.impressions>0).sort((a,b)=>b.impressions-a.impressions)){
  const state=live(e.url);if(state.live)continue;
  let reason:DeadPage['reason']|null=state.reason==='unpublished'?'unpublished':state.reason==='not-found'?'not-found':null;
  // A page RankPilot does not know may just be missing from the sync: confirm it really returns 404.
  if(state.reason==='not-in-store'&&opts.confirm&&confirmed<40){confirmed++;const code=await opts.confirm(e.url).catch(()=>null);if(code===404||code===410)reason='not-found';}
  if(!reason)continue;
  const own=state.resourceId?slim.find(r=>r.id===state.resourceId):undefined;
  const dead:DeadPage={url:e.url,impressions:e.impressions,queries:[...e.queries].sort((a,b)=>b[1]-a[1]).map(([q])=>q).slice(0,5),reason,resourceId:state.resourceId,productType:own?.productType};
  out.push(deadPageIssue(dead,redirectSuggestion(dead,candidates)));
 }
 return out;
}

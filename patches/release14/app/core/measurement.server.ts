import prisma from '../db.server';
import {auditCatalogue} from './catalogue';
import {storeScore,observedPage} from './store-score';
import {metricPair} from './analytics';
export async function recordScore(storeId:string){
 const [audit,resources,observations,metrics,store]=await Promise.all([prisma.audit.findFirst({where:{storeId},orderBy:{createdAt:'desc'}}),prisma.resource.findMany({where:{storeId}}),prisma.observation.findMany({where:{storeId,createdAt:{gte:new Date(Date.now()-28*86400000)}}}),Promise.all(['gsc','ga4-organic-daily','ai-sampling','pagespeed','indexation'].map(provider=>prisma.metric.findFirst({where:{storeId,provider},orderBy:{period:'desc'}}))).then(xs=>xs.filter(x=>x!==null)),prisma.store.findUniqueOrThrow({where:{id:storeId}})]);
 if(!audit)return;
 const healthScores=Object.fromEntries(['product','collection','article'].map(kind=>{const rows=resources.filter(r=>r.kind===kind);return [kind,rows.length?{score:auditCatalogue(rows).score}:null];}));
 const value=storeScore({metrics,technical:audit.score,schemas:JSON.parse(store.discoveries||'{}').schemas,healthScores,observations,now:Date.now()});
 const period=new Date().toISOString();
 const payload=JSON.stringify({...value,checkedAt:new Date().toISOString(),appliedCount:await prisma.change.count({where:{storeId,status:'applied'}})});
 await prisma.metric.upsert({where:{storeId_provider_period:{storeId,provider:'store-score',period}},create:{storeId,provider:'store-score',period,payload},update:{payload}});
}
export async function recordImpact(storeId:string,changeId:string){
 const change=await prisma.change.findFirstOrThrow({where:{id:changeId,storeId}});
 const [resource,gsc,audit]=await Promise.all([prisma.resource.findFirst({where:{storeId,id:change.resourceId}}),prisma.metric.findFirst({where:{storeId,provider:'gsc'},orderBy:{period:'desc'}}),prisma.audit.findFirst({where:{storeId},orderBy:{createdAt:'desc'}})]);
 const p=resource?JSON.parse(resource.payload):{};const url=p.url || (resource?`/${resource.kind==='article'?'blogs/'+p.blogHandle:resource.kind+'s'}/${resource.handle}`:JSON.parse(change.before)?.path);
 const snapshot=gsc?metricPair([gsc],'gsc')[0]:null;
 const payload=JSON.stringify({recordedAt:new Date().toISOString(),resourceId:change.resourceId,url,feature:change.feature,target:change.feature==='redirect'||change.feature==='links'?'Working links, then page impressions and clicks':'Page impressions, clicks and click rate',before:observedPage(snapshot?.rows,url||''),start:snapshot?.start,end:snapshot?.end,checksBefore:audit?JSON.parse(audit.issues).filter((i:{resourceId:string})=>i.resourceId===change.resourceId).length:null});
 await prisma.metric.upsert({where:{storeId_provider_period:{storeId,provider:'change-impact',period:changeId}},create:{storeId,provider:'change-impact',period:changeId,payload},update:{}});
}

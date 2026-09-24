import {beforeEach,afterAll,it,expect,vi} from 'vitest';
const remote=vi.hoisted(()=>({node:{} as RemoteNode,reads:0,writes:0,discard:false,reject:false}));
vi.mock('../app/shopify.server',()=>({authenticate:{admin:async()=>{throw new Response('Authentication required',{status:401});}},unauthenticated:{admin:async()=>({admin:{graphql:async(query:string,options:{variables?:{input?:Partial<RemoteNode> & {image?:{altText?:string}},metafields?:{key:string;value:string}[],files?:{id:string;alt:string}[]}})=>{
 const vars=options?.variables||{};
 if(query.startsWith('query Resource')){remote.reads++;return Response.json({data:{node:remote.node}});}
 remote.writes++;
 if(remote.reject)return Response.json({data:{update:{userErrors:[{message:'Access denied'}]}}});
 if(!remote.discard){
  if(vars.input)Object.assign(remote.node,vars.input);
  if(vars.metafields)for(const f of vars.metafields){
   if(f.key==='title_tag') remote.node.seoTitle={value:f.value};
   if(f.key==='description_tag') remote.node.seoDescription={value:f.value};
   if(f.key==='faqs')remote.node.faq={jsonValue:JSON.parse(f.value),namespace:'test'};
  }
  if(vars.files)for(const f of vars.files){const img=remote.node.media?.nodes.find(n=>n.id===f.id);if(img)img.alt=f.alt;}
  if(vars.input?.image?.altText){remote.node.image={...remote.node.image,url:'https://cdn.shopify.com/test.jpg',id:'featured',altText:vars.input.image.altText};}
 }
 return Response.json({data:{update:{userErrors:[]}}});
}}})}}));
vi.mock('../app/core/crawl.server',async(importOriginal)=>({...await importOriginal<typeof import('../app/core/crawl.server')>(),crawlStore:async()=>({issues:[],discoveries:{scanned:0,errors:[]}})}));
vi.mock('../app/core/generation.server',async(importOriginal)=>({...await importOriginal<typeof import('../app/core/generation.server')>(),generateCopy:vi.fn(async(_s:string,p:Payload,_k:string,feature:string)=>({before:feature==='seo'?p.seo:p.descriptionHtml,after:feature==='seo'?{title:'Camping mug',description:'A camping mug with a 350 ml capacity.'}:'<p>A camping mug with a 350 ml capacity.</p>',blockers:[],reasons:['source-reviewed-v1: fixture']})),generateAlts:vi.fn(async(_s:string,p:Payload)=>({before:p.images.map(({id,alt})=>({id,alt})),after:p.images.map(({id})=>({id,alt:'A white camping mug.'})),blockers:[],reasons:['image-reviewed-v1: fixture']}))}));
import prisma from '../app/db.server';
import type {Payload} from '../app/core/types';
import type {RemoteNode} from '../app/core/shopify-api.server';
import {normalise} from '../app/core/shopify-api.server';
import {enqueueGeneration,executeJob,assertSafeCopy,proposeRedirect,weeklyReport} from '../app/core/service.server';
import {generateCopy} from '../app/core/generation.server';
const storeId='audit-reproductions';
beforeEach(async()=>{
 for(const model of ['resource','audit','change','job','event'] as const)await (prisma[model] as unknown as {deleteMany(args:{where:{storeId:string|{in:string[]}}}):Promise<unknown>}).deleteMany({where:{storeId}});
 await prisma.store.upsert({where:{id:storeId},create:{id:storeId,demo:false,domain:'https://example.com'},update:{demo:false,settings:"{}",active:true}});
 remote.node={id:'gid://shopify/Product/1',title:'Camping mug',handle:'camping-mug',descriptionHtml:'<p>Camping mug. Capacity 350 ml.</p>',seo:{title:'',description:''},media:{nodes:[{id:'image1',alt:'',image:{url:'https://cdn.shopify.com/test.jpg'}}],pageInfo:{hasNextPage:false}},variants:{nodes:[],pageInfo:{hasNextPage:false}},collections:{nodes:[]}};
 remote.reads=0;remote.writes=0;remote.discard=false;remote.reject=false;vi.mocked(generateCopy).mockClear();
});
afterAll(async()=>{for(const model of ['resource','audit','change','job','event'] as const)await (prisma[model] as unknown as {deleteMany(args:{where:{storeId:string|{in:string[]}}}):Promise<unknown>}).deleteMany({where:{storeId}});await prisma.store.deleteMany({where:{id:storeId}});await prisma.$disconnect();});
async function resource(kind='product'){
 if(['article','page'].includes(kind)){
  delete remote.node.seo;remote.node.body=remote.node.descriptionHtml;delete remote.node.descriptionHtml;delete remote.node.media;
  if(kind==='article')remote.node.image={id:'featured',url:'https://cdn.shopify.com/test.jpg',altText:''};
 }
 if(kind==='collection'){delete remote.node.media;remote.node.image={id:'featured',url:'https://cdn.shopify.com/test.jpg',altText:''};}
 remote.node.id=`gid://shopify/${kind[0].toUpperCase()+kind.slice(1)}/1`;
 const p=normalise(remote.node,kind);
 return prisma.resource.create({data:{storeId,remoteId:remote.node.id,kind,title:p.title,handle:p.handle,payload:JSON.stringify(p),facts:JSON.stringify({included:{value:'One mug',source:'Supplier listing',confirmed:true}})}});
}

import {repairPendingTitles} from '../app/core/proposal-repair.server';
import {jobMessage} from '../app/core/job-feedback';
it('AUD-01: repairing a title does not trust an unreviewed description',async()=>{
 const r=await resource();
 const before={title:'Camping mug',description:'Original verified description'};
 const after={title:'This proposed camping mug title has too many words',description:'Unsupported replacement claim'};
 expect(()=>assertSafeCopy('seo',before,{...after,title:'Camping mug'},[])).toThrow();
 const c=await prisma.change.create({data:{storeId,resourceId:r.id,feature:'seo',before:JSON.stringify(before),after:JSON.stringify(after),reasons:'[]'}});
 await repairPendingTitles(storeId);
 const repaired=await prisma.change.findUniqueOrThrow({where:{id:c.id}});
 expect(JSON.parse(repaired.after).description).toBe('Unsupported replacement claim');
 expect(()=>assertSafeCopy('seo',before,JSON.parse(repaired.after),JSON.parse(repaired.reasons))).toThrow();
});
it('AUD-02: rejected proposals can be regenerated from Products',async()=>{
 const r=await resource();const a=await enqueueGeneration(storeId,[r.id],'seo');const results=await executeJob(a) as {changeId:string}[];
 await prisma.job.update({where:{id:a.id},data:{status:'completed',payload:JSON.stringify({ids:[r.id],feature:'seo',result:results})}});
 await prisma.change.update({where:{id:results[0].changeId},data:{status:'rejected'}});
 const b=await enqueueGeneration(storeId,[r.id],'seo');expect(b.id).toBe(a.id);expect(b.status).toBe('queued');expect(generateCopy).toHaveBeenCalledTimes(1);
});
it('AUD-03: changed delivery policy changes FAQ generation identity',async()=>{
 const r=await resource();const a=await enqueueGeneration(storeId,[r.id],'faq');
 await prisma.job.update({where:{id:a.id},data:{status:'completed'}});
 await prisma.store.update({where:{id:storeId},data:{settings:JSON.stringify({policies:{delivery:'New policy',source:'Store policy',returns:''}})}});
 const b=await enqueueGeneration(storeId,[r.id],'faq');expect(b.id).not.toBe(a.id);expect(b.status).toBe('queued');
});
it('AUD-04: redirect proposals replace an obsolete destination',async()=>{
 await prisma.store.update({where:{id:storeId},data:{demo:true}});
 for(const handle of ['target-a','target-b'])await prisma.resource.create({data:{storeId,remoteId:handle,kind:'collection',title:handle,handle,payload:'{}'}});
 const a=await proposeRedirect(storeId,'/collections/old','/collections/target-a');
 const b=await proposeRedirect(storeId,'/collections/old','/collections/target-b');
 expect(b.id).not.toBe(a.id);expect(JSON.parse(b.after).target).toBe('/collections/target-b');expect((await prisma.change.findUniqueOrThrow({where:{id:a.id}})).status).toBe('superseded');
});
it('AUD-05: queued retries do not present the previous error as current',()=>{
 expect(jobMessage({kind:'apply',status:'queued',payload:'{}',error:'Previous failure'})).not.toContain('Previous failure');
});
import {context} from '../app/core/context.server';
import {optimise} from '../app/core/catalogue';
import {defaults} from '../app/core/types';
it('AUD-06: exports require authentication instead of redirecting to landing',async()=>{
 const old=process.env.DEMO_MODE;process.env.DEMO_MODE='false';
 try{await context(new Request('https://app.example/app/export?type=changes',{headers:{accept:'text/html,application/xhtml+xml'}}));throw new Error('Unexpected success');}
 catch(e){expect(e).toBeInstanceOf(Response);expect((e as Response).status).toBe(401);expect((e as Response).headers.get('Location')).toBeNull();}
 finally{process.env.DEMO_MODE=old;}
});
it('AUD-07: regenerating links preserves a single related block',async()=>{
 const r=await resource();const p=JSON.parse(r.payload);const related=[{title:'Other mug',url:'/products/other'}];
 const first=optimise(p,'product','links',{},'',defaults,related);
 const second=optimise({...p,descriptionHtml:first.after},'product','links',{},'',defaults,related);
 expect(String(second.after).match(/Explore related kit/g)).toHaveLength(1);
});
it('AUD-08: reports separate rolled-back changes from active improvements',async()=>{
 const r=await resource();await prisma.change.create({data:{storeId,resourceId:r.id,feature:'title',before:'"A"',after:'"B"',status:'rolled_back',appliedAt:new Date()}});
 const report=await weeklyReport(storeId);expect(report.markdown).toContain('0 changes remain applied');expect(report.markdown).toContain('rolled_back');
 await prisma.report.delete({where:{id:report.id}});
});

import {beforeEach,afterAll,it,expect,vi} from 'vitest';
const remote=vi.hoisted(()=>({node:{} as RemoteNode,reads:0,writes:0,staleReads:0,previousSeo:null as RemoteNode["seo"]|null,delay:0,discard:false,reject:false}));
vi.mock('../app/shopify.server',()=>({unauthenticated:{admin:async()=>({admin:{graphql:async(query:string,options:{variables?:{input?:Partial<RemoteNode> & {image?:{altText?:string}},metafields?:{key:string;value:string}[],files?:{id:string;alt:string}[]}})=>{
 const vars=options?.variables||{};
 if(remote.delay)await new Promise(resolve=>setTimeout(resolve,remote.delay));
 if(query.startsWith('query Resource')){remote.reads++;if(remote.writes && remote.staleReads>0){remote.staleReads--;return Response.json({data:{node:{...remote.node,seo:remote.previousSeo}}});}return Response.json({data:{node:remote.node}});}
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
import {audit,propose,approve,applyChange,verifyChange,enqueueGeneration,executeJob,tick} from '../app/core/service.server';
import {generateCopy} from '../app/core/generation.server';
const storeId='workflow-integration';
beforeEach(async()=>{
 for(const model of ['resource','audit','change','job','event'] as const)await (prisma[model] as unknown as {deleteMany(args:{where:{storeId:string|{in:string[]}}}):Promise<unknown>}).deleteMany({where:{storeId}});
 await prisma.store.upsert({where:{id:storeId},create:{id:storeId,demo:false,domain:'https://example.com'},update:{}});
 remote.node={id:'gid://shopify/Product/1',title:'Camping mug',handle:'camping-mug',descriptionHtml:'<p>Camping mug. Capacity 350 ml.</p>',seo:{title:'',description:''},media:{nodes:[{id:'image1',alt:'',image:{url:'https://cdn.shopify.com/test.jpg'}}],pageInfo:{hasNextPage:false}},variants:{nodes:[],pageInfo:{hasNextPage:false}},collections:{nodes:[]}};
 remote.reads=0;remote.writes=0;remote.staleReads=0;remote.previousSeo=null;remote.delay=0;remote.discard=false;remote.reject=false;vi.mocked(generateCopy).mockClear();
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
it.each(['product','collection','page','article'])('audits, previews, accepts, writes, reads back and clears metadata findings for %s',async kind=>{
 const r=await resource(kind);await audit(storeId);
 const c=await propose(storeId,r.id,'seo');expect(c?.status).toBe('pending');expect(remote.writes).toBe(0);
 const reused=await propose(storeId,r.id,'seo');expect(reused?.id).toBe(c?.id);expect(generateCopy).toHaveBeenCalledTimes(1);
 await approve(storeId,c!.id,'test-owner');await applyChange(storeId,c!.id);
 expect(remote.writes).toBe(1);expect(remote.reads).toBe(2);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
 const checked=await prisma.audit.findFirstOrThrow({where:{storeId}});
 expect(JSON.parse(checked.issues).some((i:{code:string})=>i.code.startsWith('missing-meta'))).toBe(false);
 await applyChange(storeId,c!.id);expect(remote.writes).toBe(1);
 await applyChange(storeId,c!.id,true);expect(remote.writes).toBe(2);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('rolled_back');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:{code:string})=>i.code==='missing-meta-title')).toBe(true);
});
it.each(['product','collection','article'])('verifies image alt application for %s',async kind=>{
 const r=await resource(kind);await audit(storeId);const c=await propose(storeId,r.id,'alt');
 await approve(storeId,c!.id,'test-owner');await applyChange(storeId,c!.id);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:{code:string})=>i.code==='missing-alt')).toBe(false);
});
it('does not write a rejected preview',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await prisma.change.update({where:{id:c!.id},data:{status:'rejected'}});
 await expect(approve(storeId,c!.id,'test-owner')).rejects.toThrow('no longer');await applyChange(storeId,c!.id);expect(remote.writes).toBe(0);
});
it('keeps the finding open when Shopify accepts the mutation but returns the old value',async()=>{
 const r=await resource();await audit(storeId);const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');remote.discard=true;
 await expect(applyChange(storeId,c!.id)).rejects.toThrow('Verification failed');
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('verification_failed');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:{code:string})=>i.code==='missing-meta-title')).toBe(true);
 remote.discard=false;await applyChange(storeId,c!.id);expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
});
it('refuses newer Shopify edits after a preview',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');remote.node.seo!.title='Owner edit';
 await expect(applyChange(storeId,c!.id)).rejects.toThrow('Conflict');expect(remote.writes).toBe(0);
});
it('surfaces Shopify write errors without marking the change applied',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');remote.reject=true;
 await expect(applyChange(storeId,c!.id)).rejects.toThrow('Access denied');expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).not.toBe('applied');
});
it('reuses a queued job after repeated clicks and only regenerates a completed job explicitly',async()=>{
 const r=await resource();const a=await enqueueGeneration(storeId,[r.id],'seo');const b=await enqueueGeneration(storeId,[r.id],'seo');expect(a.id).toBe(b.id);
 const results=await executeJob(a);await prisma.job.update({where:{id:a.id},data:{status:'completed',payload:JSON.stringify({ids:[r.id],feature:'seo',result:results})}});
 const existing=await enqueueGeneration(storeId,[r.id],'seo');expect(existing.status).toBe('completed');expect(generateCopy).toHaveBeenCalledTimes(1);
});
it('generates confirmed product FAQs without AI and verifies the written values',async()=>{
 const r=await resource();await audit(storeId);const c=await propose(storeId,r.id,'faq');await approve(storeId,c!.id,'test-owner');await applyChange(storeId,c!.id);
 expect(generateCopy).not.toHaveBeenCalled();expect(remote.node.faq!.jsonValue![0].answer).toBe('One mug');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:{code:string})=>i.code==='missing-product-faq')).toBe(false);
});
it.each(['product','collection','page','article'])('verifies a body update and rollback for %s',async kind=>{
 const r=await resource(kind);const original=JSON.parse(r.payload).descriptionHtml;
 const c=await propose(storeId,r.id,'description');await approve(storeId,c!.id,'test-owner');await applyChange(storeId,c!.id);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
 expect(JSON.parse((await prisma.resource.findUniqueOrThrow({where:{id:r.id}})).payload).descriptionHtml).toContain('350 ml capacity');
 await applyChange(storeId,c!.id,true);expect(JSON.parse((await prisma.resource.findUniqueOrThrow({where:{id:r.id}})).payload).descriptionHtml).toBe(original);
});
it('verifies inline page image alt text through a page body write',async()=>{
 const r=await resource('page');remote.node.body='<p>Camping mug</p><img src="https://cdn.shopify.com/a.jpg">';
 await prisma.resource.update({where:{id:r.id},data:{payload:JSON.stringify(normalise(remote.node,'page'))}});
 await audit(storeId);const c=await propose(storeId,r.id,'alt');await approve(storeId,c!.id,'test-owner');await applyChange(storeId,c!.id);
 expect(remote.node.body).toContain('alt="A white camping mug."');expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
});

it('resumes completed generation results without another provider call',async()=>{
 const r=await resource();const job=await enqueueGeneration(storeId,[r.id],'seo');
 const first=await executeJob(job);const saved=await prisma.job.findUniqueOrThrow({where:{id:job.id}});
 expect(JSON.parse(saved.payload).result).toEqual(first);
 expect(await executeJob(saved)).toEqual(first);expect(generateCopy).toHaveBeenCalledTimes(1);
});
it('moves an exhausted queue entry to a visible terminal failure',async()=>{
 const r=await resource();const job=await enqueueGeneration(storeId,[r.id],'seo');
 await prisma.job.update({where:{id:job.id},data:{attempts:5,status:'queued'}});
 await tick();const saved=await prisma.job.findUniqueOrThrow({where:{id:job.id}});
 expect(saved.status).toBe('failed');expect(saved.error).toContain('interruptions');expect(generateCopy).not.toHaveBeenCalled();
});
it('applies an accepted change ahead of older generation work',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');
 const generation=await enqueueGeneration(storeId,[r.id],'description');
 await approve(storeId,c!.id,'test-owner');const queuedBefore=await prisma.job.findMany({where:{status:'queued'},select:{id:true,storeId:true,kind:true,runAt:true}});await tick();
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status,JSON.stringify(queuedBefore)).toBe('applied');
 expect((await prisma.job.findUniqueOrThrow({where:{id:generation.id}})).status).toBe('queued');
});
it('yields generation after one resource and persists progress',async()=>{
 const r=await resource();const second=await prisma.resource.create({data:{storeId,remoteId:'second',kind:'product',title:'Second mug',handle:'second',payload:r.payload,facts:r.facts}});
 const job=await enqueueGeneration(storeId,[r.id,second.id],'seo');await tick();
 const halfway=await prisma.job.findUniqueOrThrow({where:{id:job.id}});
 expect(halfway.status).toBe('queued');expect(JSON.parse(halfway.payload).result).toHaveLength(1);
 await tick();const finished=await prisma.job.findUniqueOrThrow({where:{id:job.id}});
 expect(finished.status).toBe('completed');expect(JSON.parse(finished.payload).result).toHaveLength(2);expect(generateCopy).toHaveBeenCalledTimes(2);
});

it('applies and verifies an accepted item within five seconds while generation is blocked',async()=>{
 const r=await resource();const proposal=await propose(storeId,r.id,'seo');
 let release!:()=>void;let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const block=new Promise<void>(resolve=>{release=resolve;});
 vi.mocked(generateCopy).mockImplementationOnce(async(_s:string,p:Payload)=>{entered();await block;return {before:p.descriptionHtml,after:'<p>A compact camping mug, 350 ml.</p>',blockers:[],reasons:['source-reviewed-v1: fixture']};});
 await enqueueGeneration(storeId,[r.id],'description');const background=tick({lane:'background'});await started;
 try{
  remote.delay=350;const start=performance.now();await approve(storeId,proposal!.id,'owner');await tick({lane:'apply'});
  const elapsed=performance.now()-start;
  expect((await prisma.change.findUniqueOrThrow({where:{id:proposal!.id}})).status).toBe('applied');
  expect(elapsed).toBeLessThan(5000);expect(remote.writes).toBe(1);expect(remote.reads).toBe(2);
  console.info(`Approval-to-verified fixture timing: ${Math.round(elapsed)} ms (mock Shopify, 350 ms per API response; background generation blocked)`);
 }finally{release();await background;}
});
it('prevents two accepted changes to the same resource running concurrently',async()=>{
 const r=await resource();const first=await propose(storeId,r.id,'seo');const second=await propose(storeId,r.id,'alt');
 await approve(storeId,first!.id,'owner');await expect(approve(storeId,second!.id,'owner')).rejects.toThrow('Another update');expect(remote.writes).toBe(0);
 await applyChange(storeId,first!.id);await approve(storeId,second!.id,'owner');await applyChange(storeId,second!.id);expect(remote.writes).toBe(2);
});
it('includes old active jobs even after more than a thousand newer completions',async()=>{
 const {visibleJobs}=await import('../app/core/jobs.server');
 await prisma.job.create({data:{id:'older-active-job',dedup:'older-active-job',storeId,kind:'optimise',createdAt:new Date(0)}});
 await prisma.job.createMany({data:Array.from({length:1001},(_,i)=>({storeId,dedup:`history-${i}`,kind:'report',status:'completed',createdAt:new Date(1000+i)}))});
 const jobs=await visibleJobs(storeId);expect(jobs.some(j=>j.id==='older-active-job')).toBe(true);expect(jobs.length).toBeLessThanOrEqual(51);
});
it('does not trust the historical title repair marker as a review of the description',async()=>{
 const {assertSafeCopy}=await import('../app/core/service.server');
 expect(()=>assertSafeCopy('seo',{title:'Camping mug',description:'Verified old copy'},{title:'Camping mug',description:'Unreviewed claim'},['source-reviewed-v1: The existing Shopify page title is reused verbatim. The proposed meta description is unchanged.'])).toThrow('Reject');
});
it('replaces a blocked legacy draft with a reviewed proposal that can be accepted and applied',async()=>{
 remote.node.seo={title:'Camping mug',description:'Existing verified summary.'};
 const r=await resource();const old=await propose(storeId,r.id,'seo');
 await prisma.change.update({where:{id:old!.id},data:{reasons:JSON.stringify(['source-reviewed-v1: The existing Shopify page title is reused verbatim. The proposed meta description is unchanged.'])}});
 const {displayChange}=await import('../app/core/ui-data.server');
 const shown=displayChange(await prisma.change.findUniqueOrThrow({where:{id:old!.id}}));
 expect(JSON.parse(shown.blockers).join(' ')).toContain('new content review');
 await expect(approve(storeId,old!.id,'owner')).rejects.toThrow();expect(remote.writes).toBe(0);
 const job=await enqueueGeneration(storeId,[r.id],'seo',true);await tick({lane:'background'});
 const finished=await prisma.job.findUniqueOrThrow({where:{id:job.id}});
 const nextId=JSON.parse(finished.payload).result[0].changeId;
 expect(nextId).toBeTruthy();expect(nextId).not.toBe(old!.id);
 const next=displayChange(await prisma.change.findUniqueOrThrow({where:{id:nextId}}));
 expect(JSON.parse(next.blockers)).toEqual([]);
 await approve(storeId,nextId,'owner');await tick({lane:'apply'});
 expect((await prisma.change.findUniqueOrThrow({where:{id:nextId}})).status).toBe('applied');
 expect(remote.writes).toBe(1);
});
it('retries a failed generation from Products when the user explicitly requests generation again',async()=>{
 const r=await resource();const job=await enqueueGeneration(storeId,[r.id],'seo');
 await prisma.job.update({where:{id:job.id},data:{status:'completed',payload:JSON.stringify({ids:[r.id],feature:'seo',result:[{error:'Provider unavailable'}]})}});
 const retry=await enqueueGeneration(storeId,[r.id],'seo');expect(retry.id).toBe(job.id);expect(retry.status).toBe('queued');expect(JSON.parse(retry.payload).result).toBeUndefined();expect(generateCopy).not.toHaveBeenCalled();
});

it('reconciles a successful save previously marked as conflict without rewriting Shopify',async()=>{
 const r=await resource();await audit(storeId);const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');
 remote.node.seo=JSON.parse(c!.after);
 await prisma.change.update({where:{id:c!.id},data:{status:'conflict',error:'old verification failure'}});
 expect((await verifyChange(storeId,c!.id)).ok).toBe(true);expect(remote.writes).toBe(0);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
 expect(await prisma.change.count({where:{storeId,status:'applied'}})).toBe(1);
 expect((await verifyChange(storeId,c!.id)).ok).toBe(true);expect(await prisma.change.count({where:{storeId,status:'applied'}})).toBe(1);
});
it('live verification does not write or claim success for a genuine mismatch',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');
 remote.node.seo={title:'Owner title',description:'Owner description'};
 expect((await verifyChange(storeId,c!.id)).ok).toBe(false);expect(remote.writes).toBe(0);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).not.toBe('applied');
});
it('retains an obsolete preview if replacement generation fails',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');
 await prisma.change.update({where:{id:c!.id},data:{reasons:'[]'}});
 vi.mocked(generateCopy).mockRejectedValueOnce(new Error('Provider unavailable'));
 await expect(propose(storeId,r.id,'seo')).rejects.toThrow('Provider unavailable');
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('pending');
});

it('retries stale read-back without issuing a second mutation',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');
 remote.previousSeo={...remote.node.seo};remote.staleReads=1;
 await applyChange(storeId,c!.id);
 expect(remote.writes).toBe(1);expect(remote.reads).toBe(3);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
});

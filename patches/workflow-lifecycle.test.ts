import {beforeEach,afterAll,it,expect,vi} from 'vitest';
const remote=vi.hoisted(()=>({node:{} as any,reads:0,writes:0,discard:false,reject:false}));
vi.mock('../app/shopify.server',()=>({unauthenticated:{admin:async()=>({admin:{graphql:async(query:string,options:any)=>{
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
  if(vars.files)for(const f of vars.files){const img=remote.node.media?.nodes.find((n:any)=>n.id===f.id);if(img)img.alt=f.alt;}
  if(vars.input?.image?.altText){remote.node.image={...remote.node.image,url:'https://cdn.shopify.com/test.jpg',id:'featured',altText:vars.input.image.altText};}
 }
 return Response.json({data:{update:{userErrors:[]}}});
}}})}}));
vi.mock('../app/core/crawl.server',async(importOriginal)=>({...await importOriginal<any>(),crawlStore:async()=>({issues:[],discoveries:{scanned:0,errors:[]}})}));
vi.mock('../app/core/generation.server',async(importOriginal)=>({...await importOriginal<any>(),generateCopy:vi.fn(async(_s,p,_k,feature)=>({before:feature==='seo'?p.seo:p.descriptionHtml,after:feature==='seo'?{title:'Camping mug',description:'A camping mug with a 350 ml capacity.'}:'<p>A camping mug with a 350 ml capacity.</p>',blockers:[],reasons:['source-reviewed-v1: fixture']})),generateAlts:vi.fn(async(_s,p)=>({before:p.images.map(({id,alt}:any)=>({id,alt})),after:p.images.map(({id}:any)=>({id,alt:'A white camping mug.'})),blockers:[],reasons:['image-reviewed-v1: fixture']}))}));
import prisma from '../app/db.server';
import {normalise} from '../app/core/shopify-api.server';
import {audit,propose,approve,applyChange,enqueueGeneration,executeJob,tick} from '../app/core/service.server';
import {generateCopy} from '../app/core/generation.server';
const storeId='workflow-integration';
beforeEach(async()=>{
 for(const model of ['resource','audit','change','job','event'] as const)await (prisma[model] as any).deleteMany({where:{storeId}});
 await prisma.store.upsert({where:{id:storeId},create:{id:storeId,demo:false,domain:'https://example.com'},update:{}});
 remote.node={id:'gid://shopify/Product/1',title:'Camping mug',handle:'camping-mug',descriptionHtml:'<p>Camping mug. Capacity 350 ml.</p>',seo:{title:'',description:''},media:{nodes:[{id:'image1',alt:'',image:{url:'https://cdn.shopify.com/test.jpg'}}],pageInfo:{hasNextPage:false}},variants:{nodes:[],pageInfo:{hasNextPage:false}},collections:{nodes:[]}};
 remote.reads=0;remote.writes=0;remote.discard=false;remote.reject=false;vi.mocked(generateCopy).mockClear();
});
afterAll(async()=>{for(const model of ['resource','audit','change','job','event'] as const)await (prisma[model] as any).deleteMany({where:{storeId}});await prisma.store.deleteMany({where:{id:storeId}});await prisma.$disconnect();});
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
 expect(JSON.parse(checked.issues).some((i:any)=>i.code.startsWith('missing-meta'))).toBe(false);
 await applyChange(storeId,c!.id);expect(remote.writes).toBe(1);
 await applyChange(storeId,c!.id,true);expect(remote.writes).toBe(2);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('rolled_back');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:any)=>i.code==='missing-meta-title')).toBe(true);
});
it.each(['product','collection','article'])('verifies image alt application for %s',async kind=>{
 const r=await resource(kind);await audit(storeId);const c=await propose(storeId,r.id,'alt');
 await approve(storeId,c!.id,'test-owner');await applyChange(storeId,c!.id);
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:any)=>i.code==='missing-alt')).toBe(false);
});
it('does not write a rejected preview',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await prisma.change.update({where:{id:c!.id},data:{status:'rejected'}});
 await expect(approve(storeId,c!.id,'test-owner')).rejects.toThrow('no longer');await applyChange(storeId,c!.id);expect(remote.writes).toBe(0);
});
it('keeps the finding open when Shopify accepts the mutation but returns the old value',async()=>{
 const r=await resource();await audit(storeId);const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');remote.discard=true;
 await expect(applyChange(storeId,c!.id)).rejects.toThrow('Verification failed');
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('verification_failed');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:any)=>i.code==='missing-meta-title')).toBe(true);
 remote.discard=false;await applyChange(storeId,c!.id);expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
});
it('refuses newer Shopify edits after a preview',async()=>{
 const r=await resource();const c=await propose(storeId,r.id,'seo');await approve(storeId,c!.id,'test-owner');remote.node.seo.title='Owner edit';
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
 expect(generateCopy).not.toHaveBeenCalled();expect(remote.node.faq.jsonValue[0].answer).toBe('One mug');
 expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues).some((i:any)=>i.code==='missing-product-faq')).toBe(false);
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
 await approve(storeId,c!.id,'test-owner');await tick();
 expect((await prisma.change.findUniqueOrThrow({where:{id:c!.id}})).status).toBe('applied');
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

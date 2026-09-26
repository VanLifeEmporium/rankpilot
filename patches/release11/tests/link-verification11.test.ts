import {beforeEach,afterAll,it,expect,vi} from 'vitest';
const remote=vi.hoisted(()=>({status:200,html:'<p>Working destination</p>'}));
vi.mock('../app/core/crawl.server',async original=>({...await original<typeof import('../app/core/crawl.server')>(),publicFetch:async()=>new Response(remote.html,{status:remote.status})}));
import prisma from '../app/db.server';
import {recheckLink} from '../app/core/service.server';
const storeId='recheck-integration-11';
beforeEach(async()=>{
 await Promise.all([prisma.resource.deleteMany({where:{storeId}}),prisma.audit.deleteMany({where:{storeId}}),prisma.event.deleteMany({where:{storeId}})]);
 await prisma.store.upsert({where:{id:storeId},create:{id:storeId,domain:'https://shop.test'},update:{}});
 await prisma.store.update({where:{id:storeId},data:{discoveries:JSON.stringify({reported:[{path:'/old',status:404,state:'Missing page'}]})}});
 remote.status=200;remote.html='<p>Working page</p>';
 await prisma.audit.create({data:{storeId,score:80,aeoScore:0,resourceCount:7,coverage:'{}',issues:JSON.stringify(Array.from({length:7},(_,i)=>({resourceId:'p'+i,title:'P'+i,code:'broken-link',severity:'warning',detail:`Link from https://shop.test/products/p${i} to https://shop.test/${i<6?'old':'other'} returns 404.`})))}});
});
afterAll(async()=>{await Promise.all([prisma.resource.deleteMany({where:{storeId}}),prisma.audit.deleteMany({where:{storeId}}),prisma.event.deleteMany({where:{storeId}})]);await prisma.store.delete({where:{id:storeId}});await prisma.$disconnect();});
it('clears exactly six shared findings after a successful focused check',async()=>{
 const result=await recheckLink(storeId,'/old');expect(result[0].message).toContain('6 findings cleared across 6 pages');
 expect(JSON.parse((await prisma.store.findUniqueOrThrow({where:{id:storeId}})).discoveries).reported[0]).toMatchObject({status:200,state:'Working'});
 const audit=await prisma.audit.findFirstOrThrow({where:{storeId}});expect(JSON.parse(audit.issues)).toHaveLength(1);
 await recheckLink(storeId,'/old');expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues)).toHaveLength(1);
});
it('retains every unresolved finding when the new check is still a 404',async()=>{
 remote.status=404;await recheckLink(storeId,'/old');expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues)).toHaveLength(7);
});
it('clears only the edited source when its live HTML no longer contains the link',async()=>{
 await prisma.resource.create({data:{id:'p0',storeId,remoteId:'remote-p0',kind:'product',title:'P0',handle:'p0',payload:JSON.stringify({descriptionHtml:'',url:'https://shop.test/products/p0'})}});
 remote.html='<a href="/old">Old link remains in theme</a>';await recheckLink(storeId,'/old','p0');expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues)).toHaveLength(7);
 remote.html='<p>Old link text kept</p>';await recheckLink(storeId,'/old','p0');expect(JSON.parse((await prisma.audit.findFirstOrThrow({where:{storeId}})).issues)).toHaveLength(6);
});

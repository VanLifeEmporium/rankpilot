import prisma from '../db.server';
import {z} from 'zod';
import {supplierOverlap,SUPPLIER_COPY_THRESHOLD} from './supplier-copy';
import {cleanSupplierHtml} from './html-cleanup';
import type {Payload} from './types';
/** Supplier originals are kept as metric rows (provider "supplier-original", one per product). */
const item=z.object({resourceId:z.string().optional(),handle:z.string().optional(),text:z.string().min(20).max(60000),source:z.string().min(3).max(500)});
export async function saveSupplierOriginals(storeId:string,input:unknown){
 const body=z.object({items:z.array(item).min(1).max(500)}).parse(input);
 const products=await prisma.resource.findMany({where:{storeId,kind:'product'},select:{id:true,handle:true,title:true}});
 const results:{resourceId?:string;handle?:string;ok:boolean;message:string}[]=[];
 for(const i of body.items){
  const r=products.find(p=>(i.resourceId&&p.id===i.resourceId)||(i.handle&&p.handle===i.handle));
  if(!r){results.push({resourceId:i.resourceId,handle:i.handle,ok:false,message:'No matching product'});continue;}
  const payload=JSON.stringify({text:i.text,source:i.source,savedAt:new Date().toISOString()});
  await prisma.metric.upsert({where:{storeId_provider_period:{storeId,provider:'supplier-original',period:r.id}},create:{storeId,provider:'supplier-original',period:r.id,payload},update:{payload}});
  results.push({resourceId:r.id,handle:r.handle,ok:true,message:'Saved'});
 }
 return {saved:results.filter(r=>r.ok).length,results};
}
export type SupplierCopyRow={resourceId:string;title:string;handle:string;overlap:number;source:string};
export async function supplierCopyReport(storeId:string){
 const [originals,products]=await Promise.all([prisma.metric.findMany({where:{storeId,provider:'supplier-original'}}),prisma.resource.findMany({where:{storeId,kind:'product'},select:{id:true,title:true,handle:true,payload:true}})]);
 const byId=new Map(products.map(p=>[p.id,p]));const rows:SupplierCopyRow[]=[];
 for(const o of originals){const p=byId.get(o.period);if(!p)continue;const {text,source}=JSON.parse(o.payload);const overlap=supplierOverlap(text,(JSON.parse(p.payload) as Payload).descriptionHtml||'');if(overlap===null)continue;rows.push({resourceId:p.id,title:p.title,handle:p.handle,overlap,source});}
 rows.sort((a,b)=>b.overlap-a.overlap);
 return {compared:rows.length,originals:originals.length,onSupplierCopy:rows.filter(r=>r.overlap>=SUPPLIER_COPY_THRESHOLD),rows};
}
/** Release 18: a formatting-only description proposal. The visible text must be unchanged. */
export async function proposeCleanFormatting(storeId:string,resourceId:string){
 const r=await prisma.resource.findFirstOrThrow({where:{id:resourceId,storeId}});
 const p:Payload=JSON.parse(r.payload);
 const result=cleanSupplierHtml(p.descriptionHtml||'');
 if(!result.changed||!result.removed.length)return {change:null,message:'No supplier formatting to clean on this page.'};
 if(!result.sameText)throw new Error('Clean-up would change the visible text, so no proposal was made. Edit this description in Shopify.');
 const busy=await prisma.change.findFirst({where:{storeId,resourceId,feature:{in:['description','links','faq']},status:{in:['approved','applying','verifying','rolling_back']}}});
 if(busy)throw new Error('Another update is applying to this page. Try again when it finishes.');
 await prisma.change.updateMany({where:{storeId,resourceId,feature:'description',status:'pending'},data:{status:'superseded'}});
 const change=await prisma.change.create({data:{storeId,resourceId,feature:'description',before:JSON.stringify(p.descriptionHtml),after:JSON.stringify(result.html),reasons:JSON.stringify([`source-reviewed-v1: Formatting clean-up only. Removed: ${result.removed.join(', ')}. Every word of visible text is unchanged (checked automatically).`,'Lets RankPilot and the agent edit this description, for example to add an FAQ section.'])}});
 return {change,message:`Clean-up ready for review: ${result.removed.join(', ')}. Text unchanged.`};
}

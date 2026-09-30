import prisma from '../db.server';
import {livenessIndex} from './page-liveness';
/** Release 20: liveness for this store from the synced pages, the last crawl and Google's inspections. */
export async function storeLiveness(storeId:string){
 const [store,resources,idx]=await Promise.all([
  prisma.store.findUnique({where:{id:storeId},select:{discoveries:true}}),
  prisma.resource.findMany({where:{storeId,kind:{in:['product','collection','page','article']}},select:{id:true,kind:true,handle:true,title:true,payload:true}}),
  prisma.metric.findFirst({where:{storeId,provider:'indexation'},orderBy:{period:'desc'}}),
 ]);
 const pages=(()=>{try{return JSON.parse(store?.discoveries||'{}').pages||[];}catch{return [];}})();
 const rows=(()=>{try{return idx?JSON.parse(idx.payload).rows||[]:[];}catch{return [];}})();
 // Only light fields are kept in the index; the payloads can be released after this call.
 return livenessIndex(resources.map(r=>{let p:Record<string,unknown>={};try{p=JSON.parse(r.payload);}catch{/* empty */}return {...r,payload:JSON.stringify({url:p.url,published:p.published,blogHandle:p.blogHandle})};}),pages,rows);
}

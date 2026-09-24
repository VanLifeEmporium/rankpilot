import prisma from '../db.server';
export function repairedTitle(after:{title?:string;description?:string}, pageTitle:string) {
 const valid=(title:string)=>Boolean(title.trim()) && title.trim().split(/\s+/u).length<=5 && title.trim().length<=60;
 if(valid(String(after.title||'')) || !valid(pageTitle)) return null;
 return {...after,title:pageTitle.trim()};
}
// Repair drafts only. Never edit a change already accepted or applied.
export async function repairPendingTitles(storeId:string) {
 const rows=await prisma.change.findMany({where:{storeId,feature:'seo',status:'pending'}});
 if(!rows.length)return;
 const resources=await prisma.resource.findMany({where:{storeId,id:{in:rows.map(r=>r.resourceId)}}});
 for(const row of rows){
  const resource=resources.find(r=>r.id===row.resourceId);if(!resource)continue;
  try {
   const after=repairedTitle(JSON.parse(row.after),String(JSON.parse(resource.payload).title||''));
   if(!after)continue;
   await prisma.change.updateMany({where:{id:row.id,storeId,status:'pending',after:row.after},data:{after:JSON.stringify(after),error:null,reasons:JSON.stringify(['source-reviewed-v1: The existing Shopify page title is reused verbatim. The proposed meta description is unchanged.','Saved draft repaired to meet the five-word and 60-character title limits. Review before accepting; nothing has been published.'])}});
  }catch{ /* Malformed proposals remain blocked for review. */ }
 }
}

import prisma from '../db.server';
export function repairedTitle(after:{title?:string;description?:string}, pageTitle:string) {
 const valid=(title:string)=>Boolean(title.trim()) && title.trim().length<=255;
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
   const reasons=JSON.parse(row.reasons || '[]');
   const updated=await prisma.change.updateMany({where:{id:row.id,storeId,status:'pending',after:row.after},data:{after:JSON.stringify(after),error:null,reasons:JSON.stringify([...reasons,'Title repair: reused the existing page title. Description review status is unchanged.'])}});
   if(updated.count) await prisma.event.create({data:{storeId,message:'Pending title repaired',detail:JSON.stringify({changeId:row.id,before:row.after,after:JSON.stringify(after),previousReasons:row.reasons})}});

  }catch{ /* Malformed proposals remain blocked for review. */ }
 }
}

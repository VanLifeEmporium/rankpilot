import prisma from '../db.server';
export async function visibleJobs(storeId:string) {
 const [active,recent]=await Promise.all([
  prisma.job.findMany({where:{storeId,status:{in:['queued','running']}},orderBy:{createdAt:'desc'}}),
  prisma.job.findMany({where:{storeId,status:{notIn:['queued','running']}},orderBy:{updatedAt:'desc'},take:50})
 ]);
 return [...active,...recent].sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime());
}

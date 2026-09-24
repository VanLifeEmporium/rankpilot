import type {LoaderFunctionArgs} from 'react-router';
import {context} from '../core/context.server';
import prisma from '../db.server';
import {jobRevision} from '../core/job-revision';
export async function loader({request}:LoaderFunctionArgs) {
 const {store}=await context(request);
 const jobs=await prisma.job.findMany({where:{storeId:store.id},orderBy:{createdAt:'desc'},take:1000,select:{id:true,status:true,payload:true,error:true}});
 return Response.json({revision:jobRevision(jobs)},{headers:{'Cache-Control':'no-store'}});
}

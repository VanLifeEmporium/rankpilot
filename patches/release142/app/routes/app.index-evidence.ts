import type {LoaderFunctionArgs} from 'react-router';
import {context} from '../core/context.server';
import prisma from '../db.server';
import type {Inspection} from '../core/indexation.server';
export async function loader({request}:LoaderFunctionArgs) {
 const {store}=await context(request);
 const url=new URL(request.url);
 const page=Math.max(0,Math.min(500,Math.floor(Number(url.searchParams.get('page'))||0)));
 const size=[10,25,50].includes(Number(url.searchParams.get('size')))?Number(url.searchParams.get('size')):10;
 const metric=await prisma.metric.findFirst({where:{storeId:store.id,provider:'indexation'},orderBy:{period:'desc'}});
 const rows:Inspection[]=metric?JSON.parse(metric.payload).rows||[]:[];
 const counts:Record<string,number>={};
 for(const row of rows){const reason=row.error?'Check unavailable':row.coverageState||row.verdict||'Unknown';counts[reason]=(counts[reason]||0)+1;}
 const current=Math.min(page,Math.max(0,Math.ceil(rows.length/size)-1));
 return Response.json({rows:rows.slice(current*size,(current+1)*size),total:rows.length,page:current,size,counts},{headers:{'Cache-Control':'no-store'}});
}

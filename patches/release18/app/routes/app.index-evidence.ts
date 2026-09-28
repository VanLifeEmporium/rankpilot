import type {LoaderFunctionArgs} from 'react-router';
import {context} from '../core/context.server';
import prisma from '../db.server';
import type {Inspection} from '../core/indexation.server';
import {coverageReport} from '../core/index-coverage';
export async function loader({request}:LoaderFunctionArgs) {
 const {store}=await context(request);
 const url=new URL(request.url);
 const page=Math.max(0,Math.min(500,Math.floor(Number(url.searchParams.get('page'))||0)));
 const size=[10,25,50].includes(Number(url.searchParams.get('size')))?Number(url.searchParams.get('size')):10;
 const kind=['all','catalogue','product','collection','article','page'].includes(url.searchParams.get('kind')||'')?url.searchParams.get('kind')!:'all';
 const status=url.searchParams.get('status')==='all'?'all':'not-indexed';
 const metric=await prisma.metric.findFirst({where:{storeId:store.id,provider:'indexation'},orderBy:{period:'desc'}});
 const rows:Inspection[]=metric?JSON.parse(metric.payload).rows||[]:[];
 // Release 18: grouped by Google's reason, each with a next step. Legacy `counts` kept for older clients.
 const report=coverageReport(rows,{kind,status});
 const counts:Record<string,number>={};
 for(const row of rows){const reason=row.error?'Check unavailable':row.coverageState||row.verdict||'Unknown';counts[reason]=(counts[reason]||0)+1;}
 const current=Math.min(page,Math.max(0,Math.ceil(report.rows.length/size)-1));
 return Response.json({rows:report.rows.slice(current*size,(current+1)*size),total:report.rows.length,page:current,size,counts,groups:report.groups,byKind:report.byKind,inspected:report.inspected,indexed:report.indexed,kind,status},{headers:{'Cache-Control':'no-store'}});
}

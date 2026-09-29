import type {Prisma} from '@prisma/client';
import prisma from '../db.server';
/**
 * Release 19: read resources a page at a time (default 50), with only the fields needed,
 * so a whole-store job never holds every page's HTML at once.
 */
export async function* resourcePages<T extends {id:string}>(where:Prisma.ResourceWhereInput,select:Prisma.ResourceSelect,size=Number(process.env.RESOURCE_PAGE_SIZE)||50):AsyncGenerator<T[]>{
 let cursor:string|undefined;
 for(;;){
  const rows=await prisma.resource.findMany({where,select:{...select,id:true},orderBy:{id:'asc'},take:size,...(cursor?{skip:1,cursor:{id:cursor}}:{})}) as unknown as T[];
  if(!rows.length)return;
  cursor=rows[rows.length-1].id;
  yield rows;
  if(rows.length<size)return;
 }
}
export const AUDIT_SELECT={id:true,title:true,kind:true,payload:true,keyword:true,facts:true,handle:true} satisfies Prisma.ResourceSelect;
export const CATALOGUE_KINDS=['product','collection','page','article'];

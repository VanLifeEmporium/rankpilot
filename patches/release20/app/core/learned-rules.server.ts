import prisma from '../db.server';
import {settings} from './types';
import {storeNames} from './brand-detect';
import {learnRules} from './learned-rules';
/** Release 20 (RP-403): rules learned from the store's recent SEO title decisions. */
export async function learnedRules(storeId:string){
 const store=await prisma.store.findUnique({where:{id:storeId},select:{settings:true,discoveries:true}});
 const cfg=settings(store?.settings||'{}');const names=storeNames(store);
 if(!names.length)return {rules:[],names};
 const rows=await prisma.change.findMany({where:{storeId,feature:{in:['seo','title']},status:{in:['rejected','applied','approved','applying','verifying']}},orderBy:{updatedAt:'desc'},take:500,select:{feature:true,status:true,before:true,after:true,updatedAt:true}});
 return {rules:learnRules(rows,names,cfg.learnedResetAt),names};
}

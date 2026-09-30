import prisma from '../db.server';
import {settings,type Issue} from './types';
import {applyFindingState,PROTECTED_MESSAGE} from './finding-state';
/** Release 20 (RP-603): pages with an open changed-outside finding are protected from every write. */
export async function protectedPages(storeId:string,ids?:string[]){
 const [audit,store]=await Promise.all([prisma.audit.findFirst({where:{storeId},orderBy:{createdAt:'desc'},select:{issues:true}}),prisma.store.findUnique({where:{id:storeId},select:{settings:true}})]);
 if(!audit)return new Set<string>();
 const open=applyFindingState(JSON.parse(audit.issues) as Issue[],settings(store?.settings||'{}')).active.filter(i=>i.code==='changed-outside'&&(!ids||ids.includes(i.resourceId)));
 return new Set(open.map(i=>i.resourceId));
}
export async function assertNotProtected(storeId:string,resourceId:string){
 if((await protectedPages(storeId,[resourceId])).has(resourceId))throw new ProtectedPageError(PROTECTED_MESSAGE);
}
export class ProtectedPageError extends Error{}

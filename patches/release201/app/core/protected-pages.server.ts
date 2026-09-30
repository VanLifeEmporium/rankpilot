import prisma from '../db.server';
import {settings,type Issue,type Payload} from './types';
import {applyFindingState,PROTECTED_MESSAGE} from './finding-state';
import {sameContent} from './content-diff';
/** Release 20 (RP-603): pages with an open changed-outside finding are protected from every write. */
export async function protectedPages(storeId:string,ids?:string[]){
 const [audit,store]=await Promise.all([prisma.audit.findFirst({where:{storeId},orderBy:{createdAt:'desc'},select:{issues:true}}),prisma.store.findUnique({where:{id:storeId},select:{settings:true}})]);
 if(!audit)return new Set<string>();
 // Release 20.1: most audits have no changed-outside finding; skip parsing the whole findings list then.
 if(!audit.issues.includes('"changed-outside"'))return new Set<string>();
 const open=applyFindingState(JSON.parse(audit.issues) as Issue[],settings(store?.settings||'{}')).active.filter(i=>i.code==='changed-outside'&&(!ids||ids.includes(i.resourceId)));
 const locked=new Set<string>();
 for(const i of open){
  // Release 20.1: findings from before release 20 (no side-by-side diff) may be formatting-only false
  // alarms. Re-check those against the current value before locking the page.
  if(!i.diff&&i.changeId&&await formattingOnly(storeId,i))continue;
  locked.add(i.resourceId);
 }
 return locked;
}
async function formattingOnly(storeId:string,i:Issue){
 const [change,resource]=await Promise.all([
  prisma.change.findFirst({where:{id:i.changeId,storeId},select:{feature:true,after:true}}),
  prisma.resource.findFirst({where:{id:i.resourceId,storeId},select:{payload:true}}),
 ]);
 if(!change||!resource||!['description','links'].includes(change.feature))return false;
 try{
  const expected=JSON.parse(change.after);const actual=(JSON.parse(resource.payload) as Payload).descriptionHtml;
  return typeof expected==='string'&&typeof actual==='string'&&sameContent(actual,expected);
 }catch{return false;}
}
export async function assertNotProtected(storeId:string,resourceId:string){
 if((await protectedPages(storeId,[resourceId])).has(resourceId))throw new ProtectedPageError(PROTECTED_MESSAGE);
}
export class ProtectedPageError extends Error{}

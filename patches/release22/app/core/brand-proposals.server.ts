import prisma from '../db.server';
import {settings} from './types';
import type {Facts,Issue,Payload} from './types';
import {applyFindingState} from './finding-state';
import {detectBrand,vendorRuleCollections} from './brand-detect';
import {vendorKey} from './catalogue-checks';
import {bookFromPage,bookQuery,openLibraryCandidates,validIsbn13,type BookCandidate} from './book-flow';
import {log} from './service.server';
import {friendlyError} from './db-errors';
import {ProtectedPageError} from './protected-pages.server';
/**
 * Release 20 (RP-201): turn brand-is-store findings into pending vendor changes, in bulk.
 * Each change carries the evidence and confidence, warns about vendor-based smart collections,
 * and waits for merchant approval (undoable in Results & history like any change).
 */
export type BrandResult={resourceId:string;title?:string;ok:boolean;status:string;vendor?:string;changeId?:string;message?:string;warnings?:string[]};
export async function proposeBrands(storeId:string,opts:{ids?:string[];minConfidence?:'high'|'medium';actor?:string}={}):Promise<{results:BrandResult[]}>{
 const {stageChange}=await import('./agent.server');
 const [audit,store,collections]=await Promise.all([
  prisma.audit.findFirst({where:{storeId},orderBy:{createdAt:'desc'}}),
  prisma.store.findUnique({where:{id:storeId},select:{settings:true}}),
  prisma.resource.findMany({where:{storeId,kind:'collection'},select:{title:true,payload:true}}),
 ]);
 const smart=collections.map(c=>{try{return {title:c.title,rules:(JSON.parse(c.payload) as Payload).rules};}catch{return {title:c.title};}}).filter(c=>c.rules?.length);
 const issues=audit?applyFindingState(JSON.parse(audit.issues) as Issue[],settings(store?.settings||'{}')).active.filter(i=>i.code==='brand-is-store'&&i.brand&&(!opts.ids?.length||opts.ids.includes(i.resourceId))):[];
 const results:BrandResult[]=[];
 for(const i of issues.slice(0,500)){
  const b=i.brand!;
  if(opts.minConfidence==='high'&&b.confidence!=='high'){results.push({resourceId:i.resourceId,title:i.title,ok:true,status:'skipped',vendor:b.vendor,message:'No change: medium confidence left for review'});continue;}
  try{
   const r=await prisma.resource.findFirstOrThrow({where:{id:i.resourceId,storeId,kind:'product'}});
   const p:Payload=JSON.parse(r.payload);
   if((p.vendor||'')===b.vendor){results.push({resourceId:r.id,title:r.title,ok:true,status:'unchanged',vendor:b.vendor,message:'No change: value already set'});continue;}
   // Release 22 (R22-402): one proposal per product; a pending one is reported, never duplicated.
   const pending=await prisma.change.findFirst({where:{storeId,resourceId:r.id,feature:'vendor',status:{in:['pending','approved','applying','verifying']}},orderBy:{createdAt:'desc'}});
   if(pending){results.push({resourceId:r.id,title:r.title,ok:true,status:'exists',vendor:String(JSON.parse(pending.after)),changeId:pending.id,message:'Proposal pending'});continue;}
   results.push(await stageVendor(storeId,r.id,r.title,p,b,smart,stageChange));
  }catch(e){results.push({resourceId:i.resourceId,title:i.title,ok:false,status:e instanceof ProtectedPageError?'protected':'error',message:friendlyError(e)});}
 }
 await log(storeId,'Brand proposals prepared',{count:results.filter(r=>r.status==='pending').length,actor:opts.actor});
 return {results};
}

type Smart={title:string;rules?:{column:string;condition:string}[]}[];
async function stageVendor(storeId:string,id:string,title:string,p:Payload,b:{vendor:string;confidence:string;evidence:{where:string;text:string}[]},smart:Smart,stageChange:typeof import('./agent.server').stageChange,confirmed=false):Promise<BrandResult>{
 const affected=vendorRuleCollections(smart,p.collections||[]);
 const warnings=affected.length?[`Smart ${affected.length===1?'collection':'collections'} ${affected.map(t=>`“${t}”`).join(', ')} ${affected.length===1?'uses':'use'} the vendor in ${affected.length===1?'its':'their'} rules; this product may leave or join ${affected.length===1?'it':'them'}.`]:[];
 const ev=b.evidence.map(e=>`${e.where}: “${e.text.slice(0,120)}”`).join('; ');
 const row=await stageChange(storeId,id,'vendor',p.vendor||'',b.vendor,[confirmed?`You confirmed “${b.vendor}” as a brand. Found in the ${ev}.`:`Brand found in the ${ev} (${b.confidence} confidence).`,'Vendor is the brand Google Shopping shows. Waits for your approval.',...warnings.map(w=>'Warning: '+w)]);
 return {resourceId:id,title,ok:true,status:row.status==='pending'?'pending':row.status,vendor:b.vendor,changeId:row.id,...(warnings.length?{warnings}:{})};
}

/**
 * Release 22 (R22-403): confirm a brand once. The brand is remembered (matched like a listed brand from
 * the next audit), and every product that names it but lists the store, or no brand, as its vendor gets a
 * pending vendor change, with smart-collection warnings shown before approval.
 */
export async function confirmBrand(storeId:string,input:{brand:string;actor?:string}):Promise<{brand:string;results:BrandResult[]}>{
 const brand=input.brand.replace(/\s+/g,' ').trim();
 if(brand.length<2||brand.length>60)throw new Error('Enter the brand name, 2 to 60 characters.');
 const {stageChange}=await import('./agent.server');
 const store=await prisma.store.findUniqueOrThrow({where:{id:storeId},select:{settings:true,discoveries:true}});
 const cfg=settings(store.settings||'{}');
 const confirmedBrands=[...(cfg.confirmedBrands||[]).filter(b=>vendorKey(b)!==vendorKey(brand)),brand];
 await prisma.store.update({where:{id:storeId},data:{settings:JSON.stringify({...JSON.parse(store.settings||'{}'),confirmedBrands})}});
 const storeName=(()=>{try{return JSON.parse(store.discoveries||'{}').shop?.name||'';}catch{return '';}})()||cfg.titleBrand||'';
 const storeKeys=new Set([storeName,cfg.titleBrand||''].map(vendorKey).filter(Boolean));
 const [products,collections]=await Promise.all([
  prisma.resource.findMany({where:{storeId,kind:'product'},select:{id:true,title:true,payload:true}}),
  prisma.resource.findMany({where:{storeId,kind:'collection'},select:{title:true,payload:true}}),
 ]);
 const smart=collections.map(c=>{try{return {title:c.title,rules:(JSON.parse(c.payload) as Payload).rules};}catch{return {title:c.title};}}).filter(c=>c.rules?.length);
 const results:BrandResult[]=[];
 for(const r of products){
  let p:Payload;try{p=JSON.parse(r.payload);}catch{continue;}
  const vendor=vendorKey(p.vendor||'');
  if(vendor===vendorKey(brand)||(vendor&&!storeKeys.has(vendor)&&!/^(na|none|unbranded|nobrand|generic|default)$/.test(vendor)))continue;
  const found=detectBrand(p,[brand]);
  if(!found||vendorKey(found.vendor)!==vendorKey(brand))continue;
  try{
   const pending=await prisma.change.findFirst({where:{storeId,resourceId:r.id,feature:'vendor',status:{in:['pending','approved','applying','verifying']}},orderBy:{createdAt:'desc'}});
   // A different pending proposal is superseded by stageChange; one already being applied is left alone.
   if(pending&&(vendorKey(String(JSON.parse(pending.after)))===vendorKey(brand)||pending.status!=='pending')){results.push({resourceId:r.id,title:r.title,ok:true,status:'exists',vendor:String(JSON.parse(pending.after)),changeId:pending.id,message:'Proposal pending'});continue;}
   results.push(await stageVendor(storeId,r.id,r.title,p,{...found,vendor:brand},smart,stageChange,true));
  }catch(e){results.push({resourceId:r.id,title:r.title,ok:false,status:e instanceof ProtectedPageError?'protected':'error',message:friendlyError(e)});}
 }
 await log(storeId,'Brand confirmed',{brand,count:results.filter(r=>r.status==='pending').length,actor:input.actor});
 return {brand,results};
}

/** Release 20 (RP-203): candidates for a book, from its own page first, then Open Library. */
export async function bookCandidates(p:Payload,fetcher:((url:string)=>Promise<unknown>)|null):Promise<BookCandidate[]>{
 const own=bookFromPage(p);const out:BookCandidate[]=own?[own]:[];
 if(fetcher){
  try{
   const q=own?`isbn:${own.isbn}`:`title:${bookQuery(p.title)}`;
   const json=await fetcher(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=title,author_name,publisher,isbn,first_publish_year,editions,editions.title,editions.publisher,editions.isbn,editions.publish_date&limit=5`) as {docs?:never[]};
   for(const c of openLibraryCandidates(json||{},own?'':bookQuery(p.title)))if(!out.some(o=>o.isbn===c.isbn))out.push(c);
   if(own&&!own.publisher){const match=out.find(c=>c.isbn===own.isbn&&c.publisher);if(match)own.publisher=match.publisher;}
  }catch{/* offline: page candidates only */}
 }
 return out.slice(0,4);
}
const openLibrary=async(url:string)=>{const {publicFetch,limitedText}=await import('./crawl.server');const res=await publicFetch(url,{headers:{accept:'application/json','user-agent':'RankPilot (Shopify SEO app)'}});if(!res.ok)throw new Error(`Open Library ${res.status}`);return JSON.parse(await limitedText(res,500_000));};
/** Save the suggestions as unconfirmed facts; the merchant checks the edition before anything is written. */
export async function suggestBook(storeId:string,resourceId:string,fetcher:((url:string)=>Promise<unknown>)|null=openLibrary){
 const r=await prisma.resource.findFirstOrThrow({where:{id:resourceId,storeId,kind:'product'}});
 const store=await prisma.store.findUnique({where:{id:storeId},select:{demo:true}});
 const p:Payload=JSON.parse(r.payload);
 const list=await bookCandidates(p,store?.demo&&fetcher===openLibrary?null:fetcher);
 if(!list.length)return {ok:false,candidates:[],message:'No confident match was found in the description or on Open Library (titles that don’t match the book, or editions before 1980, are left out). Copy the 13-digit ISBN from the book’s copyright page, then confirm it in Product details.'};
 const top=list[0];const facts:Facts=JSON.parse(r.facts||'{}');
 const describe=(c:BookCandidate)=>`${c.source}: ${c.title?`${c.title}, `:''}${c.author?`${c.author}, `:''}${c.publisher||'publisher unknown'}${c.year?`, ${c.year}`:''}, ISBN ${c.isbn}`;
 facts.isbn={value:top.isbn,source:describe(top)+(list.length>1?`. Other editions: ${list.slice(1).map(c=>`${c.isbn} (${c.publisher||'?'}${c.year?` ${c.year}`:''})`).join('; ')}`:''),confirmed:false};
 if(top.publisher)facts.publisher={value:top.publisher,source:describe(top),confirmed:false};
 await prisma.resource.update({where:{id:r.id},data:{facts:JSON.stringify(facts)}});
 return {ok:true,candidates:list,message:`Suggested ${top.publisher||'publisher unknown'} and ISBN ${top.isbn}${top.year?` (${top.year} edition)`:''}. Check the edition matches the copy you sell, then save.`};
}
/** Stage the publisher as vendor and the ISBN as barcode, only after the edition is confirmed. */
export async function applyBook(storeId:string,resourceId:string,input:{isbn:string;publisher:string;editionConfirmed:boolean;actor?:string}){
 if(!input.editionConfirmed)throw new Error('Confirm the edition (publisher, year and format) matches the book you sell before saving the barcode.');
 const isbn=input.isbn.replace(/[\s-]/g,'');
 if(!validIsbn13(isbn))throw new Error('Enter a 13-digit ISBN starting 978 or 979 with a valid check digit.');
 const publisher=input.publisher.trim();if(publisher.length<2||publisher.length>100)throw new Error('Enter the publisher’s name.');
 const {stageChange}=await import('./agent.server');
 const r=await prisma.resource.findFirstOrThrow({where:{id:resourceId,storeId,kind:'product'}});
 const p:Payload=JSON.parse(r.payload);const facts:Facts=JSON.parse(r.facts||'{}');
 const source=`Edition confirmed by the merchant (${new Date().toISOString().slice(0,10)})`;
 facts.isbn={value:isbn,source:facts.isbn?.value===isbn?`${facts.isbn.source}. ${source}`:source,confirmed:true};
 facts.publisher={value:publisher,source:facts.publisher?.value===publisher?`${facts.publisher.source}. ${source}`:source,confirmed:true};
 await prisma.resource.update({where:{id:r.id},data:{facts:JSON.stringify(facts)}});
 const changes:string[]=[];const notes:string[]=[];
 if((p.vendor||'')!==publisher)changes.push((await stageChange(storeId,r.id,'vendor',p.vendor||'',publisher,['Book publisher as the vendor (RP-203).',source])).id);
 else notes.push('No change: vendor already set');
 const variants=(p.variants||[]);
 if(variants.some(v=>!v.id))notes.push('Variant ids are missing; run a sync, then save the barcode again.');
 else if(variants.length&&variants.some(v=>v.barcode!==isbn)){
  const before=variants.map(v=>({id:v.id!,barcode:v.barcode||''}));const after=before.map(v=>({...v,barcode:isbn}));
  changes.push((await stageChange(storeId,r.id,'barcode',before,after,[`ISBN ${isbn} as the barcode for ${variants.length===1?'the variant':`all ${variants.length} variants`}.`,source])).id);
 }else if(variants.length)notes.push('No change: barcode already set');
 await log(storeId,'Book details proposed',{resourceId:r.id,isbn,publisher,changes,actor:input.actor});
 return {ok:true,changeIds:changes,message:changes.length?`Prepared ${changes.length===1?'1 change':`${changes.length} changes`} for review: publisher and ISBN. Nothing is published until you accept.`:notes.join('. ')};
}

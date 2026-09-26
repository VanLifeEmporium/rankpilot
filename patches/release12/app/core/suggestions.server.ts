import {load} from 'cheerio';
import prisma from '../db.server';
import {sourceSuggestions} from './source-drafts';
import {relevantLinks,incomingPlan} from './link-intelligence';
import {escapeHtml,type Payload} from './types';
export async function pageSuggestions(storeId:string,id:string){
 const resource=await prisma.resource.findFirstOrThrow({where:{id,storeId}});
 const [resources,gsc]=await Promise.all([prisma.resource.findMany({where:{storeId,kind:{in:['product','collection','article','page']}}}),prisma.metric.findFirst({where:{storeId,provider:'gsc'},orderBy:{period:'desc'}})]);
 const p:Payload=JSON.parse(resource.payload);const rows=gsc?JSON.parse(gsc.payload).rows:undefined;
 const children=resource.kind==='collection'?resources.filter(r=>r.kind==='product'&&JSON.parse(r.payload).collections?.includes(resource.title)):[];
 const suggestions=sourceSuggestions(p,resource.kind);
 const candidateQueries=(rows||[]).filter((r:{keys:string[]})=>r.keys[0]?.split('?')[0]?.endsWith('/collections/'+resource.handle)).sort((a:{impressions:number},b:{impressions:number})=>b.impressions-a.impressions).map((r:{keys:string[]})=>r.keys[1]).filter(Boolean);
 if(resource.kind==='collection')suggestions.secondary=[...new Set<string>(candidateQueries)].filter(q=>q!==suggestions.primary).slice(0,5);
 return {suggestions,links:relevantLinks(resource,resources,rows),incoming:incomingPlan(resource,resources,rows),collection:resource.kind==='collection'?{children:children.slice(0,5).map(r=>({title:r.title,handle:r.handle})),count:p.productsCount??children.length,handle:resource.keyword?resource.keyword.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):p.handle}:null};
}
export async function collectionCopy(storeId:string,id:string){
 const r=await prisma.resource.findFirstOrThrow({where:{storeId,id,kind:'collection'}});const p:Payload=JSON.parse(r.payload);const plan=await pageSuggestions(storeId,id);
 if(!plan.collection?.children.length)throw new Error('No imported products are mapped to this collection. Run a scan to load membership first.');
 const $=load(p.descriptionHtml||'',{},false);$('[data-rankpilot="collection-guide"]').remove();
 // Add a useful catalogue index without inventing suitability, specs or arbitrary padding.
 const items=plan.collection.children;
 const html=$.html()+`<section data-rankpilot="collection-guide"><h2>Explore ${escapeHtml(p.title)}</h2><p>Browse ${items.map(r=>escapeHtml(r.title)).join(', ')} in this collection.</p><ul>${items.map(r=>`<li><a href="/products/${escapeHtml(r.handle)}">${escapeHtml(r.title)}</a></li>`).join('')}</ul></section>`;
 if(html===p.descriptionHtml)throw new Error('This collection guide is already present.');
 const row=await prisma.change.create({data:{storeId,resourceId:id,feature:'description',before:JSON.stringify(p.descriptionHtml),after:JSON.stringify(html),reasons:JSON.stringify(['source-extract-v1: Adds a concise guide using actual collection membership and product names. Existing copy is retained. Review the complete before/after before accepting.','Medium impact: helps readers understand and explore the collection; a longer word count alone does not guarantee better rankings.','Source: latest Shopify catalogue import. Membership can change; confirm these items still belong here.']),blockers:'[]'}});
 return row;
}

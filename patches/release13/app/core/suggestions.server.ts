import {htmlValue} from './html-value';
import {keywordFor,cleanTitle} from './catalogue';
import {load} from 'cheerio';
import {topicProfile,relevance} from './topic-relevance';
import {canonicalPage} from './analytics';
import {resourcePath} from './link-diagnosis';
import prisma from '../db.server';
import {sourceSuggestions} from './source-drafts';
import {relevantLinks,incomingPlan} from './link-intelligence';
import {escapeHtml,type Payload} from './types';
export async function pageSuggestions(storeId:string,id:string){
 const resource=await prisma.resource.findFirstOrThrow({where:{id,storeId}});
 const [resources,gsc]=await Promise.all([prisma.resource.findMany({where:{storeId,kind:{in:['product','collection','article','page']}}}),prisma.metric.findFirst({where:{storeId,provider:'gsc'},orderBy:{period:'desc'}})]);
 const p:Payload=JSON.parse(resource.payload);const rows=gsc?JSON.parse(gsc.payload).rows:undefined;
 const members=resource.kind==='collection'?resources.filter(r=>r.kind==='product'&&JSON.parse(r.payload).collections?.includes(resource.title)):[];
 const suggestions=sourceSuggestions(p,resource.kind);
 const profile=topicProfile(resource.keyword||resource.title,p.descriptionHtml);
 const children=members.map(r=>({r,match:relevance(profile,topicProfile(r.title))})).filter(x=>x.match).sort((a,b)=>b.match!.score-a.match!.score).map(x=>x.r);
 const candidateQueries=(rows||[]).filter((r:{keys:string[]})=>canonicalPage(r.keys[0]||'').endsWith(resourcePath(resource))).sort((a:{impressions:number},b:{impressions:number})=>b.impressions-a.impressions).map((r:{keys:string[]})=>r.keys[1]).filter(Boolean);
 const queries=[...new Set<string>(candidateQueries)];
 if(queries.length){suggestions.primary=queries[0];suggestions.secondary=queries.slice(1,6);}
 const keywordSource=queries.length?'Actual Search Console searches for this page, ordered by impressions.':'Suggested topic from the page content; search demand has not been measured.';
 const legacy=`${cleanTitle(p.title).toLowerCase()}${/\bUK\b/.test(p.title)?'':' UK'}`;
 const savedKeyword=resource.keyword && ![keywordFor(p,resource.kind),legacy].includes(resource.keyword)?resource.keyword:null;
 return {suggestions,keywordSource,savedKeyword,links:relevantLinks(resource,resources,rows),incoming:incomingPlan(resource,resources,rows),collection:resource.kind==='collection'?{children:children.slice(0,5).map(r=>({title:r.title,handle:r.handle})),count:p.productsCount??children.length,handle:resource.keyword?resource.keyword.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''):p.handle}:null};
}
export async function collectionCopy(storeId:string,id:string){
 const r=await prisma.resource.findFirstOrThrow({where:{storeId,id,kind:'collection'}});const p:Payload=JSON.parse(r.payload);const plan=await pageSuggestions(storeId,id);
 if(!plan.collection?.children.length)throw new Error('No strongly relevant products were found in this collection. Check its membership in Shopify, then scan again; unrelated products will not be added to the guide.');
 const $=load(p.descriptionHtml||'',{},false);$('[data-rankpilot="collection-guide"]').remove();
 $('h2').filter((_,el)=>$(el).text()===`Explore ${p.title}`).each((_,el)=>{const h=$(el);const next=h.next();if(next.is('p')&&(next.text().startsWith('Browse ')||next.text().includes('Each product page lists its own details so you can compare what suits your setup.'))&&next.next().is('ul')){next.next().remove();next.remove();h.remove();}});
 // Add a useful catalogue index without inventing suitability, specs or arbitrary padding.
 const items=plan.collection.children;const phrase=plan.savedKeyword||plan.suggestions.primary;
 const html=$.html()+`<h2>Explore ${escapeHtml(p.title)}</h2><p>Looking for ${escapeHtml(phrase)}? Start with these options from ${escapeHtml(p.title)}. Each product page lists its own details so you can compare what suits your setup.</p><ul>${items.map(r=>`<li><a href="/products/${escapeHtml(r.handle)}">${escapeHtml(r.title)}</a></li>`).join('')}</ul>`;
 if(htmlValue(html)===htmlValue(p.descriptionHtml))throw new Error('This collection guide is already present.');
 const row=await prisma.change.create({data:{storeId,resourceId:id,feature:'description',before:JSON.stringify(p.descriptionHtml),after:JSON.stringify(html),reasons:JSON.stringify(['source-extract-v1: Adds a concise guide using actual collection membership and product names. Existing copy is retained. Review the complete before/after before accepting.','Medium impact: helps readers understand and explore the collection; a longer word count alone does not guarantee better rankings.','Source: latest Shopify catalogue import. Membership can change; confirm these items still belong here.']),blockers:'[]'}});
 return row;
}

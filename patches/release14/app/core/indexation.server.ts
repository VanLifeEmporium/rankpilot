import {load} from 'cheerio';
import prisma from '../db.server';
import {credentials} from './security.server';
import {googleToken} from './integrations.server';
import {settings} from './types';
import {publicFetch,limitedText} from './crawl.server';
export type Inspection={url:string;checkedAt:string;verdict?:string;coverageState?:string;googleCanonical?:string;error?:string};
export async function checkIndexation(storeId:string,options:{url?:string;onProgress?:(checked:number,total:number)=>Promise<void>}={}){
 const store=await prisma.store.findUniqueOrThrow({where:{id:storeId}});if(store.demo)throw new Error('Indexation requires your live Search Console connection.');
 const cfg=settings(store.settings), token=await googleToken(await credentials(storeId));
 const domain=new URL(store.domain);const sitemapQueue=[new URL('/sitemap.xml',domain).href],seen=new Set<string>(),urls=new Set<string>();const errors:string[]=[];
 // Only read this store’s public sitemap tree. Bounded independently of API quota.
 while(sitemapQueue.length && seen.size<30 && urls.size<5000){const url=sitemapQueue.shift()!;if(seen.has(url))continue;seen.add(url);try{const response=await publicFetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}`);const $=load(await limitedText(response),{xml:true});if(!$('sitemapindex,urlset').length)throw new Error('Invalid sitemap XML');$('sitemap > loc,url > loc').each((_,el)=>{try{const u=new URL($(el).text());if(u.origin!==domain.origin)return;if($(el).parent().is('sitemap'))sitemapQueue.push(u.href);else if(urls.size<5000)urls.add(u.href);}catch{/* malformed URL excluded */}});}catch(e){errors.push(`Sitemap could not be read: ${url} (${(e as Error).message})`);}}
 if(!urls.size)throw new Error('No sitemap URLs could be read. Run a store scan and check the sitemap finding.');
 const previous=await prisma.metric.findFirst({where:{storeId,provider:'indexation'},orderBy:{period:'desc'}});
 const prior:Inspection[]=previous?JSON.parse(previous.payload).rows||[]:[];
 const rows=prior.filter(r=>urls.has(r.url)&&Date.now()-Date.parse(r.checkedAt)<28*86400000);
 const eligible=[...urls].filter(u=>!rows.some(r=>r.url===u&&!r.error));
 const selected=options.url?[...urls].filter(u=>u===options.url):eligible.slice(0,20);let failed=0;
 const before=options.url?prior.find(r=>r.url===options.url):undefined;
 for(const url of selected){
  const row:Inspection={url,checkedAt:new Date().toISOString()};
  try{const r=await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({inspectionUrl:url,siteUrl:cfg.gscSite,languageCode:'en-GB'})});const j=await r.json();if(!r.ok)throw new Error(j.error?.message||`Google returned ${r.status}`);const result=j.inspectionResult?.indexStatusResult;if(!result?.verdict)throw new Error('No index verdict returned');Object.assign(row,{verdict:result.verdict,coverageState:result.coverageState,googleCanonical:result.googleCanonical});}catch(e){row.error=(e as Error).message;failed++;}
  const i=rows.findIndex(r=>r.url===url);if(i>=0)rows[i]=row;else rows.push(row);
  const payload=JSON.stringify({checkedAt:new Date().toISOString(),submitted:urls.size,indexed:rows.filter(r=>r.verdict==='PASS').length,inspected:rows.filter(r=>r.verdict).length,rows,errors,lastRecheck:options.url?{url:options.url,before,after:row}:undefined,limited:sitemapQueue.length>0||urls.size>=5000,note:'URLs found in the current sitemap, inspected against Google’s stored index. Not a live indexability test. Checks expire after 28 days; uninspected URLs are unknown, not failures.'});
  await prisma.metric.upsert({where:{storeId_provider_period:{storeId,provider:'indexation',period:'current'}},create:{storeId,provider:'indexation',period:'current',payload},update:{payload}});
  await options.onProgress?.(rows.filter(r=>r.verdict).length,urls.size);
  if(failed>=3)break; // do not exhaust a quota or repeat a credentials error 20 times
 }
 return [{message:`${selected.length?rows.filter(r=>r.verdict).length:rows.length} sitemap URLs have recent index checks; ${urls.size} URLs found.${failed?' Some checks were unavailable; open Indexation coverage for details.':''}`}];
}

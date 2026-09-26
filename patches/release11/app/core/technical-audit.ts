import {load} from 'cheerio';
import type {Issue} from './types';
export function inspectPage(html:string,url:string,resourceId:string,title:string){
 const $=load(html);const issues:Issue[]=[];const add=(code:string,detail:string,severity:Issue['severity']='warning')=>issues.push({resourceId,title,code,detail,severity});
 const pageTitle=$('title').first().text().trim();const description=$('meta[name="description"]').attr('content')?.trim()||'';
 if(!pageTitle)add('live-title-missing',`No title in the HTML served at ${url}.`);else if(pageTitle.length>65)add('live-title-long',`The theme serves a ${pageTitle.length}-character title at ${url}. Check the actual search preview; display width varies.`,'notice');
 if(!description)add('live-description-missing',`No Google summary in the HTML served at ${url}.`);
 const missing=$('img:not([alt])').map((_,e)=>$(e).attr('src')||$(e).attr('data-src')||'Image with no source').get();
 if(missing.length)add('live-alt-missing',`${missing.length} images have no alt attribute at ${url}. Examples: ${missing.slice(0,5).join(', ')}. Empty alt attributes on decorative images are intentionally not flagged.`);
 const nofollow=$('a[rel]').filter((_,e)=>($(e).attr('rel')||'').split(/\s+/).includes('nofollow')).map((_,e)=>$(e).attr('href')).get();
 if(nofollow.length)add('nofollow-review',`${nofollow.length} nofollow links at ${url}. This can be intentional for paid or unendorsed links; inspect before changing. Examples: ${nofollow.slice(0,5).join(', ')}`,'notice');
 const images=$('img');if(images.length>5&&!images.toArray().some(e=>$(e).attr('loading')==='lazy'||$(e).attr('data-src')||/lazy/i.test($(e).attr('class')||'')))add('image-loading-review',`${images.length} images and no recognised lazy-loading markers in the HTML at ${url}. Confirm with PageSpeed; JavaScript may manage loading. Do not lazy-load the main visible image.`,'notice');
 const canonical=$('link[rel="canonical"]').attr('href');
 if(/\/collections\/[^/]+\/products\//.test(new URL(url).pathname)&&canonical){try{if(new URL(canonical,url).pathname===new URL(url).pathname)add('variant-canonical',`Collection product variant is self-canonical at ${url}. Review whether /products/ is the preferred address.`);}catch{add('canonical-invalid',`Invalid canonical URL at ${url}.`);}}
 const links=[...new Set($('a[href]').map((_,e)=>$(e).attr('href')).get())].flatMap(href=>{try{const u=new URL(href,url);if(u.protocol!=='https:'||u.username||u.password||/^\/(cart|checkout|account)(\/|$)/.test(u.pathname))return [];u.hash='';return [u.href];}catch{return [];}});
 return {issues,links,pageTitle,description};
}
export function parseReportedUrls(input:string,domain:string){
 if(input.length>500000)throw new Error('Import must be smaller than 500 KB.');
 const paths=new Set<string>();
 for(const line of input.replace(/^\uFEFF/,'').split(/\r?\n/)){
 const first=(line.match(/^"((?:[^"]|"")*)"/)?.[1]?.replaceAll('""','"')||line.split(',')[0]).trim();
 if(!first||/^url$/i.test(first))continue;
 const u=new URL(first,domain);if(u.origin!==new URL(domain).origin||!first.startsWith('/')&&!first.startsWith('https://'))throw new Error('Use paths or HTTPS URLs from this store.');
 if(u.username||u.password||/[\r\n]/.test(first))throw new Error('Invalid page address.');
 u.hash='';paths.add(u.pathname+u.search);
 }
 if(paths.size>1000)throw new Error('Import up to 1,000 URLs at a time.');return [...paths];
}
export async function mapConcurrent<T,R>(items:T[],limit:number,work:(item:T)=>Promise<R>){const out:R[]=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await work(items[i]);}}));return out;}

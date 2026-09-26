import {brokenAddress} from './broken-url';
import type {Issue} from './types';
type Resource={id:string;kind:string;title:string;handle:string;payload:string;remoteId?:string};
export function resourcePath(r:Resource) {
 const p=JSON.parse(r.payload);
 return `/${r.kind==='article'?`blogs/${p.blogHandle}`:r.kind+'s'}/${r.handle}`;
}
export function linkDiagnosis(issue:Issue,domain:string,resources:Resource[]) {
 const address=brokenAddress(issue,domain,resources.find(r=>r.id===issue.resourceId));
 const external=!!address && new URL(address,domain).origin!==new URL(domain).origin;
 const existing=external?undefined:resources.find(r=>['product','collection','page','article'].includes(r.kind)&&resourcePath(r)===address.split('?')[0]);
 const payload=existing?JSON.parse(existing.payload):{};
 return {address,external,existing,count:typeof payload.productsCount==='number'?payload.productsCount:null,
  advice:existing?payload.publicationCount===0?'This collection exists but is not published to any sales channel. Make it available on the Online Store to restore this destination for every referring page.':payload.productsCount===0?'This collection exists but has no products. Add suitable products and check Online Store availability before retiring its address.':`This ${existing.kind} exists in Shopify, but the last storefront check could not load it. Check Online Store publication and availability before creating a redirect.`:external?'This is another website. Shopify cannot redirect it. Replace or remove the link in your own page.':'This address was missing at the last check. Choose a relevant replacement if it has been retired.'};
}
export function linkTargets(address:string,resources:Resource[],liveURLs:string[],domain:string) {
 const clean=(u:string)=>{try{return new URL(u,domain).pathname.replace(/\/$/,'')||'/';}catch{return '';}};
 const live=new Set(liveURLs.map(clean));
 const tokens=(s:string)=>new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2&&!['products','collections','pages','blogs','the','and','for'].includes(w)));
 const wanted=tokens(address);
 return resources.filter(r=>['product','collection','page','article'].includes(r.kind)).map(r=>({path:resourcePath(r),title:r.title,similarity:[...tokens(r.title+' '+r.handle)].filter(w=>wanted.has(w)).length})).filter(r=>r.path!==clean(address)&&live.has(r.path)).sort((a,b)=>b.similarity-a.similarity||a.title.localeCompare(b.title)).slice(0,50);
}

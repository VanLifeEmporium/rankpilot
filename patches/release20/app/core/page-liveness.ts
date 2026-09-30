/**
 * Release 20 (RP-303, RP-302): is a URL a live, indexable page on this store?
 * Uses the synced pages (published flag), the last crawl's HTTP statuses and Google's URL inspections.
 */
export type LivenessResource={id:string;kind:string;handle:string;title:string;payload:string};
export type Liveness={live:boolean;reason?:'not-found'|'unpublished'|'noindex'|'redirect'|'error'|'not-in-store';resourceId?:string;title?:string;kind?:string};
export function normalisePath(input:string){
 let path=input.trim();
 try{path=new URL(path,'https://x.invalid').pathname;}catch{/* keep */}
 try{path=decodeURIComponent(path);}catch{/* keep */}
 path=path.toLowerCase().replace(/\/+$/,'')||'/';
 path=path.replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/(products|collections|pages|blogs)\/)/,'');
 return path.replace(/^\/collections\/[^/]+\/products\//,'/products/');
}
export function resourcePath(r:LivenessResource){
 try{const p=JSON.parse(r.payload);if(p.url)return normalisePath(p.url);return normalisePath(r.kind==='article'?`/blogs/${p.blogHandle}/${r.handle}`:`/${r.kind}s/${r.handle}`);}catch{return normalisePath(`/${r.kind}s/${r.handle}`);}
}
export function livenessIndex(resources:LivenessResource[],crawl:{url:string;status:number}[]=[],inspections:{url:string;coverageState?:string;verdict?:string}[]=[]){
 const byPath=new Map(resources.map(r=>[resourcePath(r),r]));
 const status=new Map(crawl.map(c=>[normalisePath(c.url),c.status]));
 const index=new Map(inspections.map(i=>[normalisePath(i.url),(i.coverageState||'').toLowerCase()]));
 return (url:string):Liveness=>{
  const path=normalisePath(url);
  const r=byPath.get(path);
  const code=status.get(path);const state=index.get(path)||'';
  const base={resourceId:r?.id,title:r?.title,kind:r?.kind};
  if(code===404||code===410||/not found|404/.test(state))return {live:false,reason:'not-found',...base};
  if(!r&&path!=='/')return {live:false,reason:'not-in-store'};
  if(r){try{if(JSON.parse(r.payload).published===false)return {live:false,reason:'unpublished',...base};}catch{/* treat as live */}}
  if(/noindex|robots/.test(state))return {live:false,reason:'noindex',...base};
  if(/redirect/.test(state)||(code!==undefined&&code>=300&&code<400))return {live:false,reason:'redirect',...base};
  if(code!==undefined&&code>=400)return {live:false,reason:'error',...base};
  return {live:true,...base};
 };
}

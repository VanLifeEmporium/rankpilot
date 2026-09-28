/** Release 18: groups Search Console URL inspections by Google's reason, with a next step for each. */
export type CoverageRow={url:string;checkedAt:string;verdict?:string;coverageState?:string;googleCanonical?:string;error?:string};
export type CoverageGroup='indexed'|'crawled-not-indexed'|'discovered-not-indexed'|'duplicate'|'redirect'|'not-found'|'noindex'|'blocked'|'unknown-to-google'|'server-error'|'check-unavailable'|'other';
export const groupLabels:Record<CoverageGroup,string>={
 'indexed':'Indexed','crawled-not-indexed':'Crawled – currently not indexed','discovered-not-indexed':'Discovered – currently not indexed',
 'duplicate':'Duplicate / Google chose another canonical','redirect':'Page with redirect','not-found':'Not found or soft 404','noindex':'Excluded by noindex',
 'blocked':'Blocked by robots.txt','unknown-to-google':'URL unknown to Google','server-error':'Server error','check-unavailable':'Check unavailable','other':'Other reason'};
export function coverageGroup(r:CoverageRow):CoverageGroup{
 if(r.error)return 'check-unavailable';
 const s=(r.coverageState||'').toLowerCase();
 if(r.verdict==='PASS'||/^submitted and indexed|^indexed/.test(s))return 'indexed';
 if(/crawled/.test(s))return 'crawled-not-indexed';
 if(/discovered/.test(s))return 'discovered-not-indexed';
 if(/duplicate|alternate page|canonical/.test(s))return 'duplicate';
 if(/redirect/.test(s))return 'redirect';
 if(/not found|404/.test(s))return 'not-found';
 if(/noindex/.test(s))return 'noindex';
 if(/robots/.test(s))return 'blocked';
 if(/unknown to google/.test(s))return 'unknown-to-google';
 if(/server error|5xx/.test(s))return 'server-error';
 return 'other';
}
export function pageKind(url:string){
 let path='';try{path=new URL(url).pathname;}catch{return 'other';}
 path=path.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/)/i,'');
 return /^\/products\//.test(path)?'product':/^\/collections\/[^/]+\/?$/.test(path)?'collection':/^\/blogs\//.test(path)?'article':/^\/pages\//.test(path)?'page':path==='/'||path===''?'home':'other';
}
export function nextStep(r:CoverageRow,group=coverageGroup(r)):string{
 switch(group){
  case 'indexed':return 'No action needed.';
  case 'crawled-not-indexed':return 'Google read the page but judged it not worth indexing yet. Add specific detail (confirmed specs, FAQs), link to it from a related collection or guide, then request indexing in Search Console.';
  case 'discovered-not-indexed':return 'Google knows the address but has not crawled it. Link to it from a well-visited page and keep it in the sitemap; Google usually crawls it within weeks.';
  case 'duplicate':return r.googleCanonical?`Google treats ${r.googleCanonical} as the main version. If that is right, no action; otherwise make this page's content distinct and check its canonical tag.`:'Google treats another page as the main version. Make this page distinct, or accept the other page as canonical.';
  case 'redirect':return 'This address redirects. Link to the destination instead and make sure only final addresses are in the sitemap (Shopify lists live pages automatically).';
  case 'not-found':return 'The page is missing or looks empty. Restore it, or set a redirect to the closest relevant page.';
  case 'noindex':return 'A noindex tag keeps this page out of Google. Remove it in the theme or the app that adds it if the page should appear in search.';
  case 'blocked':return 'robots.txt blocks this address. Change robots.txt.liquid only if the page should be crawled.';
  case 'unknown-to-google':return 'Google has not seen this address. Link to it internally and check it is in the sitemap; request indexing in Search Console.';
  case 'server-error':return 'Google hit a server error. Recheck the page; if it persists, contact Shopify support.';
  case 'check-unavailable':return 'The inspection could not run. Check the Search Console connection and quota, then check again.';
  default:return 'Open the URL in Search Console’s URL Inspection for Google’s full explanation.';
 }
}
export function coverageReport(rows:CoverageRow[],opts:{kind?:string;status?:'all'|'not-indexed'}={}){
 const kinds=['product','collection','article','page','home','other'];
 const scoped=rows.filter(r=>!opts.kind||opts.kind==='all'||(opts.kind==='catalogue'?['product','collection'].includes(pageKind(r.url)):pageKind(r.url)===opts.kind));
 const groups:Record<string,number>={};for(const r of scoped){const g=coverageGroup(r);groups[g]=(groups[g]||0)+1;}
 const inspected=scoped.filter(r=>!r.error).length,indexed=groups.indexed||0;
 const listed=scoped.filter(r=>opts.status!=='not-indexed'||coverageGroup(r)!=='indexed').map(r=>{const g=coverageGroup(r);return {...r,group:g,reason:groupLabels[g],kind:pageKind(r.url),nextStep:nextStep(r,g)};})
  .sort((a,b)=>(a.group==='indexed'?1:0)-(b.group==='indexed'?1:0)||a.group.localeCompare(b.group)||a.url.localeCompare(b.url));
 const byKind=Object.fromEntries(kinds.map(k=>{const set=rows.filter(r=>pageKind(r.url)===k&&!r.error);return [k,{inspected:set.length,indexed:set.filter(r=>coverageGroup(r)==='indexed').length}];}).filter(([,v])=>(v as {inspected:number}).inspected));
 return {inspected,indexed,share:inspected?indexed/inspected:null,groups,byKind,rows:listed};
}

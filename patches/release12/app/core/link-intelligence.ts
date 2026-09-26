import {load} from 'cheerio';
import {resourcePath} from './link-diagnosis';
import {observedPage} from './store-score';
import type {SearchRow} from './analytics';
export type LinkResource={id:string;kind:string;title:string;handle:string;payload:string};
const stop=new Set('the and for with from your our you this that have van life emporium best guide shop product collection products collections about into more where how what camping outdoor'.split(' '));
const tokens=(s:string)=>new Set(s.toLowerCase().replace(/<[^>]+>/g,' ').split(/[^a-z0-9]+/).filter(w=>w.length>2&&!stop.has(w)));
const path=(u:string)=>{try{return new URL(u,'https://store.invalid').pathname.replace(/\/$/,'');}catch{return u;}};
export function relevantLinks(source:LinkResource,resources:LinkResource[],rows?:SearchRow[],includeArticles=false){
 const p=JSON.parse(source.payload),$=load(p.descriptionHtml||'');const title=tokens(source.title+' '+$('h2,h3').text()),body=tokens($.text());
 const existing=new Set($('a[href]').map((_,a)=>path($(a).attr('href')||'')).get());
 return resources.filter(r=>r.id!==source.id&&['product','collection',...(includeArticles?['article']:[])].includes(r.kind)).flatMap(r=>{
  const rp=JSON.parse(r.payload),url=resourcePath(r);if(existing.has(path(url))||rp.published===false||rp.publicationCount===0||r.kind==='collection'&&rp.productsCount===0)return [];
  const wanted=tokens(r.title+' '+r.handle),shared=[...wanted].filter(w=>title.has(w)),inBody=[...wanted].filter(w=>body.has(w));
  // Broad terms alone are never enough to add a link. Relevance gates priority.
  if(shared.length<2 && !(shared.length===1&&shared[0].length>=5) && inBody.length<3)return [];
  const traffic=observedPage(rows,url),sourceTraffic=observedPage(rows,resourcePath(source));
  const strength=shared.length*4+inBody.length;
  return [{id:r.id,title:r.title,url,shared:shared.length?shared:inBody,score:strength+(r.kind==='collection'?1:0)+(traffic&&traffic.clicks===0?1:0),reason:`Shares ${[...new Set([...shared,...inBody])].slice(0,5).join(', ')} with this page. ${sourceTraffic?`Source: ${sourceTraffic.clicks} recorded clicks; `:''}${traffic?`destination: ${traffic.clicks} clicks / ${traffic.impressions} impressions in the reported period.`:'No destination search observations; traffic benefit is unmeasured.'} Helps readers reach related ${r.kind==='article'?'guidance':'items'}; no ranking gain is promised.`}];
 }).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,3);
}
export function incomingPlan(target:LinkResource,resources:LinkResource[],rows?:SearchRow[]){
 const targetPath=path(resourcePath(target));const sources=resources.filter(r=>r.id!==target.id&&['article','collection','page'].includes(r.kind));
 const linked=sources.filter(r=>{const $=load(JSON.parse(r.payload).descriptionHtml||'');return $('a[href]').toArray().some(a=>path($(a).attr('href')||'')===targetPath);});
 return {count:linked.length,limited:true,suggestions:linked.length?[]:sources.flatMap(r=>{const match=relevantLinks(r,[target],rows,true)[0];return match?[{id:r.id,title:r.title,reason:match.reason}]:[];}).slice(0,3)};
}

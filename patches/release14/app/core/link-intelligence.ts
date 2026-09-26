import {load} from 'cheerio';
import {topicProfile,relevance} from './topic-relevance';
import {resourcePath} from './link-diagnosis';
import {observedPage} from './store-score';
import type {SearchRow} from './analytics';
export type LinkResource={id:string;kind:string;title:string;handle:string;payload:string};
const path=(u:string)=>{try{return new URL(u,'https://store.invalid').pathname.replace(/\/$/,'');}catch{return u;}};
export function relevantLinks(source:LinkResource,resources:LinkResource[],rows?:SearchRow[],includeArticles=false,limit=3){
 const p=JSON.parse(source.payload),$=load(p.descriptionHtml||'');const profile=topicProfile(source.title,p.descriptionHtml||'');
 const existing=new Set($('a[href]').map((_,a)=>path($(a).attr('href')||'')).get());
 return resources.filter(r=>r.id!==source.id&&['product','collection',...(includeArticles?['article']:[])].includes(r.kind)).flatMap(r=>{
  const rp=JSON.parse(r.payload),url=resourcePath(r);if(existing.has(path(url))||rp.published===false||rp.publicationCount===0||r.kind==='collection'&&rp.productsCount===0)return [];
  const match=relevance(profile,topicProfile(r.title));if(!match)return [];
  const traffic=observedPage(rows,url),sourceTraffic=observedPage(rows,resourcePath(source));
  const strength=match.score;const impact=traffic&&traffic.impressions>=10&&traffic.position!==null&&traffic.position>=8&&traffic.position<=20?'High':traffic&&traffic.impressions>=10?'Medium':'Unmeasured';
  return [{id:r.id,title:r.title,url,shared:match.shared,impact,score:strength+(r.kind==='collection'?1:0)+(traffic&&traffic.clicks===0?1:0),reason:`${match.reason} ${sourceTraffic?`Source: ${sourceTraffic.clicks} recorded clicks; `:''}${traffic?`destination: ${traffic.clicks} clicks / ${traffic.impressions} impressions in the reported period.`:'No destination search observations; traffic benefit is unmeasured.'} Helps readers reach related ${r.kind==='article'?'guidance':'items'}; no ranking gain is promised.`}];
 }).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,limit);
}
export function incomingPlan(target:LinkResource,resources:LinkResource[],rows?:SearchRow[]){
 const targetPath=path(resourcePath(target));const sources=resources.filter(r=>r.id!==target.id&&['article','collection','page'].includes(r.kind));
 const linked=sources.filter(r=>{const $=load(JSON.parse(r.payload).descriptionHtml||'');return $('a[href]').toArray().some(a=>path($(a).attr('href')||'')===targetPath);});
 return {count:linked.length,limited:true,suggestions:linked.length?[]:sources.flatMap(r=>{const match=relevantLinks(r,[target],rows,true)[0];return match?[{id:r.id,title:r.title,reason:match.reason,impact:match.impact}]:[];}).slice(0,3)};
}

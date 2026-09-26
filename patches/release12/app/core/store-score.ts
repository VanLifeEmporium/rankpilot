import {metricPair, type SearchRow} from './analytics';
import {searchVisibility, discoveryReadiness} from './visibility-score';
export type MetricInput={provider:string;period:string;payload:string};
export type ScorePart={key:string;label:string;weight:number;value:number|null;low:boolean;note:string};
export type ScoreInput={metrics:MetricInput[];technical?:number;healthScores:Record<string,{score:number}|null>;observations:{createdAt:Date|string;cited:boolean}[];now:number};
export function revenueIndex(snapshot:{start?:string;end?:string;rows?:{dimensionValues?:{value:string}[];metricValues?:{value:string}[]}[]}|undefined,now:number) {
 if(!snapshot?.start || !snapshot.end || !Array.isArray(snapshot.rows) || now-Date.parse(snapshot.end)>45*86400000 || Date.parse(snapshot.end)-Date.parse(snapshot.start)!==117*86400000)return null;
 const split=Date.parse(snapshot.end)-27*86400000;let current=0,baseline=0;
 for(const row of snapshot.rows){const d=row.dimensionValues?.[0]?.value||'';const date=Date.parse(d.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'));const revenue=Number(row.metricValues?.[0]?.value);if(!Number.isFinite(revenue)||revenue<0 || date<Date.parse(snapshot.start!) || date>Date.parse(snapshot.end!))continue;if(date>=split)current+=revenue;else baseline+=revenue;}
 if(!baseline)return null;
 return {score:Math.min(100,Math.round(50*(current/28)/(baseline/90))),current,baseline,ratio:(current/28)/(baseline/90)};
}
export function storeScore(input:ScoreInput){
 const {metrics,technical,healthScores,observations,now}=input;
 const search=searchVisibility(metricPair(metrics,'gsc')[0],undefined,now);
 const samples=observations.filter(o=>{const age=now-new Date(o.createdAt).getTime();return age>=0&&age<=28*86400000;});const cited=samples.filter(o=>o.cited).length;
 const ai=samples.length?100*cited/samples.length:null;
 const readiness=discoveryReadiness(technical,search,{cited,total:samples.length});
 const health=Object.values(healthScores||{}).filter((x):x is {score:number}=>!!x);
 const revenue=revenueIndex(metricPair(metrics,'ga4-organic-daily')[0],now);
 const parts:ScorePart[]=[
 {key:'search',label:'Google search visibility',weight:30,value:search?.score??null,low:!search||search.clicks<10||search.stale,note:'Reported search positions and click rate; fewer than 10 clicks is limited evidence.'},
 {key:'technical',label:'Technical health',weight:20,value:technical??null,low:technical===undefined,note:'Passing catalogue checks from the latest audit. Live crawl gaps are shown separately.'},
 {key:'readiness',label:'Discovery readiness',weight:15,value:readiness,low:!search||search.clicks<10,note:'Blends catalogue health and observed visibility; overlaps these components intentionally.'},
 {key:'ai',label:'AI visibility',weight:10,value:ai,low:samples.length<10,note:`${cited} cited answers from ${samples.length} recorded samples in 28 days. Under 10 samples is low confidence.`},
 {key:'revenue',label:'Organic revenue index',weight:15,value:revenue?.score??null,low:!revenue,note:revenue?`Daily revenue is ${revenue.ratio.toFixed(2)}× the preceding 90-day daily baseline. 50 means unchanged; 100 means at least double.`:'Needs 118 days of organic revenue data and a non-zero preceding 90-day baseline.'},
 {key:'content',label:'Content coverage',weight:10,value:health.length?health.reduce((n,h)=>n+h.score,0)/health.length:null,low:health.length<3,note:'Equal average of technical scores for products, collections and blogs that exist.'}
 ];
 const present=parts.filter(p=>p.value!==null);const coverage=present.reduce((n,p)=>n+p.weight,0);
 const raw=coverage?Math.round(present.reduce((n,p)=>n+p.weight*p.value!,0)/coverage):null;
 const capped=!search || search.score===null || search.clicks<10;
 return {version:1,score:raw===null?null:capped?Math.min(55,raw):raw,parts,coverage,capped,limited:parts.some(p=>p.low)||coverage<100,search,readiness,ai,cited,samples:samples.length};
}
export function observedPage(rows:SearchRow[]|undefined,url:string){
 const path=(u:string)=>{try{return new URL(u,'https://placeholder.invalid').pathname.replace(/\/$/,'')||'/';}catch{return '';}};
 const matches=rows?.filter(r=>path(r.keys[0])===path(url));if(!matches?.length)return null;
 const clicks=matches.reduce((n,r)=>n+r.clicks,0),impressions=matches.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?matches.reduce((n,r)=>n+(r.position||0)*r.impressions,0)/impressions:null};
}

import {schemaVerdict} from './schema-verdict';
import {fieldScore} from './field-speed';
import {citationMeasure} from './provider-health';
import {metricPair, type SearchRow} from './analytics';
import {searchVisibility} from './visibility-score';
export type MetricInput={provider:string;period:string;payload:string};
export type ScorePart={key:string;label:string;weight:number;value:number|null;low:boolean;note:string};
export type ScoreInput={metrics:MetricInput[];technical?:number;answerReadiness?:number|null;schemas?:{types:unknown[];valid?:boolean}[];healthScores:Record<string,{score:number}|null>;observations:{createdAt:Date|string;cited:boolean}[];now:number};
export function revenueIndex(snapshot:{start?:string;end?:string;rows?:{dimensionValues?:{value:string}[];metricValues?:{value:string}[]}[]}|undefined,now:number) {
 if(!snapshot?.start || !snapshot.end || !Array.isArray(snapshot.rows) || now-Date.parse(snapshot.end)>45*86400000 || Date.parse(snapshot.end)-Date.parse(snapshot.start)!==117*86400000)return null;
 const split=Date.parse(snapshot.end)-27*86400000;let current=0,baseline=0;
 for(const row of snapshot.rows){const d=row.dimensionValues?.[0]?.value||'';const date=Date.parse(d.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'));const revenue=Number(row.metricValues?.[0]?.value);if(!Number.isFinite(revenue)||revenue<0 || date<Date.parse(snapshot.start!) || date>Date.parse(snapshot.end!))continue;if(date>=split)current+=revenue;else baseline+=revenue;}
 if(!baseline)return null;
 return {score:Math.min(100,Math.round(50*(current/28)/(baseline/90))),current,baseline,ratio:(current/28)/(baseline/90)};
}
/** Supplement catalogue checks with measured technical signals; unknown is not a pass. */
export function technicalHealth(input:ScoreInput){
 const speed=metricPair(input.metrics,'pagespeed')[0];const idx=metricPair(input.metrics,'indexation')[0];
 const schemas=input.schemas||[];
 const schema=schemas.length?100*schemas.filter(s=>schemaVerdict(s).pass).length/schemas.length:null;
 const recent=(date:string|undefined)=>!!date&&input.now-Date.parse(date)<=28*86400000&&input.now>=Date.parse(date);
 // Release 18 (method 4): the catalogue checklist no longer dominates. Index coverage and speed are weighted up;
 // real-visitor (Chrome UX Report) speed is used when available, otherwise the lab sample, labelled as such.
 const crux=metricPair(input.metrics,'crux')[0];const field=recent(crux?.checkedAt)?fieldScore(crux):null;
 const lab=recent(speed?.checkedAt)&&typeof speed.score==='number'?100*speed.score:null;
 const parts=[{label:'Catalogue checks',weight:25,value:input.technical??null},
 {label:field!==null?'Real-visitor speed (Chrome UX Report)':'Mobile speed (single lab sample)',weight:25,value:field??lab},
 {label:'Inspected Google index coverage',weight:30,value:recent(idx?.checkedAt)&&idx.inspected>0?100*idx.indexed/idx.inspected:null},
 {label:'Scanned structured data',weight:20,value:schema}];
 const measured=parts.filter(p=>p.value!==null);const weight=measured.reduce((n,p)=>n+p.weight,0);
 return {score:weight?Math.round(measured.reduce((n,p)=>n+p.weight*Math.min(100,Math.max(0,p.value!)),0)/weight):null,parts,schema,partial:weight<100||!!(idx&&idx.inspected<idx.submitted)};
}
/**
 * Release 19 (method 5): each check is counted once. Catalogue checks live only inside Technical health;
 * Answer readiness is the 7-question product score; the old readiness blend and per-kind content
 * average are gone (they re-counted the same checks). AI answer samples are shown but excluded until
 * the sampling method is validated against real results. Notices never count as failures.
 */
export const SCORE_METHODS:Record<string,string>={
 store:'Store Score = weighted average of Google search visibility 35%, Technical health 30%, Answer readiness 20% and Organic revenue index 15%. Unmeasured parts are left out and the rest rescaled. Under 10 recent Google clicks caps it at 55.',
 search:'Google search visibility: reported positions and click rate from Search Console for the last 28 days.',
 technical:'Technical health: index coverage 30%, speed 25%, catalogue checks 25%, structured data 20%.',
 answers:'Answer readiness: share of 7 shopper questions (size, material, what is included, weight, care, fit, delivery) that each product page answers, from its description, confirmed facts and product fields.',
 ai:'AI answer samples: how often sampled AI answers cited the store. Not part of the Store Score until the sampling method matches real results.',
 revenue:'Organic revenue index: daily organic revenue over the last 28 days against the previous 90 days; 50 means unchanged.',
};
export function storeScore(input:ScoreInput){
 const {metrics,observations,now}=input;
 const technical=technicalHealth(input);
 const search=searchVisibility(metricPair(metrics,'gsc')[0],undefined,now);
 const samples=observations.filter(o=>{const age=now-new Date(o.createdAt).getTime();return age>=0&&age<=28*86400000;});const cited=samples.filter(o=>o.cited).length;
 const measurement=citationMeasure(samples,metricPair(metrics,'ai-sampling')[0],now);const ai=measurement.score;
 const revenue=revenueIndex(metricPair(metrics,'ga4-organic-daily')[0],now);
 const answers=typeof input.answerReadiness==='number'?input.answerReadiness:null;
 const parts:ScorePart[]=[
 {key:'search',label:'Google search visibility',weight:35,value:search?.score??null,low:!search||search.clicks<10||search.stale,note:SCORE_METHODS.search+' Fewer than 10 clicks is limited evidence.'},
 {key:'technical',label:'Technical health',weight:30,value:technical.score,low:technical.partial,note:SCORE_METHODS.technical+' Unmeasured parts are excluded and weights rescaled; samples are not whole-store coverage.'},
 {key:'answers',label:'Answer readiness',weight:20,value:answers,low:answers===null,note:SCORE_METHODS.answers},
 {key:'revenue',label:'Organic revenue index',weight:15,value:revenue?.score??null,low:!revenue,note:revenue?`Daily revenue is ${revenue.ratio.toFixed(2)}× the preceding 90-day daily baseline. 50 means unchanged; 100 means at least double.`:'Needs 118 days of organic revenue data and a non-zero preceding 90-day baseline.'},
 {key:'ai',label:'AI answer samples',weight:0,value:ai,low:true,note:SCORE_METHODS.ai+' '+measurement.note},
 ];
 const present=parts.filter(p=>p.value!==null&&p.weight>0);const coverage=present.reduce((n,p)=>n+p.weight,0);
 const raw=coverage?Math.round(present.reduce((n,p)=>n+p.weight*p.value!,0)/coverage):null;
 const capped=!search || search.score===null || search.clicks<10;
 return {version:5,technical,score:raw===null?null:capped?Math.min(55,raw):raw,parts,coverage,capped:capped && raw!==null && raw>55,limited:parts.some(p=>p.low&&p.weight>0)||coverage<100,search,answers,ai,cited,samples:samples.length};
}
export function observedPage(rows:SearchRow[]|undefined,url:string){
 const path=(u:string)=>{try{return new URL(u,'https://placeholder.invalid').pathname.replace(/\/$/,'')||'/';}catch{return '';}};
 const matches=rows?.filter(r=>path(r.keys[0])===path(url));if(!matches?.length)return null;
 const clicks=matches.reduce((n,r)=>n+r.clicks,0),impressions=matches.reduce((n,r)=>n+r.impressions,0);
 return {clicks,impressions,ctr:impressions?clicks/impressions:null,position:impressions?matches.reduce((n,r)=>n+(r.position||0)*r.impressions,0)/impressions:null};
}

import type {SearchRow} from './analytics';
const clamp=(n:number)=>Math.max(0,Math.min(100,n));
export type SearchSnapshot={rows?:SearchRow[];start?:string;end?:string};
/** Explicit product index, not a Google score. Missing observations are never failures. */
export function searchVisibility(snapshot:SearchSnapshot|undefined,kind?:string,now=Date.now()) {
 if(!snapshot || !Array.isArray(snapshot.rows))return null;
 const stale=!snapshot.end || !Number.isFinite(Date.parse(snapshot.end)) || now-Date.parse(snapshot.end)>45*86400000;
 const path=kind==='article'?'/blogs/':kind?'/'+kind+'s/':null;
 const rows=snapshot.rows.filter(r=>{
  try{return (!path||new URL(r.keys[0]).pathname.startsWith(path))&&Number.isFinite(r.impressions)&&r.impressions>0&&Number.isFinite(r.clicks)&&r.clicks>=0&&r.clicks<=r.impressions&&Number.isFinite(r.position)&&r.position!>=1;}catch{return false;}
 });
 const impressions=rows.reduce((n,r)=>n+r.impressions,0),clicks=rows.reduce((n,r)=>n+r.clicks,0);
 if(!impressions)return {score:null,impressions,clicks,position:null,top10:0,ctr:0,pages:0,stale,lowSample:true,start:snapshot.start,end:snapshot.end};
 const position=rows.reduce((n,r)=>n+r.position!*r.impressions,0)/impressions;
 const top10=100*rows.filter(r=>r.position!<=10).reduce((n,r)=>n+r.impressions,0)/impressions;
 const ctr=100*clicks/impressions;
 // 70% observed top-ten impression share, 30% CTR against a declared 5% reference.
 // No universal CTR benchmark is claimed; the raw figures are always displayed.
 const score=Math.round(.7*top10+.3*clamp(ctr/5*100));
 return {score:stale?null:score,impressions,clicks,position,top10,ctr,pages:new Set(rows.map(r=>r.keys[0])).size,stale,lowSample:impressions<100,start:snapshot.start,end:snapshot.end};
}
export function discoveryReadiness(technical:number|undefined,search:ReturnType<typeof searchVisibility>,citations?:{cited:number;total:number}) {
 if(technical===undefined || !search || search.score===null)return null;
 const ai=citations && citations.total>=10?100*citations.cited/citations.total:null;
 const visibility=ai===null?search.score:.8*search.score+.2*ai;
 const blended=Math.round(.35*technical+.65*visibility);
 // Explicit conservative rule for sparse evidence; never present tidiness as success.
 return search.clicks<10?Math.min(55,blended):blended;
}
export const visibilityMethod='Search visibility: 70% of the score is the share of reported impressions at average positions 1–10; 30% is click-through rate scaled against a 5% reference (not an industry benchmark). Readiness: 35% technical health + 65% observed visibility. With at least 10 recent AI samples, the visibility portion is 80% search and 20% AI citations. Fewer than 10 reported clicks caps readiness at 55. Missing or over-45-day-old search data means no readiness score. Query data can omit private or low-volume searches; unreported pages are not assumed unindexed. Indexation coverage is measured separately in its own dashboard tile.';

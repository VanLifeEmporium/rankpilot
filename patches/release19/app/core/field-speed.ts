/** Release 18: Chrome UX Report (real-visitor) speed, 75th percentile over the last 28 days. */
export type FieldMetric={p75:number|null;rating:'good'|'needs-improvement'|'poor'|null};
export type FieldPage={label:string;url:string;level:'url'|'origin'|'none';lcp:FieldMetric;inp:FieldMetric;cls:FieldMetric;period?:string};
export type FieldSpeed={checkedAt:string;pages:FieldPage[];error?:string;note?:string};
const LIMITS={lcp:[2500,4000],inp:[200,500],cls:[0.1,0.25]} as const;
export function rate(kind:keyof typeof LIMITS,value:number|null):FieldMetric['rating']{
 if(value===null||!Number.isFinite(value))return null;const [good,poor]=LIMITS[kind];return value<=good?'good':value<=poor?'needs-improvement':'poor';
}
type CruxRecord={record?:{metrics?:Record<string,{percentiles?:{p75?:number|string}}>;collectionPeriod?:{lastDate?:{year:number;month:number;day:number}}}};
export function parseCrux(label:string,url:string,level:FieldPage['level'],j:CruxRecord|null):FieldPage{
 const m=j?.record?.metrics||{};
 const p75=(k:string)=>{const v=m[k]?.percentiles?.p75;const n=typeof v==='string'?Number(v):v;return typeof n==='number'&&Number.isFinite(n)?n:null;};
 const lcp=p75('largest_contentful_paint'),inp=p75('interaction_to_next_paint'),cls=p75('cumulative_layout_shift');
 const d=j?.record?.collectionPeriod?.lastDate;
 return {label,url,level:j?level:'none',lcp:{p75:lcp,rating:rate('lcp',lcp)},inp:{p75:inp,rating:rate('inp',inp)},cls:{p75:cls,rating:rate('cls',cls)},period:d?`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`:undefined};
}
/** 0–100 from the measured ratings: good 100, needs improvement 50, poor 0. Null when no field data exists. */
export function fieldScore(f:FieldSpeed|undefined|null){
 const ratings=(f?.pages||[]).flatMap(p=>[p.lcp.rating,p.inp.rating,p.cls.rating]).filter((r):r is NonNullable<FieldMetric['rating']>=>!!r);
 if(!ratings.length)return null;
 return Math.round(ratings.reduce((n,r)=>n+(r==='good'?100:r==='needs-improvement'?50:0),0)/ratings.length);
}
export function fieldLine(p:FieldPage){
 if(p.level==='none')return `${p.label}: no real-visitor data (Chrome needs enough visits to report this page or site).`;
 const f=(name:string,m:FieldMetric,unit:(v:number)=>string)=>`${name} ${m.p75===null?'not reported':unit(m.p75)}${m.rating?` (${m.rating.replace('-',' ')})`:''}`;
 return `${p.label}${p.level==='origin'?' (whole-site data; this page has too few visits)':''}: ${f('LCP',p.lcp,v=>(v/1000).toFixed(1)+' s')} · ${f('INP',p.inp,v=>Math.round(v)+' ms')} · ${f('CLS',p.cls,v=>v.toFixed(2))}`;
}

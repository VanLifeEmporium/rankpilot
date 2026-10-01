import type {Issue} from './types';
import {normalisePath,resourcePath,type LivenessResource} from './page-liveness';
/**
 * Release 20 (RP-302): pages Google still shows but shoppers cannot open. Suggest the closest live
 * product or collection; never the home page (Google treats that as a soft 404).
 */
const STOP=new Set(['products','product','collections','collection','pages','blogs','news','the','and','for','with','uk','van','campervan','life','emporium','original','new']);
// Plurals fold to the singular, so “chair” matches “Camping Chairs”.
const stem=(w:string)=>w.length>4&&w.endsWith('ies')?w.slice(0,-3)+'y':w.length>3&&/[^s]s$/.test(w)?w.slice(0,-1):w;
const tokens=(s:string)=>new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2&&!STOP.has(w)&&!/^\d+$/.test(w)).map(stem));
export type DeadPage={url:string;impressions:number;queries:string[];reason:'not-found'|'unpublished';resourceId?:string;productType?:string;kind?:string;dated?:string[]};
/** Release 22 (R22-501): what a deleted page was, kept at sync so its redirect can match by type. */
export type RetiredPage={path:string;kind:string;title:string;handle:string;productType?:string;removedAt:string};
/**
 * Release 22 (R22-501): a dead page goes somewhere of the same kind.
 * - A product page needs a live product of the same product type, or a collection; a product of a
 *   different type (a picnic table sent to a camping toilet) is rejected.
 * - A dead collection is redirected to a live collection, never a single product.
 * - When a product and a collection score the same, the collection wins (it keeps more of the page's intent).
 */
export function redirectSuggestion(dead:DeadPage,candidates:(LivenessResource&{productType?:string})[]){
 const deadPath=normalisePath(dead.url);
 const deadKind=deadPath.startsWith('/collections/')?'collection':deadPath.startsWith('/products/')?'product':/^\/(blogs|pages)\//.test(deadPath)?'guide':'other';
 const deadType=(dead.productType||'').toLowerCase().trim();
 const wanted=new Set([...tokens(deadPath),...tokens(deadType),...dead.queries.flatMap(q=>[...tokens(q)])]);
 const scored=candidates.filter(c=>(deadKind==='guide'?['article','page','collection']:['product','collection']).includes(c.kind)&&resourcePath(c)!==deadPath).filter(c=>{
  if(deadKind==='collection')return c.kind==='collection';
  // Release 22 (R22-604): a guide (blog post or page) goes to the closest live guide, or a collection.
  if(deadKind==='guide')return true;
  // Products only when the type is known and matches; otherwise only collections are safe.
  if(c.kind==='product')return !!deadType&&!!c.productType&&c.productType.toLowerCase().trim()===deadType;
  return true;
 }).map(c=>{
  const have=tokens(`${c.title} ${c.handle} ${c.productType||''}`);
  const overlap=[...wanted].filter(w=>have.has(w)).length;
  const sameType=c.kind==='product'||(deadKind==='guide'&&c.kind==='article');
  return {path:resourcePath(c),title:c.title,kind:c.kind,score:overlap+(sameType?2:0)};
 }).filter(c=>c.score>=2).sort((a,b)=>b.score-a.score||(a.kind==='collection'?-1:b.kind==='collection'?1:0));
 return scored[0]||null;
}
/**
 * Release 22 (R22-604): details in an old guide that may have gone out of date while it was unpublished
 * (past years, prices, opening times, "currently"), to check before republishing.
 */
export function datedFacts(text:string,now=new Date()):string[]{
 const year=now.getUTCFullYear();
 const out:string[]=[];
 for(const sentence of (text||'').replace(/\s+/g,' ').match(/[^.!?]+[.!?]?/g)||[]){
  const t=sentence.trim();
  const years=[...t.matchAll(/\b(19|20)\d{2}\b/g)].map(m=>Number(m[0])).filter(y=>y<year);
  if(years.length||/\b(?:currently|at the moment|this (?:year|season|summer|winter)|next (?:year|season|summer)|recently|new for|opening (?:hours|times)|open (?:daily|from)|costs?|price[sd]?|fee|per night)\b|£\s?\d/i.test(t))out.push(t.length>160?t.slice(0,157)+'…':t);
  if(out.length>=5)break;
 }
 return out;
}
export function deadPageIssue(dead:DeadPage,suggestion:ReturnType<typeof redirectSuggestion>):Issue{
 const path=normalisePath(dead.url);
 const seen=`Google showed it ${dead.impressions} ${dead.impressions===1?'time':'times'} in the last 28 days${dead.queries.length?` (e.g. “${dead.queries.slice(0,2).join('”, “')}”)`:''}.`;
 if(dead.reason==='unpublished')return {resourceId:dead.resourceId||`url:${path}`,title:path,code:'unpublished-with-impressions',severity:'warning',
  detail:`${path} is unpublished, but ${seen} Republish it if it should be live, or redirect it${suggestion?` to ${suggestion.title} (${suggestion.path})`:''} so the traffic is not lost.${dead.dated?.length?` Before republishing, check these dated details: ${dead.dated.map(d=>`“${d}”`).join('; ')}.`:''}`,
  link:{url:dead.url,status:404,checkedAt:new Date().toISOString()},...(suggestion?{suggestion:{path:suggestion.path,title:suggestion.title}}:{})};
 return {resourceId:`url:${path}`,title:path,code:'404-with-impressions',severity:'warning',
  detail:suggestion?`${path} returns 404, but ${seen} Redirect it to the closest live page: ${suggestion.title} (${suggestion.path}).`:`${path} returns 404, but ${seen} No live page shares its product or search terms, so leave it as a 404 rather than redirecting to the home page (Google treats that as a soft 404).`,
  link:{url:dead.url,status:404,checkedAt:new Date().toISOString()},...(suggestion?{suggestion:{path:suggestion.path,title:suggestion.title}}:{})};
}

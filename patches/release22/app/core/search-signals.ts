import type {Issue,Payload} from './types';
import {metricTitle} from './brand-rules';
/**
 * Release 20 (RP-202): the brand and model words shoppers search for that the title has lost.
 * A query word counts as product identity when it is the brand or appears in the product's handle
 * (the address Shopify made from the original title), so "andes nevado 400" on
 * /products/andes-nevado-400-… flags a title that says only "XL Mummy Sleeping Bag".
 */
const STOP=new Set(['the','and','for','with','uk','best','buy','cheap','sale','review','reviews','near','me','what','how','is','a','an','of','to','in','on','van','campervan']);
const words=(s:string)=>(s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').match(/[a-z0-9]+/g)||[]);
export type QueryRow={query:string;impressions:number};
export type TermKind='brand'|'model'|'description';
export function missingSearchTerms(p:Payload,queries:QueryRow[],brands:string[]=[],minImpressions=5){
 const have=new Set([...words(p.title),...words(p.seo?.title||'')]);
 const handle=new Set(words(p.handle||''));const brand=new Set(brands.flatMap(words));
 for(const q of [...queries].filter(q=>q.impressions>=minImpressions).sort((a,b)=>b.impressions-a.impressions)){
  const tokens=words(q.query).filter(w=>!STOP.has(w)&&(w.length>2||/\d/.test(w)));
  const identity=tokens.filter(w=>brand.has(w)||handle.has(w));
  const missing=identity.filter(w=>!have.has(w));
  // At least the brand or a model word (with a digit, or two handle words) is missing.
  if(!missing.length||!(missing.some(w=>brand.has(w)||/\d/.test(w))||missing.length>=2))continue;
  const phrase=q.query.split(/\s+/).filter(w=>missing.includes(words(w)[0]||'')).map(w=>/\d/.test(w)?w:w[0].toUpperCase()+w.slice(1)).join(' ');
  // Release 22 (R22-503): say what each missing word is, so the right words are added.
  const kinds=Object.fromEntries(missing.map(w=>[w,(brand.has(w)?'brand':/\d/.test(w)?'model':'description') as TermKind]));
  return {query:q.query,impressions:q.impressions,missing,phrase,kinds};
 }
 return null;
}
type Hit=NonNullable<ReturnType<typeof missingSearchTerms>>;
const cap=(w:string)=>/\d/.test(w)||w===w.toUpperCase()?w.toUpperCase().replace(/(\d)(ML|L|CM|MM|KG|G)$/,(m,d,u)=>d+u.toLowerCase()):w[0].toUpperCase()+w.slice(1).toLowerCase();
/**
 * Release 22 (R22-503): an example title that keeps the brand first, writes units in metric, puts the
 * missing words where the search has them, and never starts with a bracket.
 */
export function exampleTitle(p:Payload,hit:Hit,brands:string[]=[],opts:{volume?:boolean}={}){
 let title=metricTitle(p.title,{volume:opts.volume})||p.title;
 const brand=[...brands].sort((a,b)=>b.length-a.length).find(b=>new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(\\s|$)`,'i').test(title));
 if(brand){title=title.replace(new RegExp(`(^|\\s)${brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=\\s|$)`,'i'),' ').replace(/\s+/g,' ').trim();}
 const missingBrand=hit.missing.filter(w=>hit.kinds[w]==='brand');
 const lead=brand||(missingBrand.length?missingBrand.map(cap).join(' '):'');
 // The search's words in order; bracketed parts are kept for the end.
 const raw=hit.query.split(/\s+/);
 const bracketed:string[]=[];const inBrackets=new Set<number>();let open=false;
 raw.forEach((w,i)=>{if(w.startsWith('('))open=true;if(open){inBrackets.add(i);bracketed.push(w);}if(w.endsWith(')'))open=false;});
 const insert=raw.filter((w,i)=>!inBrackets.has(i)&&hit.missing.includes(words(w)[0]||'')&&hit.kinds[words(w)[0]||'']!=='brand').map(cap);
 const parts=title.split(' ');
 // Put the missing words before the next search word the title already has ("stainless steel" before "Food").
 const lastMissing=Math.max(...raw.map((w,i)=>hit.missing.includes(words(w)[0]||'')?i:-1));
 const next=raw.slice(lastMissing+1).map(w=>words(w)[0]||'').find(w=>parts.some(x=>(words(x)[0]||'')===w));
 const at=next?parts.findIndex(x=>(words(x)[0]||'')===next):parts.length;
 parts.splice(at<0?parts.length:at,0,...insert);
 let out=[lead,...parts].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
 const missingBracket=bracketed.filter(w=>hit.missing.includes(words(w)[0]||''));
 if(missingBracket.length)out=`${out} (${bracketed.join(' ').replace(/[()]/g,'').split(' ').map(cap).join(' ')})`;
 return out.replace(/^\(+/,'').trim();
}
export function searchTermIssue(resourceId:string,p:Payload,hit:Hit,brands:string[]=[],opts:{volume?:boolean}={}):Issue{
 const label=(k:TermKind)=>k==='brand'?'the brand':k==='model'?'a model name or number':'a description (what it is, is made of or looks like), not a brand or model';
 const groups=(['brand','model','description'] as TermKind[]).map(k=>({k,ws:hit.missing.filter(w=>hit.kinds[w]===k)})).filter(g=>g.ws.length);
 const explain=groups.map(g=>`“${g.ws.join(' ')}” is ${label(g.k)}`).join('; ');
 const what=groups.length===1&&groups[0].k==='description'?'Add these words to the title or SEO title where they read naturally':'Add the brand and model to the title or SEO title';
 return {resourceId,title:p.title,code:'title-missing-search-terms',severity:'warning',feature:'seo',
  detail:`Google showed this page ${hit.impressions} times for “${hit.query}”, but neither the title nor the SEO title contains “${hit.phrase}”. ${explain}. ${what}, e.g. “${exampleTitle(p,hit,brands,opts)}”.`};
}
/** Release 20 (RP-401): order a grouped finding's pages by Google impressions, highest first. */
export function rankByImpressions(issue:Issue,impressions:Map<string,number>,titles:Map<string,string>):Issue{
 if(!issue.resourceIds?.length)return issue;
 const ids=[...issue.resourceIds].sort((a,b)=>(impressions.get(b)||0)-(impressions.get(a)||0));
 const top=ids.filter(id=>(impressions.get(id)||0)>0).slice(0,5);
 return {...issue,resourceIds:ids,detail:issue.detail+(top.length?` Start with the pages Google shows most: ${top.map(id=>`${titles.get(id)||id} (${impressions.get(id)} impressions)`).join(', ')}.`:'')};
}

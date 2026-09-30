import type {Issue,Payload} from './types';
/**
 * Release 20 (RP-202): the brand and model words shoppers search for that the title has lost.
 * A query word counts as product identity when it is the brand or appears in the product's handle
 * (the address Shopify made from the original title), so "andes nevado 400" on
 * /products/andes-nevado-400-… flags a title that says only "XL Mummy Sleeping Bag".
 */
const STOP=new Set(['the','and','for','with','uk','best','buy','cheap','sale','review','reviews','near','me','what','how','is','a','an','of','to','in','on','van','campervan']);
const words=(s:string)=>(s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').match(/[a-z0-9]+/g)||[]);
export type QueryRow={query:string;impressions:number};
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
  return {query:q.query,impressions:q.impressions,missing,phrase};
 }
 return null;
}
export function searchTermIssue(resourceId:string,p:Payload,hit:NonNullable<ReturnType<typeof missingSearchTerms>>):Issue{
 return {resourceId,title:p.title,code:'title-missing-search-terms',severity:'warning',feature:'seo',
  detail:`Google showed this page ${hit.impressions} times for “${hit.query}”, but neither the title nor the SEO title contains “${hit.phrase}”. Add the brand and model to the title or SEO title, e.g. “${hit.phrase} ${p.title}”.`};
}
/** Release 20 (RP-401): order a grouped finding's pages by Google impressions, highest first. */
export function rankByImpressions(issue:Issue,impressions:Map<string,number>,titles:Map<string,string>):Issue{
 if(!issue.resourceIds?.length)return issue;
 const ids=[...issue.resourceIds].sort((a,b)=>(impressions.get(b)||0)-(impressions.get(a)||0));
 const top=ids.filter(id=>(impressions.get(id)||0)>0).slice(0,5);
 return {...issue,resourceIds:ids,detail:issue.detail+(top.length?` Start with the pages Google shows most: ${top.map(id=>`${titles.get(id)||id} (${impressions.get(id)} impressions)`).join(', ')}.`:'')};
}

import type {Payload,Settings} from './types';
export const legacyWordCap=(reasons:string[])=>reasons.some(r=>/five[ -]word|five words|5[ -]word|maximum\s+5\s+words/i.test(r));
const words=(s:string):string[]=>s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
export function metadataScore(value:Payload['seo']){
 const title=value.title.trim(),summary=value.description.trim();
 return (title.length>=30&&title.length<=60?40:title?20:0)+(summary.length>=150&&summary.length<=160?40:summary?20:0)+(title&&summary?20:0);
}
/** Never shorten accurate identity or a good existing summary to manufacture a fix. */
export function metadataQuality(p:Payload,candidate:Payload['seo'],cfg:Settings){
 const current=p.seo,after={...candidate};const notes:string[]=[];
 if(after.title!==current.title){
  const identity=words(p.title),actual=words(after.title);const missing=identity.filter(w=>!actual.includes(w));
  const punctuationChanged=identity.join(' ')===words(current.title).slice(0,identity.length).join(' ')&&current.title.includes(p.title)&&!after.title.includes(p.title);
  const brand=cfg.titleBrand?.trim();const oldSuffix=current.title.match(/\s[|–—]\s(.+)$/)?.[1];
  const lostBrand=cfg.titleBrandMode!=='omit'&&((brand&&current.title.includes(brand)&&!after.title.includes(brand))||(oldSuffix&&current.title.length<=60&&!after.title.includes(oldSuffix)));
  if(after.title.length<30||after.title.length>60||missing.length||punctuationChanged||lostBrand){after.title=current.title;notes.push('Existing title retained: the candidate shortened the page identity, lost its brand, changed its wording or missed the character range.');}
 }
 if(after.description!==current.description&&(after.description.length<150||after.description.length>160||(current.description.length<=160&&after.description.length<current.description.length))){after.description=current.description;notes.push('Existing summary retained: a generated summary must be 150–160 characters and must not shorten an existing summary within the limit.');}
 const delta=metadataScore(after)-metadataScore(current);
 const changed=JSON.stringify(after)!==JSON.stringify(current);
 // Same-quality cosmetic rewrites are not an improvement; preserve merchant content.
 if(!after.title.trim()||!changed||delta<=0)return {after:current,delta:0,notes:['Current content already meets guidance, or no measurable improvement passed the content safeguards.',...notes]};
 return {after,delta,notes:[`Quality improvement +${delta}/100 on the metadata rubric (title range 40, summary range 40, both fields present 20). Identity and brand are preserved.`,...notes]};
}

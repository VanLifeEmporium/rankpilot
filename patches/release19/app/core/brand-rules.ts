import {load} from 'cheerio';
import type {Facts} from './types';
/**
 * Release 19: one brand rule list for every writer (merchant, AI drafts, agents) and every check
 * (SEO, description, source draft, go-live). Errors block a save; warnings are shown.
 */
export type RuleHit={rule:string;severity:'error'|'warning';match:string};
const SALES=['hot sale','best quality','brand new','pimp','buy now','stocks last','top rated','product description','the video showcases'];
const ALLOWED_CAPS=new Set(['USB','LED','UK','BPA','XL','XXL','XXXL','UKCA','UPF','SPF','RRP','FAQ','FAQS','PVC','EVA','HDPE','LDPE','TPU','ABS','DIY','GPS','LPG','VAT','SKU','GTIN','ISBN','IP','UV','AC','DC','PDF']);
const US_SPELLINGS:[RegExp,string][]=[[/\bcolou?r(s|ed|ful)?\b/gi,'colour'],[/\borganiz(e|es|ed|ing|er|ers|ation)\b/gi,'organise'],[/\bgray\b/gi,'grey'],[/\baluminum\b/gi,'aluminium'],[/\bcenter(s|ed)?\b/gi,'centre'],[/\bfavorite(s)?\b/gi,'favourite']];
export const plain=(value:string)=>/<[a-z][\s\S]*>/i.test(value)?load(`<div>${value}</div>`,null,false).root().text():value;
export function brandRuleHits(value:string):RuleHit[]{
 const text=plain(value||'');const hits:RuleHit[]=[];const add=(rule:string,match:string,severity:RuleHit['severity']='error')=>{if(!hits.some(h=>h.rule===rule&&h.match.toLowerCase()===match.toLowerCase()))hits.push({rule,severity,match});};
 if(text.includes('!'))add('Exclamation mark','!');
 const lower=text.toLowerCase();
 for(const phrase of SALES)if(new RegExp(`\\b${phrase.replace(/ /g,'\\s+')}\\b`,'i').test(lower))add(phrase==='product description'||phrase==='the video showcases'?'Supplier formatting':'Sales language',phrase);
 if(/[【】]/.test(text))add('Supplier formatting','【】');
 for(const m of text.matchAll(/\b[A-Z][A-Z-]{3,}\b/g)){const word=m[0].replace(/-+$/,'');if(word.split('-').every(w=>w.length<4||ALLOWED_CAPS.has(w)))continue;add('Capitals',word);}
 for(const m of text.matchAll(/\d(?:[\d.,/]*)\s?(inches|inch|in\b(?!\s+(?:a|an|the|one|two|three|stock|use|total|each|your|our|this|that|it|place|store|colours?|sizes?)\b)|"|”|″|lbs?\b|oz\b|ft\b|feet\b|foot\b)/gi))add('Imperial units',m[0].trim());
 for(const [re,uk] of US_SPELLINGS){const us=text.match(re)?.find(w=>!/^colour/i.test(w));if(us)add('US spelling',`${us} (use ${uk})`,'warning');}
 return hits;
}
export const ruleErrors=(value:string)=>brandRuleHits(value).filter(h=>h.severity==='error');
export const ruleSummary=(hits:RuleHit[])=>[...new Set(hits.map(h=>h.rule))].map(rule=>`${rule}: ${hits.filter(h=>h.rule===rule).map(h=>h.match).slice(0,4).join(', ')}`).join('; ');
/**
 * Release 19: claims no writer may publish unless the value is in the product's confirmed facts.
 * Ratings, reviews, certifications, waterproof/IP ratings, GTINs, prices and marketplace links.
 */
export function unverifiedClaims(value:string,facts:Facts={},before=''):string[]{
 const text=plain(value||'');const html=value||'';const confirmed=Object.entries(facts).filter(([k,f])=>k!=='barcode'&&f?.confirmed&&f.value).map(([,f])=>f.value.toLowerCase()).join(' \n ');
 const known=(s:string)=>confirmed.includes(s.toLowerCase().trim());
 const already=plain(before||'');
 const out:string[]=[];
 const claim=(re:RegExp,reason:string)=>{for(const m of text.matchAll(re)){const s=m[0];if(known(s)||already.includes(s))continue;out.push(reason);return;}};
 claim(/\b(?:rated|rating(?: of)?)\s+\d(?:\.\d)?\s*(?:\/\s*5|out of 5|stars?)|\b\d(?:\.\d)?\s*(?:\/\s*5|out of 5)\s*stars?|\b\d(?:\.\d)?[- ]stars?\b|\b[\d,]+\+?\s*(?:happy |satisfied )?(?:customers?|reviews?|ratings?)\b|★/gi,'Unverified rating or review claim');
 claim(/\b(?:CE|UKCA|FSC|OEKO[- ]?TEX|ISO\s?\d{3,5}|BS\s?EN\s?\d+|EN\s?\d{3,5}|TÜV|TUV|GOTS|Fairtrade)\b(?:[- ]?(?:certified|marked|approved|standard))?|\bcertified\b|\bapproved by\b/gi,'Unverified certification');
 claim(/\bIP[X]?\d{1,2}\b|\bwaterproof(?: to| rating)?\s*\d*\s*(?:mm|m)?\b|\b\d{3,5}\s?mm\s*(?:HH|hydrostatic head)\b/gi,'Unverified waterproof or IP rating');
 claim(/\b(?:GTIN|EAN|UPC|ISBN)\b[:\s#-]*\d{8,14}|\b\d{12,14}\b/gi,'Unverified GTIN or EAN');
 claim(/[£$€]\s?\d+(?:[.,]\d{2})?|\b\d+(?:\.\d{2})?\s?(?:GBP|pounds)\b/gi,'Price in copy');
 if(/\b(?:amazon\.[a-z.]+|amzn\.to|ebay\.[a-z.]+|aliexpress\.[a-z]+|temu\.com)\b/i.test(html)&&!/\b(?:amazon|amzn|ebay|aliexpress|temu)\./i.test(before||''))out.push('Marketplace link');
 return [...new Set(out)];
}
/** A rewrite that removes more than 40% of the words loses information. */
export function wordCut(before:string,after:string){
 const n=(s:string)=>plain(s).split(/\s+/).filter(Boolean).length;const b=n(before),a=n(after);
 return b>=40&&a<b*0.6?`Word count cut by ${Math.round(100*(1-a/b))}% (${b} to ${a}); keep the useful detail`:null;
}
/** Rule hits in the new value that the previous value did not already have (legacy text is flagged elsewhere). */
export function newRuleErrors(before:string,after:string){
 const old=new Set(brandRuleHits(before||'').map(h=>h.rule+'|'+h.match.toLowerCase()));
 return ruleErrors(after).filter(h=>!old.has(h.rule+'|'+h.match.toLowerCase()));
}
/** Text fields of a proposed value, for SEO ({title, description}), FAQ lists and HTML/strings. */
export function proposalText(value:unknown):string{
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(v=>v&&typeof v==='object'?`${(v as {question?:string}).question||''}\n${(v as {answer?:string}).answer||''}`:'').join('\n');
 if(value&&typeof value==='object'){const v=value as {title?:string;description?:string};return `${v.title||''}\n${v.description||''}`;}
 return '';
}
/** Release 19: the gate every writer passes before a change can be approved. */
export function brandGate(feature:string,before:unknown,after:unknown,facts:Facts={}){
 if(!['seo','title','description','faq'].includes(feature))return [];
 const b=proposalText(before),a=proposalText(after);
 const problems:string[]=[];
 const hits=newRuleErrors(b,a);if(hits.length)problems.push(ruleSummary(hits));
 problems.push(...unverifiedClaims(a,facts,b));
 if(feature==='description'){const cut=wordCut(b,a);if(cut)problems.push(cut);}
 return problems;
}

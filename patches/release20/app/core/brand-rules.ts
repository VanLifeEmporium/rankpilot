import {load} from 'cheerio';
import type {Facts} from './types';
import {titleProblems} from './learned-rules';
/**
 * Release 19: one brand rule list for every writer (merchant, AI drafts, agents) and every check
 * (SEO, description, source draft, go-live). Errors block a save; warnings are shown.
 */
export type RuleHit={rule:string;severity:'error'|'warning';match:string};
const SALES=['hot sale','best quality','brand new','pimp','buy now','stocks last','top rated','product description','the video showcases'];
// Release 20 (RP-501): technical acronyms are not shouting.
const ALLOWED_CAPS=new Set(['USB','LED','UK','BPA','XL','XXL','XXXL','UKCA','UPF','SPF','RRP','FAQ','FAQS','PVC','EVA','HDPE','LDPE','TPU','ABS','DIY','GPS','LPG','VAT','SKU','GTIN','ISBN','IP','UV','AC','DC','PDF',
 'MIMO','MPPT','PWM','HDMI','WIFI','WLAN','LTE','DAB','AGM','BMS','NFC','OLED','LCD','RGB','RGBW','IPX','UHF','VHF','CPU','SIM','GSM','RCD','RCBO','MCB','EHU','LIFEPO','LIFEPO4','NATO','ANSI','NASA','ECO','HEPA','PTFE','PFAS','PFOA','BBQ','CCTV','DVR','USBC','QI','APP','PIR','ASAP','SOS','IPA','VHB','EPDM','UPVC','PET','RPET','OEKO','FSC','GOTS','EVA','TPE','NBR','PU','PE','PP','LED','SMD','COB','CRI','AAA','AA','ANC','TWS','USB-C','ATV','UTV','RV','SUV','VW','MPV','ISOFIX','AUX','OBD','CAN','ECU','DAB+']);
export type RuleOptions={allow?:Iterable<string>;brands?:string[];productTitle?:string;storeNames?:string[]};
/** Words allowed in capitals for one product: its vendor and title words, plus the merchant's allowlist. */
export function allowedCaps(...sources:(string|string[]|undefined)[]){const out=new Set<string>();for(const src of sources)for(const w of [src||''].flat().join(' ').split(/[^A-Za-z0-9+-]+/))if(w)out.add(w.toUpperCase());return out;}
const US_SPELLINGS:[RegExp,string][]=[[/\bcolou?r(s|ed|ful)?\b/gi,'colour'],[/\borganiz(e|es|ed|ing|er|ers|ation)\b/gi,'organise'],[/\bgray\b/gi,'grey'],[/\baluminum\b/gi,'aluminium'],[/\bcenter(s|ed)?\b/gi,'centre'],[/\bfavorite(s)?\b/gi,'favourite']];
export const plain=(value:string)=>/<[a-z][\s\S]*>/i.test(value)?load(`<div>${value}</div>`,null,false).root().text():value;
const METRIC_NEAR=/\d\s?(?:mm|cm|m|km|kg|g|ml|l|litres?|liters?)\b/i;
const IMPERIAL=/(\d[\d.,/]*(?:\s?(?:to|-|–|x|×|by)\s?\d[\d.,/]*)*)\s?(inches|inch|in\b(?!\s+(?:a|an|the|one|two|three|stock|use|total|each|your|our|this|that|it|place|store|colours?|sizes?)\b)|"|”|″|lbs?\b|oz\b|ft\b|feet\b|foot\b)/gi;
/** Release 20 (RP-502): metric wording for an imperial measurement, e.g. "17 to 22 inches" → "43 to 56 cm". */
export function toMetric(numbers:string,unit:string){
 const u=unit.toLowerCase();const [factor,metric,dp]=/^(in|inch|inches|"|”|″)$/.test(u)?[2.54,'cm',0]:/^(ft|feet|foot)$/.test(u)?[0.3048,'m',1]:/^lbs?$/.test(u)?[0.4536,'kg',1]:[28.35,'g',0];
 return numbers.replace(/\d+(?:\.\d+)?/g,n=>{const v=Number(n)*factor;return dp?String(Math.round(v*10)/10):String(Math.round(v));})+' '+metric;
}
export function brandRuleHits(value:string,opts:RuleOptions={}):RuleHit[]{
 const extra=new Set([...(opts.allow||[])].map(w=>w.toUpperCase()));
 const text=plain(value||'');const hits:RuleHit[]=[];const add=(rule:string,match:string,severity:RuleHit['severity']='error')=>{if(!hits.some(h=>h.rule===rule&&h.match.toLowerCase()===match.toLowerCase()))hits.push({rule,severity,match});};
 if(text.includes('!'))add('Exclamation mark','!');
 const lower=text.toLowerCase();
 for(const phrase of SALES)if(new RegExp(`\\b${phrase.replace(/ /g,'\\s+')}\\b`,'i').test(lower))add(phrase==='product description'||phrase==='the video showcases'?'Supplier formatting':'Sales language',phrase);
 if(/[【】]/.test(text))add('Supplier formatting','【】');
 for(const m of text.matchAll(/\b[A-Z][A-Z-]{3,}\b/g)){const word=m[0].replace(/-+$/,'');if(ALLOWED_CAPS.has(word)||extra.has(word)||word.split('-').every(w=>w.length<4||ALLOWED_CAPS.has(w)||extra.has(w)))continue;add('Capitals',word);}
 // RP-502: accepted when a metric value is given alongside; otherwise propose the metric wording.
 for(const m of text.matchAll(IMPERIAL)){const at=m.index||0;const near=text.slice(Math.max(0,at-60),at+m[0].length+60);if(METRIC_NEAR.test(near))continue;add('Imperial units',`${m[0].trim()} → ${toMetric(m[1],m[2])}`);}
 for(const [re,uk] of US_SPELLINGS){const us=text.match(re)?.find(w=>!/^colour/i.test(w));if(us)add('US spelling',`${us} (use ${uk})`,'warning');}
 return hits;
}
export const ruleErrors=(value:string,opts:RuleOptions={})=>brandRuleHits(value,opts).filter(h=>h.severity==='error');
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
 // Release 20 (RP-503): "not waterproof", "isn't certified", "no IP rating" are not claims.
 const negated=(at:number)=>/\b(?:not|isn['’]t|aren['’]t|wasn['’]t|is not|are not|no|never|without|non)\b[\s-]*(?:(?:a|an|fully|completely|officially|yet|actually|designed to be|intended to be|rated|meant to be)\s+)*$/i.test(text.slice(Math.max(0,at-40),at));
 const claim=(re:RegExp,reason:string)=>{for(const m of text.matchAll(re)){const s=m[0];if(known(s)||already.includes(s)||negated(m.index||0))continue;out.push(reason);return;}};
 claim(/\b(?:rated|rating(?: of)?)\s+\d(?:\.\d)?\s*(?:\/\s*5|out of 5|stars?)|\b\d(?:\.\d)?\s*(?:\/\s*5|out of 5)\s*stars?|\b\d(?:\.\d)?[- ]stars?\b|\b[\d,]+\+?\s*(?:happy |satisfied )?(?:customers?|reviews?|ratings?)\b|★/gi,'Unverified rating or review claim');
 claim(/\b(?:CE|UKCA|FSC|OEKO[- ]?TEX|ISO\s?\d{3,5}|BS\s?EN\s?\d+|EN\s?\d{3,5}|TÜV|TUV|GOTS|Fairtrade)\b(?:[- ]?(?:certified|marked|approved|standard))?|\bcertified\b|\bapproved by\b/gi,'Unverified certification');
 claim(/\bIP[X]?\d{1,2}\b|\bwaterproof(?: to| rating)?\s*\d*\s*(?:mm|m)?\b|\b\d{3,5}\s?mm\s*(?:HH|hydrostatic head)\b/gi,'Unverified waterproof or IP rating');
 claim(/\b(?:GTIN|EAN|UPC|ISBN)\b[:\s#-]*\d{8,14}|\b\d{12,14}\b/gi,'Unverified GTIN or EAN');
 claim(/[£$€]\s?\d+(?:[.,]\d{2})?|\b\d+(?:\.\d{2})?\s?(?:GBP|pounds)\b/gi,'Price in copy');
 if(/\b(?:amazon\.[a-z.]+|amzn\.to|ebay\.[a-z.]+|aliexpress\.[a-z]+|temu\.com)\b/i.test(html)&&!/\b(?:amazon|amzn|ebay|aliexpress|temu)\./i.test(before||''))out.push('Marketplace link');
 return [...new Set(out)];
}
/**
 * A rewrite that removes more than 40% of the words loses information.
 * Release 20 (RP-504): words are counted over unique sentences, so removing repeated paragraphs or
 * bullets is not a cut.
 */
export function uniqueWordCount(value:string){
 const blocks=plain(/<[a-z][\s\S]*>/i.test(value||'')?(value||'').replace(/<\/(?:p|li|h[1-6]|div|td|th|dt|dd|tr|blockquote)>|<br\s*\/?>/gi,'$&\n'):value||'');
 const seen=new Set<string>();let n=0;
 for(const s of blocks.split(/\n+|(?<=[.!?])\s+/)){const words=s.trim().split(/\s+/).filter(Boolean);const key=words.join(' ').toLowerCase().replace(/[^\p{L}\p{N} ]/gu,'');if(!key||seen.has(key))continue;seen.add(key);n+=words.length;}
 return n;
}
export function wordCut(before:string,after:string){
 const b=uniqueWordCount(before),a=uniqueWordCount(after);
 return b>=40&&a<b*0.6?`Word count cut by ${Math.round(100*(1-a/b))}% (${b} to ${a} words, repeats not counted); keep the useful detail`:null;
}
/** Rule hits in the new value that the previous value did not already have (legacy text is flagged elsewhere). */
export function newRuleErrors(before:string,after:string,opts:RuleOptions={}){
 const old=new Set(brandRuleHits(before||'',opts).map(h=>h.rule+'|'+h.match.toLowerCase()));
 return ruleErrors(after,opts).filter(h=>!old.has(h.rule+'|'+h.match.toLowerCase()));
}
/** Text fields of a proposed value, for SEO ({title, description}), FAQ lists and HTML/strings. */
export function proposalText(value:unknown):string{
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(v=>v&&typeof v==='object'?`${(v as {question?:string}).question||''}\n${(v as {answer?:string}).answer||''}`:'').join('\n');
 if(value&&typeof value==='object'){const v=value as {title?:string;description?:string};return `${v.title||''}\n${v.description||''}`;}
 return '';
}
/** Release 20 (RP-202): brand names the old title had and the new one drops (people search for them). */
export function lostBrand(before:string,after:string,brands:string[]=[]){
 const has=(t:string,b:string)=>new RegExp(`(^|[^\\p{L}\\p{N}])${b.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^\\p{L}\\p{N}])`,'iu').test(t);
 return [...new Set(brands.filter(b=>b.trim().length>1))].filter(b=>has(before||'',b)&&!has(after||'',b));
}
const titleText=(feature:string,v:unknown)=>feature==='seo'&&v&&typeof v==='object'?String((v as {title?:string}).title||''):typeof v==='string'?v:'';
/** Release 19: the gate every writer passes before a change can be approved. */
export function brandGate(feature:string,before:unknown,after:unknown,facts:Facts={},opts:RuleOptions={}){
 if(!['seo','title','description','faq'].includes(feature))return [];
 const b=proposalText(before),a=proposalText(after);
 const problems:string[]=[];
 const hits=newRuleErrors(b,a,opts);if(hits.length)problems.push(ruleSummary(hits));
 problems.push(...unverifiedClaims(a,facts,b));
 if(feature==='description'){const cut=wordCut(b,a);if(cut)problems.push(cut);}
 if(['seo','title'].includes(feature)){const lost=lostBrand(titleText(feature,before),titleText(feature,after),opts.brands);if(lost.length)problems.push(`The new title drops the brand ${lost.map(b=>`“${b}”`).join(', ')}, which people search for; keep it`);}
 // Release 20 (RP-403): malformed SEO titles (no separator before the store name, product name altered); only new problems count.
 if(feature==='seo'&&opts.productTitle){const old=new Set(titleProblems(titleText(feature,before),opts.productTitle,opts.storeNames||[]));problems.push(...titleProblems(titleText(feature,after),opts.productTitle,opts.storeNames||[]).filter(x=>!old.has(x)));}
 return problems;
}

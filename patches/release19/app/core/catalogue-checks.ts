import {load} from 'cheerio';
import type {Facts,Payload} from './types';
/** Release 19: product checks that need the whole catalogue (template FAQs, vendors) or real validation (GTINs). */

// ---- R19-05: template FAQs ----
export function faqQuestionTexts(p:Payload){
 const $=load(p.descriptionHtml||'');
 const fromBody=$('h2,h3,h4,h5,h6,strong,b,dt,summary').toArray().map(e=>$(e).text().replace(/\s+/g,' ').trim()).filter(t=>/\?$/.test(t)&&t.length<200);
 return [...new Set([...fromBody,...(p.faqs||[]).map(f=>f.question)])];
}
/** A question with the product's own name removed, lower-cased, punctuation folded. */
export function normaliseQuestion(question:string,title:string){
 let q=question.toLowerCase();const name=title.toLowerCase().trim();
 if(name)q=q.split(name).join(' ');
 return q.replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
}

// ---- R19-06: barcodes ----
export function gtinCheckDigitValid(code:string){
 if(!/^\d+$/.test(code)||![8,12,13,14].includes(code.length))return false;
 const digits=code.split('').map(Number);const check=digits.pop()!;
 const sum=digits.reverse().reduce((n,d,i)=>n+d*(i%2===0?3:1),0);
 return (10-(sum%10))%10===check;
}
export type BarcodeProblem={code:string;severity:'warning'|'notice';detail:string};
export const isBook=(p:Payload)=>/\bbooks?\b/i.test(p.productType||'');
export function barcodeProblems(p:Payload):BarcodeProblem[]{
 const out:BarcodeProblem[]=[];
 const codes=[...new Set((p.variants||[]).map(v=>(v.barcode||'').replace(/\s+/g,'')).filter(Boolean))];
 for(const code of codes){
  if(!gtinCheckDigitValid(code)){out.push({code:'invalid-gtin',severity:'warning',detail:`Barcode ${code} is not a valid GTIN-8, 12, 13 or 14 (${/^\d+$/.test(code)?'the check digit does not match':'it contains non-digits'}). Check the code printed on the product or supplied by the manufacturer. Never make one up.`});continue;}
  const g13=code.padStart(13,'0');
  if(/^(0[2-4]|2\d)/.test(g13))out.push({code:'gtin-unusual-prefix',severity:'notice',detail:`Barcode ${code} uses a prefix reserved for in-store or restricted numbers. Google may not accept it as a manufacturer GTIN.`});
 }
 if(isBook(p)&&!codes.some(c=>/^97[89]\d{10}$/.test(c)&&gtinCheckDigitValid(c)))out.push({code:'book-without-isbn',severity:'warning',detail:`Books need their ISBN as the barcode (13 digits starting 978 or 979). ${codes.length?`Current barcode ${codes.join(', ')} is not an ISBN.`:'This book has no barcode.'} Take it from the book's copyright page or back cover.`});
 return out;
}

// ---- R19-07: vendors ----
const PLACEHOLDER=/^(n\/?a|none|unbranded|un-branded|no brand|generic|default|-|)$/i;
export const vendorKey=(v:string)=>v.toLowerCase().replace(/&/g,' and ').replace(/\b(ltd|limited|uk|co|company|inc|llc|plc)\b/g,' ').replace(/[^a-z0-9]+/g,'');
export type VendorContext={storeName:string;vendors:Map<string,Map<string,number>>};
export function vendorProblems(p:Payload,ctx:VendorContext):BarcodeProblem[]{
 const out:BarcodeProblem[]=[];const vendor=(p.vendor||'').trim();
 if(PLACEHOLDER.test(vendor)){out.push({code:'vendor-placeholder',severity:'warning',detail:`The vendor is “${vendor||'(blank)'}”. Set the real brand (the manufacturer, or ${ctx.storeName||'your store'} for own-label items) so Google Shopping shows it.`});return out;}
 const spellings=ctx.vendors.get(vendorKey(vendor));
 if(spellings&&spellings.size>1){const preferred=[...spellings].sort((a,b)=>b[1]-a[1])[0][0];if(preferred!==vendor)out.push({code:'vendor-near-duplicate',severity:'warning',detail:`Vendor “${vendor}” is spelt differently elsewhere (${[...spellings.keys()].map(s=>`“${s}”`).join(', ')}). Use one spelling, e.g. “${preferred}”.`});}
 const store=vendorKey(ctx.storeName);
 if(store&&vendorKey(vendor)===store){
  if(isBook(p))out.push({code:'vendor-store-on-book',severity:'warning',detail:`This book lists ${vendor} as its brand. Use the publisher as the vendor.`});
  else{const title=p.title.toLowerCase();const other=[...ctx.vendors.entries()].map(([k,m])=>({k,name:[...m.keys()][0]})).find(v=>v.k!==store&&v.name.length>=3&&!PLACEHOLDER.test(v.name)&&title.startsWith(v.name.toLowerCase()+' '));
   if(other)out.push({code:'vendor-mismatch',severity:'warning',detail:`The title starts with “${other.name}” but the vendor is ${vendor}. If ${other.name} makes it, set the vendor to ${other.name}.`});}
 }
 return out;
}

// ---- R19-04: answer readiness (7 shopper questions) ----
export const ANSWER_QUESTIONS=[
 {key:'size',label:'No size given'},{key:'material',label:'No material given'},{key:'included',label:"No “what's included”"},
 {key:'weight',label:'No weight given'},{key:'care',label:'No care instructions'},{key:'fit',label:'No fit guidance (van, locker or shelf)'},{key:'delivery',label:'No delivery information'},
] as const;
export type AnswerKey=typeof ANSWER_QUESTIONS[number]['key'];
const FACT_FOR:Record<AnswerKey,string[]>={size:['dimensions','capacity'],material:['materials'],included:['included'],weight:['weight'],care:['care'],fit:['compatibility'],delivery:[]};
const PATTERNS:Record<AnswerKey,RegExp>={
 size:/\b\d+(?:[.,]\d+)?\s?(?:x\s?\d+(?:[.,]\d+)?\s?)*(?:mm|cm|m|metres?|litres?|l|ml)\b|\b(?:dimensions|measures|diameter|height|width|length|depth)\b[^.]{0,40}\d/i,
 material:/\b(?:made (?:from|of|with)|material|fabric|cotton|linen|wool|polyester|nylon|canvas|leather|seagrass|rattan|jute|bamboo|wood(?:en)?|oak|pine|teak|acacia|steel|aluminium|enamel|ceramic|stoneware|porcelain|glass|silicone|plastic|polypropylene|fleece|flannel|down|velvet|marble|resin)\b/i,
 included:/\b(?:what'?s included|what is included|includes?|including|comes with|in the box|supplied with|set of \d+|pack of \d+|\d+\s?x\s?[a-z])/i,
 weight:/\b\d+(?:[.,]\d+)?\s?(?:kg|g|grams?|kilograms?)\b|\bweighs?\b[^.]{0,30}\d/i,
 care:/\b(?:wash(?:able|ing)?|wipe|clean(?:ing)?|care|dry clean|tumble|hand wash|dishwasher|oil(?:ing)? (?:the|it)|maintenance)\b/i,
 fit:/\b(?:fits?|fitting|locker|shelf|shelves|cupboard|under[- ]bed|under[- ]seat|campervan|motorhome|in the van|in your van|caravan|small spaces?|stows?|packs? (?:flat|down|small))\b/i,
 delivery:/\b(?:delivery|delivered|dispatch(?:ed)?|ships?|shipping|postage)\b/i,
};
/** Which of the 7 questions the product page answers, from its description, confirmed facts and metafields. */
export function answeredQuestions(p:Payload,facts:Facts,opts:{deliveryPolicy?:boolean}={}):Record<AnswerKey,boolean>{
 const text=load(`<div>${p.descriptionHtml||''}</div>`,null,false).root().text()+'\n'+(p.faqs||[]).map(f=>`${f.question} ${f.answer}`).join('\n');
 const meta=Object.entries(p.metafields||{}).map(([k,v])=>`${k}: ${v}`).join('\n');
 const result={} as Record<AnswerKey,boolean>;
 for(const q of ANSWER_QUESTIONS){
  const fact=FACT_FOR[q.key].some(k=>facts[k]?.confirmed&&facts[k].value?.trim());
  const metaHit=q.key==='size'?/\b(?:size|dimension|width|height|length|depth|diameter|capacity|volume)\b/i.test(meta):q.key==='weight'?/\bweight\b/i.test(meta):q.key==='material'?/\b(?:material|fabric)\b/i.test(meta):false;
  result[q.key]=fact||metaHit||PATTERNS[q.key].test(text)||(q.key==='delivery'&&!!opts.deliveryPolicy);
 }
 return result;
}

// ---- R19-15: checkable facts in articles ----
const MONTHS='January|February|March|April|May|June|July|August|September|October|November|December';
const FACT_PATTERNS:{label:string;re:RegExp}[]=[
 {label:'opening dates',re:new RegExp(`\\b(?:open(?:s|ing)?|closed?|closes|season)\\b[^.!?]{0,80}\\b(?:${MONTHS}|Easter|half[- ]term|bank holidays?)\\b`,'gi')},
 {label:'open all year',re:/\b(?:open all year(?: round)?|open year[- ]round|all[- ]year[- ]round|closed (?:in|over) (?:the )?winter)\b/gi},
 {label:'postcode',re:/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g},
 {label:'price',re:/£\s?\d+(?:\.\d{2})?(?:\s?(?:per|a|\/)\s?(?:night|pitch|person|adult|child|day|week))?/gi},
];
/** Next re-check: the start of the coming season (1 March, 1 June, 1 September, 1 December). */
export function nextSeason(now=new Date()){
 const starts:[number,string][]=[[2,'spring'],[5,'summer'],[8,'autumn'],[11,'winter']];
 const y=now.getUTCFullYear(),m=now.getUTCMonth();
 const next=starts.find(([month])=>month>m)||[2,'spring'];
 const year=next[0]>m?y:y+1;
 return {season:next[1],date:new Date(Date.UTC(year,next[0],1)).toISOString().slice(0,10)};
}
export function articleFacts(text:string){
 const items:{label:string;text:string}[]=[];
 for(const p of FACT_PATTERNS)for(const m of text.matchAll(p.re))items.push({label:p.label,text:m[0].trim().slice(0,80)});
 const seen=new Set<string>();return items.filter(i=>{const k=i.label+'|'+i.text.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}

// ---- R19-18: duplicate alt text within a product ----
export function duplicateAlts(images:{alt:string}[]){
 const count=new Map<string,number>();for(const i of images){const a=(i.alt||'').trim().toLowerCase();if(a)count.set(a,(count.get(a)||0)+1);}
 return [...count].filter(([,n])=>n>1).map(([alt,n])=>({alt,n}));
}

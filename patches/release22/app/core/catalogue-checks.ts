import {load} from 'cheerio';
import type {Facts,Payload} from './types';
import {factFaqs,type FactFaq} from './faq-facts';
import {brandList,detectBrand,isOwnLabel,type BrandProposal} from './brand-detect';
/** Release 19: product checks that need the whole catalogue (template FAQs, vendors) or real validation (GTINs). */

// ---- R19-05: template FAQs ----
export function faqQuestionTexts(p:Payload){
 const $=load(p.descriptionHtml||'');
 const clean=(t:string)=>t.replace(/\s+/g,' ').trim();
 const fromBody=$('h2,h3,h4,h5,h6,strong,b,dt,summary').toArray().map(e=>clean($(e).text())).filter(t=>/\?$/.test(t)&&t.length<200);
 // Release 20 (RP-402): plain paragraphs or list items ending "?" (or starting "Q:") after an FAQ heading.
 const inFaq:string[]=[];let open=false;
 $('h2,h3,h4,h5,h6,p,li,dt,strong,b').each((_,e)=>{const t=clean($(e).text());const name=(e as unknown as {name:string}).name;
  if(/^h[2-6]$/.test(name)||(['strong','b'].includes(name)&&!/\?$/.test(t))){if(/\b(faqs?|frequently asked|questions?)\b/i.test(t)&&!/\?$/.test(t)){open=true;return;}if(/^h[2-6]$/.test(name)&&!/\?$/.test(t))open=false;}
  if(open&&['p','li','dt'].includes(name)&&t.length<200){const q=t.replace(/^Q\s*[:.]\s*/i,'');if(/\?$/.test(q))inFaq.push(q);else if(/^Q\s*[:.]/i.test(t))inFaq.push(q.split(/\?/)[0]+'?');}
 });
 return [...new Set([...fromBody,...inFaq,...(p.faqs||[]).map(f=>f.question)])];
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
export type BarcodeProblem={code:string;severity:'warning'|'notice';detail:string;brand?:BrandProposal};
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
export type VendorContext={storeName:string;vendors:Map<string,Map<string,number>>;learnedBrands?:string[];knownBrands?:string[];handleLeads?:Map<string,number>};
export function vendorProblems(p:Payload,ctx:VendorContext,facts:Facts={}):BarcodeProblem[]{
 const out:BarcodeProblem[]=[];const vendor=(p.vendor||'').trim();
 if(PLACEHOLDER.test(vendor)){out.push({code:'vendor-placeholder',severity:'warning',detail:`The vendor is “${vendor||'(blank)'}”. Set the real brand (the manufacturer, or ${ctx.storeName||'your store'} for own-label items) so Google Shopping shows it.`});return out;}
 const spellings=ctx.vendors.get(vendorKey(vendor));
 if(spellings&&spellings.size>1){const preferred=[...spellings].sort((a,b)=>b[1]-a[1])[0][0];if(preferred!==vendor)out.push({code:'vendor-near-duplicate',severity:'warning',detail:`Vendor “${vendor}” is spelt differently elsewhere (${[...spellings.keys()].map(s=>`“${s}”`).join(', ')}). Use one spelling, e.g. “${preferred}”.`});}
 const store=vendorKey(ctx.storeName);
 if(store&&vendorKey(vendor)===store){
  if(isBook(p))out.push({code:'vendor-store-on-book',severity:'warning',detail:`This book lists ${vendor} as its brand. Use the publisher as the vendor. Open the book flow to find the publisher and ISBN.`});
  else if(!isOwnLabel(p,facts)){
   // Release 20 (RP-201): the real brand from the title, a Brand line or the handle, with its evidence.
   const found=detectBrand(p,brandList([...[...ctx.vendors.values()].map(m=>[...m.keys()][0]),...(ctx.learnedBrands||[]),...(ctx.knownBrands||[])],ctx.storeName),{handleLeads:ctx.handleLeads});
   // Release 22 (R22-401): medium confidence is a possible brand to check, not a confident proposal.
   if(found&&found.confidence==='medium'){const ev=found.evidence[0];out.push({code:'brand-is-store',severity:'notice',brand:found,detail:`Possible brand: the ${ev.where} suggests “${found.vendor}” (“${ev.text.slice(0,120)}”), but it may be a product name. Check it, then propose vendor “${found.vendor}” or confirm the brand for every product that uses it.`});}
   else if(found){const ev=found.evidence[0];out.push({code:'brand-is-store',severity:'warning',brand:found,detail:`The brand is ${vendor} (your store), but the ${ev.where} names ${found.vendor}: “${ev.text.slice(0,120)}”. Propose vendor “${found.vendor}” (${found.confidence} confidence) so Google Shopping and brand searches show the manufacturer. If this is your own label, tag the product “own-label”.`});}
  }
 }
 return out;
}

// ---- R19-04: answer readiness (7 shopper questions) ----
export const ANSWER_QUESTIONS=[
 {key:'size',label:'No size given'},{key:'material',label:'No material given'},{key:'included',label:"No “what's included”"},
 {key:'weight',label:'No weight given'},{key:'care',label:'No care instructions'},{key:'fit',label:'No fit guidance (van, locker, shelf or packed size)'},{key:'delivery',label:'No delivery information'},
 // Release 22 (R22-601): asked only of the product types they apply to (electricals and safety devices).
 {key:'power',label:'No power source given'},{key:'lifespan',label:'No battery or sensor life given'},
] as const;
export type AnswerKey=typeof ANSWER_QUESTIONS[number]['key'];
const FACT_FOR:Record<AnswerKey,string[]>={size:['dimensions','capacity'],material:['materials'],included:['included'],weight:['weight'],care:['care'],fit:['compatibility'],delivery:[],power:['power'],lifespan:[]};
const PATTERNS:Record<AnswerKey,RegExp>={
 size:/\b\d+(?:[.,]\d+)?\s?(?:x\s?\d+(?:[.,]\d+)?\s?)*(?:mm|cm|m|metres?|litres?|l|ml)\b|\b(?:dimensions|measures|diameter|height|width|length|depth)\b[^.]{0,40}\d/i,
 material:/\b(?:made (?:from|of|with)|material|fabric|cotton|linen|wool|polyester|nylon|canvas|leather|seagrass|rattan|jute|bamboo|wood(?:en)?|oak|pine|teak|acacia|steel|aluminium|enamel|ceramic|stoneware|porcelain|glass|silicone|plastic|polypropylene|fleece|flannel|(?:duck|goose) down|down[- ]filled|velvet|marble|resin)\b/i,
 included:/\b(?:what'?s included|what is included|includes?\b|comes with|in the box|supplied with|set of \d+|pack of \d+|\d+\s?x\s?[a-z])/i,
 weight:/\b\d+(?:[.,]\d+)?\s?(?:kg|g|grams?|kilograms?)\b|\bweighs?\b[^.]{0,30}\d/i,
 care:/\b(?:(?:machine |hand )?wash(?:able|ing)?|wipe (?:clean|down|dry)|clean (?:with|using|by)|cleaning|care (?:instructions|guide|label)|to care for|dry clean|tumble|dishwasher|oil(?:ing)? (?:the|it)|maintenance)\b/i,
 fit:/\b(?:fits?|fitting|locker|shelf|shelves|cupboard|under[- ]bed|under[- ]seat|campervan|motorhome|in the van|in your van|caravan|small spaces?|stows?|packs? (?:flat|down|small|away)|pack(?:ed)? size|folded size|folds? (?:down|flat) to)\b/i,
 power:/\b(?:batter(?:y|ies)|mains|plug[- ]in|usb(?:[- ]?c)?|rechargeable|12\s?v|230\s?v|240\s?v|aaa?\b|solar|hard[- ]?wired|powered by|power supply)\b/i,
 lifespan:/\b(?:(?:battery|sensor|alarm) life|lifespan|life of \d+|\d+[- ]?(?:year|yr)s?\s+(?:sealed\s+)?(?:battery|sensor|life)|lasts? (?:up to )?\d+\s?(?:years?|hours?|hrs?)|replace (?:it |the alarm )?(?:after|every) \d+)\b/i,
 delivery:/\b(?:delivery|delivered|dispatch(?:ed)?|ships?|shipping|postage)\b/i,
};
/** Which of the 7 questions the product page answers, from its description, confirmed facts and metafields. */
/**
 * Release 20 (RP-104): which questions apply to this product type. Delivery is judged once for the
 * whole store (a shared delivery line or policy answers it everywhere), so it is never per product.
 */
const NOT_RELEVANT:Partial<Record<AnswerKey,RegExp>>={
 fit:/\b(rugs?|mats?|books?|guides?|maps?|prints?|posters?|art|wall art|cards?|gift cards?|candles?|clothing|apparel|t-?shirts?|hoodies?|socks?|hats?|jewellery|cushions?|throws?|blankets?|bedding|towels?|food|drinks?|tea|coffee|soap|toiletries|skincare|sun ?cream|stickers?)\b/i,
 care:/\b(books?|guides?|maps?|gift cards?|stickers?|food|drinks?|tea|coffee|digital)\b/i,
 material:/\b(books?|guides?|maps?|gift cards?|digital|food|drinks?|tea|coffee)\b/i,
 weight:/\b(gift cards?|digital|stickers?)\b/i,
 size:/\b(gift cards?|digital)\b/i,
 included:/\b(gift cards?|digital)\b/i,
};
/** Release 22 (R22-601): product types with their own questions. */
export const SAFETY_DEVICE=/\b(?:alarms?|detectors?|extinguishers?|smoke|carbon monoxide|fire blankets?)\b/i;
export const ELECTRICAL=/\b(?:power stations?|power banks?|lanterns?|torch(?:es)?|flashlights?|lights?|lamps?|speakers?|fans?|heaters?|chargers?|routers?|projectors?|radios?|fridges?|refrigerators?|freezers?|blenders?|vacuums?|air pumps?|inflators?|electric|rechargeable|bluetooth|zappers?)\b/i;
const CAMP_GEAR=/\b(?:tents?|awnings?|shelters?|sleeping bags?|sleeping (?:mats?|pads?)|hammocks?|chairs?|tables?|stools?|loungers?|camp(?:ing)? furniture|privacy enclosures?|backpacks?)\b/i;
export function relevantQuestions(p:Payload){
 const kind=`${p.productType||''}`;const both=`${p.productType||''} ${p.title||''}`;
 const safety=SAFETY_DEVICE.test(kind);
 return ANSWER_QUESTIONS.filter(q=>{
  if(q.key==='delivery')return false;
  // A CO alarm is not marked down for a material or care instructions; it is asked about power and sensor life.
  if(safety&&(q.key==='material'||q.key==='care'))return false;
  if(q.key==='power')return safety||ELECTRICAL.test(both);
  if(q.key==='lifespan')return safety;
  return !(NOT_RELEVANT[q.key]?.test(kind));
 });
}
/** Release 22 (R22-601): for tents and other camping gear, "fit" means the packed size, not clothing fit. */
export const fitQuestion=(p:Payload)=>CAMP_GEAR.test(`${p.productType||''} ${p.title||''}`)?'What is the packed size?':'Will it fit in my van?';
/** Text a shopper can read on the page: description, FAQs and the variant options they choose from. */
export function shopperText(p:Payload,opts:{faqs?:boolean}={}){
 const options=(p.variants||[]).flatMap(v=>(v.selectedOptions||[]).map(o=>`${o.name}: ${o.value}`));
 return load(`<div>${p.descriptionHtml||''}</div>`,null,false).root().text()+'\n'+(opts.faqs===false?'':(p.faqs||[]).map(f=>`${f.question} ${f.answer}`).join('\n'))+'\n'+[...new Set(options)].join('\n');
}
// Release 22 (R22-602): RankPilot FAQ answers count once they are live on the page (faqLive), not while "Saved, not live".
export function answeredQuestions(p:Payload,facts:Facts,opts:{deliveryPolicy?:boolean;faqLive?:boolean}={}):Record<AnswerKey,boolean>{
 const text=shopperText(p,{faqs:opts.faqLive!==false});
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

/** Release 20 (RP-104): does the page mention delivery (used to spot a store-wide delivery line)? */
export const mentionsDelivery=(p:Payload)=>PATTERNS.delivery.test(shopperText(p));

// ---- Release 20 (RP-401): the same sentence on many products ----
const DELIVERY_BLOCK=/\b(?:delivery|delivered|dispatch(?:ed)?|shipping|postage|returns?|refunds?)\b/i;
/** Sentences a shopper reads, with the product's own name replaced, skipping short shared delivery blocks. */
/**
 * Release 22 (R22-303): a sentence's pattern with the product's name taken out, so "What should I check
 * before buying the Helinox Chair One?" and "… the Ultratape Gaffer Tape?" count as one template. A run of
 * two or more title words (with any small words between them) becomes "<product name>".
 */
const SMALL=new Set(['the','a','an','and','of','for','with','in','on','to','by','&','-','–','|']);
export function sentencePattern(sentence:string,title:string){
 const words=new Set(title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w=>w&&!SMALL.has(w)));
 const tokens=sentence.split(/(\s+)/);
 const isName=(t:string)=>{const w=t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,'');return !!w&&words.has(w);};
 const out:string[]=[];
 for(let i=0;i<tokens.length;){
  if(/^\s+$/.test(tokens[i])||!isName(tokens[i])){out.push(tokens[i]);i++;continue;}
  // Extend the run over name words and small words between them.
  let j=i,last=i,names=0;
  for(;j<tokens.length;j++){const t=tokens[j];if(/^\s+$/.test(t))continue;if(isName(t)){names++;last=j;continue;}if(SMALL.has(t.toLowerCase()))continue;break;}
  if(names>=2||(names===1&&words.size===1)){const tail=tokens[last].match(/[^\p{L}\p{N}]+$/u)?.[0]||'';out.push('<product name>'+tail);i=last+1;}
  else{out.push(tokens[i]);i++;}
 }
 const sample=out.join('');
 return {key:normaliseQuestion(sample.replace(/<product name>/g,' productname '),''),sample};
}
export function contentUnits(p:Payload){
 const $=load(`<div>${p.descriptionHtml||''}</div>`,null,false);
 const out=new Map<string,string>();
 $('p,li,h2,h3,h4,h5,h6,dt,dd,summary,td').each((_,e)=>{
  if($(e).find('p,li,h2,h3,h4,h5,h6,table').length)return;
  const block=$(e).text().replace(/\s+/g,' ').trim();if(!block)return;
  const words=block.split(' ').length;
  // A short delivery or returns paragraph is a shared store block, answered once (RP-104).
  if(words<40&&DELIVERY_BLOCK.test(block))return;
  for(const sentence of block.match(/[^.!?]+[.!?]?/g)||[]){
   const t=sentence.trim();if(t.split(/\s+/).length<5||t.length>200)continue;
   const {key,sample}=sentencePattern(t,p.title||'');if(key&&!out.has(key))out.set(key,sample);
   if(out.size>=40)return false;
  }
 });
 return out;
}
// ---- Release 20 (RP-402): suggested FAQ questions from the facts a page already has ----
// Release 22 (R22-502): each answer must fit its question (faq-facts.ts): a size needs a length or
// volume, a load is asked as "How much weight does it hold?", storage advice never answers cleaning.
const TOPICS:Partial<Record<AnswerKey,FactFaq['topic'][]>>={size:['size','capacity','load','people'],material:['material'],included:['included'],weight:['weight'],care:['care'],fit:['fit'],power:['power']};
export type FaqSuggestion={question:string;answer:string;source:string};
export function faqSuggestions(p:Payload,facts:Facts,pageFacts:Facts){
 const suggestions:FaqSuggestion[]=[];const needed:string[]=[];
 const confirmed=Object.fromEntries(Object.entries(facts).filter(([,f])=>f?.confirmed&&f.value?.trim()));
 const pick=(source:Facts)=>factFaqs(source).map(f=>({...f,fact:source[f.key]}));
 const options=[...pick(confirmed as Facts),...pick(pageFacts)];
 for(const q of relevantQuestions(p)){
  const topics=TOPICS[q.key];if(!topics)continue;
  // Release 22 (R22-601): for camping gear the fit question is the packed size, answered by a packed or folded size.
  const packed=q.key==='fit'&&fitQuestion(p)==='What is the packed size?';
  const found=packed?options.filter(o=>o.topic==='size'&&/\b(?:pack(?:ed|s)?|fold(?:ed|s)?)\b/i.test(o.answer)).map(o=>({...o,question:fitQuestion(p)})):options.filter(o=>topics.includes(o.topic));
  for(const o of found){if(suggestions.some(s=>s.question===o.question))continue;suggestions.push({question:o.question,answer:o.answer,source:o.fact?.confirmed?`Confirmed fact (${o.fact.source})`:o.fact?.source||'Product description'});}
  if(!found.length)needed.push(packed?'packed size':q.label.replace(/^No /,'').replace(/ given$/,''));
 }
 return {suggestions:suggestions.slice(0,4),needed};
}

import {load} from 'cheerio';
import type {Facts} from './types';
/**
 * Release 18: rule-based specification reader.
 * Reads "Label: value" lines with a wide label list, several labels on one line,
 * specification tables, and house-style section headings followed by a list.
 * Every suggestion carries the exact description text it came from and stays unconfirmed.
 */
export const specKeys=['dimensions','weight','capacity','materials','power','compatibility','included','care'] as const;
const LABELS:Record<string,string[]>={
 dimensions:['dimensions','dimension','size','sizes','approximate size','approx size','approx. size','overall size','product size','item size','measurements','measurement','assembled size','packed size','pack size','folded size','open size','opened size','unfolded size','closed size','external dimensions','internal dimensions'],
 weight:['weight','net weight','gross weight','item weight','product weight','approximate weight','approx weight','approx. weight'],
 capacity:['capacity','volume','max load','maximum load','load capacity','weight capacity','max weight','maximum weight','max user weight','load','holds','seats','sleeps'],
 materials:['material','materials','fabric','fabrics','frame','frame material','construction','made from','composition','finish','pile','pile type','outer','outer material','lining','filling','cover','upholstery'],
 power:['power','power requirements','power supply','power source','voltage','wattage','max wattage','maximum wattage','rated power','battery','battery capacity','input','output','charging','plug'],
 compatibility:['compatibility','compatible with','fits','suitable for','designed for'],
 included:['included','includes','what is included','what\'s included','whats included','set includes','package includes','package contents','pack contents','contents','in the box','box contents','comes with','pack includes','kit includes'],
 care:['care','care notes','care instructions','cleaning','cleaning instructions','washing','washing instructions','wash','maintenance'],
};
/** Height, width and similar parts are combined into one dimensions value. */
const DIMENSION_PARTS=['height','width','depth','length','diameter','open','opened','folded','unfolded','closed','packed','seat height','thickness','h','w','d','l'];
const HEADINGS:[RegExp,string][]=[
 [/what(?:'s| is)? (?:is )?included|in the box|set includes|package (?:includes|contents)|what(?:'s| is) in the (?:box|pack|set)|^contents|^includes/i,'included'],
 [/what size|^size|dimensions|check the fit|measurements|how big/i,'dimensions'],
 [/capacity|how much (?:does it|will it) hold/i,'capacity'],
 [/weight|how heavy/i,'weight'],
 [/material|fabric|made (?:from|of)|construction/i,'materials'],
 [/care|cleaning|washing|maintenance/i,'care'],
 [/power|electrical|battery|charging/i,'power'],
 [/compatib|will it fit/i,'compatibility'],
];
const COMPONENT_LABELS=new Set(['frame','frame material','outer','outer material','lining','filling','cover','upholstery','pile','pile type']);
const norm=(s:string)=>s.toLowerCase().replace(/[:：–—-]+$/,'').replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
const lookup=new Map<string,string>();for(const [k,list] of Object.entries(LABELS))for(const l of list)lookup.set(l,k);
for(const l of DIMENSION_PARTS)lookup.set(l,'dimensions:part');
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const allLabels=[...lookup.keys()].filter(l=>l.length>1).sort((a,b)=>b.length-a.length);
// A label is recognised at the start of a line or after a separator, followed by a colon.
const labelPattern=new RegExp(`(^|[\\s,;|•·*])(${allLabels.map(escape).join('|')})(?:\\s*\\([^)]{1,20}\\))?\\s*[:：]`,'gi');
const clean=(v:string)=>v.replace(/\s+/g,' ').replace(/^[\s:：\-–—•·*]+|[\s,;|•·]+$/g,'').trim();
const quote=(s:string)=>{const t=s.replace(/\s+/g,' ').trim();return t.length>300?t.slice(0,297)+'…':t;};
export type SpecSuggestion={key:string;value:string;source:string;method:'label'|'section'|'table'|'ai'};
/** Splits one line into labelled segments, e.g. "Length: 30cm Material: Seagrass In the Box: 2 x baskets". */
export function labelledSegments(line:string):{label:string;value:string}[]{
 const hits:{label:string;start:number;end:number}[]=[];labelPattern.lastIndex=0;let m:RegExpExecArray|null;
 while((m=labelPattern.exec(line))){const start=m.index+m[1].length;hits.push({label:m[2],start,end:m.index+m[0].length});}
 if(!hits.length)return [];
 // Text before the first label must be empty, a finished sentence or another "Label: value" pair,
 // so prose such as "ideal for size: small vans" is not read as a specification.
 const prefix=line.slice(0,hits[0].start).trim();
 if(prefix&&!/[.!?]$/.test(prefix)&&!/^[^:：]{1,35}[:：]/.test(prefix))return [];
 return hits.map((h,i)=>({label:h.label,value:clean(line.slice(h.end,hits[i+1]?.start??line.length))})).filter(s=>s.value);
}
function linesOf(html:string){
 const $=load(html.replace(/<br\s*\/?>/gi,'\n'));const lines:string[]=[];
 $('li,p,dd,dt,h1,h2,h3,h4,h5,h6,td,th,div').each((_,el)=>{if($(el).find('li,p,div,table').length)return;for(const l of $(el).text().split('\n')){const t=l.replace(/\s+/g,' ').trim();if(t)lines.push(t);}});
 return {$,lines};
}
export function extractSpecs(html:string):SpecSuggestion[]{
 const out=new Map<string,SpecSuggestion>();const parts:{label:string;value:string;line:string}[]=[];
 const put=(s:SpecSuggestion)=>{if(!s.value||s.value.length>1000||out.has(s.key))return;out.set(s.key,s);};
 const {$,lines}=linesOf(html||'');
 // Specification tables: first cell is the label.
 $('tr').each((_,row)=>{const cells=$(row).find('th,td');if(cells.length<2)return;const label=norm($(cells[0]).text()),value=clean($(cells[1]).text());const key=lookup.get(label);if(!key||!value)return;
  const line=`${$(cells[0]).text().trim()}: ${value}`;if(key==='dimensions:part')parts.push({label:$(cells[0]).text().trim(),value,line});else put({key,value,source:`Product description table: “${quote(line)}”`,method:'table'});});
 for(const line of lines){
  for(const seg of labelledSegments(line)){
   const key=lookup.get(norm(seg.label));if(!key)continue;
   if(key==='dimensions:part'){parts.push({label:seg.label.trim(),value:seg.value,line});continue;}
   // Release 22 (R22-502): a part's material keeps the part ("Cover: fleece"), so it is not read as the whole product's.
   const part=key==='materials'&&COMPONENT_LABELS.has(norm(seg.label));
   put({key,value:part?`${seg.label.trim()[0].toUpperCase()+seg.label.trim().slice(1)}: ${seg.value}`:seg.value,source:`Product description: “${quote(line)}”`,method:'label'});
  }
 }
 if(parts.length){
  const seen=new Set<string>();const value=parts.filter(p=>{const k=norm(p.label);if(seen.has(k))return false;seen.add(k);return true;}).map(p=>`${p.label[0].toUpperCase()+p.label.slice(1)} ${p.value}`).join('; ');
  const src=[...new Set(parts.map(p=>p.line))].map(l=>`“${quote(l)}”`).join(' ');
  if(!out.has('dimensions'))put({key:'dimensions',value,source:`Product description: ${src}`,method:'label'});
 }
 // Section headings ("What is included", "What size is it?", "Check the fit") followed by a list or short paragraphs.
 const headings=$('h2,h3,h4,h5,h6,p,div').filter((_,el)=>{
  const node=$(el);if(node.find('p,div,ul,ol,table').length)return false;
  const t=node.text().replace(/\s+/g,' ').trim();if(!t||t.length>60)return false;
  if(/^h[2-6]$/i.test((el as unknown as {name:string}).name))return true;
  const strong=node.children('strong,b').text().replace(/\s+/g,' ').trim();
  return strong===t || /[?:]$/.test(t);
 });
 headings.each((_,el)=>{
  const heading=$(el).text().replace(/\s+/g,' ').trim();const key=HEADINGS.find(([re])=>re.test(heading.replace(/[?:]$/,'')))?.[1];
  if(!key||out.has(key))return;
  const items:string[]=[];let next=$(el).next();
  for(let i=0;i<4&&next.length&&items.length<10;i++,next=next.next()){
   const name=(next.get(0) as unknown as {name:string}).name;
   if(/^h[1-6]$/.test(name)||headings.is(next))break;
   if(name==='ul'||name==='ol')next.find('li').each((_,li)=>{const t=$(li).text().replace(/\s+/g,' ').trim();if(t)items.push(t);});
   else if(name==='p'){const t=next.text().replace(/\s+/g,' ').trim();if(t&&t.length<=300)items.push(t);else break;}
   else break;
  }
  if(!items.length)return;
  const value=clean(items.join('; '));
  put({key,value,source:`Product description, “${quote(heading)}” section: ${items.slice(0,6).map(i=>`“${quote(i)}”`).join(' ')}`,method:'section'});
 });
 return specKeys.filter(k=>out.has(k)).map(k=>out.get(k)!);
}
export function specFacts(html:string):Facts{
 return Object.fromEntries(extractSpecs(html).map(s=>[s.key,{value:s.value,source:s.source,confirmed:false}]));
}
const fold=(s:string)=>s.normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim().toLowerCase();
/**
 * Grounding gate for AI proposals: the quoted sentence must appear in the description,
 * and every number in the proposed value must appear in that sentence. Nothing is invented.
 */
export function groundedProposal(descriptionText:string,p:{key:string;value:string;quote:string}):SpecSuggestion|null{
 if(!(specKeys as readonly string[]).includes(p.key))return null;
 const q=p.quote.replace(/\s+/g,' ').trim(),v=clean(p.value);
 if(q.length<4||!v||v.length>1000||!fold(descriptionText).includes(fold(q)))return null;
 const numbers=v.match(/\d+(?:[.,]\d+)?/g)||[];if(numbers.some(n=>!q.includes(n)))return null;
 // Every word of the value must come from the quote, so a real sentence cannot carry an invented value.
 const stem=(w:string)=>w.replace(/(?:es|s|ed|ing)$/,'');const quoted=new Set((fold(q).match(/[\p{L}]{3,}/gu)||[]).map(stem));
 if((fold(v).match(/[\p{L}]{3,}/gu)||[]).some(w=>!quoted.has(stem(w))))return null;
 return {key:p.key,value:v,source:`Product description (AI-read, quote checked): “${quote(q)}”`,method:'ai'};
}

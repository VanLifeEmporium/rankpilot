import {load} from 'cheerio';
import type {Facts,Payload} from './types';
/**
 * Release 20 (RP-201): find the real manufacturer of a product whose vendor is the store.
 * Evidence, strongest first: a known brand at the start of the title, anywhere in the title,
 * a "Brand:"/"by …" line in the description, then the first words of the handle (medium confidence).
 * Nothing is applied: every proposal waits for merchant approval.
 */
// Brands that are also everyday words (Ring, Whale, Scott) are left out: they would match ordinary titles.
export const KNOWN_BRANDS=['Helinox','Andes','Outwell','EcoFlow','Kidde','Thermos','Vango','Kampa','Dometic','Coleman','Jetboil','MSR','Primus','Campingaz','Cadac','Victron','Renogy','Fiamma','Thule','Netgear','Teltonika','Senelux','Lifeventure','Trangia','Sea to Summit','Exped','Therm-a-Rest','Berghaus','Robens','Easy Camp','Quechua','Fenix','Ledlenser','Petzl','Anker','Jackery','Bluetti','Goal Zero','Stanley','Hydro Flask','Klean Kanteen','Nalgene','Lifesaver','Water to Go','BioLite','Snugpak','OEX','Regatta','Karrimor','Osprey','Deuter','Vertebrate Publishing','Lonely Planet','Ordnance Survey','Rough Guides','Truma','Webasto','Eberspächer','Maxxair','Reich','Propex','Smev','Thetford','Porta Potti','Separett','Trelino','Kildwick','Sunncamp','Milenco','Road Pro','Froli','Silwy','Alpkit','Rab','Mountain Warehouse','Hi-Gear','Gelert','Kelty','Big Agnes','Ortlieb','GSI Outdoors','Light My Fire','Opinel','Leatherman','Victorinox','Gerber','Morakniv','UCO','Solo Stove','Ooni','Weber','Joseph Joseph','Brabantia','Kärcher','Numatic','Riemann','Smidge','Nikwax','Grangers','Fabsil'];
export type BrandEvidence={where:'title'|'handle'|'description';text:string};
export type BrandProposal={vendor:string;confidence:'high'|'medium';evidence:BrandEvidence[]};
const key=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
const within=(hay:string,needle:string)=>(` ${key(hay)} `).includes(` ${key(needle)} `);
/** The product is the store's own label: tagged own-label, or the merchant confirmed it. */
export const isOwnLabel=(p:Payload,facts:Facts={})=>(p.tags||[]).some(t=>/^own[- ]?(label|brand)$/i.test(t.trim()))||(facts.brand?.confirmed===true&&/own[- ]?label/i.test(facts.brand.value||''));
/** Known brands: the curated list plus every real vendor already used in the store. */
export function brandList(vendors:Iterable<string>,storeName:string){
 const store=key(storeName);const out=new Map<string,string>();
 for(const b of [...KNOWN_BRANDS,...vendors]){const k=key(b);if(k.length<2||k===store||/^(n a|na|none|unbranded|generic|default)$/.test(k))continue;if(!out.has(k))out.set(k,b);}
 // Longest first, so "Sea to Summit" wins over "Sea" and "Hydro Flask" over "Hydro".
 return [...out.values()].sort((a,b)=>b.length-a.length);
}
export function detectBrand(p:Payload,brands:string[]):BrandProposal|null{
 const title=p.title||'';const handle=(p.handle||'').replace(/-/g,' ');
 const text=load(`<div>${p.descriptionHtml||''}</div>`,null,false).root().text().replace(/\s+/g,' ');
 const labelled=text.match(/\b(?:brand|manufacturer|made by|by)\s*[:：]?\s*([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,2})/);
 for(const b of brands){
  if(key(title).startsWith(key(b)+' ')||key(title)===key(b))return {vendor:b,confidence:'high',evidence:[{where:'title',text:title}]};
 }
 for(const b of brands){
  if(within(title,b))return {vendor:b,confidence:'high',evidence:[{where:'title',text:title}]};
 }
 if(labelled){const hit=brands.find(b=>key(labelled[1]).startsWith(key(b)));if(hit){const at=text.indexOf(labelled[0]);return {vendor:hit,confidence:'high',evidence:[{where:'description',text:text.slice(Math.max(0,at-40),at+labelled[0].length+40).trim()}]};}}
 const lead=key(handle);
 for(const b of brands){
  if(lead.startsWith(key(b)+' '))return {vendor:b,confidence:'medium',evidence:[{where:'handle',text:p.handle}]};
 }
 return null;
}
/** Release 20 (RP-201): smart collections whose rules use the vendor, and so would change membership. */
export function vendorRuleCollections(collections:{title:string;rules?:{column:string;condition:string}[]}[],productCollections:string[]){
 return collections.filter(c=>c.rules?.some(r=>r.column.toUpperCase()==='VENDOR')&&productCollections.includes(c.title)).map(c=>c.title);
}
/** Release 20 (RP-202): the product's brand names (a real vendor, or one found in the title), never the store. */
export function productBrands(p:Payload,storeNames:string[]){
 const stores=storeNames.map(key).filter(Boolean);const out:string[]=[];
 const vendor=(p.vendor||'').trim();if(vendor&&!stores.includes(key(vendor))&&!/^(n\/?a|none|unbranded|generic|default)$/i.test(vendor))out.push(vendor);
 const found=detectBrand(p,brandList(out,storeNames[0]||''));if(found&&!out.some(b=>key(b)===key(found.vendor)))out.push(found.vendor);
 return out;
}
export const storeNames=(store:{discoveries?:string|null;settings?:string|null}|null|undefined)=>{
 const parse=(s?:string|null)=>{try{return JSON.parse(s||'{}');}catch{return {};}};
 return [parse(store?.discoveries).shop?.name,parse(store?.settings).titleBrand].filter((s):s is string=>typeof s==='string'&&!!s.trim());
};

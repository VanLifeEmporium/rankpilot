import {load} from 'cheerio';
import type {Facts,Payload} from './types';
/**
 * Release 20 (RP-201): find the real manufacturer of a product whose vendor is the store.
 * Evidence, strongest first: a known brand at the start of the title, anywhere in the title,
 * a "Brand:"/"by …" line in the description, then the first words of the handle (medium confidence).
 * Nothing is applied: every proposal waits for merchant approval.
 */
// Brands that are also everyday words (Ring, Whale, Scott) are left out: they would match ordinary titles.
export const KNOWN_BRANDS=['Helinox','Andes','Outwell','EcoFlow','Kidde','Thermos','Vango','Kampa','Dometic','Coleman','Jetboil','MSR','Primus','Campingaz','Cadac','Victron','Renogy','Fiamma','Thule','Netgear','Teltonika','Senelux','Lifeventure','Trangia','Sea to Summit','Exped','Therm-a-Rest','Berghaus','Robens','Easy Camp','Quechua','Fenix','Ledlenser','Petzl','Anker','Jackery','Bluetti','Goal Zero','Stanley','Hydro Flask','Klean Kanteen','Nalgene','Lifesaver','Water to Go','BioLite','Snugpak','OEX','Regatta','Karrimor','Osprey','Deuter','Vertebrate Publishing','Lonely Planet','Ordnance Survey','Rough Guides','Truma','Webasto','Eberspächer','Maxxair','Reich','Propex','Smev','Thetford','Porta Potti','Separett','Trelino','Kildwick','Sunncamp','Milenco','Road Pro','Froli','Silwy','Alpkit','Rab','Mountain Warehouse','Hi-Gear','Gelert','Kelty','Big Agnes','Ortlieb','GSI Outdoors','Light My Fire','Opinel','Leatherman','Victorinox','Gerber','Morakniv','UCO','Solo Stove','Ooni','Weber','Joseph Joseph','Brabantia','Kärcher','Numatic','Riemann','Smidge','Nikwax','Grangers','Fabsil','HOMCOM','Duronic','La Hacienda','Igloo','Trespass','Marshall','Engel','Outsunny','Costway','VonHaus','Russell Hobbs','Salter','Tower','Morphy Richards','Kenwood','Bosch','Black+Decker','Karrimor','Gelert','Vango','Eurohike','Sunncamp','Quest','Royal','Leisurewize','Streetwize','Maypole','Mobicool','Waeco','Campos'];
/**
 * Release 22 (R22-401): brands that are not on the list. A word that starts the titles of two or more
 * store-branded products ("Betron …") is a brand unless it is an ordinary product word ("Folding",
 * "Portable"); a handle that starts with a word missing from the title ("igloo-marine-…" for
 * "Marine Ultra 51L Cool Box") points to a brand with medium confidence.
 */
export const GENERIC_WORDS=new Set(('a an and the for with of in on by your our my this that new original classic premium deluxe luxury value budget best top quality professional pro plus max lite ultra super extra mini micro big large medium small compact giant tiny little xl xxl '+
 'folding foldable portable collapsible retractable inflatable adjustable rechargeable electric solar magnetic universal heavy duty double single twin triple multi multipurpose all-in-one set pack pair kit bundle '+
 'stainless steel wooden wood bamboo cotton wool leather silicone plastic metal aluminium aluminum glass ceramic enamel cast iron copper brass linen canvas fleece felt rubber jute seagrass rattan '+
 'black white red blue green grey gray brown pink yellow orange purple navy beige cream natural clear silver gold '+
 'round square rectangle rectangular oval hanging wall door window car van campervan camper motorhome caravan travel camping outdoor outdoors indoor picnic kitchen bathroom toilet shower bed pillow cushion blanket rug mat '+
 'light lamp lantern torch led usb power bank battery fan heater cool cooler cold hot warm thermal insulated vacuum food water coffee tea cup mug bottle flask storage organiser organizer bag box basket hook hooks clip clips strap straps rope '+
 'tent awning chair table stool bench shelf rack holder stand cover case pouch sleeping emergency safety first aid fire smoke carbon gas alarm detector sensor smart digital wireless bluetooth mobile phone home garden '+
 'easy quick instant pop up lightweight waterproof windproof eco organic vegan handmade hand made british uk english scottish welsh irish european gift gifts card sticker stickers print poster book guide map '+
 'vintage retro rustic modern boho nordic scandi sweet happy essential essentials everyday daily adventure explorer nomad wild wilderness mountain forest ocean sea beach summer winter spring autumn festival party christmas '+
 'marine sports sport kids children child baby adult mens womens unisex dog pet cat bike cycle bicycle fishing hiking walking running yoga 12v 24v 230v 240v 2x 3x 4x copy '+
 'geometric swedish winter galaxy northern southern south north east west mountains mountain wild stay pure herringbone sweet stargazer moon verdant lidded macrame macramé shallow nesting teal sage coconut teak acacia oak olive pine birch memory sherpa terra aztec boho bohemian afghan kilim '+
 'freestanding pestle sustainable jerry having handwoven upcycled natural microfibre throw mesh manual refillable recycled projector hammock merino kiln motorhome motorhoming morocco william morris strawberry insulated '+
 'handheld roadside slat heavy-duty seven three four five six two one ten twin open closed rotating dimmable cordless wireless butterfly orkney cappuccino whitewashed tablecloth canister twin-pack').split(/\s+/));
const brandWord=(w:string)=>/^[A-Za-z][A-Za-z'’&-]*[A-Za-z]$/.test(w)&&w.length>=3&&!GENERIC_WORDS.has(w.toLowerCase().replace(/['’]s?$/,''));
/** Words that start the titles of at least `min` store-branded products and are not ordinary product words. */
export function learnTitleBrands(titles:string[],min=2){
 const counts=new Map<string,{n:number;spelling:string}>();
 for(const t of titles){const w=(t.trim().split(/\s+/)[0]||'').replace(/[^A-Za-z'’&-]+$/,'');if(!brandWord(w))continue;const k=w.toLowerCase();const e=counts.get(k);if(e)e.n++;else counts.set(k,{n:1,spelling:w});}
 return [...counts.values()].filter(e=>e.n>=min).map(e=>e.spelling[0].toUpperCase()+e.spelling.slice(1));
}
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
/** Release 22 (R22-401): store-wide counts of the first word of each handle, to tell a brand from a one-off name. */
const ALLOWED_CAPS_WORDS=new Set(['LED','USB','XL','XXL','XXXL','LCD','RGB','BBQ','UK','DAB','HDMI','WIFI']);
export type BrandStats={handleLeads?:Map<string,number>};
export const handleLead=(handle:string)=>(handle||'').split('-')[0]||'';
export function detectBrand(p:Payload,brands:string[],stats:BrandStats={}):BrandProposal|null{
 const title=p.title||'';const handle=(p.handle||'').replace(/-/g,' ');
 const text=load(`<div>${p.descriptionHtml||''}</div>`,null,false).root().text().replace(/\s+/g,' ');
 const labelled=text.match(/\b(?:brand|manufacturer|made by|by)\s*[:：]?\s*([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,2})/);
 const titleWords=key(title).split(' ');
 for(const b of brands){
  if(key(title).startsWith(key(b)+' ')||key(title)===key(b))return {vendor:b,confidence:'high',evidence:[{where:'title',text:title}]};
 }
 for(const b of brands){
  // Anywhere in the title only for distinctive names (one short word like "Trail" could be ordinary).
  if((b.includes(' ')||b.length>=5)&&within(title,b))return {vendor:b,confidence:'high',evidence:[{where:'title',text:title}]};
 }
 if(labelled){const hit=brands.find(b=>key(labelled[1]).startsWith(key(b)));if(hit){const at=text.indexOf(labelled[0]);return {vendor:hit,confidence:'high',evidence:[{where:'description',text:text.slice(Math.max(0,at-40),at+labelled[0].length+40).trim()}]};}}
 const lead=key(handle);
 for(const b of brands){
  if(lead.startsWith(key(b)+' '))return {vendor:b,confidence:'medium',evidence:[{where:'handle',text:p.handle}]};
 }
 // R22-401: a listed brand elsewhere in the handle ("2-person-festival-tent-outsunny").
 for(const b of brands){
  if(key(b).length>=5&&within(handle,b))return {vendor:b,confidence:'medium',evidence:[{where:'handle',text:p.handle}]};
 }
 const first=handleLead(p.handle);const titleFirst=(title.trim().split(/\s+/)[0]||'').replace(/[^A-Za-z'’&-]+$/,'');
 // R22-401: a handle word that is the first word of a vendor already in the store ("jungle-…" → Jungle Culture).
 {const vendor=first.length>=5?brands.find(b=>b.includes(' ')&&key(b).split(' ')[0]===first.toLowerCase()):undefined;
  if(vendor)return {vendor,confidence:'medium',evidence:[{where:'handle',text:p.handle}]};}
 // R22-401: the title and the handle start with the same unusual word ("Ultratape Rhino Gaffer Tape").
 if(brandWord(titleFirst)&&titleFirst.length>=4&&key(titleFirst)===first.toLowerCase())
  return {vendor:titleFirst,confidence:'medium',evidence:[{where:'title',text:title},{where:'handle',text:p.handle}]};
 // R22-401: a handle that starts with a word the title doesn't have, and that is not an ordinary word.
 // When the same word starts other products' handles too, it is a brand rather than a one-off name.
 if(brandWord(first)&&first.length>=4&&!titleWords.includes(first.toLowerCase())&&(p.handle||'').split('-').length>=3){
  const repeated=(stats.handleLeads?.get(first.toLowerCase())||0)>=2;
  return {vendor:first[0].toUpperCase()+first.slice(1),confidence:repeated?'high':'medium',evidence:[{where:'handle',text:p.handle}]};
 }
 // R22-401: a word written in capitals at the start of the title ("GADLANE 10m Camping Hook-Up").
 if(/^[A-Z]{4,}$/.test(titleFirst)&&brandWord(titleFirst)&&!ALLOWED_CAPS_WORDS.has(titleFirst))
  return {vendor:titleFirst,confidence:'medium',evidence:[{where:'title',text:title}]};
 // R22-401: a title word that starts another product's handle ("Trespass Joejoe …" and "trespass-trek-…").
 if(brandWord(titleFirst)&&titleFirst.length>=4&&(stats.handleLeads?.get(titleFirst.toLowerCase())||0)>=1)
  return {vendor:titleFirst,confidence:'high',evidence:[{where:'title',text:title}]};
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

import {load} from 'cheerio';
import {gtinCheckDigitValid} from './catalogue-checks';
import type {Payload} from './types';
/**
 * Release 20 (RP-203): guided book listing. Suggest the publisher and the 13-digit ISBN from a
 * trusted source (the book's own description or product fields, then Open Library). The merchant
 * confirms the edition before any barcode is saved; nothing is ever made up.
 */
export type BookCandidate={isbn:string;publisher:string;year?:string;title?:string;source:string};
export const validIsbn13=(s:string)=>/^97[89]\d{10}$/.test(s)&&gtinCheckDigitValid(s);
/** ISBN-10 to ISBN-13 (978 prefix, new check digit). */
export function isbn10to13(s:string){
 const d=s.replace(/[^0-9X]/gi,'');if(!/^\d{9}[\dX]$/i.test(d))return null;
 const base='978'+d.slice(0,9);const sum=base.split('').reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0);
 return base+((10-(sum%10))%10);
}
const isbnIn=(text:string)=>{
 for(const m of text.matchAll(/\bISBN(?:-1[03])?\s*[:：]?\s*([0-9][0-9 -]{8,16}[0-9X])\b/gi)){const raw=m[1].replace(/[\s-]/g,'');const isbn=raw.length===10?isbn10to13(raw):raw;if(isbn&&validIsbn13(isbn))return isbn;}
 for(const m of text.matchAll(/\b97[89][\d -]{10,14}\d\b/g)){const isbn=m[0].replace(/[\s-]/g,'');if(validIsbn13(isbn))return isbn;}
 return null;
};
/** Candidates printed on the product itself: description or product fields. */
export function bookFromPage(p:Payload):BookCandidate|null{
 const text=load(`<div>${p.descriptionHtml||''}</div>`,null,false).root().text().replace(/\s+/g,' ')+' '+Object.entries(p.metafields||{}).map(([k,v])=>`${k}: ${v}`).join(' ');
 const isbn=isbnIn(text);if(!isbn)return null;
 const publisher=(text.match(/\b(?:publisher|published by)\s*[:：]?\s*([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/)||[])[1]||'';
 const year=(text.match(/\b(?:published|edition|first published)\D{0,20}((?:19|20)\d{2})\b/i)||[])[1];
 return {isbn,publisher:publisher.trim(),year,source:'Product description'};
}
type OpenLibraryDoc={title?:string;publisher?:string[];isbn?:string[];first_publish_year?:number;editions?:{docs?:{title?:string;publisher?:string[];isbn?:string[];publish_date?:string[]}[]}};
/** Up to three editions from Open Library, each with a valid 978/979 ISBN. */
export function openLibraryCandidates(json:{docs?:OpenLibraryDoc[]}):BookCandidate[]{
 const out:BookCandidate[]=[];
 for(const doc of json.docs||[]){
  const editions=doc.editions?.docs?.length?doc.editions.docs:[{title:doc.title,publisher:doc.publisher,isbn:doc.isbn,publish_date:doc.first_publish_year?[String(doc.first_publish_year)]:[]}];
  for(const e of editions){
   const isbn=(e.isbn||[]).map(i=>i.length===10?isbn10to13(i):i).find((i):i is string=>!!i&&validIsbn13(i));
   if(!isbn||out.some(c=>c.isbn===isbn))continue;
   out.push({isbn,publisher:(e.publisher||[])[0]||'',year:((e.publish_date||[])[0]||'').match(/\d{4}/)?.[0],title:e.title||doc.title,source:'Open Library'});
   if(out.length>=3)return out;
  }
 }
 return out;
}
/** Words the search should ignore: the store's own name and format words. */
export const bookQuery=(title:string)=>title.replace(/\((?:paperback|hardback|book)\)|\b(?:paperback|hardback|book|guide book)\b/gi,' ').replace(/[|–—].*$/,'').replace(/\s+/g,' ').trim();

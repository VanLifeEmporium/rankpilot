import {load} from 'cheerio';
/** Release 18: how much of the supplier's original wording is still in the live description. */
const words=(s:string)=>(s.normalize('NFKC').toLowerCase().replace(/<[^>]*>/g,' ').match(/[\p{L}\p{N}]+/gu)||[]);
const shingles=(list:string[],n=5)=>{const out=new Set<string>();for(let i=0;i+n<=list.length;i++)out.add(list.slice(i,i+n).join(' '));return out;};
export const plainText=(html:string)=>load(`<div>${html}</div>`,null,false).root().text();
/** Share (0–1) of the original's five-word sequences that still appear in the current text. */
export function supplierOverlap(original:string,current:string){
 const a=shingles(words(plainText(original))),b=shingles(words(plainText(current)));
 if(a.size<5)return null;
 let hit=0;for(const s of a)if(b.has(s))hit++;
 return hit/a.size;
}
export const SUPPLIER_COPY_THRESHOLD=0.5;

import {load} from 'cheerio';
import type {AnyNode} from 'domhandler';
/**
 * Release 20 (RP-103): content as a shopper sees it. Editor formatting differences — self-closing
 * tags, whitespace, empty attributes, data-* attributes, attribute-free spans, &nbsp; — are ignored;
 * words, links, images, headings, lists and tables still count.
 */
export function contentValue(html:string){
 const $=load(html||'',{},false);
 // Returns a list: attribute-free wrappers (span, font, div) contribute their children directly.
 const walk=(node:AnyNode):unknown[]=>{
  if(node.type==='text'){const t=node.data.normalize('NFC').replace(/\u00a0/g,' ').replace(/\s+/gu,' ');return t.trim()?[t]:[];}
  if('name' in node&&'attribs' in node&&'children' in node){
   // Release 22 (R22-304): CSS in a <style> block compares without spacing ("margin:28px 0" = "margin: 28px 0").
   if(node.name==='style')return [['style',[],[node.children.map(c=>c.type==='text'?c.data:'').join('').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\s*([:;{},>])\s*/g,'$1').replace(/;}/g,'}').replace(/\s+/g,' ').trim()]]];
   const kids=children(node.children);
   const attrs=Object.entries(node.attribs).filter(([k,v])=>v!==''&&!k.startsWith('data-')&&!['class','style','id','dir','target','rel'].includes(k)).sort(([a],[b])=>a.localeCompare(b));
   const name=node.name==='b'?'strong':node.name==='i'?'em':node.name;
   if(['span','font','div'].includes(name)&&!attrs.length)return kids;
   if(!kids.length&&!attrs.length&&!['br','hr','img'].includes(name))return [];
   return [[name,attrs,kids]];
  }
  return [];
 };
 const children=(nodes:AnyNode[])=>{const out:unknown[]=[];for(const v of nodes.flatMap(walk)){if(typeof v==='string'&&typeof out[out.length-1]==='string')out[out.length-1]+=v;else out.push(v);}return out.map(v=>typeof v==='string'?v.replace(/\s+/g,' ').trim():v).filter(v=>v!=='');};
 return JSON.stringify(children($.root().contents().toArray()));
}
export const sameContent=(a:string,b:string)=>contentValue(a)===contentValue(b);
const plainText=(html:string)=>load(`<div>${html||''}</div>`,null,false).root().text().replace(/\s+/g,' ').trim();
const links=(html:string)=>{const $=load(html||'',{},false);return $('a[href]').map((_,e)=>`${$(e).text().trim()} → ${$(e).attr('href')}`).get();};
/** Side-by-side excerpt around the first real difference, plus link changes. */
export function contentDiff(rankpilot:string,shopify:string){
 const a=plainText(rankpilot),b=plainText(shopify);
 let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 let endA=a.length,endB=b.length;while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
 const from=Math.max(0,a.lastIndexOf(' ',Math.max(0,start-40))+1);
 const excerpt=(t:string,end:number)=>`${from>0?'…':''}${t.slice(from,Math.min(t.length,end+40))}${end+40<t.length?'…':''}`;
 const la=links(rankpilot),lb=links(shopify);
 return {rankpilot:a===b?'(same words)':excerpt(a,endA),shopify:a===b?'(same words)':excerpt(b,endB),linksRemoved:la.filter(l=>!lb.includes(l)),linksAdded:lb.filter(l=>!la.includes(l))};
}

import {load} from 'cheerio';
import type {AnyNode} from 'domhandler';
/** Compare parsed HTML, not editor serialisation. Keep links, images, facts and styling. */
export function htmlValue(value:string) {
 const $=load(value,{},false);
 // This is RankPilot's old bookkeeping wrapper, not merchant content.
 $('[data-rankpilot="collection-guide"]').each((_,el)=>{
  const node=$(el);node.removeAttr('data-rankpilot');
  if(el.type==='tag' && el.name==='section' && !Object.keys(el.attribs).length)node.replaceWith(node.contents());
 });
 const walk=(node:AnyNode):unknown=>{
  if(node.type==='comment')return null;
  if(node.type==='text')return node.data.normalize('NFC').replace(/\s+/gu,' ').trim()||null;
  if('name' in node && 'attribs' in node && 'children' in node){
   const name=node.name==='b'?'strong':node.name==='i'?'em':node.name;
   const attrs=Object.entries(node.attribs).sort(([a],[b])=>a.localeCompare(b));
   return [name,attrs,node.children.map(walk).filter(v=>v!==null)];
  }
  return null;
 };
 return JSON.stringify($.root().contents().toArray().map(walk).filter(v=>v!==null));
}

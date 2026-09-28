import sanitizeHtml from 'sanitize-html';
import {load} from 'cheerio';
/**
 * Release 18: "Clean supplier formatting". Removes markup RankPilot will not edit around
 * (buttons, forms, scripts, styles, inline styles, H1, unsafe links) and keeps every word of text.
 */
const TAGS=['h2','h3','h4','h5','h6','p','br','ul','ol','li','strong','b','em','i','a','table','thead','tbody','tr','th','td','img','blockquote','dl','dt','dd','details','summary'];
const visible=(html:string)=>{const $=load(`<div>${html}</div>`,null,false);$('script,style,noscript,iframe,object,embed,textarea').remove();return $.root().text().replace(/\s+/g,'').trim();};
export function cleanSupplierHtml(html:string){
 const removed=new Set<string>();
 const $=load(`<div id="rp-root">${html}</div>`,null,false);
 $('h1').each((_,e)=>{removed.add('H1 heading (now H2)');e.tagName='h2';});
 $('button').each((_,e)=>{removed.add('buttons (text kept)');$(e).replaceWith($(e).contents());});
 $('a').each((_,e)=>{const href=$(e).attr('href')||'';if(!/^(https:|mailto:|tel:|\/(?!\/)|#)/i.test(href)){removed.add('links with unsafe or empty addresses (text kept)');$(e).replaceWith($(e).contents());}});
 $('*').each((_,e)=>{const el=e as unknown as {tagName:string;attribs:Record<string,string>};if(el.tagName==='div'&&$(e).attr('id')==='rp-root')return;
  if(['div','font','section','article','center','span'].includes(el.tagName)&&Object.keys(el.attribs).length)removed.add('layout wrappers');
  if(['form','input','label','select','textarea'].includes(el.tagName))removed.add('form elements');
  if(['script','style','iframe','object','embed','noscript'].includes(el.tagName))removed.add('scripts, styles or frames');
  if(el.attribs.style)removed.add('inline styles');
  if(Object.keys(el.attribs).some(a=>/^on/i.test(a)))removed.add('event handlers');
  if(Object.keys(el.attribs).some(a=>a.startsWith('data-')))removed.add('app data attributes');});
 const cleaned=sanitizeHtml($('#rp-root').html()||'',{
  allowedTags:TAGS,
  allowedAttributes:{a:['href','title','target','rel'],img:['src','alt','width','height','loading']},
  allowedSchemes:['https','mailto','tel'],allowProtocolRelative:false,
  // Text inside removed tags is kept ("discard" drops only the tag); script/style bodies are dropped.
  disallowedTagsMode:'discard',nonTextTags:['script','style','textarea','noscript','iframe','object','embed','select','option'],
 }).replace(/<p>\s*<\/p>/g,'').trim();
 return {html:cleaned,removed:[...removed],sameText:visible(html)===visible(cleaned),changed:cleaned!==html.trim()};
}
/** Markup that blocks RankPilot edits; used to raise a "Clean supplier formatting" finding. */
export function blockingMarkup(html:string){
 const found:string[]=[];
 if(/<h1\b/i.test(html))found.push('an H1 heading');
 if(/<(button|form|input)\b/i.test(html))found.push('buttons or form fields');
 if(/<(script|style|iframe)\b/i.test(html))found.push('scripts, styles or frames');
 if(/\son[a-z]+\s*=/i.test(html)||/javascript:/i.test(html))found.push('script links or handlers');
 if(/href\s*=\s*["'](?!https:|mailto:|tel:|\/(?!\/)|#)[^"']+/i.test(html))found.push('non-HTTPS links');
 return found;
}

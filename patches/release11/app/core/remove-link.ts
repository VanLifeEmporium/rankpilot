import {load} from 'cheerio';
export function removeBrokenLink(html:string, address:string, base:string,replacement?:string){
 const target=new URL(address,base);if(!['http:','https:'].includes(target.protocol))throw new Error('Choose a web link.');
 const $=load(html,{},false);let removed=0;
 $('a[href]').each((_,el)=>{try{if(new URL($(el).attr('href')!,base).href===target.href){if(replacement)$(el).attr("href",replacement);else $(el).replaceWith($(el).contents());removed++;}}catch{/* Leave unrelated links unchanged. */}});
 if(!removed)throw new Error('This link is not in this page’s editable content. It may be in navigation or the theme; no content was changed.');
 return {html:$.html(),removed};
}

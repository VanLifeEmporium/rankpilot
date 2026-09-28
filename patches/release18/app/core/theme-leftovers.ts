import {load} from 'cheerio';
import type {Issue} from './types';
/**
 * Release 18: code left in the theme by SEO apps (the AVADA incident overrode 45 titles),
 * app blocks that failed to render, and duplicated head tags. Found per page, reported once per store.
 */
export const SEO_APP_MARKERS:{app:string;pattern:RegExp}[]=[
 {app:'AVADA SEO',pattern:/avada[-_ ]?seo|avada-sea|avada_seo|\bavada\b[^<]{0,40}(?:seo|meta|title)/i},
 {app:'Plug In SEO',pattern:/plug[-_ ]?in[-_ ]?seo|pluginseo/i},
 {app:'SEO Manager (venntov)',pattern:/venntov|seo[-_]manager/i},
 {app:'Smart SEO',pattern:/smart[-_]seo|sherpas[-_]?seo/i},
 {app:'Booster SEO',pattern:/booster[-_]seo|\bbs[-_]seo\b/i},
 {app:'TinyIMG',pattern:/tiny[-_]?img/i},
 {app:'JSON-LD for SEO',pattern:/json[-_]ld[-_]for[-_]seo|ilana[-_]?jsonld/i},
 {app:'Schema Plus for SEO',pattern:/schema[-_]?plus[-_]?for[-_]?seo|schemaplus/i},
 {app:'SearchPie',pattern:/searchpie/i},
 {app:'Yoast SEO for Shopify',pattern:/yoast[-_ ]seo/i},
 {app:'SEO King',pattern:/seo[-_]king/i},
];
export type PageSignals={url:string;apps:string[];failedBlocks:number;liquidErrors:number;titles:number;descriptions:number};
export function themeSignals(html:string,url:string):PageSignals{
 const $=load(html);
 // Only markup the theme or an app emits: comments, script/link sources, ids, classes and head tags. Visible copy is ignored.
 const code=[...html.matchAll(/<!--([\s\S]*?)-->/g)].map(m=>m[1]).join('\n')+'\n'+$('script[src],link[href],style,meta,[id],[class],[data-app]').map((_,e)=>{const el=$(e);return [el.attr('src'),el.attr('href'),el.attr('id'),el.attr('class'),el.attr('data-app'),el.attr('name'),e.tagName==='style'?el.text().slice(0,2000):''].filter(Boolean).join(' ');}).get().join('\n')+'\n'+$('script:not([src])').map((_,e)=>$(e).text().slice(0,4000)).get().join('\n');
 const apps=SEO_APP_MARKERS.filter(m=>m.pattern.test(code)).map(m=>m.app);
 const failedBlocks=(html.match(/Failed to render app block/gi)||[]).length;
 const liquidErrors=(html.match(/Liquid (?:syntax )?error/gi)||[]).length;
 return {url,apps,failedBlocks,liquidErrors,titles:$('head title').length||$('title').length,descriptions:$('meta[name="description"]').length};
}
export function themeFindings(pages:PageSignals[]):Issue[]{
 const issues:Issue[]=[];const examples=(list:PageSignals[])=>list.slice(0,5).map(p=>p.url).join(', ');
 const byApp=new Map<string,PageSignals[]>();for(const p of pages)for(const a of p.apps)byApp.set(a,[...(byApp.get(a)||[]),p]);
 for(const [app,list] of byApp)issues.push({resourceId:'theme',title:'Live theme',code:'theme-leftover',severity:'warning',detail:`${app} code is in the live theme on ${list.length} of ${pages.length} scanned pages (e.g. ${examples(list)}). If the app is uninstalled, its snippets can keep overriding titles, descriptions or structured data. Check the app is still wanted; otherwise remove its snippet and the {% render %} line in theme.liquid, in a duplicate theme first.`});
 const failed=pages.filter(p=>p.failedBlocks);
 if(failed.length)issues.push({resourceId:'theme',title:'Live theme',code:'app-block-failed',severity:'warning',detail:`“Failed to render app block” appears on ${failed.length} scanned pages (e.g. ${examples(failed)}). The block belongs to an uninstalled or broken app. Remove the dead block in the theme editor.`});
 const liquid=pages.filter(p=>p.liquidErrors);
 if(liquid.length)issues.push({resourceId:'theme',title:'Live theme',code:'liquid-error',severity:'warning',detail:`A Liquid error is printed on ${liquid.length} scanned pages (e.g. ${examples(liquid)}). Often a snippet left by a removed app. Find the snippet named in the error and remove or fix it.`});
 const dupes=pages.filter(p=>p.titles>1||p.descriptions>1);
 if(dupes.length)issues.push({resourceId:'theme',title:'Live theme',code:'duplicate-head-tags',severity:'warning',detail:`${dupes.length} scanned pages serve more than one <title> or meta description (e.g. ${examples(dupes)}). Search engines pick one, which may not be your SEO title. This is the usual sign of an SEO app snippet left in theme.liquid.`});
 return issues;
}

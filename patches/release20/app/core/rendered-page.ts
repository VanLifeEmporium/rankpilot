import {load} from 'cheerio';
import type {Issue} from './types';
/**
 * Release 19: checks on the page the storefront actually renders, not the admin data.
 * Two in-stock products rendered the theme's 404 page with HTTP 200 and were reported healthy.
 */
type Node={['@type']?:string|string[];image?:unknown;brand?:unknown;offers?:unknown;name?:string};
const types=(n:Node)=>[n['@type']].flat().filter(Boolean) as string[];
const has=(v:unknown):boolean=>Array.isArray(v)?v.some(has):typeof v==='number'?true:typeof v==='string'?v.trim().length>0:!!v&&typeof v==='object'&&Object.values(v as object).some(has);
export function pageNotFound(html:string){
 const $=load(html);
 const h1=$('h1').first().text().replace(/\s+/g,' ').trim();
 const title=$('title').first().text();
 return /\btemplate-404\b/.test($('body').attr('class')||'')||/^(page not found|404)\b/i.test(h1)||/\b404 not found\b|^\s*page not found\b/i.test(title);
}
/** Release 20 (RP-102): the Shopify template that rendered the page, from the body class (e.g. "product", "product.alternate"). */
export function templateName(html:string){const cls=load(html)('body').attr('class')||'';const m=cls.match(/\btemplate-([a-z0-9-]+)(?:\s|$)/);const suffix=cls.match(/\btemplate-suffix-([a-z0-9-]+)/);return m?`${m[1]}${suffix?'.'+suffix[1]:''}`:null;}
type Source={script:string;types:string[];url:string;id:string};
export function renderedChecks(html:string,nodes:Node[],target:{id:string;title:string;url:string;kind?:string},opts:{variants?:Set<unknown>;top?:Set<unknown>;sources?:Source[]}={}):Issue[]{
 const issues:Issue[]=[];const add=(code:string,severity:Issue['severity'],detail:string)=>issues.push({resourceId:target.id,title:target.title,code,severity,detail});
 if(pageNotFound(html)){
  add('page-not-found','critical',`${target.url} returns HTTP 200 but shows the theme's “Page not found” page. Shoppers and Google see a missing page. Check the item is active, published to the Online Store and has at least one image, then recheck.`);
  return issues;
 }
 if(target.kind!=='product')return issues;
 const products=nodes.filter(n=>types(n).some(t=>t==='Product'||t==='ProductGroup'));
 const $=load(html);
 const ogImage=$('meta[property="og:image"]').attr('content')||'';
  // RP-102: no Product data means the product is invisible to Google Shopping and rich results.
 if(!products.length){const tpl=templateName(html);add('product-schema-missing','critical',`${target.url} has no Product structured data${nodes.length?` (only ${[...new Set(nodes.flatMap(types))].join(', ')})`:''}, so Google cannot show price, stock or reviews for it. Template in use: ${tpl?`“${tpl}”`:'unknown'}. Check that template’s product section or the app that should output Product data.`);}
 // RP-101: variants inside one ProductGroup are one product. Only separate top-level entities count.
 // Nested Products (related products, offers) are not separate page entities either.
 const distinct=products.filter(n=>!opts.variants?.has(n)&&(!opts.top||opts.top.has(n)));
 if(distinct.length>1){const names=(opts.sources||[]).filter(src=>src.types.some(t=>t==='Product'||t==='ProductGroup')&&distinct.some(n=>((n as {'@id'?:string})['@id']||'')===src.id&&((n as {url?:string}).url||'')===src.url)).map(src=>src.script);
  add('product-schema-multiple','warning',`${target.url} outputs ${distinct.length} separate Product entities${names.length?` (from ${[...new Set(names)].join(' and ')})`:''}. Google may read the wrong one. Usually the theme and an app both output Product data; keep one.`);}
 if(!products.some(n=>has(n.image))&&!ogImage)add('rendered-no-images','critical',`${target.url} renders with no product image. Add at least one image in Shopify.`);
 if(products.length&&!products.some(n=>has(n.brand)))add('product-brand-missing','warning',`${target.url}: the Product structured data has no brand. Set the product's vendor in Shopify.`);
 return issues;
}
export const RENDERED_CODES=new Set(['page-not-found','product-schema-missing','product-schema-multiple','rendered-no-images','product-brand-missing']);
/** Release 19 (R19-17): Google merchant-listing fields missing from a product's offers. */
export function merchantListingGaps(nodes:Node[]){
 const offers=nodes.filter(n=>types(n).some(t=>t==='Product'||t==='ProductGroup')).flatMap(n=>[n.offers,(n as {hasVariant?:unknown}).hasVariant].flat()).flatMap(o=>[o,(o as {offers?:unknown})?.offers].flat()).filter(o=>o&&typeof o==='object') as Record<string,unknown>[];
 if(!offers.length)return [];
 const gaps:string[]=[];
 if(!offers.some(o=>has(o.shippingDetails)))gaps.push('shippingDetails');
 if(!offers.some(o=>has(o.hasMerchantReturnPolicy))&&!nodes.some(n=>has((n as {hasMerchantReturnPolicy?:unknown}).hasMerchantReturnPolicy)))gaps.push('hasMerchantReturnPolicy');
 return gaps;
}

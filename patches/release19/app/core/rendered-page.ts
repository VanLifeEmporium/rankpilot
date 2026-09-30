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
export function renderedChecks(html:string,nodes:Node[],target:{id:string;title:string;url:string;kind?:string}):Issue[]{
 const issues:Issue[]=[];const add=(code:string,severity:Issue['severity'],detail:string)=>issues.push({resourceId:target.id,title:target.title,code,severity,detail});
 if(pageNotFound(html)){
  add('page-not-found','critical',`${target.url} returns HTTP 200 but shows the theme's “Page not found” page. Shoppers and Google see a missing page. Check the item is active, published to the Online Store and has at least one image, then recheck.`);
  return issues;
 }
 if(target.kind!=='product')return issues;
 const products=nodes.filter(n=>types(n).some(t=>t==='Product'||t==='ProductGroup'));
 const $=load(html);
 const ogImage=$('meta[property="og:image"]').attr('content')||'';
 if(!products.length)add('product-schema-missing','warning',`${target.url} has no Product structured data in the rendered page, so Google cannot show price, stock or reviews for it. Check the product template or the app that outputs it.`);
 if(products.filter(n=>types(n).includes('Product')).length>1)add('product-schema-multiple','warning',`${target.url} has ${products.filter(n=>types(n).includes('Product')).length} separate Product entities. Google may read the wrong one. Usually a theme block plus an app both output Product data; keep one.`);
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

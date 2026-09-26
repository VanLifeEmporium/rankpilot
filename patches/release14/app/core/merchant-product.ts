type Product={name:string;offerId:string;productAttributes?:Record<string,unknown>;attributes?:Record<string,unknown>;productStatus?:{itemLevelIssues:unknown[]}};
export function merchantProduct(p:Product){
 const a=p.productAttributes||p.attributes||{};
 const has=(v:unknown)=>Array.isArray(v)?v.length>0:typeof v==='string'&&!!v.trim();
 const missing=['brand','productTypes','shipping'].filter(k=>!has(a[k]));
 if(a.identifierExists!==false && !has(a.gtins||a.gtin))missing.unshift('gtin');
 const coverage={gtin:a.identifierExists===false?'exempt':has(a.gtins||a.gtin)?'present':'missing',brand:has(a.brand)?'present':'missing',price:a.price&&typeof a.price==='object'?'present':'missing',availability:has(a.availability)?'present':'missing',condition:has(a.condition)?'present':'missing',shipping:has(a.shipping)?'present':'account-check',returns:has(a.returnPolicyLabel)?'label-present':'account-check'};
 return {coverage,name:p.name,offerId:p.offerId,title:typeof a.title==='string'?a.title:undefined,link:typeof a.link==='string'?a.link:undefined,missing,issues:p.productStatus?.itemLevelIssues||[]};
}

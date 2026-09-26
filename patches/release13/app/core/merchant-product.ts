type Product={name:string;offerId:string;productAttributes?:Record<string,unknown>;attributes?:Record<string,unknown>;productStatus?:{itemLevelIssues:unknown[]}};
export function merchantProduct(p:Product){
 const a=p.productAttributes||p.attributes||{};
 const has=(v:unknown)=>Array.isArray(v)?v.length>0:typeof v==='string'&&!!v.trim();
 const missing=['brand','productTypes','shipping'].filter(k=>!has(a[k]));
 if(a.identifierExists!==false && !has(a.gtins||a.gtin))missing.unshift('gtin');
 return {name:p.name,offerId:p.offerId,title:typeof a.title==='string'?a.title:undefined,link:typeof a.link==='string'?a.link:undefined,missing,issues:p.productStatus?.itemLevelIssues||[]};
}

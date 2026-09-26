import type {Payload,Settings} from './types';
export function pagePurpose(kind:string,title:string){
 if(['page','article'].includes(kind) && /\b(about|our story|why we started|who we are|our journey)\b/i.test(title))return 'brand story';
 return kind==='article'?'editorial guide':kind==='product'?'product':kind==='collection'?'collection':'information page';
}
export function pageInstructions(kind:string,title:string){
 const purpose=pagePurpose(kind,title);
 return purpose==='product'?'For product descriptions use only source-supported product details and practical relevance.':
 purpose==='brand story'?'This is an authentic brand story. Preserve the personal narrative, first-person voice, anecdotes, distinctive language and chronology. Never turn it into a product listing, shortlist, specifications or shopping boilerplate. Return changed=false when the original already works.':
 purpose==='editorial guide'?'This is editorial content. Preserve the author’s voice, guide structure, locations, caveats and useful detail. Do not convert it to product-conversion copy.':
 'Preserve the purpose and voice of this page. Do not impose a product-description template.';
}
export function titleBrandInstructions(cfg:Settings){
 const brand=cfg.titleBrand?.trim() || '';
 const rule=cfg.titleBrandMode==='omit'?'Omit the store-name suffix only. Preserve product manufacturer and model identity.':cfg.titleBrandMode==='append' && brand?`End the search title with the store brand “${brand}”. Fit the whole title near the character target; if accurate page identity cannot fit, return changed=false and explain.`:'Preserve an existing store-brand suffix where it fits naturally; do not remove a product manufacturer or model just to shorten the title. If the identity cannot fit, return changed=false.';
 return 'Aim for 50–60 characters including the brand suffix. There is no word limit; prioritise accurate identity. '+rule;
}
export function supplierSignals(kind:string,p:Payload){
 if(!['product','collection'].includes(kind))return [];
 const phrases=p.descriptionHtml.replace(/<[^>]*>/g,' ').match(/\b(?:hot sale|best quality|100% brand new|factory direct|wholesale price|dropshipping supplier)\b/gi) || [];
 return [...new Set(phrases.map(p=>p.toLowerCase()))];
}

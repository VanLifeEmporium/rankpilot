import {validateProposalValue} from "./proposal-value";
import type {Change,Resource} from '@prisma/client';
// Invalid saved data must not crash every page or silently become an approvable edit.
export function jsonObject(value:string):Record<string,unknown>{try{const parsed=JSON.parse(value);return parsed && typeof parsed==='object' && !Array.isArray(parsed)?parsed:{};}catch{return {};}}
export function jsonList(value:string):unknown[]{try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:[];}catch{return [];}}
export function displayResource(resource:Resource,includeBody=false){
 const p=jsonObject(resource.payload);
 return {...resource,facts:JSON.stringify(jsonObject(resource.facts)),payload:JSON.stringify({title:resource.title,handle:resource.handle,descriptionHtml:includeBody && typeof p.descriptionHtml==='string'?p.descriptionHtml:'',seo:p.seo && typeof p.seo==='object'?p.seo:{title:'',description:''},images:Array.isArray(p.images)?p.images:[],collections:Array.isArray(p.collections)?p.collections:[],faqs:Array.isArray(p.faqs)?p.faqs:[],faqNamespace:p.faqNamespace,blogHandle:p.blogHandle,blogId:p.blogId,published:p.published})};
}
export function displayChange(change:Change){
 let invalid=false;for(const key of ['before','after'] as const){try{JSON.parse(change[key]);}catch{invalid=true;}}
 const reasons=jsonList(change.reasons).filter(r=>typeof r==='string');const blockers=jsonList(change.blockers).filter(r=>typeof r==='string');
 if(!invalid && change.status==='pending'){const issue=validateProposalValue(change.feature,JSON.parse(change.after));if(issue)blockers.push(issue);}
 if(reasons.some(r=>String(r).startsWith('source-reviewed-v1: The existing Shopify page title')))blockers.push('This older preview needs a new content review. Generate a replacement before accepting.');
 if(invalid)blockers.push('This saved preview is unreadable. Reject it and generate a replacement.');
 return {...change,before:invalid?'null':change.before,after:invalid?'null':change.after,reasons:JSON.stringify(reasons),blockers:JSON.stringify(blockers)};
}

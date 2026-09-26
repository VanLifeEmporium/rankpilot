import {load} from 'cheerio';
import type {Payload,Settings} from './types';
import {extractFacts,keywordFor} from './catalogue';
import {metadataWarnings} from './search-copy';
export function sourceSuggestions(p:Payload,kind:string){
 const $=load(p.descriptionHtml);$('script,style').remove();
 const passages=$('p,li,tr').map((_,el)=>$(el).text().replace(/\s+/g,' ').trim()).get().filter(Boolean);
 if(!passages.length && $.root().text().replace(/\s+/g,' ').trim())passages.push($.root().text().replace(/\s+/g,' ').trim());
 // Whole source statements only: do not cut off qualifications to hit a character target.
 const boilerplate=/^(post|part|chapter)\s+\d+\s+(of|in)|subscribe|sign up|cookie|all rights reserved|read more|published on|updated on/i;
 const candidates=[...passages,...passages.flatMap(s=>s.match(/[^.!?]+[.!?](?:\s|$)/g)||[])].map(s=>s.trim()).filter(s=>s.length>=35&&s.length<=200&&!boilerplate.test(s));
 const words=p.title.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>3);
 const rated=[...new Set(candidates)].map(value=>({value,score:words.filter(w=>value.toLowerCase().includes(w)).length*15+(value.length>=110&&value.length<=170?20:0)})).sort((a,b)=>b.score-a.score);
 const summary=rated[0]?.value||'';
 const facts=extractFacts(p);
 const primary=keywordFor(p,kind);
 const secondary=[...new Set([p.productType,...(p.tags||[])].filter((s):s is string=>!!s&&s.toLowerCase()!==primary.toLowerCase()))].slice(0,5);
 return {title:{value:p.seo.title||p.title,source:p.seo.title?'Existing Google title':'Current page title',confidence:'High — exact source wording'},summary:{value:p.seo.description||summary,source:p.seo.description?'Existing Google summary':'Complete statement from the current description',confidence:'Medium — check that it represents the whole page'},facts,features:passages.filter(s=>s.length<=300).slice(0,5),primary,secondary,alts:p.images.map(i=>({id:i.id,value:i.alt,source:i.alt?'Existing image description':'Needs image review; product wording cannot describe an unseen image'})),faqs:Object.entries(facts).map(([key,f])=>({question:`What are the ${key==='included'?'included items':key} for ${p.title}?`,answer:f.value,source:f.source,confirmed:false}))};
}
export function sourceDraft(p:Payload,kind:string,cfg:Settings){
 const suggested=sourceSuggestions(p,kind);
 let title=p.seo.title || suggested.title.value;
 if(cfg.titleBrandMode==='append' && cfg.titleBrand?.trim() && !title.endsWith(cfg.titleBrand.trim()))title+=` | ${cfg.titleBrand.trim()}`;
 if(!title.trim()||title.length>255)throw new Error('The source title needs a shorter edit before a preview can be prepared.');
 const description=suggested.summary.value;
 if(!description)throw new Error('There is no complete, short source statement for a Google summary. Add checked product details or write a summary before trying again.');
 return {before:p.seo,after:{title,description},blockers:[],reasons:['source-extract-v1: A source draft using existing page wording. This has not had an AI content review. Check accuracy and suitability before accepting.',`Title source: ${suggested.title.source}. ${suggested.title.confidence}.`,`Summary source: ${suggested.summary.source}. ${suggested.summary.confidence}.`,`Source evidence: “${description}”`,...metadataWarnings(title,description)]};
}

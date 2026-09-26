import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import prisma from '../db.server';
import {credentials} from './security.server';
import {relevantLinks,type LinkResource} from './link-intelligence';
import type {SearchRow} from './analytics';
export function cosine(a:number[],b:number[]){if(!a.length||a.length!==b.length)return 0;const norm=Math.sqrt(a.reduce((n,v)=>n+v*v,0)*b.reduce((n,v)=>n+v*v,0));return norm?a.reduce((n,v,i)=>n+v*b[i],0)/norm:0;}
const model='text-embedding-3-small';
export async function semanticLinks(storeId:string,source:LinkResource,resources:LinkResource[],rows?:SearchRow[],includeArticles=false){
 // Subject/season safeguards precede semantic ranking. Never suggest an unrelated
 // page just because an embedding model assigns it a relatively high score.
 const candidates=relevantLinks(source,resources,rows,includeArticles,20);
 if(!candidates.length)return [];
 const keys=await credentials(storeId);if(!keys.openaiKey)throw new Error('Connect OpenAI in Settings to check link relevance. No links have been added.');
 const selected=[source,...candidates.map(c=>resources.find(r=>r.id===c.id)!)];
 const documents=selected.map(r=>{const p=JSON.parse(r.payload);const $=load(p.descriptionHtml||'');$('script,style,nav,footer').remove();return `${r.kind}: ${r.title}\n${$.text().replace(/\s+/g,' ').slice(0,3500)}`;});
 const cacheKeys=documents.map(text=>createHash('sha256').update(JSON.stringify([storeId,model,'link-v1',text])).digest('hex'));
 const cached=await prisma.generationCache.findMany({where:{storeId,key:{in:cacheKeys}}});
 const vectors:(number[]|undefined)[]=cacheKeys.map(key=>{const c=cached.find(c=>c.key===key);return c?JSON.parse(c.value):undefined;});
 const missing=vectors.flatMap((v,i)=>v?[]:[i]);
 if(missing.length){
  const response=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{Authorization:`Bearer ${keys.openaiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),body:JSON.stringify({model,input:missing.map(i=>documents[i]),encoding_format:'float',dimensions:512})});
  if(!response.ok)throw new Error(`The relevance check could not finish (${response.status}). No links have been added; try again.`);
  const result=await response.json();
  for(let j=0;j<missing.length;j++){const i=missing[j],v=result.data?.find((d:{index:number})=>d.index===j)?.embedding;if(!Array.isArray(v)||!v.length||!v.every(Number.isFinite))throw new Error('The relevance check returned no usable result. No links have been added.');vectors[i]=v;await prisma.generationCache.upsert({where:{key:cacheKeys[i]},create:{key:cacheKeys[i],storeId,value:JSON.stringify(v)},update:{value:JSON.stringify(v),createdAt:new Date()}});}
 }
 return candidates.map((c,i)=>({...c,similarity:cosine(vectors[0]!,vectors[i+1]!)})).filter(c=>c.similarity>=0.55).sort((a,b)=>b.similarity-a.similarity).slice(0,3).map(c=>({...c,reason:`Semantic relevance checked (${c.similarity.toFixed(2)} similarity; minimum 0.55). Source: the current page and destination text, not external verification. ${c.reason}`}));
}

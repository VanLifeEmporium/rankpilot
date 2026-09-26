import type {Issue} from './types';
import {issuePriority} from './merchant-copy';
export function actionGroups(issues:Issue[]) {
 const groups=new Map<string,Issue[]>();
 const destinationOf=(i:Issue)=>i.link?.url || (i.code==='broken-link'?i.detail.match(/ to (https?:\/\/\S+) returns/)?.[1]:undefined);
 const sharedDestinations=new Set(issues.filter(i=>i.code==='broken-link').map(destinationOf).filter(Boolean));
 for(const i of issues){
  const code=['missing-meta-title','missing-meta-description','duplicate-title','duplicate-meta-title','duplicate-meta-description','long-meta-title','long-title','long-meta-description','live-title-long'].includes(i.code)?'google-listings':i.code;
  const destination=destinationOf(i);
  const key=destination && ['broken-link','404','reported-404'].includes(i.code) && sharedDestinations.has(destination)?'broken-link:'+destination:code;
  groups.set(key,[...(groups.get(key)||[]),i]);
 }
 return [...groups].map(([key,items])=>({key,code:key.startsWith('broken-link:')?'broken-link':key,items:reviewItems(items),count:new Set(items.map(i=>i.resourceId)).size,occurrences:items.length,priority:Math.min(...items.map(issuePriority)),destination:key.startsWith('broken-link:')?key.slice(12):undefined})).sort((a,b)=>a.priority-b.priority||b.count-a.count);
}
/** A title and summary proposal edits the same fields together: one review per page. */
export function reviewItems(issues:Issue[]) {
 const grouped=new Map<string,Issue>();
 for(const i of issues){const key=i.resourceId+':'+(i.feature||i.code)+':'+(i.code==='broken-link'?(i.link?.url||i.detail):'');const previous=grouped.get(key);grouped.set(key,previous?{...previous,detail:previous.detail+' '+i.detail}:i);}
 return [...grouped.values()];
}
export function resourceHealth(ids:string[],issues:Issue[],audited:boolean){
 if(!audited || !ids.length)return null;
 const affected=new Set(issues.filter(i=>ids.includes(i.resourceId)&&i.severity!=='notice'&&issuePriority(i)<9).map(i=>i.resourceId));
 return Math.round(100*(ids.length-affected.size)/ids.length);
}
export function opportunityQueries(rows:{keys:string[];position?:number;impressions:number;clicks:number}[]=[]){return rows.filter(r=>r.position!==undefined&&r.position>=8&&r.position<=20).sort((a,b)=>b.impressions-a.impressions);}

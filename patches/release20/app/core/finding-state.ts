import type {Issue,Settings} from './types';
/** Release 18: merchant decisions about findings, kept in store settings (no Shopify write). */
export type Snooze={resourceId:string;code:string;until:string;reason:string;at:string;title?:string};
export const findingKey=(i:{resourceId:string;code:string})=>`${i.resourceId}|${i.code}`;
export function activeSnoozes(cfg:Pick<Settings,'snoozes'>,now=Date.now()){return (cfg.snoozes||[]).filter(s=>Date.parse(s.until)>now);}
/** Splits findings into those to show and those snoozed until a date. */
/** Release 20 (RP-301): findings on unpublished pages, kept apart from the main list. */
export const splitUnpublished=<T extends Issue>(issues:T[])=>({live:issues.filter(i=>!i.unpublished),unpublished:issues.filter(i=>i.unpublished)});
export function applyFindingState<T extends Issue>(issues:T[],cfg:Pick<Settings,'snoozes'|'keptShopify'>,now=Date.now()){
 const snoozes=new Map(activeSnoozes(cfg,now).map(s=>[findingKey(s),s]));
 const kept=cfg.keptShopify||{};
 const active:T[]=[],snoozed:(T&{snooze:Snooze})[]=[];
 for(const i of issues){
  if(i.code==='changed-outside'&&i.changeId&&kept[i.changeId])continue;
  const s=snoozes.get(findingKey(i));
  if(s)snoozed.push({...i,snooze:s});else active.push(i);
 }
 return {active,snoozed};
}
export function snooze(cfg:Settings,input:{resourceId:string;code:string;until:string;reason:string;title?:string},now=Date.now()){
 const until=Date.parse(input.until);
 if(!Number.isFinite(until)||until<=now)throw new Error('Choose a snooze date in the future.');
 if(until>now+366*86400000)throw new Error('Snooze for at most a year, so the finding is looked at again.');
 const reason=input.reason.trim();if(reason.length<3||reason.length>300)throw new Error('Add a short reason (3–300 characters), for example “Redirect to home is intentional until the festival returns”.');
 const rest=(cfg.snoozes||[]).filter(s=>findingKey(s)!==findingKey(input)&&Date.parse(s.until)>now);
 return {...cfg,snoozes:[...rest,{resourceId:input.resourceId,code:input.code,until:new Date(until).toISOString(),reason,at:new Date(now).toISOString(),title:input.title}].slice(-500)};
}
export function unsnooze(cfg:Settings,key:{resourceId:string;code:string}){return {...cfg,snoozes:(cfg.snoozes||[]).filter(s=>findingKey(s)!==findingKey(key))};}
/** Records that the merchant accepts the value now in Shopify for the change behind a "changed outside" flag. */
export function keepShopify(cfg:Settings,changeId:string,now=Date.now()){
 if(!changeId)throw new Error('This finding has no RankPilot change to accept. Run a fresh audit.');
 const kept={...(cfg.keptShopify||{}),[changeId]:new Date(now).toISOString()};
 // Bounded: the newest 1,000 decisions are kept.
 return {...cfg,keptShopify:Object.fromEntries(Object.entries(kept).sort((a,b)=>b[1].localeCompare(a[1])).slice(0,1000))};
}
export const NO_BARCODE_SOURCE='Merchant confirmed: own-label product with no manufacturer barcode';
export const noBarcodeFact=(now=Date.now())=>({value:'none',source:`${NO_BARCODE_SOURCE} (${new Date(now).toISOString().slice(0,10)})`,confirmed:true});
export const confirmedNoBarcode=(facts:Record<string,{value?:string;confirmed?:boolean}>|undefined)=>facts?.barcode?.confirmed===true&&facts.barcode.value==='none';
/** Release 20 (RP-603): message used whenever a write is refused because the page changed outside RankPilot. */
export const PROTECTED_MESSAGE='This page was changed in Shopify after RankPilot’s last update and that finding is still open. Resolve it first (Keep Shopify’s version, or Restore RankPilot version); RankPilot will not write over the newer edit.';

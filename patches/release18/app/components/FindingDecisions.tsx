import {useState} from 'react';
import {useFetcher,useFormAction} from 'react-router';
import type {Issue} from '../core/types';
import {findingName} from '../core/merchant-copy';
type Snoozed=Issue&{snooze:{until:string;reason:string;at:string}};
/** Release 18: snooze a finding until a date, with a reason. */
export function SnoozeForm({issue,busy,onAction}:{issue:Issue;busy:boolean;onAction:(intent:string,values?:Record<string,string>)=>void}){
 const [open,setOpen]=useState(false);
 const [until,setUntil]=useState(()=>new Date(Date.now()+90*86400000).toISOString().slice(0,10));const [tomorrow]=useState(()=>new Date(Date.now()+86400000).toISOString().slice(0,10));const [reason,setReason]=useState('');
 if(!open)return <button type="button" className="button" disabled={busy} onClick={()=>setOpen(true)}>Snooze…</button>;
 return <form className="snooze-form" onSubmit={e=>{e.preventDefault();onAction('snoozeFinding',{resourceId:issue.resourceId,code:issue.code,title:issue.title,until,reason});setOpen(false);}}>
  <label>Hide until<input type="date" required value={until} min={tomorrow} onChange={e=>setUntil(e.target.value)}/></label>
  <label>Reason<input required minLength={3} maxLength={300} value={reason} placeholder="e.g. Redirect to home is intentional until next summer" onChange={e=>setReason(e.target.value)}/></label>
  <button className="button" disabled={busy}>Snooze</button> <button type="button" className="text-link" onClick={()=>setOpen(false)}>Cancel</button>
 </form>;
}
export function SnoozedList({snoozed=[]}:{snoozed?:Snoozed[]}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const action=useFormAction();
 if(!snoozed.length)return null;
 return <section className="card" id="snoozed"><h2>Snoozed findings ({snoozed.length})</h2><p>Hidden until the date shown, then they return automatically if the next check still finds them.</p>
  <table><thead><tr><th>Page</th><th>Finding</th><th>Until</th><th>Reason</th><th></th></tr></thead><tbody>{snoozed.map(i=><tr key={i.resourceId+i.code}><td>{i.title}</td><td>{findingName(i.code)}</td><td>{new Date(i.snooze.until).toLocaleDateString('en-GB')}</td><td>{i.snooze.reason}</td><td><button className="text-link" disabled={fetcher.state!=='idle'} onClick={()=>fetcher.submit({intent:'unsnoozeFinding',resourceId:i.resourceId,code:i.code},{method:'post',action})}>Show again</button></td></tr>)}</tbody></table>
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
 </section>;
}
/** Release 18: bulk "No manufacturer barcode (confirmed)" for own-label products. */
export function NoBarcodeBulk({issues}:{issues:Issue[]}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const action=useFormAction();
 const products=[...new Map(issues.filter(i=>i.code==='missing-gtin').map(i=>[i.resourceId,i])).values()];
 const [selected,setSelected]=useState<string[]>([]);
 if(!products.length)return null;
 const all=selected.length===products.length;
 return <section className="card" id="no-barcode"><h2>Products without a barcode ({products.length})</h2><p>Own-label products often have no manufacturer barcode (GTIN). Confirm those here so they stop being flagged. Never invent a barcode; if the manufacturer assigns one, add it to the variant in Shopify instead.</p>
  <form onSubmit={e=>{e.preventDefault();const body=new FormData();body.set('intent','noBarcode');for(const id of selected)body.append('ids',id);fetcher.submit(body,{method:'post',action});setSelected([]);}}>
   <label className="check-row"><input type="checkbox" checked={all} onChange={()=>setSelected(all?[]:products.map(p=>p.resourceId))}/> Select all</label>
   <ul className="plain-list">{products.map(p=><li key={p.resourceId}><label className="check-row"><input type="checkbox" checked={selected.includes(p.resourceId)} onChange={e=>setSelected(e.target.checked?[...selected,p.resourceId]:selected.filter(id=>id!==p.resourceId))}/> {p.title}</label></li>)}</ul>
   <button className="button primary" disabled={!selected.length||fetcher.state!=='idle'}>No manufacturer barcode (confirmed) for {selected.length} selected</button>
  </form>
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
 </section>;
}

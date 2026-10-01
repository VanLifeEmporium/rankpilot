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
 // Release 19: stay mounted while a message is showing, so "Show again" confirmation is not lost.
 if(!snoozed.length&&!fetcher.data)return null;
 return <section className="card" id="snoozed"><h2>Snoozed findings ({snoozed.length})</h2><p>Hidden until the date shown, then they return automatically if the next check still finds them.</p>
  <table><thead><tr><th>Page</th><th>Finding</th><th>Until</th><th>Reason</th><th></th></tr></thead><tbody>{snoozed.map(i=><tr key={i.resourceId+i.code}><td>{i.title}</td><td>{findingName(i.code)}</td><td>{new Date(i.snooze.until).toLocaleDateString('en-GB')}</td><td>{i.snooze.reason}</td><td><button className="text-link" disabled={fetcher.state!=='idle'} onClick={()=>fetcher.submit({intent:'unsnoozeFinding',resourceId:i.resourceId,code:i.code},{method:'post',action})}>Show again</button></td></tr>)}</tbody></table>
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
 </section>;
}
/** Release 18: bulk "No manufacturer barcode (confirmed)" for own-label products. */
export function NoBarcodeBulk({issues,resources=[]}:{issues:Issue[];resources?:{id:string;title:string;kind:string;facts:string}[]}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const action=useFormAction();
 const products=[...new Map(issues.filter(i=>i.code==='missing-gtin').map(i=>[i.resourceId,i])).values()];
 const [selected,setSelected]=useState<string[]>([]);
 // Release 19: confirmed products are listed with an undo; the section stays while a message shows.
 const confirmed=resources.filter(r=>r.kind==='product'&&(()=>{try{const b=JSON.parse(r.facts||'{}').barcode;return b?.confirmed&&b.value==='none';}catch{return false;}})());
 const undo=(id:string)=>{const body=new FormData();body.set('intent','noBarcode');body.append('ids',id);body.set('undo','on');fetcher.submit(body,{method:'post',action});};
 if(!products.length&&!confirmed.length&&!fetcher.data)return null;
 const all=selected.length===products.length;
 return <section className="card" id="no-barcode"><h2>Products without a barcode ({products.length})</h2><p>Own-label products often have no manufacturer barcode (GTIN). Confirm those here so they stop being flagged. Never invent a barcode; if the manufacturer assigns one, add it to the variant in Shopify instead.</p>
  {products.length>0&&<>
  <form onSubmit={e=>{e.preventDefault();const body=new FormData();body.set('intent','noBarcode');for(const id of selected)body.append('ids',id);fetcher.submit(body,{method:'post',action});setSelected([]);}}>
   <label className="check-row"><input type="checkbox" checked={all} onChange={()=>setSelected(all?[]:products.map(p=>p.resourceId))}/> Select all</label>
   <ul className="plain-list">{products.map(p=><li key={p.resourceId}><label className="check-row"><input type="checkbox" checked={selected.includes(p.resourceId)} onChange={e=>setSelected(e.target.checked?[...selected,p.resourceId]:selected.filter(id=>id!==p.resourceId))}/> {p.title}</label></li>)}</ul>
   <button className="button primary" disabled={!selected.length||fetcher.state!=='idle'}>No manufacturer barcode (confirmed) for {selected.length} selected</button>
  </form>
  </>}
  {confirmed.length>0&&<details><summary>Confirmed without a barcode ({confirmed.length})</summary><ul className="plain-list">{confirmed.map(r=><li key={r.id}>{r.title} <button type="button" className="text-link" disabled={fetcher.state!=='idle'} onClick={()=>undo(r.id)}>Undo</button></li>)}</ul></details>}
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
 </section>;
}
/** Release 20 (RP-301): findings on unpublished pages, kept out of the main list and the scores. */
export function UnpublishedList({issues=[]}:{issues?:Issue[]}){
 if(!issues.length)return null;
 const pages=[...new Map(issues.map(i=>[i.resourceId,i.title])).entries()];
 return <section className="card" id="unpublished"><h2>Unpublished pages ({pages.length})</h2><p>These pages are not live on your store, so their findings are not counted in Catalogue checks or Answer readiness. Publish a page in Shopify when it is ready, or leave it as a draft.</p>
  <details><summary>Show {issues.length} {issues.length===1?'finding':'findings'}</summary><ul className="plain-list">{pages.map(([id,title])=><li key={id}><span className="badge neutral">Draft</span> {title}: {issues.filter(i=>i.resourceId===id).map(i=>findingName(i.code)).join(', ')}</li>)}</ul></details>
 </section>;
}
/** Release 22 (R22-701): findings with a proposal or redirect already waiting; not counted as open work. */
export function InProgressList({issues=[],onReview}:{issues?:(Issue&{pending:{changeId:string;label:string}})[];onReview:(id:string)=>void}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const action=useFormAction();
 if(!issues.length&&!fetcher.data)return null;
 const busy=fetcher.state!=='idle';
 return <section className="card" id="in-progress"><h2>In progress ({issues.length})</h2><p>These findings already have a change waiting. They are not counted as open findings. Approve or reject each one here, or open it to review the details.</p>
  <ul className="plain-list">{issues.map(i=><li key={i.resourceId+i.code}><span className="badge neutral">{i.pending.label}</span> {i.title}: {findingName(i.code)}{' '}
   <button type="button" className="button primary" disabled={busy} onClick={()=>fetcher.submit({intent:'approve',id:i.pending.changeId},{method:'post',action})}>Approve</button>{' '}
   <button type="button" className="button" disabled={busy} onClick={()=>fetcher.submit({intent:'reject',id:i.pending.changeId},{method:'post',action})}>Reject</button>{' '}
   <button type="button" className="text-link" onClick={()=>onReview(i.pending.changeId)}>Review</button></li>)}</ul>
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
 </section>;
}

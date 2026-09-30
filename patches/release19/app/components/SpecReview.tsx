import {plural} from '../core/plural';
import {useState} from 'react';
import {useFetcher,useFormAction} from 'react-router';
import {specKeys} from '../core/spec-extract';
import {factLabels} from '../core/catalogue-data';
import type {Facts} from '../core/types';
type Resource={id:string;title:string;kind:string;facts:string};
type Job={id:string;kind:string;status:string;payload:string;error?:string|null};
/** Release 18: bulk specification suggestions, reviewed per product with their source sentences. */
export function SpecReview({resources,jobs}:{resources:Resource[];jobs:Job[]}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const action=useFormAction();
 const [ai,setAi]=useState(false);const [page,setPage]=useState(0);
 // Release 19: each value is ticked after checking it; nothing is confirmed in bulk without a look.
 const [checked,setChecked]=useState<Set<string>>(new Set());const toggle=(k:string,on:boolean)=>setChecked(prev=>{const next=new Set(prev);if(on)next.add(k);else next.delete(k);return next;});
 const busy=fetcher.state!=='idle';
 const job=jobs.find(j=>j.kind==='spec-fill'&&['queued','running'].includes(j.status));
 const last=jobs.find(j=>j.kind==='spec-fill');
 const progress=(()=>{try{return JSON.parse((job||last)?.payload||'{}');}catch{return {};}})();
 const rows=resources.filter(r=>r.kind==='product').map(r=>{let f:Facts={};try{f=JSON.parse(r.facts||'{}');}catch{/* unreadable facts are skipped */}return {id:r.id,title:r.title,facts:specKeys.filter(k=>f[k]?.value?.trim()&&!f[k].confirmed).map(k=>({key:k,...f[k]}))};}).filter(r=>r.facts.length);
 const size=15,shown=rows.slice(page*size,page*size+size);
 const submit=(values:Record<string,string>)=>fetcher.submit(values,{method:'post',action});
 return <section className="card spec-review" aria-label="Specification suggestions"><h2>Fill specs for all products</h2>
  <p>Reads every product description for sizes, weight, capacity, materials, power, compatibility, what is included and care. Suggestions fill empty fields only, show the sentence they came from and stay unconfirmed until you confirm them. Nothing is sent to Shopify.</p>
  <label className="check-row"><input type="checkbox" checked={ai} onChange={e=>setAi(e.target.checked)}/> Also use AI for details the rules cannot read (uses your OpenAI key; a small cost per product). A suggestion is kept only if its quoted sentence is really in the description.</label>
  <button className="button" disabled={busy||!!job} onClick={()=>submit({intent:'fillSpecs',ai:ai?'on':''})}>{job?`Reading products… ${progress.cursor||0} of ${progress.total||'?'}`:busy?'Starting…':'Fill specs for all products'}</button>
  {!job&&last?.status==='completed'&&<p className="muted">Last run: {plural(progress.filled||0,'suggestion')} added to {plural(progress.products||0,'product')}.</p>}
  {last?.status==='failed'&&<p role="alert">{last.error||'The last run stopped.'}</p>}
  {/* Release 19: a start message is cleared once the run finishes, so it cannot go stale. */}
  {fetcher.data&&(!fetcher.data.ok||job||!/^Reading product descriptions/.test(fetcher.data.message))&&<p role={fetcher.data.ok?'status':'alert'} className={fetcher.data.ok?'':'notice error'}>{fetcher.data.message}</p>}
  <p><button className="button" disabled={busy} onClick={()=>submit({intent:'bulkFaqs'})}>Add FAQs from confirmed facts</button> <span className="muted">For products with 3+ confirmed facts and no FAQs. Proposals go to the review queue.</span></p>
  {rows.length>0?<><p>{plural(rows.length,'product')} {rows.length===1?'has':'have'} unconfirmed suggestions. Tick each value you have checked against its source, then confirm.</p><p className="notice warning">Confirming facts replaces any waiting description, FAQ or Google listing proposals for that product; prepare them again afterwards so they use the confirmed facts.</p>
   <table className="spec-review-table"><thead><tr><th>Product</th><th>Field</th><th>Suggested value</th><th>Source</th></tr></thead><tbody>
   {shown.map(r=>{const picked=r.facts.filter(f=>checked.has(r.id+'|'+f.key)).map(f=>f.key);return r.facts.map((f,i)=><tr key={r.id+f.key}>{i===0&&<th rowSpan={r.facts.length} scope="rowgroup">{r.title}<div className="connection-actions"><button className="button" disabled={busy||!picked.length} onClick={()=>submit({intent:'confirmSpecs',id:r.id,keys:JSON.stringify(picked)})}>Confirm checked ({picked.length} of {r.facts.length})</button><button className="text-link" disabled={busy} onClick={()=>submit({intent:'discardSpecs',id:r.id})}>Discard</button></div></th>}<td><label className="check-row"><input type="checkbox" checked={checked.has(r.id+'|'+f.key)} onChange={e=>toggle(r.id+'|'+f.key,e.target.checked)}/> {factLabels[f.key]||f.key}</label></td><td>{f.value}</td><td className="muted">{f.source}</td></tr>);})}
   </tbody></table>
   {rows.length>size&&<p><button className="text-link" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button> Page {page+1} of {Math.ceil(rows.length/size)} <button className="text-link" disabled={(page+1)*size>=rows.length} onClick={()=>setPage(page+1)}>Next</button></p>}</>
  :<p className="muted">No unconfirmed suggestions waiting.</p>}
 </section>;
}

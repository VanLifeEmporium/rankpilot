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
  {!job&&last?.status==='completed'&&<p className="muted">Last run: {progress.filled||0} suggestions added to {progress.products||0} products.</p>}
  {last?.status==='failed'&&<p role="alert">{last.error||'The last run stopped.'}</p>}
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
  <p><button className="button" disabled={busy} onClick={()=>submit({intent:'bulkFaqs'})}>Add FAQs from confirmed facts</button> <span className="muted">For products with 3+ confirmed facts and no FAQs. Proposals go to the review queue.</span></p>
  {rows.length>0?<><p>{rows.length} products have unconfirmed suggestions. Check each value against its source, then confirm.</p>
   <table className="spec-review-table"><thead><tr><th>Product</th><th>Field</th><th>Suggested value</th><th>Source</th></tr></thead><tbody>
   {shown.map(r=>r.facts.map((f,i)=><tr key={r.id+f.key}>{i===0&&<th rowSpan={r.facts.length} scope="rowgroup">{r.title}<div className="connection-actions"><button className="button" disabled={busy} onClick={()=>submit({intent:'confirmSpecs',id:r.id})}>Confirm all ({r.facts.length})</button><button className="text-link" disabled={busy} onClick={()=>submit({intent:'discardSpecs',id:r.id})}>Discard</button></div></th>}<td>{factLabels[f.key]||f.key}</td><td>{f.value}</td><td className="muted">{f.source}</td></tr>))}
   </tbody></table>
   {rows.length>size&&<p><button className="text-link" disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button> Page {page+1} of {Math.ceil(rows.length/size)} <button className="text-link" disabled={(page+1)*size>=rows.length} onClick={()=>setPage(page+1)}>Next</button></p>}</>
  :<p className="muted">No unconfirmed suggestions waiting.</p>}
 </section>;
}

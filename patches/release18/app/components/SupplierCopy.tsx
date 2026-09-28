import {useState} from 'react';
import {useFetcher,useFormAction} from 'react-router';
import type {SupplierCopyRow} from '../core/supplier-copy.server';
/** Release 18: products whose description still matches the supplier original. */
export function SupplierCopy({report}:{report?:{compared:number;originals:number;onSupplierCopy:SupplierCopyRow[];rows:SupplierCopyRow[]}|null}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const action=useFormAction();const [csv,setCsv]=useState('');
 if(!report)return null;
 return <section className="card" id="supplier-copy"><h2>Still on supplier copy</h2>
  <p>Compares each description with the supplier’s original wording (five-word sequences). Products at 50% or more still read mostly as the supplier wrote them. Only products with a supplied original are compared.</p>
  {report.compared?<><p><strong>{report.onSupplierCopy.length}</strong> of {report.compared} compared products are still on supplier copy.</p>
   {report.onSupplierCopy.length>0&&<table><thead><tr><th>Product</th><th>Matches supplier</th><th>Original from</th></tr></thead><tbody>{report.onSupplierCopy.map(r=><tr key={r.resourceId}><td>{r.title}</td><td>{Math.round(100*r.overlap)}%</td><td className="muted">{r.source}</td></tr>)}</tbody></table>}</>
  :<p className="muted">No supplier originals yet. Store Operations (or the agent, via POST supplier-originals) can send them; or import a CSV below.</p>}
  <details><summary>Import supplier originals (CSV)</summary><p>Columns: handle, original, source. Nothing in Shopify changes.</p>
   <label>CSV file<input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(file&&file.size<=500000)setCsv(await file.text());}}/></label>
   <label>CSV contents<textarea rows={4} value={csv} onChange={e=>setCsv(e.target.value)}/></label>
   <button className="button" disabled={!csv.trim()||fetcher.state!=='idle'} onClick={()=>fetcher.submit({intent:'supplierOriginals',csv},{method:'post',action})}>Save originals</button></details>
  {fetcher.data&&<p role={fetcher.data.ok?'status':'alert'}>{fetcher.data.message}</p>}
 </section>;
}

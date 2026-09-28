import {useEffect,useRef,useState} from 'react';
import {useFetcher} from 'react-router';
import {groupLabels,type CoverageGroup} from '../core/index-coverage';
type Row={url:string;verdict?:string;coverageState?:string;error?:string;checkedAt:string;group?:CoverageGroup;reason?:string;nextStep?:string;kind?:string;googleCanonical?:string};
type Evidence={rows:Row[];total:number;page:number;size:number;counts:Record<string,number>;groups?:Record<string,number>;byKind?:Record<string,{inspected:number;indexed:number}>;inspected?:number;indexed?:number};
const kindLabels:Record<string,string>={all:'All pages',catalogue:'Products and collections',product:'Products',collection:'Collections',article:'Blog posts',page:'Pages'};
/** Release 18: index coverage report — every non-indexed page with Google's reason and a next step. */
export function IndexEvidence({lastRecheck}:{rows?:Row[];lastRecheck?:{url:string;before?:Row;after:Row}}){
 const [page,setPage]=useState(0),[size,setSize]=useState(10),[kind,setKind]=useState('all'),[status,setStatus]=useState('not-indexed');const evidence=useFetcher<Evidence>();
 const requested=useRef('');const path=`/app/index-evidence?page=${page}&size=${size}&kind=${kind}&status=${status}`;
 useEffect(()=>{if(requested.current!==path){requested.current=path;void evidence.load(path);}},[path,evidence]);
 const data=evidence.data;const loading=evidence.state!=='idle';
 return <div className="index-report"><p>Pages Google inspected, grouped by Google’s reason. Uninspected sitemap URLs are unknown, not failures.</p>
 <div className="connection-actions"><label>Show<select value={kind} disabled={loading} onChange={e=>{setKind(e.target.value);setPage(0);}}>{Object.entries(kindLabels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
 <label>Status<select value={status} disabled={loading} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="not-indexed">Not indexed only</option><option value="all">All inspected</option></select></label>
 <button type="button" className="button" disabled={loading} onClick={()=>evidence.load(path)}>Refresh evidence</button></div>
 {!data?.rows?<p role="status">{loading?'Loading URL evidence…':'Evidence unavailable. Try Refresh evidence.'}</p>:<>
 {data.inspected!==undefined&&<p><strong>{data.indexed} of {data.inspected}</strong> inspected {kindLabels[kind].toLowerCase()} indexed{data.inspected?` (${Math.round(100*(data.indexed||0)/data.inspected)}%)`:''}.{data.byKind&&' '+Object.entries(data.byKind).map(([k,v])=>`${k}: ${v.indexed}/${v.inspected}`).join(' · ')}</p>}
 <ul>{Object.entries(data.groups||data.counts||{}).sort((a,b)=>b[1]-a[1]).map(([g,n])=><li key={g}>{groupLabels[g as CoverageGroup]||g}: {n}</li>)}</ul>
 {lastRecheck&&<p>Latest check after a saved change: {lastRecheck.url} · Before: {lastRecheck.before?.coverageState||lastRecheck.before?.verdict||'Not previously checked'} → Now: {lastRecheck.after.error||lastRecheck.after.coverageState||lastRecheck.after.verdict}. Google’s stored index may not yet reflect the edit.</p>}
 {data.rows.length?<table className="index-table"><thead><tr><th>Page</th><th>Google’s reason</th><th>Next step</th></tr></thead><tbody>{data.rows.map(r=><tr key={r.url}><td><a href={r.url} target="_blank" rel="noreferrer">{r.url.replace(/^https?:\/\/[^/]+/,'')||'/'}</a><br/><small className="muted">Checked {new Date(r.checkedAt).toLocaleDateString('en-GB')}</small></td><td>{r.error||r.coverageState||r.verdict}</td><td>{r.nextStep}</td></tr>)}</tbody></table>:<p>{status==='not-indexed'?'No inspected page in this view is outside Google’s index.':'No inspected pages yet.'}</p>}
 <label>Rows per page<select value={size} disabled={loading} onChange={e=>{setSize(Number(e.target.value));setPage(0);}}>{[10,25,50].map(n=><option key={n}>{n}</option>)}</select></label>
 <button type="button" className="button" disabled={loading||!data.page} onClick={()=>setPage(data.page-1)}>Previous URLs</button> <span>{data.page+1} of {Math.max(1,Math.ceil(data.total/size))}</span> <button type="button" className="button" disabled={loading||(data.page+1)*size>=data.total} onClick={()=>setPage(data.page+1)}>Next URLs</button></>}
 </div>;
}

import {useEffect,useRef,useState} from 'react';
import {useFetcher} from 'react-router';
type Row={url:string;verdict?:string;coverageState?:string;error?:string;checkedAt:string};
type Evidence={rows:Row[];total:number;page:number;size:number;counts:Record<string,number>};
export function IndexEvidence({lastRecheck}:{rows?:Row[];lastRecheck?:{url:string;before?:Row;after:Row}}){
 const [page,setPage]=useState(0),[size,setSize]=useState(10);const evidence=useFetcher<Evidence>();
 const requested=useRef('');const path=`/app/index-evidence?page=${page}&size=${size}`;
 useEffect(()=>{if(requested.current!==path){requested.current=path;void evidence.load(path);}},[path,evidence]);
 const data=evidence.data;const loading=evidence.state!=='idle';
 return <><p>Evidence is loaded on demand. Use Refresh evidence to see newer checks while a job runs.</p><button type="button" className="button" disabled={loading} onClick={()=>evidence.load(path)}>Refresh evidence</button>
 {!data?<p role="status">{loading?'Loading URL evidence…':'Evidence unavailable. Try Refresh evidence.'}</p>:<>
 <ul>{Object.entries(data.counts).map(([reason,n])=><li key={reason}>{reason}: {n}</li>)}</ul>
 {lastRecheck&&<p>Latest check after a saved change: {lastRecheck.url} · Before: {lastRecheck.before?.coverageState||lastRecheck.before?.verdict||'Not previously checked'} → Now: {lastRecheck.after.error||lastRecheck.after.coverageState||lastRecheck.after.verdict}. Google’s stored index may not yet reflect the edit.</p>}
 <label>URLs per page<select value={size} disabled={loading} onChange={e=>{setSize(Number(e.target.value));setPage(0);}}>{[10,25,50].map(n=><option key={n}>{n}</option>)}</select></label>
 {data.rows.map(r=><p key={r.url}>{r.url} · {r.error||r.coverageState||r.verdict} · {new Date(r.checkedAt).toLocaleString('en-GB')}</p>)}
 <button type="button" className="button" disabled={loading||!data.page} onClick={()=>setPage(data.page-1)}>Previous URLs</button> <span>{data.page+1} of {Math.max(1,Math.ceil(data.total/size))}</span> <button type="button" className="button" disabled={loading||(data.page+1)*size>=data.total} onClick={()=>setPage(data.page+1)}>Next URLs</button></>}
 </>;
}

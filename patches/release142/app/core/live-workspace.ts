import {useEffect,useRef,useState} from 'react';
import {workspaceRevision,shareWorkspace} from './live-refresh';
import type {loadUI} from './ui.server';
type Data=Awaited<ReturnType<typeof loadUI>>;

// Resource-route JSON requests do not navigate the embedded frame or depend on
// React Router's revalidation lifecycle. Never cache a session token.
export async function workspaceJSON(path:string,demo:boolean,signal:AbortSignal) {
 const headers:Record<string,string>={Accept:'application/json'};
 if(!demo) {
  const bridge=(window as unknown as {shopify?:{idToken:()=>Promise<string>}}).shopify;
  if(!bridge)throw new Error('Shopify connection is not ready');
  signal.throwIfAborted();
  const token=await new Promise<string>((resolve,reject)=>{
   const abort=()=>reject(signal.reason);
   signal.addEventListener('abort',abort,{once:true});
   bridge.idToken().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
  headers.Authorization=`Bearer ${token}`;
 }
 signal.throwIfAborted();
 const response=await fetch(path,{headers,signal,cache:'no-store',credentials:'same-origin',redirect:'error'});
 if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))throw new Error('Live refresh unavailable');
 return response.json();
}
export function useLiveWorkspace(initial:Data,section:string,actionState:string) {
 const [snapshot,setSnapshot]=useState<{base:Data;value:Data}|null>(null);
 const [refreshError,setRefreshError]=useState(false);
 const [workerHealthy,setWorkerHealthy]=useState(true);
 const current=snapshot?.base===initial?snapshot.value:initial;
 const latest=useRef(current);
 useEffect(()=>{latest.current=current;},[current]);
 useEffect(()=>{
  let stopped=false,busy=false,timer:ReturnType<typeof setTimeout>;
  let controller:AbortController|undefined;
  let failures=0;
  let lastFullRefresh=0;
  const check=async()=>{
   if(stopped || busy)return;
   busy=true;clearTimeout(timer);controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),12000);
   try {
    const status=await workspaceJSON('/app/job-status',initial.demo,controller.signal);
    if(!stopped)setWorkerHealthy(status.workerHealthy!==false);
    if(typeof status.workspaceRevision!=='string')throw new Error('Invalid status response');
    if(status.workspaceRevision!==workspaceRevision(latest.current.jobs) && Date.now()-lastFullRefresh>=4000) {
     const params=new URLSearchParams({section});
     const historyPage=new URLSearchParams(window.location.search).get('historyPage');
     if(historyPage)params.set('historyPage',historyPage);
     const value=await workspaceJSON(`/app/live-state?${params}`,initial.demo,controller.signal) as Data;
     if(!Array.isArray(value.jobs) || !Array.isArray(value.changes))throw new Error('Invalid workspace response');
     if(!stopped){const shared=shareWorkspace(latest.current,value);latest.current=shared;lastFullRefresh=Date.now();setSnapshot({base:initial,value:shared});}
    } else if(status.workspaceRevision===workspaceRevision(latest.current.jobs)) {
     const previous=latest.current;
     const jobs=previous.jobs.map(j=>{const progress=status.indexJobs?.find((x:{id:string})=>x.id===j.id);return progress?{...j,...progress}:j;});
     const metrics=status.indexation?[...previous.metrics.filter(m=>m.provider!=='indexation'),status.indexation]:previous.metrics;
     const value=shareWorkspace(previous,{...previous,jobs,metrics});
     if(!stopped&&(value.jobs!==previous.jobs||value.metrics!==previous.metrics)){latest.current=value;setSnapshot({base:initial,value});}
    }
    failures=0;if(!stopped)setRefreshError(false);
   } catch {
    failures++;if(!stopped)setRefreshError(true);
   } finally {
    clearTimeout(timeout);busy=false;
    if(!stopped){const active=latest.current.jobs.some(j=>['queued','running'].includes(j.status));timer=setTimeout(check,failures?Math.min(30000,2000*2**Math.min(failures,4)):active?3000:15000);}
   }
  };
  // Poll inside visible Shopify frames too; visibility heuristics must not hide
  // a completed job. Requests are bounded and never overlap.
  timer=setTimeout(check,500);window.addEventListener('focus',check);
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();window.removeEventListener('focus',check);};
 },[initial,section,actionState]);
 return {data:current,refreshError,workerHealthy};
}

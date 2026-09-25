import {useEffect,useRef,useState} from 'react';
import {jobRevision} from './job-revision';
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
  const check=async()=>{
   if(stopped || busy)return;
   busy=true;clearTimeout(timer);controller=new AbortController();
   const timeout=setTimeout(()=>controller?.abort(),12000);
   try {
    const status=await workspaceJSON('/app/job-status',initial.demo,controller.signal);
    if(!stopped)setWorkerHealthy(status.workerHealthy!==false);
    if(typeof status.revision!=='string')throw new Error('Invalid status response');
    if(status.revision!==jobRevision(latest.current.jobs)) {
     const params=new URLSearchParams({section});
     const historyPage=new URLSearchParams(window.location.search).get('historyPage');
     if(historyPage)params.set('historyPage',historyPage);
     const value=await workspaceJSON(`/app/live-state?${params}`,initial.demo,controller.signal) as Data;
     if(!Array.isArray(value.jobs) || !Array.isArray(value.changes))throw new Error('Invalid workspace response');
     if(!stopped){latest.current=value;setSnapshot({base:initial,value});}
    }
    if(!stopped)setRefreshError(false);
   } catch {
    if(!stopped)setRefreshError(true);
   } finally {
    clearTimeout(timeout);busy=false;
    if(!stopped){const active=latest.current.jobs.some(j=>['queued','running'].includes(j.status));timer=setTimeout(check,active?1000:5000);}
   }
  };
  // Poll inside visible Shopify frames too; visibility heuristics must not hide
  // a completed job. Requests are bounded and never overlap.
  void check();window.addEventListener('focus',check);
  return()=>{stopped=true;clearTimeout(timer);controller?.abort();window.removeEventListener('focus',check);};
 },[initial,section,actionState]);
 return {data:current,refreshError,workerHealthy};
}

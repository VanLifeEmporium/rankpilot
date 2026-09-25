import {useState} from 'react';
import {useFetcher,useFormAction} from 'react-router';
import {ChangeValues} from './ChangeValues';
import {featureNames} from '../core/merchant-copy';
type Change={id:string;resourceId:string;feature:string;before:string;after:string;updatedAt:Date|string};
export function BatchReview({changes,resources}:{changes:Change[];resources:{id:string;title:string}[]}) {
 const fetcher=useFetcher<{message:string}>();const action=useFormAction();
 const [confirmed,setConfirmed]=useState('');
 return <section className="card"><h2>Review similar improvements together</h2><p>Choose one small set below. Read the previews, then approve that set in one click. Every change is checked against your current shop before saving.</p><details><summary>Why this matters and how to use it</summary><p>Group similar tasks to reduce repeated clicks. Each set contains up to 25 ready suggestions, one per page. Older drafts and blocked suggestions are excluded. Open a preview to inspect the exact wording; only approve a set you are happy with. You can undo each saved change separately.</p></details>{['seo','alt'].map(feature=>{
 const used=new Set<string>();const group=changes.filter(c=>{if(c.feature!==feature || used.has(c.resourceId))return false;used.add(c.resourceId);return true;}).slice(0,25);
 if(!group.length)return null;
 const key=JSON.stringify(group.map(c=>[c.id,c.updatedAt]));
 return <details key={feature}><summary>{featureNames[feature]} — {group.length} ready</summary>{group.map(c=><details key={c.id}><summary>{resources.find(r=>r.id===c.resourceId)?.title || 'Page'}</summary><h3>Now</h3><ChangeValues feature={feature} value={JSON.parse(c.before)}/><h3>After your approval</h3><ChangeValues feature={feature} value={JSON.parse(c.after)}/></details>)}<label className="check-row"><input type="checkbox" checked={confirmed===key} onChange={e=>setConfirmed(e.target.checked?key:'')}/>I approve these {group.length} previews.</label><button type="button" className="button primary" disabled={fetcher.state!=='idle' || confirmed!==key} onClick={()=>{setConfirmed('');fetcher.submit({intent:'approveBatch',items:JSON.stringify(group.map(c=>({id:c.id,version:new Date(c.updatedAt).toISOString()})))},{method:'post',action});}}>Accept and apply this set ({group.length})</button></details>;
 })}{fetcher.data && <p role="status">{fetcher.data.message}</p>}</section>;
}

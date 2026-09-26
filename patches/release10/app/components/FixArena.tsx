import {useEffect,useRef,useState} from 'react';
import type {loadUI} from '../core/ui.server';
import type {Issue} from '../core/types';
import {brokenAddress} from '../core/broken-url';
import {findingAction,findingProgress} from '../core/finding-workflow';
import {findingName,findingExplanation} from '../core/merchant-copy';
import type {ReviewFeedback} from './ChangeReview';
type Data=Awaited<ReturnType<typeof loadUI>>;
/** Shared accessible review shell. Decisions remain visible as content scrolls. */
export function FixDialog({open,title,onClose,children}:{open:boolean;title:string;onClose:()=>void;children:React.ReactNode}) {
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open && !dialog.current?.open)dialog.current?.showModal();else if(!open && dialog.current?.open)dialog.current.close();},[open]);
 return <dialog ref={dialog} className="review-dialog change-preview" aria-labelledby="fix-title" onClose={onClose}>
  <div className="dialog-head"><div><span className="eyebrow">REVIEW A FIX</span><h2 id="fix-title">{title}</h2></div><button type="button" className="close" aria-label="Close preview" onClick={onClose}>×</button></div>
  {children}
 </dialog>;
}
export function FindingFix({issue,d,busy,message,feedback,onGenerate,onFacts,onReview,onAction}:{
 issue:Issue;d:Data;busy:boolean;message?:string;feedback?:ReviewFeedback;
 onGenerate:()=>void;onFacts:()=>void;onReview:(id:string)=>void;onAction:(intent:string,values?:Record<string,string>)=>void;
}) {
 const resource=d.resources.find(r=>r.id===issue.resourceId);
 const action=findingAction(issue,resource,d.settings);
 const progress=findingProgress(issue,d.changes,d.jobs);
 const [requested,setRequested]=useState(false);
 const [redirectRequested,setRedirectRequested]=useState(false);
 const path=brokenAddress(issue,d.domain,resource);
 const [target,setTarget]=useState('/');
 const [mode,setMode]=useState('redirect');
 const redirect=['reported-404','404','broken-link'].includes(issue.code);
 return <>
  <div className="review-body finding-review">
   <p className="badge">{findingName(issue.code)}</p>
   <section className="review-why"><h3>Why we suggest fixing this</h3><p>{findingExplanation(issue)}</p></section>
   <details><summary>Evidence from the last check</summary><p>{issue.detail}</p></details>
   {action.kind==='generate' && <><h3>Prepare a change to review</h3><p>We’ll use this page’s existing information to prepare a Before/After preview. You can then accept or reject it here. Nothing is published during preparation.</p></>}
   {action.kind==='facts' && <><h3>Confirm the information first</h3><p>{action.detail}</p><p>Add a detail you have checked, save it, then return here to prepare the preview.</p></>}
   {action.kind==='manual' && <><h3>{redirect?'Choose where visitors should go':'What needs to change'}</h3><p>{action.detail}</p>
    {redirect ? <form id="arena-redirect" onSubmit={e=>{e.preventDefault();setRedirectRequested(true);onAction(mode==='redirect'?'applyRedirect':issue.code==='broken-link'?'removeBrokenLink':'removeReportedUrl',{path,target,resourceId:issue.resourceId});}}>
     <label>Choose a fix<select value={mode} disabled={busy} onChange={e=>setMode(e.target.value)}><option value="redirect">Redirect visitors to another page</option>{["broken-link","reported-404"].includes(issue.code) && <option value="delete">{issue.code==="broken-link"?"Delete this link (keep the text)":"Delete from the tracking list"}</option>}</select></label>
     <label>Current broken URL<input required name="path" value={path} readOnly aria-readonly="true" placeholder="Address unavailable — run a fresh scan"/></label>
     {mode==='redirect' && <label>New target<input required name="target" disabled={busy} value={target} onChange={e=>setTarget(e.target.value)} placeholder="/"/></label>}
     <p>{mode==='redirect'?'Before: visitors reach a missing page. After: they are forwarded to the target above. / means your homepage; choose a relevant replacement where available. Apply update approves and saves this redirect.':issue.code==='broken-link'?'Apply update removes matching links from this page’s editable description, keeping their text. Links in navigation or the theme need a source edit. You can undo the saved change in Results & history.':'This address already has no live page. Apply update removes it from RankPilot tracking only; it does not erase search results or delete store content.'}</p>
    </form> : <p>This finding needs a change to its source or theme. There is no supported automatic edit to approve yet. Check the evidence above, make the source correction, then run a fresh check below.</p>}
   </>}
   {(requested || progress.busy) && <p role="status">{message || progress.message || 'Preparing your preview…'}</p>}
   {redirectRequested && feedback && <p role={feedback.ok?'status':'alert'}>{feedback.message}</p>}
  </div>
  <div className="review-footer">
   {redirectRequested && feedback?.ok && feedback.changeId && <button type="button" className="button primary" onClick={()=>onReview(feedback.changeId!)}>Review prepared redirect</button>}
   {progress.changeId && <button type="button" className="button primary" onClick={()=>onReview(progress.changeId!)}>Review the prepared fix</button>}
   {action.kind==='generate' && progress.canGenerate && <button type="button" className="button primary" disabled={busy||progress.busy} onClick={()=>{setRequested(true);onGenerate();}}>{busy||progress.busy?'Preparing preview…':'Prepare preview'}</button>}
   {action.kind==='facts' && <button type="button" className="button primary" onClick={onFacts}>Confirm product details</button>}
   {action.kind==='manual' && (redirect ? <button form="arena-redirect" className="button primary" disabled={busy||!path}>{busy?'Applying update…':'Apply update'}</button> : <button type="button" className="button" disabled={busy} onClick={()=>{setRedirectRequested(true);onAction('audit');}}>Recheck after fixing</button>)}

  </div>
 </>;
}

import {ChangeImpact} from './ChangeImpact';
import {titleGuidance,metadataWarnings} from '../core/search-copy';
import {useState} from 'react';
import type {loadUI} from '../core/ui.server';
import {ChangeValues} from './ChangeValues';
import {ReviewActions} from './ReviewActions';
import {Guidance} from './SectionHeading';
import {changeStatus} from '../core/workflow-ui';
import {featureNames as labels} from '../core/merchant-copy';
import {jobMessage} from '../core/job-feedback';
type Data=Awaited<ReturnType<typeof loadUI>>;
function Button({children,onClick,disabled=false,primary=false}:{children:React.ReactNode;onClick:()=>void;disabled?:boolean;primary?:boolean}) {return <button type="button" className={primary?'button primary':'button'} disabled={disabled} onClick={onClick}>{children}</button>;}
function Badge({children}:{children:React.ReactNode}) {return <span className="badge">{children}</span>;}
export type ReviewFeedback={ok:boolean;message:string;changeId?:string;comparison?:{field:string;accepted:string;live:string;matches:boolean}[]};
/** One review surface, reused for dashboard fixes, catalogue previews and history. */
export function ChangeReview({d,review,busy,accepting,feedback,onAction,onReplace,onEditFacts}:{
 d:Data;review:Data['changes'][number];busy:boolean;accepting:boolean;feedback?:ReviewFeedback;
 onAction:(intent:string,id:string,reason?:string)=>void;onReplace:()=>void;onEditFacts:()=>void;
}) {
 const [previewTab,setPreviewTab]=useState('after');
 const [rejection,setRejection]=useState('');
 const beforeValue=JSON.parse(review.before),afterValue=JSON.parse(review.after);
 const [editedTitle,setEditedTitle]=useState(String(afterValue?.title||'')),[editedSummary,setEditedSummary]=useState(String(afterValue?.description||''));
 const [keepTitle,setKeepTitle]=useState(false),[keepSummary,setKeepSummary]=useState(false),[checked,setChecked]=useState(false);
 const reviewResource=d.resources.find(r=>r.id===review.resourceId);
 const reviewPayload=reviewResource?JSON.parse(reviewResource.payload):null;
 const reviewValue=JSON.parse(previewTab==='before'?review.before:review.after);
 const reviewJob=d.jobs.find(j=>{try {const p=JSON.parse(j.payload);return j.kind==='optimise' && ['queued','running'].includes(j.status) && p.feature===review.feature && p.ids?.includes(review.resourceId);}catch{return false;}});
 const reviewBlockers:string[]=JSON.parse(review.blockers);
 if(['seo','title'].includes(review.feature)) {
   const value=JSON.parse(review.after);const title=String(review.feature==='seo'?value?.title||'':value||'').trim();
   if((!title||title.length>255)&&!reviewBlockers.length)reviewBlockers.push('Generate a replacement with a valid, non-empty title.');
 }
 return (
          <>
            <div className="review-body">
            <ChangeImpact d={d} change={review}/>
            <Guidance title="Change preview"/>
            <div className="preview-meta">
              <Badge>{labels[review.feature]}</Badge>
              <Badge>{changeStatus(review.status)}</Badge>
              {["title","seo"].includes(review.feature) && <span>{review.feature === "seo" ? "Changes the suggested Google title, not the name shown on your product page." : "Updates the visible page title."} {titleGuidance}</span>}
            </div>
            {review.feature === "alt" && reviewPayload?.images?.map((img:{id:string;url:string;alt:string}) => (
              <figure key={img.id}><img src={img.url} alt={img.alt || "Image awaiting an alt description"} style={{maxWidth:240,maxHeight:180}} /><figcaption>Image on this page</figcaption></figure>
            ))}
            {review.feature==='seo' && metadataWarnings(JSON.parse(review.after).title,JSON.parse(review.after).description).map(w=><p className="muted" key={w}>{w}</p>)}
            <div className="preview-tabs">
              <Button
                primary={previewTab === "before"}
                onClick={() => setPreviewTab("before")}
              >
                Before
              </Button>
              <Button
                primary={previewTab === "after"}
                onClick={() => setPreviewTab("after")}
              >
                After
              </Button>
            </div>
            {review.beforeHtml !== null ? (
              <div
                className={"diff rendered " + previewTab}
                dangerouslySetInnerHTML={{
                  __html:
                    (previewTab === "before"
                      ? review.beforeHtml
                      : review.afterHtml) || "",
                }}
              />
            ) : (
              review.feature!=="seo" && <ChangeValues feature={review.feature} value={reviewValue}/>
            )}
            {["seo","title"].includes(review.feature) && <>
            <h3>{previewTab==='before'?"How it looks now":"After your approval"}</h3>
            <div className="snippet">
              <div>{d.settings.titleBrand || d.domain}</div>
              <small>
                {d.domain} ›{" "}
                {reviewResource?.kind === "redirect"
                  ? "collections"
                  : reviewResource?.kind + "s"}{" "}
                ›{" "}
                {review.feature === "handle"
                  ? reviewValue
                  : reviewResource?.handle}
              </small>
              <h3>
                {review.feature === "seo"
                  ? reviewValue?.title
                  : review.feature === "title"
                    ? reviewPayload?.seo?.title || reviewValue
                    : reviewPayload?.seo?.title || reviewResource?.title}
              </h3>
              <p>
                {review.feature === "seo"
                  ? reviewValue?.description
                  : reviewPayload?.seo?.description ||
                    "No Google summary has been saved."}
              </p>
            </div>
            <small className="muted">
              Illustrative only. Google can choose a different title or snippet.
            </small>
            </>}
            {review.feature==='seo' && <details><summary>See the exact title and summary</summary><ChangeValues feature={review.feature} value={reviewValue}/></details>}
            {review.feature==='seo'&&review.status==='pending'&&<details><summary>Edit this suggestion or keep an existing field</summary><p>Keep a good existing title while improving only the summary. Your revised wording becomes a new preview; it is not published until you accept it.</p><label className="check-row"><input type="checkbox" checked={keepTitle} onChange={e=>setKeepTitle(e.target.checked)}/>Keep my existing Google title</label><label>Google title<input value={keepTitle?beforeValue?.title||'':editedTitle} disabled={keepTitle} onChange={e=>setEditedTitle(e.target.value)} maxLength={255}/></label><small>{(keepTitle?beforeValue?.title||'':editedTitle).length} characters · target 50–60</small><label className="check-row"><input type="checkbox" checked={keepSummary} onChange={e=>setKeepSummary(e.target.checked)}/>Keep my existing Google summary</label><label>Google summary<textarea value={keepSummary?beforeValue?.description||'':editedSummary} disabled={keepSummary} onChange={e=>setEditedSummary(e.target.value)} maxLength={500}/></label><small>{(keepSummary?beforeValue?.description||'':editedSummary).length} characters · target 150–160</small><label className="check-row"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>I checked the edited wording against this page’s information</label><Button disabled={busy||!checked} onClick={()=>onAction('reviseProposal',review.id,JSON.stringify({title:keepTitle?beforeValue?.title||'':editedTitle,description:keepSummary?beforeValue?.description||'':editedSummary,version:new Date(review.updatedAt).toISOString(),confirmed:true}))}>Review my edited suggestion</Button></details>}
            <section className="review-why"><h3>Why we suggest this</h3><ul className="reasons">
              {JSON.parse(review.reasons).map((r: string) => (
                <li key={r}>{r.replace(/^[\w-]+-v\d+:\s*/, "")}</li>
              ))}
            </ul></section>
            </div>
            <div className="review-footer">
            {review.status==='rejected' && <p role="status">Rejected. Your current content has been kept.</p>}
            {review.error && <div className="notice error">{review.error}</div>}
            {reviewJob && <p role="status" className="notice">Replacement: {jobMessage(reviewJob,d.changes)}. This original preview stays here until the replacement is ready.</p>}
            {review.approvedBy && !['draft','redirect'].includes(review.feature) && ['verification_failed','conflict'].includes(review.status) && <Button disabled={busy} onClick={()=>onAction('verify',review.id)}>Re-read live Shopify values</Button>}
            {review.status==='conflict'&&<Button disabled={busy} onClick={()=>onAction('refreshChange',review.id)}>Re-read Shopify and prepare a new review</Button>}
            {['approved','applying','verifying'].includes(review.status) && <p role="status">Saving your change and checking it automatically. You can keep working…</p>}
            {review.status==='applied' && <p role="status">Done. {review.feature==='seo'?'Your suggested Google listing for':'Your page update for'} {reviewResource?.title} is saved in Shopify. {review.feature==='seo' && 'Google decides when to refresh its search results.'}</p>}
            {feedback?.ok===false && <><p role="alert">{feedback.message}</p>{feedback.comparison && <table><thead><tr><th>Search field</th><th>Expected before update</th><th>Accepted proposal</th><th>Saved in Shopify</th></tr></thead><tbody>{feedback.comparison.map(row=><tr key={row.field}><th>{row.field} — {row.matches?'Matches':'Differs'}</th><td>{String(review.feature==='seo'?JSON.parse(review.before)?.[row.field]??'Not set':typeof JSON.parse(review.before)==='string'?JSON.parse(review.before):JSON.stringify(JSON.parse(review.before)))}</td><td>{row.accepted || 'Not set'}</td><td>{row.live || 'Not set'}</td></tr>)}</tbody></table>}</>}
              {review.status === "pending" && (
                <><label>Reason for rejecting (optional)<select aria-label="Reason for rejecting" value={rejection} onChange={e=>setRejection(e.target.value)}><option value="">Choose a reason</option><option>Not relevant to this page</option><option>Incorrect or unsupported facts</option><option>Wording or brand voice</option><option>Current content is better</option><option>Other</option></select></label><ReviewActions blockers={reviewBlockers} busy={busy} accepting={accepting} demo={d.demo}
                  onReject={()=>{onAction('reject',review.id,rejection);}}
                  onAccept={()=>onAction('approve',review.id)}
                  onEditFacts={review.feature==='faq' ? onEditFacts : undefined}
                  onReplace={onReplace}/></>
              )}
              {['apply_failed','rollback_failed'].includes(review.status) && d.jobs.filter(j=>{
                try{return ['apply','rollback'].includes(j.kind) && j.status==='failed' && JSON.parse(j.payload).changeId===review.id;}catch{return false;}
              }).slice(0,1).map(j=><Button key={j.id} disabled={busy} onClick={()=>onAction('retry',j.id)}>Try saving again</Button>)}
              {review.status === "applied" && (
                <Button
                  onClick={() => {
                    if(window.confirm("Restore the exact previous value? We will stop if this content has changed since your update."))onAction("rollback",review.id);
                  }}
                >
                  Undo this change
                </Button>
              )}
            </div>
          </>
 );
}

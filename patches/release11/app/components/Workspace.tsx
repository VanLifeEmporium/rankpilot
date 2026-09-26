import {ChangeReview} from './ChangeReview';
import {FixDialog,FindingFix} from './FixArena';
import {opportunityQueries,reviewItems} from '../core/dashboard';
import {TechnicalTools} from './TechnicalTools';
import {PageSpeedResults} from './PageSpeedResults';
import {Dashboard} from './Dashboard';
import {BatchReview} from './BatchReview';
import {featureNames,findingName,findingExplanation,issuePriority,searchSummary} from '../core/merchant-copy';
import {FactImport} from './FactImport';
import {changeStatus,reviewable} from '../core/workflow-ui';
import {Connections} from "./Connections";
import {SectionHeading,Guidance} from "./SectionHeading";
import {metricGuide} from "../core/subsection-guide";
import {Download} from "./Download";
import {useLiveWorkspace} from "../core/live-workspace";
import {sectionGuide} from "../core/section-guide";
import {findingKey,findingAction,findingProgress} from "../core/finding-workflow";
import {jobResults as readJobResults, jobMessage, jobLabel, resultMessage} from "../core/job-feedback";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useFormAction,
  useParams,
  useSearchParams,
} from "react-router";
import type { loadUI } from "../core/ui.server";
import {
  clusters,
  topics,
  prompts,
  factLabels,
  opportunities,
} from "../core/catalogue-data";
import { clickRate, metricPair, pageGains, visibilityTrend } from "../core/analytics";
import { features, type Payload, type Facts, type Issue } from "../core/types";
type Data = Awaited<ReturnType<typeof loadUI>>;
const labels=featureNames;
const nav = ["Dashboard", "Reports", "Settings"];
const icons = ["◈", "▥", "⚙"];
const sectionNames:Record<string,string>={Dashboard:'Dashboard',Audit:'Find issues',Reviews:'Review & apply',Products:'Products',Collections:'Collections',Content:'Blogs',AEO:'Help AI answer questions',Reports:'Results & history',Settings:'Settings'};
const sectionHelp:Record<string,string>={dashboard:'Start here. Run an audit, review proposed fixes and track verified updates.',audit:'Find issues → Generate fix → Review & apply. Generating does not publish.',reviews:'Compare each proposal, accept or reject it, and track whether Shopify was updated.',products:'Help shoppers understand your products on Google and in your shop. Review every suggestion before saving.',collections:'Improve collection copy and review redirects for retired collection URLs.',content:'Create and review unpublished blog drafts.',aeo:'Add checked product details, answer common questions and see whether AI assistants mention your shop.',reports:'View performance and the history of changes applied to Shopify.',settings:'Manage connections and preferences. Autopilot remains off.'};
const date = (s: string | Date) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Metric({
  label,
  value,
  caption,
  accent = false,
}: {
  label: string;
  value: string;
  caption: string;
  accent?: boolean;
}) {
  return (
    <div className={"metric " + (accent ? "accent" : "")}>
      <div>{label}</div>
      <strong>{value}</strong>
      <small>{caption}</small><details className="metric-help"><summary>About this measure</summary><p>{metricGuide[label] || `${caption}. Use the related section below to inspect the records behind this value. Missing data means a check or connection is still needed.`}</p></details>
    </div>
  );
}
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={primary ? "button primary" : "button"}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
const CatalogueRow = memo(function CatalogueRow({resource:r,payload:p,count,checked,toggle,open}:{
  resource:Data["resources"][number];payload:Payload;count:number;checked:boolean;
  toggle:(id:string,checked:boolean)=>void;open:(id:string)=>void;
}) {
  return <tr><td><input type="checkbox" aria-label={`Select ${r.title}`} checked={checked}
    onChange={e=>toggle(r.id,e.currentTarget.checked)}/></td>
    <td><div className="product-cell">{p.images[0] && <img src={p.images[0].url} alt="" loading="lazy" width="42" height="42"/>}
    <div><strong>{r.title}</strong><small>{r.collection || r.kind}</small></div></div></td>
    <td><span className="keyword">{r.keyword || "Unassigned"}</span></td>
    <td><Badge tone={count?"amber":"green"}>{count?`${count} checks`:"Clear"}</Badge></td>
    <td><Button onClick={()=>open(r.id)}>{r.kind==="product"?"Product details":"Keyword"}</Button></td></tr>;
});
export default function Workspace() {
  const initial = useLoaderData<Data>();
  const section = useParams().section || "dashboard";
  const fetcher = useFetcher<{ ok: boolean; message: string; comparison?:{field:string;accepted:string;live:string;matches:boolean}[]; changeId?: string; jobId?: string; factResourceId?:string; factSuggestions?:Facts; keywordSuggestion?:string; factsSaved?:string }>();
  const generation=useFetcher<{ok:boolean;message:string;jobId?:string;changeId?:string}>();
  const [generationError,setGenerationError]=useState("");
  const [actionTarget,setActionTarget]=useState("");
  const {data:d,refreshError,workerHealthy}=useLiveWorkspace(initial,section,fetcher.state+generation.state);
  const resourceDetail=useFetcher<Data["resources"][number]>();
  const formAction = useFormAction();
  const [collection, setCollection] = useState("All collections");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const toggleSelected=useCallback((id:string,checked:boolean)=>setSelected(previous=>
    checked ? previous.includes(id)?previous:[...previous,id] : previous.filter(value=>value!==id)),[]);
  const selectedIds=useMemo(()=>new Set(selected),[selected]);
  const [feature, setFeature] = useState("seo");
  const [reviewId, setReviewId] = useState("");
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const openedChanges = useRef(new Set<string>());
  const [factId, setFactId] = useState("");
  const [searchParams]=useSearchParams();
  // Filtering is local UI state: selecting a finding must not launch an
  // authenticated navigation or be reset by a background loader refresh.
  const [severity,setSeverity]=useState(()=>searchParams.get('priority') || 'all');
  const [issueQuery,setIssueQuery]=useState(()=>searchParams.get('q') || '');
  const [issueCode,setIssueCode]=useState(()=>searchParams.get('finding') || 'all');
  useEffect(()=>{
    const url=new URL(window.location.href);
    for(const [key,value] of [['priority',severity],['q',issueQuery],['finding',issueCode]]) {
      if(value && value!=='all')url.searchParams.set(key,value);else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state,'',url);
  },[severity,issueQuery,issueCode]);
  const [fixGroup,setFixGroup]=useState<Issue[]|null>(null);
  const [reviewQueue,setReviewQueue]=useState<string[]|null>(null);
  const [fixIndex,setFixIndex]=useState(0);
  const currentFix=fixGroup?.[fixIndex];
  const openFix=(items:Issue[],index=0)=>{
    items=reviewItems(items);setReviewQueue(null);setFixGroup(items);setFixIndex(index);
    const progress=findingProgress(items[index],d.changes,d.jobs);
    setReviewId(progress.changeId || "");
  };
  const factsForm = useRef<HTMLFormElement>(null);
  const [factMessage,setFactMessage]=useState("");
  const factsDialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const result=fetcher.data;
    if(result?.factsSaved===factId && result.ok) factsDialog.current?.close();
    if(result?.factResourceId!==factId || !result?.factSuggestions || !factsForm.current) return;
    let filled=0;
    for(const [key,fact] of Object.entries(result.factSuggestions)) {
      const value=factsForm.current.elements.namedItem(key) as HTMLInputElement|null;
      const source=factsForm.current.elements.namedItem(key+'Source') as HTMLInputElement|null;
      if(value && !value.value.trim()) {value.value=fact.value;if(source)source.value=fact.source;filled++;}
    }
    const keyword=factsForm.current.elements.namedItem('keyword') as HTMLInputElement|null;
    if(keyword && !keyword.value.trim()) keyword.value=result.keywordSuggestion || '';
    // This message describes the DOM fields filled from the completed server request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFactMessage(filled ? `${filled} empty fields filled. Check the source and confirm only accurate facts. Nothing saved yet.` : 'No additional labelled specifications found. Your existing entries were kept. Add missing facts from a supplier source.');
  },[fetcher.data,factId]);
  const submit = (intent: string, extra: Record<string, string> = {}) => {
    setActionTarget(extra.id || "");
    return fetcher.submit(
      { intent, ...extra },
      { method: "post", action: formAction, preventScrollReset:true },
    );
  };
  const running = d.jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (factId) factsDialog.current?.showModal();
    else factsDialog.current?.close();
  }, [factId]);
  const requestedJob = d.jobs.find(j => j.id === generation.data?.jobId);
  const jobResults: {changeId?:string;message?:string;error?:string}[] = requestedJob?.status === "completed" ? readJobResults(requestedJob) : [];
  const generatedChangeId = generation.data?.changeId || (jobResults.length === 1 ? jobResults[0]?.changeId : undefined);
  const generationMessage = requestedJob
    ? jobMessage(requestedJob, d.changes)
    : generation.data?.message;
  useEffect(() => {
    if(generation.state!=="idle" || fetcher.state!=="idle")return;
    for(const id of [fetcher.data?.changeId,generatedChangeId]) {
      if(id && !openedChanges.current.has(id) && d.changes.some(c=>c.id===id)) {
        openedChanges.current.add(id);setReviewId(id);
      }
    }
  },[generation.state,fetcher.state,fetcher.data?.changeId,generatedChangeId,d.changes]);
  const audit = d.audits[0];
  const issues: Issue[] = useMemo(()=>audit ? JSON.parse(audit.issues) : [],[audit]);
  const remainingFixPages=fixGroup?new Set(fixGroup.filter(i=>issues.some(current=>current.resourceId===i.resourceId && (i.feature?current.feature===i.feature:current.code===i.code))).map(i=>i.resourceId)).size:0;
  const issueCounts=useMemo(()=>{const counts=new Map<string,number>();for(const issue of issues)counts.set(issue.resourceId,(counts.get(issue.resourceId)||0)+1);return counts;},[issues]);
  const resourcePayloads=useMemo(()=>new Map(d.resources.map(r=>[r.id,JSON.parse(r.payload) as Payload])),[d.resources]);
  const coverage = audit ? JSON.parse(audit.coverage) : {};
  const auditJob = d.jobs.find(j => j.kind === "audit");
  const auditSubmitting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "audit";
  const sortedIssues=[...issues].sort((a,b)=>issuePriority(a)-issuePriority(b));
  const filteredIssues = sortedIssues.filter(i =>
    (severity === "all" || i.severity === severity) &&
    (issueCode === "all" || i.code === issueCode) &&
    `${i.title} ${i.detail} ${i.code}`.toLowerCase().includes(issueQuery.toLowerCase()));
  const allPending=d.changes.filter(c=>c.status==='pending');
  const pending=allPending.filter(reviewable);
  const blockedPending=allPending.filter(c=>!reviewable(c));
  const generating=d.jobs.filter(j=>j.kind==='optimise' && ['queued','running'].includes(j.status));
  const [reviewTab,setReviewTab]=useState('ready');
  const review = d.changes.find((c) => c.id === reviewId);
  const factResource = resourceDetail.data?.id===factId ? resourceDetail.data : d.resources.find((r) => r.id === factId);
  useEffect(()=>{if(factId && resourceDetail.data?.id!==factId && resourceDetail.state==='idle')resourceDetail.load(`/app/resource?id=${encodeURIComponent(factId)}`);},[factId,resourceDetail]);
  const reviewResource=review && d.resources.find(r=>r.id===review.resourceId);
  const generationBusy=generation.state!=="idle" || !!requestedJob && ["queued","running"].includes(requestedJob.status);
  const optimise = (ids: string[], f = feature, regenerate=false) => {
    if(generationBusy)return;
    setGenerationError("");
    void generation.submit({intent:"optimise",ids:JSON.stringify(ids),feature:f,regenerate:String(regenerate)},
      {method:"post",action:formAction,preventScrollReset:true}).catch(()=>setGenerationError("We couldn't send this request. Please try Generate previews again."));
  };
  const busy = fetcher.state !== "idle";
  const list = useMemo(()=>d.resources.filter(
    (r) =>
      (section === "products"
        ? r.kind === "product"
        : section === "collections"
          ? r.kind === "collection"
          : true) &&
      (collection === "All collections" ||
        r.collection === collection ||
        resourcePayloads.get(r.id)?.collections?.includes(collection) ||
        r.title === collection) &&
      r.title.toLowerCase().includes(query.toLowerCase()),
  ),[d.resources,section,collection,query,resourcePayloads]);
  const title = sectionNames[Object.keys(sectionNames).find((n) => n.toLowerCase() === section) || "Dashboard"];
  const gsc = useMemo(()=>metricPair(d.metrics,"gsc"),[d.metrics]);
  const ga = useMemo(()=>metricPair(d.metrics,"ga4"),[d.metrics]);
  const clicks = gsc[0]?.rows?.reduce(
    (sum: number, r: {clicks:number}) => sum + r.clicks,
    0,
  );
  const organic = ga[0]?.rows?.reduce(
    (sum: number, r: {metricValues?:{value?:string}[]}) => sum + Number(r.metricValues?.[0]?.value || 0),
    0,
  );
  const revenue = ga[0]?.rows?.reduce(
    (sum: number, r: {metricValues?:{value?:string}[]}) => sum + Number(r.metricValues?.[1]?.value || 0),
    0,
  );
  const mentionRate = d.observations.length
    ? Math.round(
        (d.observations.filter((o) => o.mentioned).length /
          d.observations.length) *
          100,
      )
    : null;
  function historyPagination(){return <nav aria-label="Change history pages" className="connection-actions"><span>{d.historyCount} historical changes · page {d.historyPage+1}</span>{d.historyPage>0 && <Link to={`?historyPage=${d.historyPage-1}`}>Previous history</Link>}{(d.historyPage+1)*50<d.historyCount && <Link to={`?historyPage=${d.historyPage+1}`}>Older history</Link>}<small>All pending and failed changes remain visible.</small></nav>;}
  function changesTable(rows = pending) {
    return (
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Improvement</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const r = d.resources.find((r) => r.id === c.resourceId);
              const blockers = JSON.parse(c.blockers);
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{r?.title || "Removed resource"}</strong>
                    <small>
                      {r?.kind} · {date(c.createdAt)}
                    </small>
                  </td>
                  <td>{labels[c.feature]}</td>
                  <td>
                    <Badge
                      tone={
                        blockers.length && c.status === "pending"
                          ? "amber"
                          : c.status === "applied"
                            ? "green"
                            : "neutral"
                      }
                    >
                      {blockers.length && c.status === "pending"
                        ? "Needs a new review"
                        : changeStatus(c.status)}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      onClick={() => {
                        setReviewId(c.id);
                        
                      }}
                    >
                      Review
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <span>✓</span>
            <h3>Nothing waiting for review</h3>
            <p>
              Choose a product or collection to generate your first improvement.
            </p>
            <Link className="text-link" to="/app/products">
              Browse products →
            </Link>
          </div>
        )}
      </div>
    );
  }
  function catalogue() {
    return (
      <>
        <div className="toolbar">
          <input
            aria-label="Search pages"
            placeholder={`Search ${section}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter collection"
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setSelected([]);
            }}
          >
            <option>All collections</option>
            {Object.keys(clusters).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="spacer" />
          <Badge>{list.length} pages</Badge>
        </div>
        <Guidance title="Catalogue selection"/><div className="bulk-bar">
          <span>{selected.length} selected</span>
          <select
            aria-label="Improvement type"
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
          >
            {features
              .filter(
                (f) =>
                  section === "products" ||
                  !["filename", "faq"].includes(f),
              )
              .map((f) => (
                <option key={f} value={f}>
                  {labels[f]}
                </option>
              ))}
          </select>
          <Button
            primary
            disabled={!selected.length || busy || generationBusy}
            onClick={() => optimise(selected)}
          >
            {generation.state!=="idle"?"Sending request…":generationBusy?"Preparing previews…":"Generate previews"}
          </Button>
          <Button
            disabled={!list.length || busy || generationBusy}
            onClick={() => optimise(list.map((r) => r.id))}
          >
            Optimise this collection
          </Button>
        </div>
        <div className="generation-feedback" role="status" aria-live="polite" aria-atomic="true">
          {generation.state!=="idle" ? <p><span className="progress-spinner" aria-hidden="true"/> Sending your request. Nothing will be published.</p> :
            generationError ? <p className="notice error">{generationError}</p> : generation.data && <>
              <p>{generationMessage}</p>
              {generationBusy && <p className="muted">You can keep browsing. This message updates automatically; every preview needs your approval.</p>}
              {requestedJob?.status==="completed" && jobResults.some(r=>r.changeId) && <Link className="button" to="/app?review=ready">Review generated previews on the dashboard</Link>}
            </>}
          {generationBusy && refreshError && <p>Progress updates are temporarily unavailable. Reconnecting automatically; your request is still recorded.</p>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all visible pages"
                    checked={
                      list.length > 0 &&
                      list.every((r) => selectedIds.has(r.id))
                    }
                    onChange={(e) =>
                      setSelected(e.target.checked ? list.map((r) => r.id) : [])
                    }
                  />
                </th>
                <th>{section === "products" ? "Product" : "Collection"}</th>
                <th>Main phrase shoppers search for</th>
                <th>Audit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(r=><CatalogueRow key={r.id} resource={r} payload={resourcePayloads.get(r.id)!}
                count={issueCounts.get(r.id)||0} checked={selectedIds.has(r.id)} toggle={toggleSelected} open={setFactId}/>)}
            </tbody>
          </table>
          {!list.length && (
            <p className="empty">
              No pages match. Run a store audit to import the catalogue.
            </p>
          )}
        </div>
        <s-section heading="Keyword opportunities"><Guidance title="Keyword opportunities"/>
          <div className="cluster-grid">
            {Object.entries(clusters)
              .filter(
                ([c]) => collection === "All collections" || c === collection,
              )
              .map(([c, words]) => (
                <div key={c}>
                  <h3>{c}</h3>
                  <p>
                    {words.map((w) => (
                      <span className="chip" key={w}>
                        {w}
                      </span>
                    ))}
                  </p>
                </div>
              ))}
          </div>
          <p className="muted">
            Editorial seed terms prioritising UK and buyer intent. Search volume
            and difficulty are not estimated. Validate opportunities using
            Search Console data.
          </p>
        </s-section>
      </>
    );
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" to="/app">
          <span className="brand-mark">
            r<span>↗</span>
          </span>
          <span>RankPilot</span>
        </Link>
        <div className="store-switch">
          <span className="store-avatar">V</span>
          <div>
            <strong>Van Life Emporium</strong>
            <small>UK storefront</small>
          </div>
          <span>⌄</span>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n, i) => (
            <Link
              key={n}
              aria-label={sectionNames[n]}
              to={i === 0 ? "/app" : `/app/${n.toLowerCase()}`}
              className={section === n.toLowerCase() ? "active" : ""}
            >
              <span>{icons[i]}</span>
              {sectionNames[n]}
              {n === "Audit" && issues.length > 0 && <b>{issues.length}</b>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="approval-indicator">
            <span /> You approve every change
          </div>
          <p>
            Considered changes.
            <br />A clearer path to discovery.
          </p>
          <span className="tiny">HOME IS THE ROAD</span>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <span className="slash">/</span>
            {title}
          </div>
          <div className="topbar-right">
            {d.demo ? (
              <Badge tone="amber">Demo catalogue</Badge>
            ) : (
              <Badge tone="green">Shopify connected</Badge>
            )}
            <span className="store-avatar small">VE</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">VAN LIFE EMPORIUM</div>
              <h1>
                {title}
              </h1>
              <p>
                {sectionHelp[section]}
              </p>
            </div>
            <div className="heading-actions">
              <span className="muted">
                {running
                  ? "Work in progress…"
                  : audit
                    ? `Last audit ${new Date(audit.createdAt).toLocaleString("en-GB")}`
                    : "Not yet audited"}
              </span>
              <Button
                primary
                disabled={busy || auditJob?.status === "queued" || auditJob?.status === "running"}
                onClick={() => submit("audit")}
              >
                {auditSubmitting ? "Queueing audit…" : auditJob?.status === "queued" ? "Audit queued…" : auditJob?.status === "running" ? "Auditing store…" : "↻ Run store audit"}
              </Button>
              <div role="status" aria-live="polite" style={{maxWidth: 360}}>
                {auditSubmitting ? "Submitting audit request…" : auditJob ?
                  `Latest audit job: ${auditJob.status}${auditJob.error ? ` — ${auditJob.error}` : ""}` : ""}
              </div>
            </div>
          </div>
          {d.demo && (
            <div className="notice demo">
              <strong>Explore RankPilot</strong>
              <span>
                Sample products, real workflows. Changes stay in this demo; your
                Shopify store is untouched.
              </span>
              <Link to="/app/settings">Installation guide ↗</Link>
            </div>
          )}
          {refreshError && <p role="status" className="notice warning">Live progress is temporarily unavailable. Reconnecting automatically; your queued work continues.</p>}
          {fetcher.data && (
            <div
              role="status"
              className={"notice " + (fetcher.data.ok ? "success" : "error")}
            >
              {d.jobs.find(j=>j.id===fetcher.data?.jobId) ? jobMessage(d.jobs.find(j=>j.id===fetcher.data?.jobId)!,d.changes) : fetcher.data.message}
            </div>
          )}
          {running && !workerHealthy && <p role="status" className="notice warning">Background processing is not responding. Accepted updates can still start here; queued generation needs the worker to recover. Avoid submitting the same work repeatedly.</p>}
          {busy && <p role="status" aria-live="polite">Submitting your request… Please wait; you do not need to click again.</p>}
          {section!=="dashboard" && sectionGuide[section] && <details className="card" style={{padding:'16px 20px',marginBottom:16}}><summary style={{cursor:'pointer',fontWeight:600}}>What is this section and how do I use it?</summary><p>{sectionGuide[section].shows}</p><ol>{sectionGuide[section].steps.map(step=><li key={step} style={{marginBottom:8}}>{step}</li>)}</ol></details>}
          {section!=="dashboard" && <p><Link to="/app">← Dashboard</Link></p>}
          {blockedPending.length>0 && section==='reviews' && <p className="notice">{pending.length} ready to accept · {blockedPending.length} need a new review. <Link to="/app/reviews">Open review queue</Link>. Generating a replacement keeps the old draft until the new one is ready.</p>}
          {section === "products" && <FactImport/>}
          {section === "reviews" && <BatchReview changes={pending} resources={d.resources}/>}
          {section === "reviews" && <section className="card"><SectionHeading title="Proposals and Shopify updates"/><p>Only ready proposals count towards your review queue. Older drafts stay under Needs attention until a replacement is ready.</p><div className="connection-actions" role="group" aria-label="Review queue views">{[['ready',`Ready to accept (${pending.length})`],['attention',`Needs attention (${blockedPending.length})`],['generating',`Generating (${generating.length})`],['all','All changes']].map(([value,label])=><Button key={value} onClick={()=>setReviewTab(value)} disabled={reviewTab===value}>{label}</Button>)}</div>{reviewTab==='generating' ? <div aria-live="polite">{generating.length?generating.map(j=><p key={j.id}>{(()=>{try{return JSON.parse(j.payload).ids.map((id:string)=>d.resources.find(r=>r.id===id)?.title || "Page").join(", ");}catch{return "Selected pages";}})()}: {jobMessage(j,d.changes)}</p>):<p>No generation is running. Completed proposals appear under Ready to accept or Needs attention.</p>}</div>:changesTable(reviewTab==='ready'?pending:reviewTab==='attention'?blockedPending:d.changes)}{historyPagination()}</section>}
          {section === "dashboard" && <Dashboard d={d} issues={issues} busy={busy || generationBusy} onFix={openFix} onReview={id=>{setReviewQueue(null);setFixGroup(null);setReviewId(id);}} onReviewReady={()=>{setFixGroup(null);setReviewQueue(pending.map(c=>c.id));setFixIndex(0);setReviewId(pending[0]?.id || "");}}/>}
          {section === "audit" && (
            <>
              <TechnicalTools discoveries={d.discoveries}/>
              <div className="metrics-grid">
                <Metric
                  label="Store check score"
                  value={audit ? String(audit.score) : "—"}
                  caption="Catalogue checks, scored out of 100"
                />
                <Metric
                  label="Pages checked"
                  value={String(audit?.resourceCount || 0)}
                  caption="Products, collections, pages and articles"
                />
                <Metric
                  label="Things to improve"
                  value={String(issues.length)}
                  caption={`${new Set(issues.map(i => i.resourceId)).size} affected resources; ${new Set(issues.map(i => i.code)).size} finding types`}
                />
                <Metric
                  label="Awaiting approval"
                  value={String(pending.length)}
                  caption="Accepting a preview applies it automatically. Autopilot is off."
                />
              </div>
              <section className="card">
                <div className="card-head">
                  <SectionHeading title="Prioritised fix-it list"/>
                  <input aria-label="Search findings" placeholder="Search page, issue or URL" value={issueQuery}
                    onChange={e => {setIssueQuery(e.target.value); setActiveIssue(null);}} />
                  <select aria-label="Filter finding type" value={issueCode}
                    onChange={e => {setIssueCode(e.target.value); setActiveIssue(null);}}>
                    <option value="all">All improvement types</option>
                    {[...new Set(issues.map(i => i.code))].sort().map(code =>
                      <option key={code} value={code}>{findingName(code)} ({issues.filter(i => i.code === code).length})</option>)}
                  </select>
                  <select
                    aria-label="Filter severity"
                    value={severity}
                    onChange={(e) => {setSeverity(e.target.value); setActiveIssue(null);}}
                  >
                    <option value="all">All priorities</option>
                    <option value="critical">Critical</option>
                    <option value="warning">Warnings</option>
                    <option value="notice">Advisory</option>
                  </select>
                </div>
                <p>{filteredIssues.length} of {issues.length} suggestions shown. A page can have more than one suggestion.</p>
                <p>{audit?.resourceCount || 0} pages checked; {coverage.storefront || 0} live storefront pages inspected (crawl limit: {coverage.crawlLimit ?? "not applicable"}). The score measures our page-content checks, not your position on Google.</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Priority</th>
                        <th>Page & finding</th>
                        <th>Next action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredIssues.map((i) => {
                        const key=findingKey(i);
                        const resource=d.resources.find(r=>r.id===i.resourceId);
                        const action=findingAction(i,resource,d.settings);
                        const progress=findingProgress(i,d.changes,d.jobs);
                        return <tr key={key}>
                            <td>
                              <Badge
                                tone={
                                  i.severity === "critical"
                                    ? "red"
                                    : i.severity === "warning"
                                      ? "amber"
                                      : "neutral"
                                }
                              >
                                {issuePriority(i)===9?'Optional':i.severity==='critical'?'Fix first':i.severity==='warning'?'Worth checking':'Optional'}
                              </Badge>
                            </td>
                            <td>
                              <strong>{i.title}</strong>
                              <small>{findingExplanation(i)}</small>
                            </td>
                            <td>
                              {action.kind === 'facts' ? <Button onClick={()=>setFactId(i.resourceId)}>Confirm product facts</Button>
                                : action.kind === 'generate' ? <>
                                  {progress.changeId && <Button onClick={()=>{setReviewId(progress.changeId!);}}>{d.changes.find(c=>c.id===progress.changeId)?.status==='pending' ? 'Review fix' : 'View change'}</Button>}
                                  {progress.canGenerate && <Button disabled={busy || progress.busy} onClick={()=>{
                                    setActiveIssue(key); optimise([i.resourceId],i.feature!,Boolean(progress.message));
                                  }}>{busy && activeIssue===key ? 'Queuing…' : progress.message ? 'Generate again' : 'Generate fix'}</Button>}
                                </> : <Button onClick={()=>openFix([i])}>Inspect &amp; fix</Button>}
                              {action.detail && <p className="muted" style={{maxWidth:360}}>{action.detail}</p>}
                              {(progress.message || activeIssue===key) && action.kind==='generate' && <div role="status" aria-live="polite" style={{maxWidth:360,marginTop:8}}>
                                {activeIssue===key && generation.data?.ok===false ? generation.data.message : progress.message || (activeIssue===key ? generationMessage : '')}
                              </div>}

                            </td>
                          </tr>;
                        })}
                    </tbody>
                  </table>
                </div>
                <details className="details">
                  <summary>Audit coverage and scoring</summary>
                  <pre>
                    {audit &&
                      JSON.stringify(JSON.parse(audit.coverage), null, 2)}
                  </pre>
                  <p>
                    Copy similarity is assessed within the catalogue. It is not
                    a web-wide plagiarism check. External links are not crawled.
                    PageSpeed measures need a connected key.
                  </p>
                </details>
              </section>
              <section className="card">
                <SectionHeading title="Approval queue"/>
                {changesTable()}
              </section>
              <section className="card">
                <SectionHeading title="Recent jobs"/>
                {d.jobs.map((j) => (
                  <div className="job" key={j.id}>
                    <strong>{j.kind}</strong>
                    <Badge tone={j.status === "failed" || jobLabel(j) === "needs attention" ? "red" : "neutral"}>
                      {jobLabel(j)}
                    </Badge>
                    <span>{j.error}</span>
                    {readJobResults(j).map((result, index:number) => (
                      <div key={index}><span>{resultMessage(result, d.changes)}</span>{result.changeId && <Button onClick={() => setReviewId(result.changeId!)}>{d.changes.find(c => c.id === result.changeId)?.status === "pending" ? "Review proposal" : "View change"}</Button>}</div>
                    ))}
                    {j.status === "failed" && (
                      <Button onClick={() => submit("retry", { id: j.id })}>
                        Retry
                      </Button>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
          {["products", "collections"].includes(section) && (
            <section className="card catalogue-card">
              {catalogue()}
              {section === "collections" && (
                <s-section heading="Repair a collection redirect"><Guidance title="Repair a collection redirect"/>
                  <fetcher.Form method="post" preventScrollReset>
                    <input type="hidden" name="intent" value="redirect" />
                    <div className="form-grid">
                      <label>
                        Retired collection path
                        <input
                          name="path"
                          placeholder="/collections/old-collection"
                          required
                        />
                      </label>
                      <label>
                        Destination collection path
                        <select name="target" required defaultValue="">
                          <option value="" disabled>Choose a destination collection</option>
                          {d.resources.filter((r) => r.kind === "collection").map((r) => <option key={r.id} value={`/collections/${r.handle}`}>{r.title}</option>)}
                        </select>
                      </label>
                    </div>
                    <button className="button">
                      Queue redirect for review
                    </button>
                  </fetcher.Form>
                  <p className="muted">
                    The destination must be a live collection. Existing broken mappings are updated after approval; rollback restores the previous mapping. Live collections cannot be redirected by this form.
                  </p>
                </s-section>
              )}
            </section>
          )}
          {section === "content" && (
            <>
              <div className="notice">
                <strong>Drafts stay drafts</strong>
                <span>
                  Product facts come from this catalogue. Places, regulations,
                  recommendations and safety claims require sources and
                  editorial verification.
                </span>
              </div>
              <section className="card">
                <SectionHeading title="Your content plan"/>
                <p className="muted">
                  Practical questions, useful answers and relevant links back to
                  the shop.
                </p>
                {topics.map((t, i) => (
                  <div className="content-item" key={t}>
                    <span className="priority-number">0{i + 1}</span>
                    <div>
                      <h3>{t}</h3>
                      <p>
                        {
                          [
                            "Buying guide · power requirements",
                            "How-to · small-space cooking",
                            "Gift guide · considered details",
                            "Seasonal guide · UK winter",
                            "Ideas · interiors",
                          ][i]
                        }
                      </p>
                    </div>
                    <Button
                      disabled={busy}
                      onClick={() => submit("draft", { title: t })}
                    >
                      Create draft
                    </Button>
                  </div>
                ))}
              </section>
              <section className="card">
                <SectionHeading title="Pages & articles"/>
                {d.resources
                  .filter((r) => ["article", "page"].includes(r.kind))
                  .map((r) => (
                    <div className="content-item" key={r.id}>
                      <div>
                        <h3>{r.title}</h3>
                        <Badge
                          tone={
                            JSON.parse(r.payload).published
                              ? "neutral"
                              : "amber"
                          }
                        >
                          {JSON.parse(r.payload).published
                            ? "Existing page"
                            : "Unpublished draft"}
                        </Badge>
                        <details>
                          <summary>Read content</summary>
                          <pre className="content-preview">
                            {JSON.parse(r.payload).descriptionHtml}
                          </pre>
                        </details>
                      </div>
                      <Button onClick={() => optimise([r.id], "links")}>
                        Suggest links
                      </Button>
                    </div>
                  ))}
                {!d.resources.some(
                  (r) => r.kind === "article" || r.kind === "page",
                ) && (
                  <p className="muted">
                    Create a draft or import your existing content with a store
                    audit.
                  </p>
                )}
              </section>
            </>
          )}
          {section === "aeo" && (
            <>
              <div className="metrics-grid">
                <Metric
                  label="Confirmed product details"
                  value={`${audit?.aeoScore || 0}%`}
                  caption="Dimensions, weight, materials and included items"
                />
                <Metric
                  label="How often AI mentions your shop"
                  value={mentionRate === null ? "—" : `${mentionRate}%`}
                  caption="Observed samples, not search rankings"
                />
                <Metric
                  label="Citation samples"
                  value={String(d.observations.filter((o) => o.cited).length)}
                  caption="Verified host match to your domain"
                />
                <Metric
                  label="Structured data"
                  value={
                    d.demo
                      ? "Not scanned"
                      : String(d.discoveries.schemas?.length || 0)
                  }
                  caption="Live pages inspected"
                />
              </div>
              <div className="two-cols">
                <section className="card">
                  <SectionHeading title="Schema without duplication"/>
                  <p>
                    The RankPilot theme embed avoids adding a second version of supported existing markup. It does not remove duplicates already produced by your theme or other apps.
                  </p>
                  <div className="check-list">
                    <p>
                      ✓ Product, Offer, BreadcrumbList, Organization, WebSite
                      and Article
                    </p>
                    <p>
                      ✓ Customer answers are visible on the page and readable by search engines
                    </p>
                    <p>
                      ✓ No invented ratings, specifications or return promises
                    </p>
                  </div>
                  <p className="muted">
                    Shipping and return schema stays off until you verify values
                    in the app embed settings. Existing Product and review
                    markup is preserved.
                  </p>
                  {d.discoveries.schemas?.map((s: {url:string;types:string[]}) => (
                    <p key={s.url}>
                      <small>{s.url}</small>
                      <span className="keyword">
                        {s.types.join(", ") || "No JSON-LD types detected"}
                      </span>
                    </p>
                  ))}
                </section>
                <section className="card">
                  <SectionHeading title="AI crawler readiness"/>
                  {d.discoveries.robots?.length ? (
                    d.discoveries.robots.map((r: {agent:string;home:boolean;product:boolean}) => (
                      <div className="mini-stat" key={r.agent}>
                        <span>{r.agent}</span>
                        <Badge tone={r.home && r.product ? "green" : "amber"}>
                          {r.home && r.product
                            ? "Allowed on sample URLs"
                            : "Review blocking rules"}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      Run a live audit to inspect robots.txt.
                    </p>
                  )}
                  <p className="muted">
                    Training crawlers and search crawlers serve different
                    purposes. Google-Extended does not control Google Search
                    indexing. RankPilot never edits robots.txt automatically.
                  </p>
                  <details>
                    <summary>Review crawler policy guidance</summary>
                    <p>
                      Choose separately whether to allow search retrieval and
                      model training. Preserve Shopify’s checkout, cart and
                      account exclusions. Have your theme maintainer review
                      specific rules before making changes.
                    </p>
                  </details>
                </section>
              </div>
              <section className="card">
                <div className="card-head">
                  <SectionHeading title="Store discovery file"/>
                  <Download className="button" url="/app/export?type=llms">Download llms.txt draft</Download>
                </div>
                <p>
                  Check Shopify’s managed <code>/llms.txt</code> and{" "}
                  <code>/agents.md</code> first. The downloadable draft
                  summarises collections and confirmed policies. The app embed
                  cannot replace these root files.
                </p>
                <Badge tone={d.discoveries.llms?.present ? "green" : "neutral"}>
                  {d.discoveries.llms?.present
                    ? "Managed file detected"
                    : d.demo
                      ? "Live file not checked"
                      : "Check the latest scan"}
                </Badge>
              </section>
              <section className="card">
                <div className="card-head">
                  <div>
                    <SectionHeading title="Independent answer-engine samples"/>
                    <p className="muted">
                      Each run queries six UK buyer prompts per connected
                      provider. Provider API usage may be billed.
                    </p>
                  </div>
                  <Button
                    primary
                    disabled={busy || d.demo}
                    onClick={() => submit("visibility")}
                  >
                    Run visibility check
                  </Button>
                </div>
                <div className="prompt-list">
                  {prompts.map((p) => (
                    <span className="chip" key={p}>
                      {p}
                    </span>
                  ))}
                </div>
                {d.observations.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Engine / prompt</th>
                          <th>Mention</th>
                          <th>Citation</th>
                          <th>Other cited domains</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.observations.map((o) => (
                          <tr key={o.id}>
                            <td>
                              <strong>
                                {o.engine} · {date(o.createdAt)}
                              </strong>
                              <small>{o.prompt}</small>
                              <details>
                                <summary>Inspect answer and sources</summary>
                                <p>{o.text}</p>
                                {JSON.parse(o.citations).map((u: string) => (
                                  <p key={u}>
                                    <a
                                      href={u}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {u}
                                    </a>
                                  </p>
                                ))}
                                <small>
                                  {o.source} · {o.model}
                                </small>
                              </details>
                            </td>
                            <td>{o.mentioned ? "Yes" : "No"}</td>
                            <td>{o.cited ? "Yes" : "No"}</td>
                            <td>
                              {JSON.parse(o.competitors).join(", ") ||
                                "None recorded"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    <h3>No AI observations yet</h3>
                    <p>
                      Connect OpenAI, Perplexity or Gemini to begin. Failed
                      requests never count as missing mentions.
                    </p>
                  </div>
                )}
                <details className="details">
                  <summary>
                    Add a manual Copilot or Google AI Overview observation
                  </summary>
                  <fetcher.Form method="post" preventScrollReset>
                    <input type="hidden" name="intent" value="observation" />
                    <label>
                      Engine
                      <select name="engine">
                        <option>Copilot</option>
                        <option>Google AI Overviews</option>
                      </select>
                    </label>
                    <label>
                      Exact prompt
                      <input name="prompt" required />
                    </label>
                    <label>
                      Observed answer
                      <textarea name="text" required rows={5} />
                    </label>
                    <label>
                      Cited URLs, one per line
                      <textarea name="citations" rows={3} />
                    </label>
                    <button className="button primary">Save observation</button>
                  </fetcher.Form>
                  <p className="muted">
                    These consumer experiences are not represented by the OpenAI
                    or Gemini API. Record them separately.
                  </p>
                </details>
              </section>
              <section className="card">
                <SectionHeading title="Authority opportunities"/>
                <p className="muted">
                  Why this can backfire: irrelevant promotional posts can be removed and damage trust. Disclose your connection, ask moderators first and do not buy or demand links. Research candidates, not verified placements. Check relevance,
                  current contacts and community rules before approaching.
                </p>
                <div className="cluster-grid">
                  {opportunities.map((t) => (
                    <div className="outreach" key={t.name}>
                      <h3>
                        <a href={t.url} target="_blank" rel="noreferrer">
                          {t.name} ↗
                        </a>
                      </h3>
                      <p>
                        {t.angle} Disclose your commercial connection and check
                        community rules.
                      </p>
                      <details>
                        <summary>Outreach draft</summary>
                        <p>
                          Hello, I run Van Life Emporium, a UK store for
                          campervan and outdoor kit. I’m putting together a
                          practical guide for people choosing equipment for
                          smaller spaces. If this is relevant to your audience,
                          I’d be glad to discuss a contribution built around
                          verified product details. There is no expectation of a
                          link. Would a short outline be useful?
                        </p>
                      </details>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {section === "reports" && (
            <>
              <section className="card"><h2>Are more shoppers finding you?</h2><p>{searchSummary(gsc[0],gsc[1])}</p>{gsc[0]?.start && <small>Reporting period: {gsc[0].start} to {gsc[0].end}. Search reports arrive a few days late.</small>}</section>
              <div className="metrics-grid">
                <Metric
                  label="Google search clicks"
                  value={clicks === undefined ? "—" : String(clicks)}
                  caption="Search Console · last complete 28 days"
                />
                <Metric
                  label="Search-engine sessions"
                  value={organic === undefined ? "—" : String(organic)}
                  caption="Google Analytics (GA4) · unpaid search sessions"
                />
                <Metric
                  label="Sales attributed to search"
                  value={
                    revenue === undefined
                      ? "—"
                      : new Intl.NumberFormat("en-GB", {
                          style: "currency",
                          currency: "GBP",
                        }).format(revenue)
                  }
                  caption="GA4 attributed revenue"
                />
                <Metric
                  label="Applied changes"
                  value={String(
                    d.appliedCount,
                  )}
                  caption="Saved changes you can undo individually"
                />
              </div>
              <div className="two-cols">
                <section className="card">
                  <div className="card-head">
                    <SectionHeading title="Weekly reports"/>
                    <Button onClick={() => submit("report")} disabled={busy}>
                      Generate report
                    </Button>
                  </div>
                  {d.reports.map((r) => (
                    <div className="mini-stat" key={r.id}>
                      <span>{date(r.createdAt)}</span>
                      <Download className="text-link" url={`/app/export?id=${r.id}`}>Download report ↓</Download>
                    </div>
                  ))}
                  {!d.reports.length && (
                    <p className="muted">
                      Generate a report now, or enable the weekly schedule in
                      Settings.
                    </p>
                  )}
                </section>
                <section className="card">
                  <SectionHeading title="Analytics connections"/>
                  <p>
                    Compare consecutive 28-day periods, ending three days ago to
                    allow for reporting delays.
                  </p>
                  <Button
                    primary
                    disabled={busy || d.demo}
                    onClick={() => submit("analytics")}
                  >
                    Refresh connected analytics
                  </Button>
                  <p className="muted">
                    Connected snapshots: {d.metrics.length}. Traffic changes do
                    not by themselves establish the impact of a particular edit.
                  </p>
                </section>
              </div>
              <section className="card">
                <SectionHeading title="Top-gaining pages"/>
                {gsc.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Landing page</th>
                          <th>Clicks</th>
                          <th>Impressions</th>
                          <th>Position</th>
                          <th>Click change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageGains(gsc[0], gsc[1])
                          .slice(0, 30)
                          .map((r, i) => (
                            <tr key={i}>
                              <td>
                                <strong>{r.url}</strong>
                              </td>
                              <td>{r.clicks}</td>
                              <td>{r.impressions}</td>
                              <td>{r.position?.toFixed(1)}</td>
                              <td>
                                {r.change === null
                                  ? "No baseline"
                                  : `${r.change > 0 ? "+" : ""}${r.change}`}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    <h3>Connect your search data</h3>
                    <p>
                      Search queries, impressions and landing-page performance
                      will appear after a successful refresh.
                    </p>
                    <Link className="text-link" to="/app/settings">
                      Connect analytics →
                    </Link>
                  </div>
                )}
              </section>
              <section className="card">
                <SectionHeading title="Searches within reach"/>
                <p>These searches currently average positions 8–20. Improve the matching page with useful, accurate answers; a higher position is not guaranteed.</p>
                <p className="muted">Source: Google Search Console{gsc[0]?.start && gsc[0]?.end ? ` · ${gsc[0].start} to ${gsc[0].end}` : ""}. Click rate = clicks ÷ views in search. Views without clicks correctly show 0%; missing data shows —.</p><div className="table-wrap"><table><thead><tr><th>Search phrase</th><th>Page</th><th>Views in search</th><th>Clicks</th><th>Position</th><th>Click rate</th></tr></thead><tbody>{opportunityQueries(gsc[0]?.rows).slice(0,50).map((r,i)=><tr key={i}><td>{r.keys[1]}</td><td>{r.keys[0]}</td><td>{r.impressions}</td><td>{r.clicks ?? "—"}</td><td>{r.position?.toFixed(1)}</td><td>{clickRate(r.clicks,r.impressions)}</td></tr>)}</tbody></table></div>
                {!opportunityQueries(gsc[0]?.rows).length&&<p>No matching searches in the connected data yet.</p>}
              </section><section className="card">
                <SectionHeading title="AI visibility over time"/>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Week beginning</th>
                        <th>Engine</th>
                        <th>Samples</th>
                        <th>Mention rate</th>
                        <th>Citation rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibilityTrend(d.observations).map((r) => (
                        <tr key={r.week + r.engine}>
                          <td>{r.week}</td>
                          <td>{r.engine}</td>
                          <td>{r.samples}</td>
                          <td>{Math.round((r.mentions / r.samples) * 100)}%</td>
                          <td>
                            {Math.round((r.citations / r.samples) * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!d.observations.length && (
                  <p className="muted">
                    Trends appear after recorded API or manual observations.
                  </p>
                )}
              </section>
              <section className="card">
                <SectionHeading title="Connection activity"/>
                {d.events
                  .filter(
                    (e) =>
                      JSON.parse(e.detail).errors?.length ||
                      e.message.includes("failed"),
                  )
                  .slice(0, 10)
                  .map((e) => (
                    <div key={e.id}>
                      <strong>{e.message}</strong>
                      <pre>{JSON.stringify(JSON.parse(e.detail), null, 2)}</pre>
                    </div>
                  ))}
                <p className="muted">
                  A connected key is verified by a successful refresh, not by
                  its presence in Settings.
                </p>
              </section>
              <section className="card">
                <SectionHeading title="Merchant feed completeness"/>
                {metricPair(d.metrics,"merchant")[0]?.products?.map((p: {name:string;title?:string;offerId:string;missing:string[]}) => (
                  <div className="mini-stat" key={p.name}>
                    <span>{p.title || p.offerId}</span>
                    <Badge tone={p.missing.length ? "amber" : "green"}>
                      {p.missing.length
                        ? "Check " + p.missing.join(", ")
                        : "Attributes present"}
                    </Badge>
                  </div>
                )) || (
                  <p className="muted">
                    Connect Merchant Center to check feed attributes and
                    reported item issues. Missing GTINs must be resolved with
                    the manufacturer.
                  </p>
                )}
              </section>
              <PageSpeedResults domain={d.domain} metrics={d.metrics} jobs={d.jobs} demo={d.demo}/>
              <section className="card">
                <div className="card-head">
                  <SectionHeading title="Version history"/>
                  <Download className="text-link" url="/app/export?type=changes">Export full history ↓</Download>
                </div>
                {changesTable(d.changes)}{historyPagination()}
              </section>
            </>
          )}
          {section === "settings" && (
            <>
              <fetcher.Form method="post" preventScrollReset>
                <input type="hidden" name="intent" value="settings" /><section className="card"><h2>Your brand voice</h2><p>Describe the tone you want. These preferences guide new proposals; factual checks and approval always apply.</p><label htmlFor="brand-voice">Describe your brand’s tone</label><textarea id="brand-voice" aria-describedby="brand-voice-help" rows={4} name="brandVoice" maxLength={1500} defaultValue={d.settings.brandVoice||''} placeholder="Plain British English, thoughtful and outdoors-focused. Keep original stories and avoid exaggerated claims."/><small id="brand-voice-help">Editable · up to 1,500 characters. Save settings below to use this tone in new previews.</small></section><section className="card"><SectionHeading title="Search title preferences"/><p>Aim for 50–60 characters in a Google title and 150–160 in its summary, including any brand suffix. There is no word limit. Longer wording is allowed with a preview warning; shorter wording is fine when clear.</p><details><summary>Why this matters and how to use it</summary><p>Keep a useful product identity first. Choose whether to retain, omit or add your store name. Include your brand only where it helps identify the page. These preferences affect new previews and never publish changes.</p></details><label>Store brand<input name="titleBrand" defaultValue={d.settings.titleBrand}/></label><label>Brand suffix<select name="titleBrandMode" defaultValue={d.settings.titleBrandMode || 'preserve'}><option value="preserve">Keep an existing suffix when it fits</option><option value="omit">Omit the store suffix</option><option value="append">Add the store brand</option></select></label></section>
                <section className="card">
                  <SectionHeading title="Automation, on your terms"/>
                  <p className="muted">
                    Autopilot is locked off. Every proposed change requires your review. Blog articles are always unpublished drafts.
                  </p>
                  {features.map((f) => (
                    <label className="toggle-row" key={f}>
                      <span>
                        <strong>{labels[f]}</strong>
                        <small>
                          {f === "handle"
                            ? "Changes public URLs and creates redirects"
                            : f === "filename"
                              ? "Updates Shopify file names; review image usage first"
                              : "Changes are versioned and can be rolled back"}
                        </small>
                      </span>
                      <span className="toggle">
                        <input
                          name={f}
                          type="checkbox"
                          checked={false}
                          disabled
                        />
                        <span /> Autopilot
                      </span>
                    </label>
                  ))}
                </section>
                <section className="card">
                  <SectionHeading title="Reporting & monitoring"/>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="weekly"
                      defaultChecked={d.settings.weekly}
                    />
                    Run weekly audits, analytics refresh and a report
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="requeue"
                      defaultChecked={d.settings.requeue}
                    />
                    Use API credits to regenerate pages with at least a 25% click drop, 100 prior
                    impressions and 10 prior clicks
                  </label>
                  <p className="muted">
                    A 28-day cooldown avoids repeatedly rewriting the same page.
                    Regenerated proposals still require acceptance. AI mention sampling runs only when you request it.
                  </p>
                  <div className="form-grid">
                    <label>
                      Storefront pages per audit
                      <input
                        name="crawlLimit"
                        type="number"
                        min={1}
                        max={5000}
                        defaultValue={d.settings.crawlLimit}
                      />
                    </label>
                    <label>
                      Search Console property
                      <input name="gscSite" defaultValue={d.settings.gscSite} />
                    </label>
                    <label>
                      GA4 numeric property ID
                      <input
                        name="ga4Property"
                        defaultValue={d.settings.ga4Property}
                      />
                    </label>
                    <label>
                      Merchant Center account ID
                      <input
                        name="merchantAccount"
                        defaultValue={d.settings.merchantAccount}
                      />
                    </label>
                    <label>
                      Blog for new drafts
                      <select name="blogId" defaultValue={d.settings.blogId}><option value="">Choose a blog</option>{d.settings.blogId && !d.discoveries.blogs?.some((b: {id:string})=>b.id===d.settings.blogId) && <option value={d.settings.blogId}>Previously selected blog</option>}{d.discoveries.blogs?.map((b:{id:string;title:string})=><option key={b.id} value={b.id}>{b.title}</option>)}</select><small>Run an audit to load your blogs. New articles are saved as unpublished drafts.</small>
                    </label>
                  </div>
                  
                </section>
                <section className="card">
                  <SectionHeading title="Verified delivery & returns wording"/>
                  <p className="muted">
                    Use wording that applies to every relevant supplier and
                    product. Leave blank when delivery times vary.
                  </p>
                  <label>
                    UK delivery
                    <textarea
                      name="delivery"
                      defaultValue={d.settings.policies.delivery}
                    />
                  </label>
                  <label>
                    Returns
                    <textarea
                      name="returns"
                      defaultValue={d.settings.policies.returns}
                    />
                  </label>
                  <label>
                    Verified policy source
                    <input
                      name="policySource"
                      placeholder="Policy URL and verification date"
                      defaultValue={d.settings.policies.source}
                    />
                  </label>
                </section>
                <button className="button primary" disabled={busy}>
                  Save settings
                </button>
              </fetcher.Form>
              <section className="card">
                <SectionHeading title="Secure connections"/>
                <p>Connect only the services you need. Your keys are encrypted and never displayed after saving.</p>
                {d.demo && <p className="notice">Connections are disabled in the demonstration workspace.</p>}
                <Connections names={d.credentialNames} demo={d.demo}/>
              </section>
              <section className="card">
                <SectionHeading title="Installation checklist"/>
                <ol className="install-list"><li>Run a store audit to import your pages and find issues.</li><li>Connect OpenAI if you want copy or image descriptions generated. Measurement connections are optional.</li><li>Generate one preview, review it and accept it. Wait for Applied and verified before considering the update complete.</li><li>For FAQs on the storefront, enable the RankPilot embed in your Shopify theme editor and check a product page.</li></ol>
              </section>
            </>
          )}
          <footer>
            RankPilot <span>·</span> Built for Van Life Emporium <span>·</span>{" "}
            {d.demo ? "Demonstration workspace" : "UK · GBP · British English"}
          </footer>
        </main>
      </div>
      <FixDialog open={!!reviewId || !!fixGroup || reviewQueue!==null} title={reviewResource?.title || currentFix?.title || "Review a fix"}
        onClose={()=>{setReviewId("");setFixGroup(null);setReviewQueue(null);}}>
        {reviewQueue && reviewQueue.length>0 && <div className="fix-navigation"><label>Ready fix
          <select disabled={busy} aria-label="Ready fix" value={fixIndex} onChange={e=>{const index=Number(e.target.value);setFixIndex(index);setReviewId(reviewQueue[index]);}}>
            {reviewQueue.map((id,index)=>{const change=d.changes.find(c=>c.id===id);return <option key={id} value={index}>{index+1}. {d.resources.find(r=>r.id===change?.resourceId)?.title || "Page"} — {labels[change?.feature || ""]}</option>;})}
          </select></label><span>{fixIndex+1} of {reviewQueue.length}</span></div>}
        {reviewQueue?.length===0 && <div className="review-body"><h3>No fixes are ready yet</h3><p>Choose an issue under Fix these next to prepare a preview. Nothing changes until you accept it.</p></div>}
        {fixGroup && <div className="fix-navigation"><label>Affected page
          <select aria-label="Affected page" value={fixIndex} onChange={e=>openFix(fixGroup,Number(e.target.value))}>
            {fixGroup.map((issue,index)=><option key={findingKey(issue)} value={index}>{index+1}. {issue.title} — {findingName(issue.code)}</option>)}
          </select></label><span>{fixIndex+1} of {fixGroup.length} checks across {new Set(fixGroup.map(i=>i.resourceId)).size} pages · {remainingFixPages} still have this type of finding in the latest check</span></div>}
        {review ? <ChangeReview key={review.id} d={d} review={review} busy={busy || generation.state!=="idle"} accepting={fetcher.formData?.get('intent')==='approve'} feedback={actionTarget===review.id?fetcher.data:undefined}
          onAction={(intent,id)=>submit(intent,{id})}
          onReplace={()=>optimise([review.resourceId],review.feature,true)}
          onEditFacts={()=>{setFactId(review.resourceId);setReviewId("");setFixGroup(null);}}/>
          : currentFix && <FindingFix key={findingKey(currentFix)} issue={currentFix} relatedIssues={fixGroup||[]} d={d} busy={busy || generationBusy}
            message={generation.state!=="idle"?"Preparing your preview request…":generationError || generationMessage}
            feedback={fetcher.data} onGenerate={()=>optimise([currentFix.resourceId],currentFix.feature!)}
            onFacts={()=>setFactId(currentFix.resourceId)} onReview={setReviewId} onAction={submit}/>}
        {reviewQueue && reviewQueue.length>1 && <div className="fix-next">
          <button className="button" disabled={busy || fixIndex===0} onClick={()=>{setFixIndex(fixIndex-1);setReviewId(reviewQueue[fixIndex-1]);}}>← Previous fix</button>{" "}
          <button className="button" disabled={busy || fixIndex===reviewQueue.length-1} onClick={()=>{setFixIndex(fixIndex+1);setReviewId(reviewQueue[fixIndex+1]);}}>Next fix →</button>
        </div>}
        {fixGroup && fixIndex<fixGroup.length-1 && <div className="fix-next"><button className="button" onClick={()=>openFix(fixGroup,fixIndex+1)}>Next affected page →</button></div>}
      </FixDialog>
      <dialog
        ref={factsDialog}
        className="review-dialog facts-dialog"
        aria-labelledby="facts-heading"
        onClose={() => setFactId("")}
      >
        <div className="dialog-head">
          <h2 id="facts-heading">{factResource?.title}</h2>
          <button
            className="close"
            aria-label="Close facts"
            onClick={() => setFactId("")}
          >
            ×
          </button>
        </div>
        {factResource && (
          <fetcher.Form
            method="post"
            key={factResource.id}
            ref={factsForm}
            preventScrollReset
          >
            <div className="facts-body">
            <Guidance title="Product facts"/><input
              type="hidden"
              name="intent"
              value={factResource.kind === "product" ? "facts" : "keyword"}
            />
            <input type="hidden" name="id" value={factResource.id} />
            <label>
              Main phrase shoppers search for
              <input name="keyword" defaultValue={factResource.keyword} />
            </label>
            {factResource.kind === "product" && (
              <>
                <p className="muted">
                  Confirm a few details so we can write accurate copy: size, weight and material are a useful start. Use a supplier document or information you have checked; leave unknown details blank. You can import a supplier spreadsheet from the Products page. Saving updated details means older suggestions need a fresh review.
                </p>
                <Button disabled={busy || resourceDetail.state!=="idle"} onClick={()=>{setFactMessage("");submit("suggestFacts",{id:factResource.id});}}>Fill from existing product information</Button>
                <p role="status">{busy ? "Working…" : factMessage}</p>
                {fetcher.data?.ok===false && <><p role="alert">{fetcher.data.message}</p>{fetcher.data.comparison && <table><thead><tr><th>Search field</th><th>Accepted proposal</th><th>Saved in Shopify</th></tr></thead><tbody>{fetcher.data.comparison.map(row=><tr key={row.field}><th>{row.field} — {row.matches?'Matches':'Differs'}</th><td>{row.accepted || 'Not set'}</td><td>{row.live || 'Not set'}</td></tr>)}</tbody></table>}</>}
                {Object.entries(factLabels).map(([k, label]) => {
                  const f: Facts = JSON.parse(factResource.facts);
                  return (
                    <div className="fact-field" key={k}><details><summary>Why add {label.toLowerCase()}?</summary><p>This gives customers a specific answer about the product. Copy an accurate value from the description or supplier document, add its source and confirm only after checking. Leave it blank when unknown.</p></details>
                      <label>
                        {label}
                        <input name={k} defaultValue={f[k]?.value || ""} />
                      </label>
                      <label>
                        Where did you check this?
                        <input
                          name={k + "Source"}
                          defaultValue={f[k]?.source || ""}
                          placeholder="Supplier specification, URL or document reference"
                        />
                      </label>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          name={k + "Confirmed"}
                          defaultChecked={f[k]?.confirmed || false}
                        />
                        I checked this detail against the reference
                      </label>
                    </div>
                  );
                })}
                <details>
                  <summary>Original product description</summary>
                  <p>{resourceDetail.state!=="idle"?"Loading original description…":JSON.parse(factResource.payload).descriptionHtml.replace(/<[^>]+>/g," ")}</p>
                </details>
              </>
            )}
            </div>
            <div className="dialog-actions facts-footer">
              <Button onClick={()=>setFactId("")}>Cancel</Button>
              <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save product details"}</button>
            </div>
          </fetcher.Form>
        )}
      </dialog>
    </div>
  );
}

import {ChangeValues} from "./ChangeValues";
import {Connections} from "./Connections";
import {SectionHeading,Guidance} from "./SectionHeading";
import {metricGuide} from "../core/subsection-guide";
import {Download} from "./Download";
import {jobRevision} from "../core/job-revision";
import {sectionGuide} from "../core/section-guide";
import {findingKey,findingAction,findingProgress} from "../core/finding-workflow";
import {jobResults as readJobResults, jobMessage, jobLabel, resultMessage} from "../core/job-feedback";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  useFetcher,
  useLoaderData,
  useFormAction,
  useParams,
  useRevalidator,
} from "react-router";
import type { loadUI } from "../core/ui.server";
import {
  clusters,
  topics,
  prompts,
  factLabels,
  opportunities,
} from "../core/catalogue-data";
import { metricPair, pageGains, visibilityTrend } from "../core/analytics";
import { features, type Payload, type Facts, type Issue } from "../core/types";
type Data = Awaited<ReturnType<typeof loadUI>>;
const labels: Record<string, string> = {
  title: "Product titles",
  description: "Descriptions",
  seo: "Search snippets",
  alt: "Image alt text",
  filename: "Image filenames",
  handle: "URL handles",
  faq: "Product FAQs",
  links: "Internal links",
  redirect: "Collection redirect",
  draft: "Article draft",
};
const nav = [
  "Dashboard",
  "Audit",
  "Reviews",
  "Products",
  "Collections",
  "Content",
  "AEO",
  "Reports",
  "Settings",
];
const icons = ["◈", "⊞", "✓", "▣", "▦", "▤", "✳", "▥", "⚙"];
const sectionNames:Record<string,string>={Dashboard:'Overview',Audit:'Find issues',Reviews:'Review & apply',Products:'Products',Collections:'Collections',Content:'Blog drafts',AEO:'FAQs & AI visibility',Reports:'Results & history',Settings:'Settings'};
const sectionHelp:Record<string,string>={dashboard:'Start here. Run an audit, review proposed fixes and track verified updates.',audit:'Find issues → Generate fix → Review & apply. Generating does not publish.',reviews:'Compare each proposal, accept or reject it, and track whether Shopify was updated.',products:'Generate product titles, search snippets, descriptions and image alt text.',collections:'Improve collection copy and review redirects for retired collection URLs.',content:'Create and review unpublished blog drafts.',aeo:'Confirm product facts, prepare FAQs and measure AI mentions.',reports:'View performance and the history of changes applied to Shopify.',settings:'Manage connections and preferences. Autopilot remains off.'};
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
export default function Workspace() {
  const d = useLoaderData<Data>();
  const section = useParams().section || "dashboard";
  const fetcher = useFetcher<{ ok: boolean; message: string; changeId?: string; jobId?: string; factResourceId?:string; factSuggestions?:Facts; keywordSuggestion?:string; factsSaved?:string }>();
  const progress=useFetcher<{revision:string;workerHealthy:boolean}>();
  const resourceDetail=useFetcher<Data["resources"][number]>();
  const revalidator = useRevalidator();
  const formAction = useFormAction();
  const [collection, setCollection] = useState("All collections");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [feature, setFeature] = useState("seo");
  const [reviewId, setReviewId] = useState("");
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const openedChange = useRef("");
  const [factId, setFactId] = useState("");
  const [severity, setSeverity] = useState("all");
  const [issueQuery, setIssueQuery] = useState("");
  const [issueCode, setIssueCode] = useState("all");
  const [previewTab, setPreviewTab] = useState("after");
  const dialog = useRef<HTMLDialogElement>(null);
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
  const submit = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit(
      { intent, ...extra },
      { method: "post", action: formAction },
    );
  const running = d.jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const loadedRevision=jobRevision(d.jobs);
  const refreshedRevision=useRef("");
  const applying=d.jobs.some(j=>['apply','rollback'].includes(j.kind) && ['queued','running'].includes(j.status));
  useEffect(()=>{
    if(!running)return;
    const timer=setInterval(()=>{if(progress.state==='idle' && document.visibilityState==='visible')progress.load('/app/job-status');},applying?500:2000);
    return()=>clearInterval(timer);
  },[running,applying,progress]);
  useEffect(()=>{
    const revision=progress.data?.revision;
    if(!revision || revision===refreshedRevision.current)return;
    if(revision===loadedRevision){refreshedRevision.current=revision;return;}
    if(revalidator.state==='idle'){refreshedRevision.current=revision;void revalidator.revalidate();}
  },[progress.data?.revision,loadedRevision,revalidator]);
  useEffect(() => {
    if (reviewId) dialog.current?.showModal();
    else dialog.current?.close();
  }, [reviewId]);
  useEffect(() => {
    if (factId) factsDialog.current?.showModal();
    else factsDialog.current?.close();
  }, [factId]);
  const requestedJob = d.jobs.find(j => j.id === fetcher.data?.jobId);
  const jobResults: {changeId?:string;message?:string;error?:string}[] = requestedJob?.status === "completed" ? readJobResults(requestedJob) : [];
  const generatedChangeId = fetcher.data?.changeId || (jobResults.length === 1 ? jobResults[0]?.changeId : undefined);
  const generationMessage = requestedJob
    ? jobMessage(requestedJob, d.changes)
    : fetcher.data?.message;
  useEffect(() => {
    const id = generatedChangeId;
    if (fetcher.state === "idle" && id && openedChange.current !== id && d.changes.some(c => c.id === id)) {
      openedChange.current = id;
      setPreviewTab("after");
      setReviewId(id);
    }
  }, [fetcher.state, generatedChangeId, d.changes]);
  const audit = d.audits[0];
  const issues: Issue[] = audit ? JSON.parse(audit.issues) : [];
  const coverage = audit ? JSON.parse(audit.coverage) : {};
  const auditJob = d.jobs.find(j => j.kind === "audit");
  const auditSubmitting = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "audit";
  const filteredIssues = issues.filter(i =>
    (severity === "all" || i.severity === severity) &&
    (issueCode === "all" || i.code === issueCode) &&
    `${i.title} ${i.detail} ${i.code}`.toLowerCase().includes(issueQuery.toLowerCase()));
  const pending = d.changes.filter((c) => c.status === "pending");
  const products = d.resources.filter((r) => r.kind === "product");
  const review = d.changes.find((c) => c.id === reviewId);
  const factResource = resourceDetail.data?.id===factId ? resourceDetail.data : d.resources.find((r) => r.id === factId);
  useEffect(()=>{if(factId && resourceDetail.data?.id!==factId && resourceDetail.state==='idle')resourceDetail.load(`/app/resource?id=${encodeURIComponent(factId)}`);},[factId,resourceDetail]);
  const staleTitle = review && ["seo","title"].includes(review.feature) && (()=>{try{const after=JSON.parse(review.after);const title=String(review.feature === "seo" ? after.title || "" : after).trim();return !title || title.split(/\s+/u).length>5 || title.length>60;}catch{return true;}})();
  const reviewResource =
    review && d.resources.find((r) => r.id === review.resourceId);
  const reviewValue = review
    ? JSON.parse(previewTab === "before" ? review.before : review.after)
    : null;
  const reviewPayload = reviewResource
    ? JSON.parse(reviewResource.payload)
    : null;
  const productCount = products.length;
  const optimise = (ids: string[], f = feature, regenerate=false) =>
    submit("optimise", { ids: JSON.stringify(ids), feature: f, regenerate:String(regenerate) });
  const busy = fetcher.state !== "idle";
  const list = d.resources.filter(
    (r) =>
      (section === "products"
        ? r.kind === "product"
        : section === "collections"
          ? r.kind === "collection"
          : true) &&
      (collection === "All collections" ||
        r.collection === collection ||
        JSON.parse(r.payload).collections?.includes(collection) ||
        r.title === collection) &&
      r.title.toLowerCase().includes(query.toLowerCase()),
  );
  const title = sectionNames[nav.find((n) => n.toLowerCase() === section) || "Dashboard"];
  const newestMetrics = (provider: string) => metricPair(d.metrics, provider);
  const gsc = newestMetrics("gsc");
  const ga = newestMetrics("ga4");
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
                        ? "Facts needed"
                        : c.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td>
                    <Button
                      onClick={() => {
                        setReviewId(c.id);
                        setPreviewTab("after");
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
            disabled={!selected.length || busy}
            onClick={() => optimise(selected)}
          >
            Generate previews
          </Button>
          <Button
            disabled={!list.length || busy}
            onClick={() => optimise(list.map((r) => r.id))}
          >
            Optimise this collection
          </Button>
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
                      list.every((r) => selected.includes(r.id))
                    }
                    onChange={(e) =>
                      setSelected(e.target.checked ? list.map((r) => r.id) : [])
                    }
                  />
                </th>
                <th>{section === "products" ? "Product" : "Collection"}</th>
                <th>Primary keyword</th>
                <th>Audit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const p: Payload = JSON.parse(r.payload);
                const count = issues.filter(
                  (i) => i.resourceId === r.id,
                ).length;
                return (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.title}`}
                        checked={selected.includes(r.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, r.id]
                              : selected.filter((id) => id !== r.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="product-cell">
                        {p.images[0] && <img src={p.images[0].url} alt="" />}
                        <div>
                          <strong>{r.title}</strong>
                          <small>{r.collection || r.kind}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="keyword">
                        {r.keyword || "Unassigned"}
                      </span>
                    </td>
                    <td>
                      <Badge tone={count ? "amber" : "green"}>
                        {count ? `${count} checks` : "Clear"}
                      </Badge>
                    </td>
                    <td>
                      <Button onClick={() => setFactId(r.id)}>
                        {r.kind === "product" ? "Facts & keyword" : "Keyword"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
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
            <span /> Approval first
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
          {fetcher.data && (
            <div
              role="status"
              className={"notice " + (fetcher.data.ok ? "success" : "error")}
            >
              {generationMessage}
            </div>
          )}
          {running && progress.data?.workerHealthy===false && <p role="status" className="notice warning">Background processing is not responding. Accepted updates can still start here; queued generation needs the worker to recover. Avoid submitting the same work repeatedly.</p>}
          {busy && <p role="status" aria-live="polite">Submitting your request… Please wait; you do not need to click again.</p>}
          {sectionGuide[section] && <details className="card" style={{padding:'16px 20px',marginBottom:16}}><summary style={{cursor:'pointer',fontWeight:600}}>What is this section and how do I use it?</summary><p>{sectionGuide[section].shows}</p><ol>{sectionGuide[section].steps.map(step=><li key={step} style={{marginBottom:8}}>{step}</li>)}</ol></details>}
          <div className="card" style={{padding:'12px 20px',marginBottom:16,display:'flex',gap:20,flexWrap:'wrap'}} aria-label="Workflow shortcuts">
            <Link to="/app/audit">1. Find issues</Link><Link to="/app/reviews">2. Review & apply ({pending.length})</Link><Link to="/app/reviews">3. Check updates</Link>
          </div>
          {section === "reviews" && <section className="card"><div className="card-head"><div><SectionHeading title="Proposals and Shopify updates"/><p>Accepted means queued. Applied means the saved Shopify value was verified. Open a change to see errors or retry.</p></div></div>{changesTable(d.changes)}{historyPagination()}</section>}
          {section === "dashboard" && (
            <>
              <div className="metrics-grid">
                <Metric
                  label="Catalogue SEO score"
                  value={audit ? `${audit.score}/100` : "—"}
                  caption={`${issues.length} checks to review`}
                  accent
                />
                <Metric
                  label="Answer-ready facts"
                  value={audit ? `${audit.aeoScore}%` : "—"}
                  caption="Confirmed core product attributes"
                />
                <Metric
                  label="Organic sessions"
                  value={
                    organic === undefined
                      ? "—"
                      : organic.toLocaleString("en-GB")
                  }
                  caption={
                    organic === undefined
                      ? "Connect Google Analytics"
                      : "Last complete 28-day period"
                  }
                />
                <Metric
                  label="AI mention rate"
                  value={mentionRate === null ? "—" : `${mentionRate}%`}
                  caption={
                    mentionRate === null
                      ? "Connect an answer engine"
                      : `${d.observations.length} recorded samples`
                  }
                />
              </div>
              <div className="dashboard-grid">
                <section className="card priority-card">
                  <div className="card-head">
                    <div>
                      <span className="eyebrow">YOUR NEXT MOVES</span>
                      <SectionHeading title="Make the useful details visible"/>
                    </div>
                    <Badge>
                      {issues.filter((i) => i.severity !== "notice").length}{" "}
                      priorities
                    </Badge>
                  </div>
                  {[
                    {
                      title: "Give product pages a clearer introduction",
                      body: "Replace supplier language with relevant, factual descriptions.",
                      count: new Set(
                        issues
                          .filter(
                            (i) =>
                              ["thin-content", "supplier-language"].includes(
                                i.code,
                              ) && products.some((p) => p.id === i.resourceId),
                          )
                          .map((i) => i.resourceId),
                      ).size,
                      feature: "description",
                      icon: "01",
                    },
                    {
                      title: "Make every image easier to understand",
                      body: "Add descriptive labels without guessing what an image shows.",
                      count: issues.filter((i) => i.code === "missing-alt")
                        .length,
                      feature: "alt",
                      icon: "02",
                    },
                    {
                      title: "Answer the questions before they are asked",
                      body: "Use confirmed specifications to create helpful product FAQs.",
                      count: issues.filter(
                        (i) => i.code === "missing-product-faq",
                      ).length,
                      feature: "faq",
                      icon: "03",
                    },
                  ].map((item) => (
                    <div className="priority" key={item.icon}>
                      <span className="priority-number">{item.icon}</span>
                      <div>
                        <h3>{item.title}</h3>
                        <p>{item.body}</p>
                        <small>{item.count} pages flagged</small>
                      </div>
                      <button
                        aria-label={item.title}
                        className="arrow-button"
                        disabled={!productCount || busy}
                        onClick={() =>
                          optimise(
                            [...new Set(issues.filter(i=> item.feature==='alt' ? i.code==='missing-alt' : item.feature==='faq' ? i.code==='missing-product-faq' : ['thin-content','supplier-language'].includes(i.code)).map(i=>i.resourceId))],
                            item.feature,
                          )
                        }
                      >
                        ↗
                      </button>
                    </div>
                  ))}
                </section>
                <section className="card progress-card">
                  <SectionHeading title="Review queue"/>
                  <div className="queue-number">
                    {pending.length}
                    <span>
                      changes awaiting
                      <br />
                      your review
                    </span>
                  </div>
                  <p>
                    You choose what goes live. Every applied change keeps its
                    previous version.
                  </p>
                  <Button
                    primary
                    disabled={!pending.length}
                    onClick={() => setReviewId(pending[0]?.id || "")}
                  >
                    Review next change →
                  </Button>
                  <div className="mini-stat">
                    <span>Products in this workspace</span>
                    <strong>{productCount}</strong>
                  </div>
                  <div className="mini-stat">
                    <span>Applied improvements</span>
                    <strong>
                      {d.appliedCount}
                    </strong>
                  </div>
                </section>
              </div>
              <section className="card">
                <div className="card-head">
                  <SectionHeading title="Ready for a closer look"/>
                  <Link className="text-link" to="/app/audit">
                    View all improvements →
                  </Link>
                </div>
                {changesTable(pending.slice(0, 5))}
              </section>
              <div className="two-cols">
                <section className="card">
                  <SectionHeading title="Recent activity"/>
                  {d.events.slice(0, 5).map((e) => (
                    <div className="activity" key={e.id}>
                      <span className="activity-dot" />
                      <div>
                        <strong>{e.message}</strong>
                        <small>{date(e.createdAt)}</small>
                      </div>
                    </div>
                  ))}
                  {!d.events.length && (
                    <p className="muted">Your changes will appear here.</p>
                  )}
                </section>
                <section className="card">
                  <SectionHeading title="Connect the full picture"/>
                  <p className="muted">
                    Bring search queries, landing-page traffic and independent
                    AI samples into one workspace.
                  </p>
                  <div className="integration-pills">
                    <span>Search Console</span>
                    <span>GA4</span>
                    <span>Bing</span>
                  </div>
                  <Link className="text-link" to="/app/settings">
                    Manage connections →
                  </Link>
                </section>
              </div>
            </>
          )}
          {section === "audit" && (
            <>
              <div className="metrics-grid">
                <Metric
                  label="SEO baseline"
                  value={audit ? String(audit.score) : "—"}
                  caption="Catalogue checks, scored out of 100"
                />
                <Metric
                  label="Catalogue records checked"
                  value={String(audit?.resourceCount || 0)}
                  caption="Products, collections, pages and articles"
                />
                <Metric
                  label="Finding occurrences"
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
                    <option value="all">All finding types</option>
                    {[...new Set(issues.map(i => i.code))].sort().map(code =>
                      <option key={code} value={code}>{code} ({issues.filter(i => i.code === code).length})</option>)}
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
                <p>{filteredIssues.length} of {issues.length} finding occurrences shown. Repeated findings across pages are counted separately.</p>
                <p>{audit?.resourceCount || 0} catalogue records checked; {coverage.storefront || 0} live storefront pages inspected (crawl limit: {coverage.crawlLimit ?? "not applicable"}). The catalogue score excludes live schema and link checks and is not a ranking score.</p>
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
                                {i.severity}
                              </Badge>
                            </td>
                            <td>
                              <strong>{i.title}</strong>
                              <small>{i.detail}</small>
                            </td>
                            <td>
                              {action.kind === 'facts' ? <Button onClick={()=>setFactId(i.resourceId)}>Confirm product facts</Button>
                                : action.kind === 'generate' ? <>
                                  {progress.changeId && <Button onClick={()=>{setPreviewTab('after');setReviewId(progress.changeId!);}}>{d.changes.find(c=>c.id===progress.changeId)?.status==='pending' ? 'Review fix' : 'View change'}</Button>}
                                  {progress.canGenerate && <Button disabled={busy || progress.busy} onClick={()=>{
                                    setActiveIssue(key); openedChange.current=''; optimise([i.resourceId],i.feature!,Boolean(progress.message));
                                  }}>{busy && activeIssue===key ? 'Queuing…' : progress.message ? 'Generate again' : 'Generate fix'}</Button>}
                                </> : <strong>{action.label}</strong>}
                              {action.detail && <p className="muted" style={{maxWidth:360}}>{action.detail}</p>}
                              {(progress.message || activeIssue===key) && action.kind==='generate' && <div role="status" aria-live="polite" style={{maxWidth:360,marginTop:8}}>
                                {activeIssue===key && fetcher.data?.ok===false ? fetcher.data.message : progress.message || (activeIssue===key ? generationMessage : '')}
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
                  <fetcher.Form method="post">
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
                  label="Answer-ready facts"
                  value={`${audit?.aeoScore || 0}%`}
                  caption="Dimensions, weight, materials and included items"
                />
                <Metric
                  label="AI mention rate"
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
                      ✓ FAQs displayed visibly alongside their structured data
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
                  <fetcher.Form method="post">
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
                  Research candidates, not verified placements. Check relevance,
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
              <div className="metrics-grid">
                <Metric
                  label="Organic search clicks"
                  value={clicks === undefined ? "—" : String(clicks)}
                  caption="Search Console · last complete 28 days"
                />
                <Metric
                  label="Organic sessions"
                  value={organic === undefined ? "—" : String(organic)}
                  caption="GA4 · Organic Search channel"
                />
                <Metric
                  label="Organic revenue"
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
                  caption="Full history with rollback"
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
                {newestMetrics("merchant")[0]?.products?.map((p: {name:string;title?:string;offerId:string;missing:string[]}) => (
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
              <section className="card">
                <SectionHeading title="Mobile template performance"/>
                <fetcher.Form method="post" className="inline-form">
                  <input type="hidden" name="intent" value="pagespeed" />
                  <input
                    aria-label="Store page URL"
                    name="url"
                    defaultValue={d.domain}
                    type="url"
                    required
                  />
                  <button className="button" disabled={d.demo}>
                    Run PageSpeed check
                  </button>
                </fetcher.Form>
                {newestMetrics("pagespeed").map((m: {url:string;score:number}) => (
                  <p key={m.url}>
                    {m.url}: performance {Math.round(m.score * 100)}/100. Lab
                    measurement; field data may be unavailable.
                  </p>
                ))}
              </section>
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
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="settings" />
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
      <dialog
        ref={dialog}
        className="review-dialog"
        onClose={() => setReviewId("")}
      >
        <div className="dialog-head">
          <div>
            <span className="eyebrow">CHANGE PREVIEW</span>
            <h2>{reviewResource?.title || "Review change"}</h2>
          </div>
          <button
            aria-label="Close preview"
            className="close"
            onClick={() => setReviewId("")}
          >
            ×
          </button>
        </div>
        {review && (
          <>
            <Guidance title="Change preview"/>
            <div className="preview-meta">
              <Badge>{labels[review.feature]}</Badge>
              <Badge>{review.status}</Badge>
              {["title","seo"].includes(review.feature) && <span>{review.feature === "seo" ? "Search title only; the visible page title stays unchanged." : "Updates the visible page title."} Maximum five words.</span>}
            </div>
            {staleTitle && review.status === "pending" && <div className="notice warning"><p>This saved proposal exceeds the current five-word title limit. It cannot be applied. Generate a replacement to review.</p><Button disabled={busy} onClick={()=>{optimise([review.resourceId],review.feature,true);setReviewId("");}}>Generate shorter replacement</Button></div>}
            {JSON.parse(review.blockers).length > 0 && (
              <div className="notice warning">
                <strong>This proposal needs attention</strong>
                <ul>
                  {JSON.parse(review.blockers).map((b: string) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                {review.status === "pending" && <Button disabled={busy} onClick={() => {optimise([review.resourceId],review.feature,true);setReviewId("");}}>Generate replacement</Button>}
                <Button
                  onClick={() => {
                    setFactId(review.resourceId);
                    setReviewId("");
                  }}
                >
                  Edit product facts
                </Button>
              </div>
            )}
            {review.feature === "alt" && reviewPayload?.images?.map((img:{id:string;url:string;alt:string}) => (
              <figure key={img.id}><img src={img.url} alt={img.alt || "Image awaiting an alt description"} style={{maxWidth:240,maxHeight:180}} /><figcaption>Image on this page</figcaption></figure>
            ))}
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
              <ChangeValues feature={review.feature} value={reviewValue}/>
            )}
            <h3>Google snippet preview</h3><Guidance title="Google snippet preview"/>
            <div className="snippet">
              <div>Van Life Emporium</div>
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
                    "No explicit meta description has been set."}
              </p>
            </div>
            <small className="muted">
              Illustrative only. Google can choose a different title or snippet.
            </small>
            <ul className="reasons">
              {JSON.parse(review.reasons).map((r: string) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {review.error && <div className="notice error">{review.error}</div>}
            {['approved','applying'].includes(review.status) && <p role="status">Accepted. Applying and verifying in Shopify…</p>}
            {review.status==='applied' && <p role="status">Applied. Future changes still require your acceptance.</p>}
            {fetcher.data?.ok===false && <p role="alert">{fetcher.data.message}</p>}
            <div className="dialog-actions">
              {review.status === "pending" && (
                <>
                  <Button
                    onClick={() => {
                      submit("reject", { id: review.id });
                      setReviewId("");
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    primary
                    disabled={busy || Boolean(staleTitle) || JSON.parse(review.blockers).length > 0}
                    onClick={() => {
                      submit("approve", { id: review.id });
                    }}
                  >
                    {d.demo ? "Approve demo change" : "Accept and apply"}
                  </Button>
                </>
              )}
              {['apply_failed','verification_failed','rollback_failed'].includes(review.status) && d.jobs.filter(j=>{
                try{return ['apply','rollback'].includes(j.kind) && j.status==='failed' && JSON.parse(j.payload).changeId===review.id;}catch{return false;}
              }).slice(0,1).map(j=><Button key={j.id} disabled={busy} onClick={()=>submit('retry',{id:j.id})}>Retry and verify</Button>)}
              {review.status === "applied" && (
                <Button
                  onClick={() => {
                    submit("rollback", { id: review.id });
                    setReviewId("");
                  }}
                >
                  Roll back this change
                </Button>
              )}
            </div>
          </>
        )}
      </dialog>
      <dialog
        ref={factsDialog}
        className="review-dialog"
        onClose={() => setFactId("")}
      >
        <div className="dialog-head">
          <h2>{factResource?.title}</h2>
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
          >
            <Guidance title="Product facts"/><input
              type="hidden"
              name="intent"
              value={factResource.kind === "product" ? "facts" : "keyword"}
            />
            <input type="hidden" name="id" value={factResource.id} />
            <label>
              Primary keyword
              <input name="keyword" defaultValue={factResource.keyword} />
            </label>
            {factResource.kind === "product" && (
              <>
                <p className="muted">
                  Use an exact supplier specification or a verified source.
                  Confirm only what you have checked. Saving facts supersedes
                  pending copy previews so you can regenerate them.
                </p>
                <Button disabled={busy || resourceDetail.state!=="idle"} onClick={()=>{setFactMessage("");submit("suggestFacts",{id:factResource.id});}}>Auto-populate empty fields & keyword</Button>
                <p role="status">{busy ? "Working…" : factMessage}</p>
                {fetcher.data?.ok===false && <p role="alert">{fetcher.data.message}</p>}
                {Object.entries(factLabels).map(([k, label]) => {
                  const f: Facts = JSON.parse(factResource.facts);
                  return (
                    <div className="fact-field" key={k}><details><summary>Why add {label.toLowerCase()}?</summary><p>This gives customers a specific answer about the product. Copy an accurate value from the description or supplier document, add its source and confirm only after checking. Leave it blank when unknown.</p></details>
                      <label>
                        {label}
                        <input name={k} defaultValue={f[k]?.value || ""} />
                      </label>
                      <label>
                        Source
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
                        Verified against this source
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
            <div className="dialog-actions">
              <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save facts & keyword"}</button>
            </div>
          </fetcher.Form>
        )}
      </dialog>
    </div>
  );
}

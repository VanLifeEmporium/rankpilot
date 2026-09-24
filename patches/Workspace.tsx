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
  "Products",
  "Collections",
  "Content",
  "AEO",
  "Reports",
  "Settings",
];
const icons = ["◈", "⊞", "▣", "▦", "▤", "✳", "▥", "⚙"];
const date = (s: string | Date) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const show = (v: unknown) =>
  typeof v === "string" ? v : JSON.stringify(v, null, 2);
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
      <small>{caption}</small>
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
  const fetcher = useFetcher<{ ok: boolean; message: string; changeId?: string; jobId?: string }>();
  const revalidator = useRevalidator();
  const formAction = useFormAction();
  const [collection, setCollection] = useState("All collections");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [feature, setFeature] = useState("seo");
  const [reviewId, setReviewId] = useState("");
  const [activeIssue, setActiveIssue] = useState<number | null>(null);
  const openedChange = useRef("");
  const [factId, setFactId] = useState("");
  const [severity, setSeverity] = useState("all");
  const [issueQuery, setIssueQuery] = useState("");
  const [issueCode, setIssueCode] = useState("all");
  const [previewTab, setPreviewTab] = useState("after");
  const dialog = useRef<HTMLDialogElement>(null);
  const factsDialog = useRef<HTMLDialogElement>(null);
  const submit = (intent: string, extra: Record<string, string> = {}) =>
    fetcher.submit(
      { intent, ...extra },
      { method: "post", action: formAction },
    );
  const running = d.jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => revalidator.revalidate(), 2500);
    return () => clearInterval(t);
  }, [running, revalidator]);
  useEffect(() => {
    setSelected([]);
    setQuery("");
  }, [section]);
  useEffect(() => {
    if (reviewId) dialog.current?.showModal();
    else dialog.current?.close();
  }, [reviewId]);
  useEffect(() => {
    if (factId) factsDialog.current?.showModal();
    else factsDialog.current?.close();
  }, [factId]);
  const requestedJob = d.jobs.find(j => j.id === fetcher.data?.jobId);
  const jobResults: {changeId?:string;message?:string;error?:string}[] = requestedJob ? readJobResults(requestedJob) : [];
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
  const factResource = d.resources.find((r) => r.id === factId);
  const reviewResource =
    review && d.resources.find((r) => r.id === review.resourceId);
  const reviewValue = review
    ? JSON.parse(previewTab === "before" ? review.before : review.after)
    : null;
  const reviewPayload = reviewResource
    ? JSON.parse(reviewResource.payload)
    : null;
  const productCount = products.length;
  const optimise = (ids: string[], f = feature) =>
    submit("optimise", { ids: JSON.stringify(ids), feature: f });
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
  const title = nav.find((n) => n.toLowerCase() === section) || "Dashboard";
  const newestMetrics = (provider: string) => metricPair(d.metrics, provider);
  const gsc = newestMetrics("gsc");
  const ga = newestMetrics("ga4");
  const clicks = gsc[0]?.rows?.reduce(
    (sum: number, r: any) => sum + r.clicks,
    0,
  );
  const organic = ga[0]?.rows?.reduce(
    (sum: number, r: any) => sum + Number(r.metricValues?.[0]?.value || 0),
    0,
  );
  const revenue = ga[0]?.rows?.reduce(
    (sum: number, r: any) => sum + Number(r.metricValues?.[1]?.value || 0),
    0,
  );
  const mentionRate = d.observations.length
    ? Math.round(
        (d.observations.filter((o) => o.mentioned).length /
          d.observations.length) *
          100,
      )
    : null;
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
        <div className="bulk-bar">
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
        <s-section heading="Keyword opportunities">
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
              aria-label={n}
              to={i === 0 ? "/app" : `/app/${n.toLowerCase()}`}
              className={section === n.toLowerCase() ? "active" : ""}
            >
              <span>{icons[i]}</span>
              {n}
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
                {title === "Dashboard" ? "A clearer road to discovery" : title}
              </h1>
              <p>
                {
                  (
                    {
                      dashboard:
                        "Your search visibility, the work behind it, and what to do next.",
                      audit:
                        "Prioritised checks across your catalogue and storefront.",
                      products:
                        "Turn supplier copy into useful, considered product pages.",
                      collections:
                        "Give each collection a clear purpose in search.",
                      content:
                        "Useful guides for life on the road. Always saved as drafts.",
                      aeo: "Make the facts easy to find, understand and cite.",
                      reports: "Follow the changes. Measure what happens next.",
                      settings:
                        "Decide what runs automatically and what needs your review.",
                    } as Record<string, string>
                  )[section]
                }
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
                disabled={busy || running}
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
                      <h2>Make the useful details visible</h2>
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
                            products.map((p) => p.id),
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
                  <span className="eyebrow">REVIEW QUEUE</span>
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
                      {d.changes.filter((c) => c.status === "applied").length}
                    </strong>
                  </div>
                </section>
              </div>
              <section className="card">
                <div className="card-head">
                  <h2>Ready for a closer look</h2>
                  <Link className="text-link" to="/app/audit">
                    View all improvements →
                  </Link>
                </div>
                {changesTable(pending.slice(0, 5))}
              </section>
              <div className="two-cols">
                <section className="card">
                  <h2>Recent activity</h2>
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
                  <h2>Connect the full picture</h2>
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
                  caption="Nothing publishes without a rule or review"
                />
              </div>
              <section className="card">
                <div className="card-head">
                  <h2>Prioritised fix-it list</h2>
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
                      {filteredIssues.map((i, index) => (
                          <tr key={index}>
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
                              {i.feature ? (
                                <Button
                                  disabled={busy}
                                  onClick={() => {
                                    setActiveIssue(index);
                                    openedChange.current = "";
                                    optimise([i.resourceId], i.feature);
                                  }}
                                >
                                  {busy && activeIssue === index ? "Checking…" : "Generate fix"}
                                </Button>
                              ) : (
                                <small>
                                  <strong>Manual review</strong>
                                  {i.detail.includes("404")
                                    ? "Choose a relevant live destination, then update the link or create a redirect."
                                    : /Organization|schema|entity/i.test(i.detail)
                                      ? "Inspect the theme and app schema sources before removing any markup."
                                      : /heading/i.test(i.detail)
                                        ? "Inspect the article and theme headings; correct the level that skips the hierarchy."
                                        : "Review this finding in the page or theme editor. No automatic fix is available."}
                                </small>
                              )}
                              {activeIssue === index && (
                                <div role="status" aria-live="polite" style={{ maxWidth: 320, marginTop: 8 }}>
                                  {busy ? "Checking this item…" : generationMessage}
                                  {!busy && generatedChangeId && (
                                    <Button onClick={() => setReviewId(generatedChangeId!)}>{d.changes.find(c => c.id === generatedChangeId)?.status === "pending" ? "Review proposal" : "View change"}</Button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
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
                <h2>Approval queue</h2>
                {changesTable()}
              </section>
              <section className="card">
                <h2>Recent jobs</h2>
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
                <s-section heading="Repair a collection redirect">
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
                          {d.resources.filter((r:any) => r.kind === "collection").map((r:any) => <option key={r.id} value={`/collections/${r.handle}`}>{r.title}</option>)}
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
                <h2>Your content plan</h2>
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
                <h2>Pages & articles</h2>
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
                  <h2>Schema without duplication</h2>
                  <p>
                    Enable the RankPilot app embed in Shopify’s theme editor. It
                    checks existing JSON-LD and yields to the theme and
                    Judge.me.
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
                  {d.discoveries.schemas?.map((s: any) => (
                    <p key={s.url}>
                      <small>{s.url}</small>
                      <span className="keyword">
                        {s.types.join(", ") || "No JSON-LD types detected"}
                      </span>
                    </p>
                  ))}
                </section>
                <section className="card">
                  <h2>AI crawler readiness</h2>
                  {d.discoveries.robots?.length ? (
                    d.discoveries.robots.map((r: any) => (
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
                  <h2>Store discovery file</h2>
                  <Link
                    className="button"
                    reloadDocument
                    to="/app/export?type=llms"
                  >
                    Download llms.txt draft
                  </Link>
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
                    <h2>Independent answer-engine samples</h2>
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
                <h2>Authority opportunities</h2>
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
                    d.changes.filter((c) => c.status === "applied").length,
                  )}
                  caption="Full history with rollback"
                />
              </div>
              <div className="two-cols">
                <section className="card">
                  <div className="card-head">
                    <h2>Weekly reports</h2>
                    <Button onClick={() => submit("report")} disabled={busy}>
                      Generate report
                    </Button>
                  </div>
                  {d.reports.map((r) => (
                    <div className="mini-stat" key={r.id}>
                      <span>{date(r.createdAt)}</span>
                      <Link
                        className="text-link"
                        reloadDocument
                        to={`/app/export?id=${r.id}`}
                      >
                        Download report ↓
                      </Link>
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
                  <h2>Analytics connections</h2>
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
                <h2>Top-gaining pages</h2>
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
                <h2>AI visibility over time</h2>
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
                <h2>Connection activity</h2>
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
                <h2>Merchant feed completeness</h2>
                {newestMetrics("merchant")[0]?.products?.map((p: any) => (
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
                <h2>Mobile template performance</h2>
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
                {newestMetrics("pagespeed").map((m: any) => (
                  <p key={m.url}>
                    {m.url}: performance {Math.round(m.score * 100)}/100. Lab
                    measurement; field data may be unavailable.
                  </p>
                ))}
              </section>
              <section className="card">
                <div className="card-head">
                  <h2>Version history</h2>
                  <Link
                    className="text-link"
                    reloadDocument
                    to="/app/export?type=changes"
                  >
                    Export full history ↓
                  </Link>
                </div>
                {changesTable(d.changes)}
              </section>
            </>
          )}
          {section === "settings" && (
            <>
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="settings" />
                <section className="card">
                  <h2>Automation, on your terms</h2>
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
                  <h2>Reporting & monitoring</h2>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="weekly"
                      defaultChecked={d.settings.weekly}
                    />
                    Run weekly audits, analytics refresh, AI sampling and a
                    report
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      name="requeue"
                      defaultChecked={d.settings.requeue}
                    />
                    Re-queue pages with at least a 25% click drop, 100 prior
                    impressions and 10 prior clicks
                  </label>
                  <p className="muted">
                    A 28-day cooldown avoids repeatedly rewriting the same page.
                    Weekly API calls may incur provider charges.
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
                      Shopify blog ID
                      <input
                        name="blogId"
                        placeholder="gid://shopify/Blog/…"
                        defaultValue={d.settings.blogId}
                      />
                    </label>
                  </div>
                  {d.discoveries.blogs?.map((b: any) => (
                    <small key={b.id}>
                      {b.title}: {b.id}
                    </small>
                  ))}
                </section>
                <section className="card">
                  <h2>Verified delivery & returns wording</h2>
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
                <h2>Secure connections</h2>
                <div className="integration-pills">
                  {[
                    "Google",
                    "Bing",
                    "PageSpeed",
                    "OpenAI",
                    "Perplexity",
                    "Gemini",
                  ].map((name) => (
                    <span key={name}>
                      {name} ·{" "}
                      {d.credentialNames.some((k) =>
                        k.toLowerCase().startsWith(name.toLowerCase()),
                      )
                        ? "Configured"
                        : "Not connected"}
                    </span>
                  ))}
                </div>
                <p>
                  Keys are encrypted on the server and are never returned to the
                  browser. A configured key still needs a successful API request
                  to verify access.
                </p>
                {d.demo ? (
                  <div className="notice">
                    Real credentials are disabled in demo mode. Follow the
                    installation guide in the source package to run a live
                    instance.
                  </div>
                ) : (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="credentials" />
                    <label>
                      Credential update (JSON)
                      <textarea
                        name="credentials"
                        rows={7}
                        placeholder={
                          '{"openaiKey":"…","googleServiceAccount":"{…}"}'
                        }
                        required
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <p className="muted">
                      Accepted keys: googleServiceAccount, googleClientId,
                      googleClientSecret, googleRefreshToken, bingKey,
                      pagespeedKey, openaiKey, openaiModel, perplexityKey,
                      perplexityModel, geminiKey, geminiModel. Empty values
                      remove a key.
                    </p>
                    <button className="button primary">
                      Encrypt and save credentials
                    </button>
                  </fetcher.Form>
                )}
              </section>
              <section className="card">
                <h2>Installation checklist</h2>
                <ol className="install-list">
                  <li>
                    Create RankPilot in the Shopify Dev Dashboard and select
                    custom distribution for your store.
                  </li>
                  <li>
                    Set the app URL, OAuth redirect URLs and environment secrets
                    on an HTTPS Node host.
                  </li>
                  <li>
                    Link and deploy the app configuration with Shopify CLI.
                    Install it in Van Life Emporium.
                  </li>
                  <li>
                    Enable the RankPilot theme app embed. Verify any shipping
                    and returns values before enabling their schema.
                  </li>
                  <li>
                    Connect read-only analytics and the AI APIs you want to
                    sample. Run the first live audit and review the results.
                  </li>
                </ol>
                <p className="muted">
                  The downloadable source package includes exact commands,
                  credentials, tests and deployment notes.
                </p>
                <p>
                  FAQ metafield namespace:{" "}
                  <code>
                    {d.resources
                      .map((r) => JSON.parse(r.payload).faqNamespace)
                      .find(Boolean) ||
                      "Apply your first FAQ and run a fresh audit to retrieve the namespace."}
                  </code>
                </p>
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
            <div className="preview-meta">
              <Badge>{labels[review.feature]}</Badge>
              <Badge>{review.status}</Badge>
            </div>
            {JSON.parse(review.blockers).length > 0 && (
              <div className="notice warning">
                <strong>Confirm these details first</strong>
                <ul>
                  {JSON.parse(review.blockers).map((b: string) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
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
            {review.feature === "alt" && reviewPayload?.images?.map((img:any) => (
              <figure key={img.id}><img src={img.url} alt={img.alt || "Image awaiting an alt description"} style={{maxWidth:240,maxHeight:180}} /><figcaption>{img.id}</figcaption></figure>
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
              <pre className={"diff " + previewTab}>
                {show(
                  JSON.parse(
                    previewTab === "before" ? review.before : review.after,
                  ),
                )}
              </pre>
            )}
            <h3>Google snippet preview</h3>
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
                    disabled={busy || JSON.parse(review.blockers).length > 0}
                    onClick={() => {
                      submit("approve", { id: review.id });
                      setReviewId("");
                    }}
                  >
                    {d.demo ? "Approve demo change" : "Approve change"}
                  </Button>
                </>
              )}
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
            onSubmit={() => setFactId("")}
          >
            <input
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
                {Object.entries(factLabels).map(([k, label]) => {
                  const f: Facts = JSON.parse(factResource.facts);
                  return (
                    <div className="fact-field" key={k}>
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
                  <pre>{JSON.parse(factResource.payload).descriptionHtml}</pre>
                </details>
              </>
            )}
            <div className="dialog-actions">
              <button className="button primary">Save facts & keyword</button>
            </div>
          </fetcher.Form>
        )}
      </dialog>
    </div>
  );
}

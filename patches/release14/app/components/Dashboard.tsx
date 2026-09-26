import {speedRecommendations,type SpeedResult} from '../core/performance';
import {ScoreBoard,StoreProgress} from './ScoreBoard';
import {findingImpact,findingName} from '../core/merchant-copy';
import {TrafficTrend} from './TrafficTrend';
import {useState,useEffect} from 'react';
import {Link,useSearchParams} from 'react-router';
import type {loadUI} from '../core/ui.server';
import type {Issue} from '../core/types';
import {actionGroups,opportunityQueries} from '../core/dashboard';
import {metricPair} from '../core/analytics';
import {BatchReview} from './BatchReview';
import {reviewable} from '../core/workflow-ui';
type Data=Awaited<ReturnType<typeof loadUI>>;
export function Dashboard({d,issues,busy,onFix,onReview,onReviewReady}:{d:Data;issues:Issue[];busy:boolean;onFix:(issues:Issue[])=>void;onReview:(id:string)=>void;onReviewReady:()=>void}){
 const [params]=useSearchParams();const [all,setAll]=useState(false);const [queue,setQueue]=useState(params.get('review')==='ready');
 useEffect(()=>{if(queue){const panel=document.getElementById('dashboard-review');panel?.scrollIntoView({block:'start'});panel?.focus();}},[queue]);
 const ready=d.changes.filter(c=>c.status==='pending'&&reviewable(c));
 const groups=actionGroups(issues);const latest=d.audits[0];
 const gsc=metricPair(d.metrics,'gsc')[0];
 const measuredAt=Date.parse(d.measuredAt);
 const samples=d.observations.filter(o=>measuredAt-new Date(o.createdAt).getTime()<=28*86400000);
 const competitors=new Map<string,number>();for(const o of samples.filter(o=>!o.cited)){try{for(const c of JSON.parse(o.competitors))if(typeof c==='string')competitors.set(c,(competitors.get(c)||0)+1);}catch{/* no structured evidence */}}
 const competitor=[...competitors].sort((a,b)=>b[1]-a[1])[0];
 const opportunities=opportunityQueries(gsc?.rows);
 const speed=metricPair(d.metrics,'pagespeed')[0] as SpeedResult|undefined;const speedFixes=speed?speedRecommendations(speed).slice(0,3):[];
 const sampling=metricPair(d.metrics,'ai-sampling')[0];
 const coverage=latest?JSON.parse(latest.coverage):{};
 return <>
 <ScoreBoard d={d}/>
 <h2 className="action-track-heading">Action &amp; track</h2>
 <div className="dashboard-grid">
 <section className="card"><div className="card-head"><h2>Fix these next</h2><button className="button" onClick={onReviewReady}>Review ready fixes ({ready.length})</button>{ready.length>0&&<button className="button" onClick={()=>setQueue(true)}>Review as a set</button>}</div><p className="muted">Ready fixes are prepared proposals; issue groups contain checks that may still need a proposal. Clear failures first, then useful improvements. Nothing is published until you approve.</p>{coverage.lastLinkRecheck&&<p role="status">Latest link check: {coverage.lastLinkRecheck.address} · {coverage.lastLinkRecheck.resolved?`${coverage.lastLinkRecheck.removed} findings cleared after a successful live check.`:`Still needs attention${coverage.lastLinkRecheck.status?` (HTTP ${coverage.lastLinkRecheck.status})`:""}; findings retained.`} Checked {new Date(coverage.lastLinkRecheck.checkedAt).toLocaleString("en-GB")}.</p>}
 {(all?groups:groups.slice(0,5)).map(g=>{const ids=[...new Set(g.items.map(i=>i.resourceId))];const proposals=ready.filter(c=>ids.includes(c.resourceId)&&g.items.some(i=>i.feature===c.feature));return <div className="priority" key={g.key}><span className={'badge '+(g.priority===0?'red':g.priority<3?'amber':'neutral')}>{g.priority===0?'High':g.priority<3?'Medium':'Optional'}</span><div><h3>{g.code==='google-listings'?'Improve Google titles and summaries':findingName(g.code)}</h3>{g.destination&&<p>Shared destination: {g.destination}</p>}<p className="muted">{findingImpact(g.items[0]).impact} · {findingImpact(g.items[0]).effort}</p><small>{g.count} affected {g.count===1?'page':'pages'} · {g.items.length} fixes · {g.occurrences} checks</small><details><summary>Why and how to fix</summary><p>{g.items[0].detail}</p><Link to={`/app/audit?finding=${encodeURIComponent(g.items[0].code)}`}>See affected pages and evidence</Link></details></div><button className="button" disabled={busy} onClick={()=>onFix([...g.items].sort((a,b)=>Number(proposals.some(c=>c.resourceId===b.resourceId&&c.feature===b.feature))-Number(proposals.some(c=>c.resourceId===a.resourceId&&c.feature===a.feature))))}>{proposals.length?`Review a fix (${proposals.length})`:'Inspect & fix'}</button></div>})}
 {speedFixes.length>0&&<details><summary>Speed improvements from your latest test ({speedFixes.length})</summary>{speedFixes.map(a=><div className="priority" key={a.id}><div><h3>{a.title}</h3><p>{a.details?.overallSavingsMs?`${Math.round(a.details.overallSavingsMs)} ms estimated saving in this test`:a.displayValue||"Inspect the affected resource"}. Score-point impact is unmeasured.</p></div><Link className="button" to="/app/reports#page-speed">Review theme fix</Link></div>)}</details>}{!groups.length&&<p>{latest?'No findings in the completed checks. Review scan coverage before assuming every page is healthy.':'Run your first scan to prioritise fixes.'}</p>}
 {groups.length>5&&<button className="text-link" onClick={()=>setAll(!all)}>{all?'Show top five':`See all ${groups.length} issue groups`}</button>}
 <p><Link to="/app/audit#technical-tools">Manage broken URLs and technical checks</Link> · <Link to="/app/reports#page-speed">Check page speed</Link></p>
 {opportunities.length>0&&<p><Link to="/app/reports">Explore {opportunities.length} searches at positions 8–20</Link></p>}
 </section>
 <section className="card"><h2>AI answer engines</h2>{[['openai','ChatGPT API'],['perplexity','Perplexity'],['gemini','Gemini'],['Google AI Overviews','Google AI Overviews']].map(([key,label])=>{const rows=samples.filter(o=>o.engine===key);return <div className="mini-stat" key={key}><span>{label}</span><strong>{sampling?.engines?.[key]?.failed && !sampling?.engines?.[key]?.completed?'Check unavailable':rows.length?`Cited ${rows.filter(o=>o.cited).length}/${rows.length}`:'Not measured'}</strong>{rows.length>0&&<small>{new Date(rows[0].createdAt).toLocaleDateString('en-GB')} · {rows.length} successful samples</small>}</div>})}<p>API samples are dated observations, not consumer search rankings. Google AI Overviews requires a separate observation source.</p><p>{competitor?`Most frequently recorded alternative: ${competitor[0]} (${competitor[1]} samples).`:'No competing citations recorded yet.'}</p><Link className="button" to="/app/aeo">Explore AI visibility &amp; FAQs</Link><p className="muted">Crawler access and confirmed product details are checked separately.</p></section>
 </div>
 
 {queue&&<section id="dashboard-review" tabIndex={-1} aria-label="Review and approve a set"><h2>Review and approve here</h2><BatchReview changes={ready} resources={d.resources}/>{ready.map(c=><div className="mini-stat" key={c.id}><span>{d.resources.find(r=>r.id===c.resourceId)?.title||'Page'}</span><button className="button" onClick={()=>onReview(c.id)}>Review</button></div>)}{!ready.length&&<p>No ready previews. Generate a fix above to start.</p>}<details><summary>Older drafts and work in progress</summary>{d.changes.filter(c=>!reviewable(c)&&!['applied','rejected','rolled_back','superseded'].includes(c.status)).map(c=><p key={c.id}>{d.resources.find(r=>r.id===c.resourceId)?.title}<button className="button" onClick={()=>onReview(c.id)}>Open details</button></p>)}</details></section>}
 <TrafficTrend daily={metricPair(d.metrics,'gsc-daily')[0]} observations={d.observations}/>
 <StoreProgress d={d}/>
 <details className="card"><summary>How to use this dashboard and what has been checked</summary><p>Start with one of the five priority groups. Generate a preview, check the proposed change, then approve it here. Use the product, collection and blog tiles for individual pages; open AI visibility for FAQs and recorded answers. Saved changes and undo options are in Results &amp; history.</p><p>{latest?`${coverage.catalogue||0} catalogue records and ${coverage.storefront||0} live pages checked. ${coverage.linkChecks?.checked||0} link destinations tested.`:'No completed audit yet.'}</p><p>{coverage.linkChecks?.skipped?`${coverage.linkChecks.skipped} link destinations were outside this scan’s limits. `:''}{coverage.linkChecks?.unavailable?`${coverage.linkChecks.unavailable} destinations could not be confirmed. `:''}Historical missing addresses are checked when you import them. Technical health counts catalogue checks. Search visibility uses the dated Search Console observations shown above; missing data stays unmeasured.</p><Link to="/app/audit">Open all checks, missing URLs and technical fixes</Link></details>
 </>;
}

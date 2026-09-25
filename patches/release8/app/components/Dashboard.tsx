import {TrafficTrend} from './TrafficTrend';
import {useState} from 'react';
import {Link} from 'react-router';
import type {loadUI} from '../core/ui.server';
import type {Issue} from '../core/types';
import {actionGroups,resourceHealth,opportunityQueries} from '../core/dashboard';
import {findingName} from '../core/merchant-copy';
import {metricPair} from '../core/analytics';
import {BatchReview} from './BatchReview';
import {reviewable} from '../core/workflow-ui';
type Data=Awaited<ReturnType<typeof loadUI>>;
export function Dashboard({d,issues,busy,onGenerate,onReview}:{d:Data;issues:Issue[];busy:boolean;onGenerate:(ids:string[],feature:string)=>void;onReview:(id:string)=>void}){
 const [all,setAll]=useState(false);const [queue,setQueue]=useState(false);
 const ready=d.changes.filter(c=>c.status==='pending'&&reviewable(c));
 const groups=actionGroups(issues);const latest=d.audits[0];
 const ga=metricPair(d.metrics,'ga4')[0];const ai=metricPair(d.metrics,'ga4-ai')[0];const gsc=metricPair(d.metrics,'gsc')[0];
 const money=(m:typeof ga)=>m?.rows ? new Intl.NumberFormat('en-GB',{style:'currency',currency:m.currency||'GBP'}).format(m.rows.reduce((n:number,r:{metricValues?:{value:string}[]})=>n+Number(r.metricValues?.[1]?.value||0),0)):'Not measured';
 const samples=d.observations;const cited=samples.filter(o=>o.cited).length;
 const competitors=new Map<string,number>();for(const o of samples.filter(o=>!o.cited)){try{for(const c of JSON.parse(o.competitors))if(typeof c==='string')competitors.set(c,(competitors.get(c)||0)+1);}catch{/* no structured evidence */}}
 const competitor=[...competitors].sort((a,b)=>b[1]-a[1])[0];
 const opportunities=opportunityQueries(gsc?.rows);
 const trend=[...d.audits].reverse();
 const coverage=latest?JSON.parse(latest.coverage):{};
 return <>
 <div className="metrics-grid dashboard-metrics">
 <div className="metric"><div>Store health</div><strong>{latest?`${latest.score}/100`:'Not checked'}</strong><small>Catalogue score. Live website findings appear below; unchecked pages are not a pass.</small></div>
 <Link className="metric metric-link" to="/app/aeo"><div>AI visibility ↗</div><strong>{samples.length?`${Math.round(100*cited/samples.length)}%`:'Not measured'}</strong><small>{cited} cited answers / {samples.length} recorded samples. Open FAQs and AI visibility.</small></Link>
 <div className="metric"><div>Organic revenue</div><strong>{money(ga)}</strong><small>{ga?.start?`${ga.start} to ${ga.end} · Google Analytics attribution`:'Connect Google Analytics in Settings'}</small></div>
 <div className="metric"><div>AI referral revenue</div><strong>{money(ai)}</strong><small>{ai?.start?`${ai.start} to ${ai.end} · identifiable AI referrals in Analytics`:'Refresh connected analytics to measure identifiable AI referrals'}</small></div>
 </div>
 <div className="dashboard-grid">
 <section className="card"><div className="card-head"><h2>Fix these next</h2><button className="button" onClick={()=>setQueue(!queue)}>Review ready fixes ({ready.length})</button></div><p className="muted">Clear failures first, then useful improvements. Nothing is published until you approve.</p>
 {(all?groups:groups.slice(0,5)).map(g=>{const ids=[...new Set(g.items.map(i=>i.resourceId))];const proposals=ready.filter(c=>ids.includes(c.resourceId)&&g.items.some(i=>i.feature===c.feature));const feature=g.items[0].feature;return <div className="priority" key={g.code}><span className={'badge '+(g.priority===0?'red':g.priority<3?'amber':'neutral')}>{g.priority===0?'High':g.priority<3?'Medium':'Optional'}</span><div><h3>{g.code==='google-listings'?'Improve Google titles and summaries':findingName(g.code)}</h3><small>{g.count} affected {g.count===1?'page':'pages'}</small><details><summary>Why and how to fix</summary><p>{g.items[0].detail}</p><Link to={`/app/audit?finding=${encodeURIComponent(g.items[0].code)}`}>See affected pages and evidence</Link></details></div>{proposals.length?<button className="button" onClick={()=>onReview(proposals[0].id)}>Review ({proposals.length})</button>:feature?<button className="button" disabled={busy} onClick={()=>onGenerate(ids.slice(0,25),feature)}>Generate fixes</button>:<Link className="button" to={`/app/audit?finding=${encodeURIComponent(g.items[0].code)}`}>Inspect &amp; fix</Link>}</div>})}
 {!groups.length&&<p>{latest?'No findings in the completed checks. Review scan coverage before assuming every page is healthy.':'Run your first scan to prioritise fixes.'}</p>}
 {groups.length>5&&<button className="text-link" onClick={()=>setAll(!all)}>{all?'Show top five':`See all ${groups.length} issue groups`}</button>}
 {opportunities.length>0&&<p><Link to="/app/reports">Explore {opportunities.length} searches at positions 8–20</Link></p>}
 </section>
 <section className="card"><h2>AI answer engines</h2>{[['openai','ChatGPT API'],['perplexity','Perplexity'],['gemini','Gemini'],['Google AI Overviews','Google AI Overviews']].map(([key,label])=>{const rows=samples.filter(o=>o.engine===key);return <div className="mini-stat" key={key}><span>{label}</span><strong>{rows.length?`Cited ${rows.filter(o=>o.cited).length}/${rows.length}`:'Not measured'}</strong></div>})}<p>API samples are dated observations, not consumer search rankings. Google AI Overviews requires a separate observation source.</p><p>{competitor?`Most frequently recorded alternative: ${competitor[0]} (${competitor[1]} samples).`:'No competing citations recorded yet.'}</p><Link className="button" to="/app/aeo">Explore AI visibility &amp; FAQs</Link><p className="muted">Crawler access and confirmed product details are checked separately.</p></section>
 </div>
 {queue&&<section id="dashboard-review"><h2>Review and approve here</h2><BatchReview changes={ready} resources={d.resources}/>{ready.map(c=><div className="mini-stat" key={c.id}><span>{d.resources.find(r=>r.id===c.resourceId)?.title||'Page'}</span><button className="button" onClick={()=>onReview(c.id)}>Review</button></div>)}{!ready.length&&<p>No ready previews. Generate a fix above to start.</p>}<details><summary>Older drafts and work in progress</summary>{d.changes.filter(c=>!reviewable(c)&&!['applied','rejected','rolled_back','superseded'].includes(c.status)).map(c=><p key={c.id}>{d.resources.find(r=>r.id===c.resourceId)?.title}<button className="button" onClick={()=>onReview(c.id)}>Open details</button></p>)}</details></section>}
 <TrafficTrend daily={metricPair(d.metrics,'gsc-daily')[0]} observations={d.observations}/>
 <details className="card"><summary>Store-health score history</summary><h2>Progress over time</h2><p>Recorded store-health checks. Scores cover catalogue checks only; they do not prove changes caused more sales.</p>{trend.length>1?<><svg viewBox="0 0 800 140" role="img" aria-label="Catalogue health scores across recorded audits" style={{width:'100%',height:160}}><line x1="15" x2="785" y1="125" y2="125" stroke="#dce3df"/><polyline fill="none" stroke="#27644e" strokeWidth="3" points={trend.map((a,i)=>`${15+i*770/(trend.length-1)},${125-a.score}`).join(' ')}/></svg><div className="mini-stat"><span>{new Date(trend[0].createdAt).toLocaleDateString('en-GB')}</span><span>{new Date(trend.at(-1)!.createdAt).toLocaleDateString('en-GB')}</span></div><details><summary>View recorded scores</summary>{trend.map(a=><p key={a.id}>{new Date(a.createdAt).toLocaleString('en-GB')}: {a.score}/100</p>)}</details></>:<p>Run another audit to build a real trend. No sample trend is shown.</p>}<Link to="/app/reports">Explore traffic, revenue and change history</Link></details>
 <div className="catalogue-tiles">{[['product','Products','products'],['collection','Collections','collections'],['article','Blogs','content']].map(([kind,label,path])=>{const records=d.resources.filter(r=>r.kind===kind);const health=resourceHealth(records.map(r=>r.id),issues,!!latest);return <Link className="card catalogue-tile" to={`/app/${path}`} key={kind}><h2>{label} ↗</h2><strong>{health===null?'Not checked':`${health}%`}</strong><p>{records.length} pages · percentage without priority catalogue or recorded live-page findings.</p></Link>})}</div>
 <details className="card"><summary>How to use this dashboard and what has been checked</summary><p>Start with one of the five priority groups. Generate a preview, check the proposed change, then approve it here. Use the product, collection and blog tiles for individual pages; open AI visibility for FAQs and recorded answers. Saved changes and undo options are in Results &amp; history.</p><p>{latest?`${coverage.catalogue||0} catalogue records and ${coverage.storefront||0} live pages checked. ${coverage.linkChecks?.checked||0} link destinations tested.`:'No completed audit yet.'}</p><p>{coverage.linkChecks?.skipped?`${coverage.linkChecks.skipped} link destinations were outside this scan’s limits. `:''}{coverage.linkChecks?.unavailable?`${coverage.linkChecks.unavailable} destinations could not be confirmed. `:''}Historical missing addresses are checked when you import them. The health score measures catalogue checks; it is not a Google ranking.</p><Link to="/app/audit">Open all checks, missing URLs and technical fixes</Link></details>
 </>;
}

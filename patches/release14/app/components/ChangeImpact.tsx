import {metricPair} from '../core/analytics';
import {observedPage} from '../core/store-score';
import type {loadUI} from '../core/ui.server';
type Data=Awaited<ReturnType<typeof loadUI>>;
export function ChangeImpact({d,change}:{d:Data;change:Data['changes'][number]}){
 if(!change.appliedAt)return null;
 const metric=d.metrics.find(m=>m.provider==='change-impact'&&m.period===change.id);
 const baseline=metric?JSON.parse(metric.payload):null;
 const current=metricPair(d.metrics,'gsc')[0];
 const mature=baseline?.before&&current?.start&&Date.parse(current.start)>=new Date(change.appliedAt).getTime()&&Date.parse(current.end)-Date.parse(current.start)===27*86400000;
 const after=mature?observedPage(current.rows,baseline.url):null;
 return <details className="change-impact"><summary>What happened after this fix?</summary><p>{baseline?.target||'Page discovery and search traffic'} · saved {new Date(change.appliedAt).toLocaleDateString('en-GB')}{change.status==='rolled_back'?' · this change was subsequently undone.':'.'}</p>
 {!baseline?<p>This older change predates impact baselines. Its original search measurements were not recorded.</p>:<><p>{baseline.url||'Store-level update'} · {baseline.checksBefore===null?'No baseline audit':`${baseline.checksBefore} page checks needed attention before this update`}.</p>{!baseline.before?<p>No page-level search observations existed when this change was accepted. A zero baseline has not been invented.</p>:!after?<p>Baseline ({baseline.start} to {baseline.end}): {baseline.before.clicks} clicks / {baseline.before.impressions} impressions. Waiting for a complete, non-overlapping 28-day search period after this change. Refresh connected analytics in the following weeks.</p>:<div className="table-wrap"><table><thead><tr><th>Measure</th><th>Before: {baseline.start}–{baseline.end}</th><th>After: {current.start}–{current.end}</th></tr></thead><tbody><tr><td>Google clicks</td><td>{baseline.before.clicks}</td><td>{after.clicks}</td></tr><tr><td>Search impressions</td><td>{baseline.before.impressions}</td><td>{after.impressions}</td></tr><tr><td>Click rate</td><td>{baseline.before.ctr==null?'Unmeasured':`${(100*baseline.before.ctr).toFixed(1)}%`}</td><td>{after.ctr==null?'Unmeasured':`${(100*after.ctr).toFixed(1)}%`}</td></tr></tbody></table></div>}</>}
 <p>Search Console reports a subset of queries. Seasonality, other edits and ranking changes can affect these figures. This comparison does not establish that the edit caused the movement.</p></details>;
}

export function ObservedWins({d}:{d:Data}){
 const current=metricPair(d.metrics,'gsc')[0];
 const wins=d.changes.filter(c=>c.status==='applied'&&c.appliedAt).flatMap(c=>{const record=d.metrics.find(m=>m.provider==='change-impact'&&m.period===c.id);if(!record||!current?.start||!current.end)return [];const b=JSON.parse(record.payload);if(!b.before||Date.parse(current.start)<new Date(c.appliedAt!).getTime()||Date.parse(current.end)-Date.parse(current.start)!==27*86400000)return [];const a=observedPage(current.rows,b.url);return a&&a.clicks>b.before.clicks?[{change:c,before:b.before.clicks,after:a.clicks}]:[];});
 return <section className="card"><h2>Saved changes followed by more search clicks</h2><p>Complete 28-day periods after a saved change, compared with its recorded baseline. Timing is not proof the change caused the increase.</p>{wins.length?wins.slice(0,10).map(w=><div key={w.change.id}><p>{d.resources.find(r=>r.id===w.change.resourceId)?.title||'Updated page'}: {w.after-w.before} more Google clicks ({w.before} → {w.after}).</p><ChangeImpact d={d} change={w.change}/></div>):<p>No comparable improvement has been measured for the loaded saved changes yet. Keep the original baseline; refresh analytics after a full reporting period. We do not invent a zero baseline or promise a ranking gain.</p>}</section>;
}

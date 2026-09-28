import {answersBreakdown,type ObservationRow} from '../core/ai-answers';
/** Release 18: AI answers breakdown — each tracked question with who was cited instead. */
export function AiAnswers({observations,measuredAt}:{observations:ObservationRow[];measuredAt:string}){
 const rows=answersBreakdown(observations,Date.parse(measuredAt));
 return <section className="card" id="ai-answers"><h2>AI answers by question</h2>
  <p>Last 28 days of recorded answer samples. API samples do not represent every consumer answer.</p>
  {rows.length?<table><thead><tr><th>Question</th><th>Your store cited</th><th>Cited instead</th><th>Content gap</th></tr></thead><tbody>{rows.map(r=><tr key={r.prompt}><td>{r.prompt}<br/><small className="muted">{r.engines.join(', ')}</small></td><td>{r.cited} of {r.samples}{r.mentioned>r.cited?` (mentioned ${r.mentioned})`:''}</td><td>{r.competitors.length?r.competitors.map(c=>`${c.name} (${c.count})`).join(', '):'None named'}</td><td>{r.gap}</td></tr>)}</tbody></table>
  :<p className="muted">No answer samples in the last 28 days. Run an AI visibility check.</p>}
 </section>;
}

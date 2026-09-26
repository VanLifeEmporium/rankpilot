import type {Issue} from '../core/types';
export function HttpEvidence({issues}:{issues:Issue[]}){
 const groups=new Map<string,Issue[]>();
 for(const issue of issues){const status=issue.link?.status;const label=status===401||status===403?'Access denied to this check':status===429?'Rate limited':status&&status>=500?'Server error':status?`HTTP ${status}`:'Result unavailable';groups.set(label,[...(groups.get(label)||[]),issue]);}
 return <><p>These are crawler observations, not a count of confirmed broken customer pages. Open an affected URL and recheck before changing it.</p>{[...groups].map(([label,rows])=><div key={label}><strong>{label}: {new Set(rows.map(r=>r.resourceId)).size} pages</strong>{rows.slice(0,3).map((r,i)=><p key={r.resourceId+':'+i}>{r.link?.url||r.title} · {r.link?.status?`HTTP ${r.link.status}`:r.detail} · {r.link?.checkedAt?new Date(r.link.checkedAt).toLocaleString('en-GB'):'Check date not retained; run a fresh scan'}</p>)}</div>)}<p>A fresh store scan rechecks these addresses. Access-denied or rate-limited checks may require resolving crawler access rather than editing the page.</p></>;
}

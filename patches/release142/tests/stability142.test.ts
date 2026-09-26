import {expect,it} from 'vitest';
import {workspaceRevision,shareWorkspace} from '../app/core/live-refresh';
import {indexSummary} from '../app/core/index-summary';
import {findingImpact,findingName} from '../app/core/merchant-copy';
it('indexation progress never invalidates catalogue data, but completion does',()=>{
 const job={id:'inspection',kind:'indexation',status:'running',payload:JSON.stringify({progress:{checked:1,total:5000}})};
 const next={...job,payload:JSON.stringify({progress:{checked:4000,total:5000}})};
 expect(workspaceRevision([job])).toBe(workspaceRevision([next]));
 expect(workspaceRevision([job])).not.toBe(workspaceRevision([{...next,status:'completed'}]));
});
it('other completed work still triggers refresh and review handoff',()=>{
 const job={id:'draft',kind:'draft',status:'running',payload:'{}'};
 expect(workspaceRevision([job])).not.toBe(workspaceRevision([{...job,status:'completed',payload:'{"result":[{"changeId":"review"}]}'}]));
});
it('shares unchanged catalogue and audit arrays across progress snapshots',()=>{
 const previous={resources:[{id:'one'}],audits:[{score:82}],jobs:[{progress:1}]};
 const next=shareWorkspace(previous,{resources:[{id:'one'}],audits:[{score:82}],jobs:[{progress:2}]});
 expect(next.resources).toBe(previous.resources);expect(next.audits).toBe(previous.audits);expect(next.jobs).not.toBe(previous.jobs);
});
it('keeps 5000 URL records out of routine indexation responses',()=>{
 const summary=indexSummary(JSON.stringify({indexed:200,inspected:339,submitted:5000,rows:Array.from({length:5000},(_,i)=>({url:'https://s.test/'+i}))}));
 expect(summary.rows).toBeUndefined();expect(summary.inspected).toBe(339);expect(JSON.stringify(summary).length).toBeLessThan(200);
});
it('does not call blocked crawler requests confirmed broken pages',()=>{
 expect(findingName('http-error')).toContain('checks');
 expect(findingImpact({code:'http-error',severity:'warning',resourceId:'1',title:'Page',detail:'HTTP 403'}).impact).toContain('does not establish');
});

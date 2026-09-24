import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect,vi} from 'vitest';
import {jobResults,jobMessage,jobLabel} from '../app/core/job-feedback';
const state=vi.hoisted(()=>({job:{id:'audit-1',kind:'audit',status:'completed',payload:JSON.stringify({result:{score:82,issues:[]}})},section:'dashboard'}));
vi.mock('react-router',()=>({
 useLoaderData:()=>({jobs:[state.job],audits:[],resources:[],changes:[],metrics:[],observations:[],events:[],reports:[],discoveries:{},settings:{},credentialNames:[],domain:'test.myshopify.com',demo:false}),
 useParams:()=>({section:state.section}),useFetcher:()=>({state:'idle',data:{ok:true,jobId:state.job.id},submit:vi.fn(),Form:'form'}),
 useFormAction:()=>'/app',useRevalidator:()=>({revalidate:vi.fn()}),Link:({to,children,...props}:any)=>React.createElement('a',{href:to,...props},children)
}));
import Workspace from '../app/components/Workspace';
it.each(['dashboard','audit'])('renders %s after audit completion with an object result',section=>{
 state.section=section;
 expect(()=>renderToStaticMarkup(React.createElement(Workspace))).not.toThrow();
 expect(renderToStaticMarkup(React.createElement(Workspace))).toContain('Audit completed. Findings updated.');
});
it.each(['{}','null','invalid','{"result":null}','{"result":[null,3,{"message":5}]}'])('handles malformed or absent results: %s',payload=>{
 const job={kind:'optimise',status:'completed',payload};
 expect(jobResults(job)).toEqual([]);expect(jobMessage(job)).toContain('without readable result');
});
it('does not label a completed worker with a failed item as successful generation',()=>{
 const job={kind:'optimise',status:'completed',payload:JSON.stringify({result:[{error:'Needs manual review: source missing'}]})};
 expect(jobLabel(job)).toBe('needs attention');expect(jobMessage(job)).toContain('source missing');
});
it('reflects applied changes rather than stale proposal-ready messages',()=>{
 const job={kind:'optimise',status:'completed',payload:JSON.stringify({result:[{changeId:'c',message:'Proposal ready for review'}]})};
 expect(jobMessage(job,[{id:'c',status:'applied'}])).toBe('Change applied');
 expect(jobMessage(job,[{id:'c',status:'pending'}])).toContain('not published');
});
